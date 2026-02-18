import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  Thread,
  ThreadsData,
  ThreadSignals,
  ThreadPriority,
  PluginLogger,
} from "./types.js";
import { getPatterns, detectMood, HIGH_IMPACT_KEYWORDS, isNoiseTopic } from "./patterns.js";
import type { PatternLanguage } from "./patterns.js";
import { loadJson, saveJson, rebootDir, ensureRebootDir } from "./storage.js";

export type ThreadTrackerConfig = {
  enabled: boolean;
  pruneDays: number;
  maxThreads: number;
};

/**
 * Check if text matches a thread via word overlap (≥ minOverlap words from title in text).
 * Words shorter than 3 characters are excluded.
 */
export function matchesThread(thread: Thread, text: string, minOverlap = 2): boolean {
  const threadWords = new Set(
    thread.title.toLowerCase().split(/\s+/).filter(w => w.length > 2),
  );
  const textWords = new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length > 2),
  );

  let overlap = 0;
  for (const word of threadWords) {
    if (textWords.has(word)) overlap++;
  }
  return overlap >= minOverlap;
}

/**
 * Extract thread-related signals from message text.
 */
export function extractSignals(text: string, language: PatternLanguage): ThreadSignals {
  const patterns = getPatterns(language);
  const signals: ThreadSignals = { decisions: [], closures: [], waits: [], topics: [] };

  for (const pattern of patterns.decision) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      signals.decisions.push(text.slice(start, end).trim());
    }
  }

  for (const pattern of patterns.close) {
    if (pattern.test(text)) {
      signals.closures.push(true);
    }
  }

  for (const pattern of patterns.wait) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const end = Math.min(text.length, match.index + match[0].length + 80);
      signals.waits.push(text.slice(match.index, end).trim());
    }
  }

  for (const pattern of patterns.topic) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match[1]) {
        signals.topics.push(match[1].trim());
      }
    }
  }

  return signals;
}

/**
 * Infer thread priority from content.
 */
function inferPriority(text: string): ThreadPriority {
  const lower = text.toLowerCase();
  for (const kw of HIGH_IMPACT_KEYWORDS) {
    if (lower.includes(kw)) return "high";
  }
  return "medium";
}

/**
 * Thread Tracker — manages conversation thread state.
 */
export class ThreadTracker {
  private threads: Thread[] = [];
  private dirty = false;
  private writeable = true;
  private eventsProcessed = 0;
  private lastEventTimestamp = "";
  private sessionMood = "neutral";
  private readonly filePath: string;
  private readonly config: ThreadTrackerConfig;
  private readonly language: PatternLanguage;
  private readonly logger: PluginLogger;

  constructor(
    workspace: string,
    config: ThreadTrackerConfig,
    language: PatternLanguage,
    logger: PluginLogger,
  ) {
    this.config = config;
    this.language = language;
    this.logger = logger;
    this.filePath = join(rebootDir(workspace), "threads.json");

    // Ensure directory exists
    ensureRebootDir(workspace, logger);

    // Load existing state
    const data = loadJson<Partial<ThreadsData>>(this.filePath);
    this.threads = Array.isArray(data.threads) ? data.threads : [];
    this.sessionMood = data.session_mood ?? "neutral";
  }

  /** Create new threads from topic signals (with noise filtering). */
  private createFromTopics(topics: string[], sender: string, mood: string, now: string): void {
    for (const topic of topics) {
      if (isNoiseTopic(topic)) continue;
      const exists = this.threads.some(
        t => t.title.toLowerCase() === topic.toLowerCase() || matchesThread(t, topic),
      );
      if (!exists) {
        this.threads.push({
          id: randomUUID(), title: topic, status: "open",
          priority: inferPriority(topic), summary: `Topic detected from ${sender}`,
          decisions: [], waiting_for: null, mood, last_activity: now, created: now,
        });
      }
    }
  }

  /**
   * Apply LLM analysis results — creates threads, closes threads, adds decisions.
   * Called from hooks when LLM enhance is enabled.
   */
  applyLlmAnalysis(analysis: {
    threads: Array<{ title: string; status: "open" | "closed"; summary?: string }>;
    closures: string[];
    mood: string;
  }): void {
    const now = new Date().toISOString();

    // Create threads from LLM
    for (const lt of analysis.threads) {
      if (isNoiseTopic(lt.title)) continue;
      const exists = this.threads.some(
        t => t.title.toLowerCase() === lt.title.toLowerCase() || matchesThread(t, lt.title),
      );
      if (!exists) {
        this.threads.push({
          id: randomUUID(), title: lt.title, status: lt.status,
          priority: inferPriority(lt.title), summary: lt.summary ?? "LLM-detected",
          decisions: [], waiting_for: null, mood: analysis.mood ?? "neutral",
          last_activity: now, created: now,
        });
      }
    }

    // Close threads from LLM closures
    for (const closure of analysis.closures) {
      for (const thread of this.threads) {
        if (thread.status === "open" && matchesThread(thread, closure)) {
          thread.status = "closed";
          thread.last_activity = now;
        }
      }
    }

    // Update session mood
    if (analysis.mood && analysis.mood !== "neutral") {
      this.sessionMood = analysis.mood;
    }

    this.dirty = true;
    this.persist();
  }

  /** Close threads matching closure signals. */
  private closeMatching(content: string, closures: boolean[], now: string): void {
    if (closures.length === 0) return;
    for (const thread of this.threads) {
      if (thread.status === "open" && matchesThread(thread, content)) {
        thread.status = "closed";
        thread.last_activity = now;
      }
    }
  }

  /** Append decisions to matching threads. */
  private applyDecisions(decisions: string[], now: string): void {
    for (const ctx of decisions) {
      for (const thread of this.threads) {
        if (thread.status === "open" && matchesThread(thread, ctx)) {
          const short = ctx.slice(0, 100);
          if (!thread.decisions.includes(short)) {
            thread.decisions.push(short);
            thread.last_activity = now;
          }
        }
      }
    }
  }

  /** Update waiting_for on matching threads. */
  private applyWaits(waits: string[], content: string, now: string): void {
    for (const waitCtx of waits) {
      for (const thread of this.threads) {
        if (thread.status === "open" && matchesThread(thread, content)) {
          thread.waiting_for = waitCtx.slice(0, 100);
          thread.last_activity = now;
        }
      }
    }
  }

  /** Update mood on active threads matching content. */
  private applyMood(mood: string, content: string): void {
    if (mood === "neutral") return;
    for (const thread of this.threads) {
      if (thread.status === "open" && matchesThread(thread, content)) {
        thread.mood = mood;
      }
    }
  }

  /**
   * Process a message: extract signals, update threads, persist.
   */
  processMessage(content: string, sender: string): void {
    if (!content) return;

    const signals = extractSignals(content, this.language);
    const mood = detectMood(content);
    const now = new Date().toISOString();

    this.eventsProcessed++;
    this.lastEventTimestamp = now;
    if (mood !== "neutral") this.sessionMood = mood;

    this.createFromTopics(signals.topics, sender, mood, now);
    this.closeMatching(content, signals.closures, now);
    this.applyDecisions(signals.decisions, now);
    this.applyWaits(signals.waits, content, now);
    this.applyMood(mood, content);

    this.dirty = true;
    this.pruneAndCap();
    this.persist();
  }

  /**
   * Prune closed threads older than pruneDays and enforce maxThreads cap.
   */
  private pruneAndCap(): void {
    const cutoff = new Date(
      Date.now() - this.config.pruneDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Remove closed threads older than cutoff
    this.threads = this.threads.filter(
      t => !(t.status === "closed" && t.last_activity < cutoff),
    );

    // Enforce maxThreads cap — remove oldest closed threads first
    if (this.threads.length > this.config.maxThreads) {
      const open = this.threads.filter(t => t.status === "open");
      const closed = this.threads
        .filter(t => t.status === "closed")
        .sort((a, b) => a.last_activity.localeCompare(b.last_activity));

      const budget = this.config.maxThreads - open.length;
      this.threads = [...open, ...closed.slice(Math.max(0, closed.length - budget))];
    }
  }

  /**
   * Attempt to persist current state to disk.
   */
  private persist(): void {
    if (!this.writeable) return;

    const ok = saveJson(this.filePath, this.buildData(), this.logger);
    if (!ok) {
      this.writeable = false;
      this.logger.warn("[cortex] Workspace not writable — running in-memory only");
    }
    if (ok) this.dirty = false;
  }

  /**
   * Build the ThreadsData object for serialization.
   */
  private buildData(): ThreadsData {
    return {
      version: 2,
      updated: new Date().toISOString(),
      threads: this.threads,
      integrity: {
        last_event_timestamp: this.lastEventTimestamp || new Date().toISOString(),
        events_processed: this.eventsProcessed,
        source: "hooks",
      },
      session_mood: this.sessionMood,
    };
  }

  /**
   * Force-flush state to disk. Called by pre-compaction.
   */
  flush(): boolean {
    if (!this.dirty) return true;
    return saveJson(this.filePath, this.buildData(), this.logger);
  }

  /**
   * Get current thread list (in-memory).
   */
  getThreads(): Thread[] {
    return [...this.threads];
  }

  /**
   * Get current session mood.
   */
  getSessionMood(): string {
    return this.sessionMood;
  }

  /**
   * Get events processed count.
   */
  getEventsProcessed(): number {
    return this.eventsProcessed;
  }
}

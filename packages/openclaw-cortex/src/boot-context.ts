import { join } from "node:path";
import type {
  Thread,
  Decision,
  ThreadsData,
  DecisionsData,
  ExecutionMode,
  PluginLogger,
  CortexConfig,
  Mood,
} from "./types.js";
import { MOOD_EMOJI, PRIORITY_EMOJI, PRIORITY_ORDER } from "./types.js";
import { loadJson, loadText, rebootDir, isFileOlderThan, saveText, ensureRebootDir } from "./storage.js";

/**
 * Determine execution mode from current hour.
 */
export function getExecutionMode(): ExecutionMode {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return "Morning — brief, directive, efficient";
  if (hour >= 12 && hour < 18) return "Afternoon — execution mode";
  if (hour >= 18 && hour < 22) return "Evening — strategic, philosophical possible";
  return "Night — emergencies only";
}

/**
 * Load threads data from disk.
 */
function loadThreadsData(workspace: string): Partial<ThreadsData> {
  const data = loadJson<Partial<ThreadsData>>(
    join(rebootDir(workspace), "threads.json"),
  );
  // Handle legacy format where data is an array
  if (Array.isArray(data)) {
    return { threads: data as unknown as Thread[] };
  }
  return data;
}

/**
 * Get sorted open threads by priority and recency.
 */
export function getOpenThreads(workspace: string, limit: number): Thread[] {
  const data = loadThreadsData(workspace);
  const threads = (data.threads ?? []).filter(t => t.status === "open");

  threads.sort((a, b) => {
    const priA = PRIORITY_ORDER[a.priority] ?? 3;
    const priB = PRIORITY_ORDER[b.priority] ?? 3;
    if (priA !== priB) return priA - priB;
    // More recent first
    return b.last_activity.localeCompare(a.last_activity);
  });

  return threads.slice(0, limit);
}

/**
 * Generate staleness warning from integrity data.
 */
export function integrityWarning(workspace: string): string {
  const data = loadThreadsData(workspace);
  const integrity = data.integrity;

  if (!integrity?.last_event_timestamp) {
    return "⚠️ No integrity data — thread tracker may not have run yet.";
  }

  try {
    const lastTs = integrity.last_event_timestamp;
    const lastDt = new Date(lastTs.endsWith("Z") ? lastTs : lastTs + "Z");
    const ageMin = (Date.now() - lastDt.getTime()) / 60000;

    if (ageMin > 480) {
      return `🚨 STALE DATA: Thread data is ${Math.round(ageMin / 60)}h old.`;
    }
    if (ageMin > 120) {
      return `⚠️ Data staleness: Thread data is ${Math.round(ageMin / 60)}h old.`;
    }
    return "";
  } catch {
    return "⚠️ Could not parse integrity timestamp.";
  }
}

/**
 * Load hot snapshot if it's fresh (< 1 hour old).
 */
function loadHotSnapshot(workspace: string): string {
  const filePath = join(rebootDir(workspace), "hot-snapshot.md");
  if (isFileOlderThan(filePath, 1)) return "";
  const content = loadText(filePath);
  return content.trim().slice(0, 1000);
}

/**
 * Load decisions from the last N days, return last `limit` entries.
 */
function loadRecentDecisions(workspace: string, days: number, limit: number): Decision[] {
  const data = loadJson<Partial<DecisionsData>>(
    join(rebootDir(workspace), "decisions.json"),
  );
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];

  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10);

  return decisions
    .filter(d => d.date >= cutoff)
    .slice(-limit);
}

/**
 * Load narrative if it's fresh (< 36 hours old).
 */
function loadNarrative(workspace: string): string {
  const filePath = join(rebootDir(workspace), "narrative.md");
  if (isFileOlderThan(filePath, 36)) return "";
  const content = loadText(filePath);
  return content.trim().slice(0, 2000);
}

/**
 * Boot Context Generator — assembles BOOTSTRAP.md from persisted state.
 */
export class BootContextGenerator {
  private readonly workspace: string;
  private readonly config: CortexConfig["bootContext"];
  private readonly logger: PluginLogger;

  constructor(
    workspace: string,
    config: CortexConfig["bootContext"],
    logger: PluginLogger,
  ) {
    this.workspace = workspace;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Check if boot context should be generated.
   */
  shouldGenerate(): boolean {
    return this.config.enabled && this.config.onSessionStart;
  }

  /** Build header section. */
  private buildHeader(): string {
    const now = new Date();
    return [
      "# Context Briefing",
      `Generated: ${now.toISOString().slice(0, 19)}Z | Local: ${now.toTimeString().slice(0, 5)}`,
      "",
    ].join("\n");
  }

  /** Build state section (mode, mood, warnings). */
  private buildState(): string {
    const lines: string[] = ["## ⚡ State", `Mode: ${getExecutionMode()}`];

    const threadsData = loadThreadsData(this.workspace);
    const mood = (threadsData.session_mood ?? "neutral") as Mood;
    if (mood !== "neutral") {
      lines.push(`Last session mood: ${mood} ${MOOD_EMOJI[mood] ?? ""}`);
    }

    const warning = integrityWarning(this.workspace);
    if (warning) {
      lines.push("", warning);
    }
    lines.push("");
    return lines.join("\n");
  }

  /** Build threads section. */
  private buildThreads(threads: Thread[]): string {
    if (threads.length === 0) return "";
    const lines: string[] = ["## 🧵 Active Threads"];
    for (const t of threads) {
      const priEmoji = PRIORITY_EMOJI[t.priority] ?? "⚪";
      const moodTag = t.mood && t.mood !== "neutral" ? ` [${t.mood}]` : "";
      lines.push("", `### ${priEmoji} ${t.title}${moodTag}`);
      lines.push(`Priority: ${t.priority} | Last: ${t.last_activity.slice(0, 16)}`);
      lines.push(`Summary: ${t.summary || "no summary"}`);
      if (t.waiting_for) lines.push(`⏳ Waiting for: ${t.waiting_for}`);
      if (t.decisions.length > 0) lines.push(`Decisions: ${t.decisions.join(", ")}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  /** Build decisions section. */
  private buildDecisions(decisions: Decision[]): string {
    if (decisions.length === 0) return "";
    const impactEmoji: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
    const lines: string[] = ["## 🎯 Recent Decisions"];
    for (const d of decisions) {
      lines.push(`- ${impactEmoji[d.impact] ?? "⚪"} **${d.what}** (${d.date})`);
      if (d.why) lines.push(`  Why: ${d.why.slice(0, 100)}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Assemble and return BOOTSTRAP.md content.
   */
  generate(): string {
    ensureRebootDir(this.workspace, this.logger);

    const threads = getOpenThreads(this.workspace, this.config.maxThreadsInBoot);
    const decisions = loadRecentDecisions(
      this.workspace, this.config.decisionRecencyDays, this.config.maxDecisionsInBoot,
    );
    const hot = loadHotSnapshot(this.workspace);
    const narrative = loadNarrative(this.workspace);

    const sections = [
      this.buildHeader(),
      this.buildState(),
      hot ? `## 🔥 Last Session Snapshot\n${hot}\n` : "",
      narrative ? `## 📖 Narrative (last 24h)\n${narrative}\n` : "",
      this.buildThreads(threads),
      this.buildDecisions(decisions),
      "---",
      `_Boot context | ${threads.length} active threads | ${decisions.length} recent decisions_`,
    ];

    let result = sections.filter(Boolean).join("\n");

    if (result.length > this.config.maxChars) {
      result = result.slice(0, this.config.maxChars) + "\n\n_[truncated to token budget]_";
    }

    return result;
  }

  /**
   * Generate and write BOOTSTRAP.md to the workspace root.
   */
  write(): boolean {
    try {
      const content = this.generate();
      const outputPath = join(this.workspace, "BOOTSTRAP.md");
      return saveText(outputPath, content, this.logger);
    } catch (err) {
      this.logger.warn(`[cortex] Boot context generation failed: ${err}`);
      return false;
    }
  }
}

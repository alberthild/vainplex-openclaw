import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  Decision,
  DecisionsData,
  ImpactLevel,
  PluginLogger,
} from "./types.js";
import { getPatterns, HIGH_IMPACT_KEYWORDS } from "./patterns.js";
import type { PatternLanguage } from "./patterns.js";
import { loadJson, saveJson, rebootDir, ensureRebootDir } from "./storage.js";

export type DecisionTrackerConfig = {
  enabled: boolean;
  maxDecisions: number;
  dedupeWindowHours: number;
};

/**
 * Infer impact level from decision context text.
 */
export function inferImpact(text: string): ImpactLevel {
  const lower = text.toLowerCase();
  for (const kw of HIGH_IMPACT_KEYWORDS) {
    if (lower.includes(kw)) return "high";
  }
  return "medium";
}

/**
 * Extract context window around a match: 50 chars before, 100 chars after.
 */
function extractContext(text: string, matchIndex: number, matchLength: number): { what: string; why: string } {
  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(text.length, matchIndex + matchLength + 100);
  const what = text.slice(start, end).trim();

  // Wider context for "why"
  const whyStart = Math.max(0, matchIndex - 100);
  const whyEnd = Math.min(text.length, matchIndex + matchLength + 200);
  const why = text.slice(whyStart, whyEnd).trim();

  return { what, why };
}

/**
 * Decision Tracker — extracts and persists decisions from messages.
 */
export class DecisionTracker {
  private decisions: Decision[] = [];
  private readonly filePath: string;
  private readonly config: DecisionTrackerConfig;
  private readonly language: PatternLanguage;
  private readonly logger: PluginLogger;
  private writeable = true;

  constructor(
    workspace: string,
    config: DecisionTrackerConfig,
    language: PatternLanguage,
    logger: PluginLogger,
  ) {
    this.config = config;
    this.language = language;
    this.logger = logger;
    this.filePath = join(rebootDir(workspace), "decisions.json");

    // Ensure directory exists
    ensureRebootDir(workspace, logger);

    // Load existing state
    const data = loadJson<Partial<DecisionsData>>(this.filePath);
    this.decisions = Array.isArray(data.decisions) ? data.decisions : [];
  }

  /**
   * Process a message: scan for decision patterns, dedup, persist.
   */
  processMessage(content: string, sender: string): void {
    if (!content) return;

    const patterns = getPatterns(this.language);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    let changed = false;

    for (const pattern of patterns.decision) {
      const globalPattern = new RegExp(pattern.source, "gi");
      let match: RegExpExecArray | null;
      while ((match = globalPattern.exec(content)) !== null) {
        const { what, why } = extractContext(content, match.index, match[0].length);

        // Deduplication: skip if identical 'what' exists within dedupeWindow
        if (this.isDuplicate(what, now)) continue;

        const decision: Decision = {
          id: randomUUID(),
          what,
          date: dateStr,
          why,
          impact: inferImpact(what + " " + why),
          who: sender,
          extracted_at: now.toISOString(),
        };

        this.decisions.push(decision);
        changed = true;
      }
    }

    if (changed) {
      this.enforceMax();
      this.persist();
    }
  }

  /**
   * Check if a decision with the same 'what' exists within the dedup window.
   */
  private isDuplicate(what: string, now: Date): boolean {
    const windowMs = this.config.dedupeWindowHours * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - windowMs).toISOString();

    return this.decisions.some(
      d => d.what === what && d.extracted_at >= cutoff,
    );
  }

  /**
   * Enforce maxDecisions cap — remove oldest decisions first.
   */
  private enforceMax(): void {
    if (this.decisions.length > this.config.maxDecisions) {
      this.decisions = this.decisions.slice(
        this.decisions.length - this.config.maxDecisions,
      );
    }
  }

  /**
   * Persist decisions to disk.
   */
  private persist(): void {
    if (!this.writeable) return;

    const data: DecisionsData = {
      version: 1,
      updated: new Date().toISOString(),
      decisions: this.decisions,
    };

    const ok = saveJson(this.filePath, data, this.logger);
    if (!ok) {
      this.writeable = false;
      this.logger.warn("[cortex] Decision tracker: workspace not writable");
    }
  }

  /**
   * Add a decision directly (from LLM analysis). Deduplicates and persists.
   */
  addDecision(what: string, who: string, impact: ImpactLevel | string): void {
    const now = new Date();
    if (this.isDuplicate(what, now)) return;

    const validImpact = (["critical", "high", "medium", "low"].includes(impact) ? impact : "medium") as ImpactLevel;

    this.decisions.push({
      id: randomUUID(),
      what: what.slice(0, 200),
      date: now.toISOString().slice(0, 10),
      why: `LLM-detected decision (${who})`,
      impact: validImpact,
      who,
      extracted_at: now.toISOString(),
    });

    this.enforceMax();
    this.persist();
  }

  /**
   * Get all decisions (in-memory).
   */
  getDecisions(): Decision[] {
    return [...this.decisions];
  }

  /**
   * Get recent decisions within N days.
   */
  getRecentDecisions(days: number, limit: number): Decision[] {
    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10);

    return this.decisions
      .filter(d => d.date >= cutoff)
      .slice(-limit);
  }
}

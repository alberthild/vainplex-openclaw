import { join } from "node:path";
import type {
  Thread,
  Decision,
  ThreadsData,
  DecisionsData,
  NarrativeSections,
  PluginLogger,
} from "./types.js";
import { loadJson, loadText, rebootDir, saveText, ensureRebootDir } from "./storage.js";

/**
 * Load daily notes for today and yesterday.
 */
export function loadDailyNotes(workspace: string): string {
  const parts: string[] = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const date of [yesterday, today]) {
    const filePath = join(workspace, "memory", `${date}.md`);
    const content = loadText(filePath);
    if (content) {
      parts.push(`## ${date}\n${content.slice(0, 4000)}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Load threads from threads.json.
 */
function loadThreads(workspace: string): Thread[] {
  const data = loadJson<Partial<ThreadsData>>(
    join(rebootDir(workspace), "threads.json"),
  );
  return Array.isArray(data.threads) ? data.threads : [];
}

/**
 * Load recent decisions (from last 24h).
 */
function loadRecentDecisions(workspace: string): Decision[] {
  const data = loadJson<Partial<DecisionsData>>(
    join(rebootDir(workspace), "decisions.json"),
  );
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];

  const yesterday = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10);

  return decisions.filter(d => d.date >= yesterday);
}

/**
 * Extract timeline entries from daily notes.
 */
export function extractTimeline(notes: string): string[] {
  const entries: string[] = [];
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    // Skip date headers (## 2026-02-17)
    if (trimmed.startsWith("## ") && !trimmed.match(/^## \d{4}-\d{2}-\d{2}/)) {
      entries.push(trimmed.slice(3));
    } else if (trimmed.startsWith("### ")) {
      entries.push(`  ${trimmed.slice(4)}`);
    }
  }
  return entries;
}

/**
 * Build narrative sections from data.
 */
export function buildSections(
  threads: Thread[],
  decisions: Decision[],
  notes: string,
): NarrativeSections {
  const now = new Date();
  const yesterday = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10);

  const completed = threads.filter(
    t => t.status === "closed" && t.last_activity.slice(0, 10) >= yesterday,
  );
  const open = threads.filter(t => t.status === "open");
  const timelineEntries = extractTimeline(notes);

  return { completed, open, decisions, timelineEntries };
}

/**
 * Generate a structured narrative from sections.
 */
export function generateStructured(sections: NarrativeSections): string {
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = dayNames[now.getDay()];
  const date = now.getDate();
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();

  const parts: string[] = [
    `*${day}, ${String(date).padStart(2, "0")}. ${month} ${year} — Narrative*\n`,
  ];

  if (sections.completed.length > 0) {
    parts.push("**Completed:**");
    for (const t of sections.completed) {
      parts.push(`- ✅ ${t.title}: ${(t.summary || "").slice(0, 100)}`);
    }
    parts.push("");
  }

  if (sections.open.length > 0) {
    parts.push("**Open:**");
    for (const t of sections.open) {
      const emoji = t.priority === "critical" ? "🔴" : "🟡";
      parts.push(`- ${emoji} ${t.title}: ${(t.summary || "").slice(0, 150)}`);
      if (t.waiting_for) {
        parts.push(`  ⏳ ${t.waiting_for}`);
      }
    }
    parts.push("");
  }

  if (sections.decisions.length > 0) {
    parts.push("**Decisions:**");
    for (const d of sections.decisions) {
      parts.push(`- ${d.what} — ${(d.why || "").slice(0, 80)}`);
    }
    parts.push("");
  }

  if (sections.timelineEntries.length > 0) {
    parts.push("**Timeline:**");
    for (const entry of sections.timelineEntries) {
      parts.push(`- ${entry}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Narrative Generator — creates a structured narrative from recent activity.
 */
export class NarrativeGenerator {
  private readonly workspace: string;
  private readonly logger: PluginLogger;

  constructor(workspace: string, logger: PluginLogger) {
    this.workspace = workspace;
    this.logger = logger;
  }

  /**
   * Generate and write narrative.md.
   */
  generate(): string {
    ensureRebootDir(this.workspace, this.logger);

    const notes = loadDailyNotes(this.workspace);
    const threads = loadThreads(this.workspace);
    const decisions = loadRecentDecisions(this.workspace);

    const sections = buildSections(threads, decisions, notes);
    return generateStructured(sections);
  }

  /**
   * Generate and write to disk.
   */
  write(): boolean {
    try {
      const narrative = this.generate();
      const filePath = join(rebootDir(this.workspace), "narrative.md");
      return saveText(filePath, narrative, this.logger);
    } catch (err) {
      this.logger.warn(`[cortex] Narrative generation failed: ${err}`);
      return false;
    }
  }
}

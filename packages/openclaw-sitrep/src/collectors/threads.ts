import { readJsonSafe } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface ThreadsCollectorConfig extends CollectorConfig {
  threadsPath?: string;
  staleDays?: number;
}

interface Thread {
  id?: string;
  topic?: string;
  status?: string;
  last_activity?: string;
  priority?: string;
  [key: string]: unknown;
}

interface ThreadsData {
  threads?: Thread[];
  open?: number;
  closed?: number;
  [key: string]: unknown;
}

/**
 * Collector: Conversation threads.
 * Detects stale threads and high-priority open items.
 */
export const collectThreads: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const tConfig = config as ThreadsCollectorConfig;
  const threadsPath = tConfig.threadsPath;

  if (!threadsPath) {
    return { status: "ok", items: [], summary: "no threadsPath configured", duration_ms: 0 };
  }

  const raw = readJsonSafe<ThreadsData>(threadsPath);
  if (!raw) {
    return { status: "ok", items: [], summary: "threads file not found", duration_ms: 0 };
  }

  const threads = raw.threads ?? [];
  const items: SitrepItem[] = [];
  const staleDays = tConfig.staleDays ?? 7;
  const now = Date.now();

  const openThreads = threads.filter((t) => t.status === "open" || !t.status);

  for (const thread of openThreads) {
    const lastActivity = thread.last_activity ? new Date(thread.last_activity).getTime() : 0;
    const ageDays = lastActivity ? (now - lastActivity) / 86_400_000 : 0;

    if (ageDays > staleDays) {
      items.push({
        id: `thread-${thread.id ?? "unknown"}-stale`,
        source: "threads",
        severity: "info",
        category: "informational",
        title: `Thread stale (${Math.round(ageDays)}d): ${thread.topic ?? "unknown"}`,
        score: 15,
      });
    }
  }

  return {
    status: items.length > 5 ? "warn" : "ok",
    items,
    summary: `${openThreads.length} open threads, ${items.length} stale (>${staleDays}d)`,
    duration_ms: 0,
  };
};

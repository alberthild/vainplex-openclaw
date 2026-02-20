import { readJsonSafe } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface GoalsCollectorConfig extends CollectorConfig {
  goalsPath?: string;
  staleHours?: number;
}

interface Goal {
  id?: string;
  title?: string;
  status?: string;
  zone?: string;
  source_type?: string;
  proposed_at?: string;
  approved_at?: string;
  [key: string]: unknown;
}

/**
 * Collector: Goal Engine goals.
 * Detects open, stale, blocked, or red-zone goals that need attention.
 */
export const collectGoals: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const goalsConfig = config as GoalsCollectorConfig;
  const goalsPath = goalsConfig.goalsPath;

  if (!goalsPath) {
    return { status: "ok", items: [], summary: "no goalsPath configured", duration_ms: 0 };
  }

  const data = readJsonSafe<Goal[]>(goalsPath);
  if (!data || !Array.isArray(data)) {
    return { status: "ok", items: [], summary: "goals file not found or empty", duration_ms: 0 };
  }

  const items: SitrepItem[] = [];
  const staleHours = goalsConfig.staleHours ?? 48;

  const open = data.filter((g) => g.status === "proposed" || g.status === "approved" || g.status === "in_progress");
  const redZone = open.filter((g) => g.zone === "red");
  const now = Date.now();

  for (const goal of open) {
    const id = goal.id ?? "unknown";
    const title = goal.title ?? "Untitled goal";
    const proposedAt = goal.proposed_at ? new Date(goal.proposed_at).getTime() : 0;
    const ageHours = proposedAt ? (now - proposedAt) / 3_600_000 : 0;

    if (goal.zone === "red" && goal.status === "approved") {
      items.push({
        id: `goal-${id}-red-approved`,
        source: "goals",
        severity: "warn",
        category: "needs_owner",
        title: `Red-zone goal awaiting manual execution: ${title}`,
        detail: `Status: ${goal.status}, Zone: red`,
        score: 70,
      });
    } else if (ageHours > staleHours && goal.status === "proposed") {
      items.push({
        id: `goal-${id}-stale`,
        source: "goals",
        severity: "info",
        category: "needs_owner",
        title: `Goal proposed ${Math.round(ageHours)}h ago, not yet approved: ${title}`,
        score: 20,
      });
    }
  }

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${open.length} open goals (${redZone.length} red-zone), ${items.length} need attention`,
    duration_ms: 0,
  };
};

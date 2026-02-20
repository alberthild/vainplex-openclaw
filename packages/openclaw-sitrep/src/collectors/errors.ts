import { readJsonSafe } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface ErrorsCollectorConfig extends CollectorConfig {
  patternsPath?: string;
  recentHours?: number;
}

interface ErrorPattern {
  id?: string;
  pattern?: string;
  type?: string;
  severity?: string;
  count?: number;
  first_seen?: string;
  last_seen?: string;
  [key: string]: unknown;
}

/**
 * Collector: Error patterns.
 * Surfaces recent critical/high errors that haven't been addressed.
 */
export const collectErrors: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const eConfig = config as ErrorsCollectorConfig;
  const patternsPath = eConfig.patternsPath;

  if (!patternsPath) {
    return { status: "ok", items: [], summary: "no patternsPath configured", duration_ms: 0 };
  }

  const data = readJsonSafe<ErrorPattern[]>(patternsPath);
  if (!data || !Array.isArray(data)) {
    return { status: "ok", items: [], summary: "error patterns file not found", duration_ms: 0 };
  }

  const items: SitrepItem[] = [];
  const recentHours = eConfig.recentHours ?? 24;
  const now = Date.now();
  const cutoff = now - recentHours * 3_600_000;

  const recent = data.filter((p) => {
    const lastSeen = p.last_seen ? new Date(p.last_seen).getTime() : 0;
    return lastSeen > cutoff;
  });

  const critical = recent.filter(
    (p) => p.severity === "critical" || p.severity === "high",
  );

  for (const err of critical.slice(0, 10)) {
    items.push({
      id: `error-${err.id ?? err.pattern?.slice(0, 20) ?? "unknown"}`,
      source: "errors",
      severity: err.severity === "critical" ? "critical" : "warn",
      category: "needs_owner",
      title: `${err.severity?.toUpperCase()}: ${err.pattern ?? "unknown pattern"}`,
      detail: `Type: ${err.type ?? "?"}, Count: ${err.count ?? "?"}, Last: ${err.last_seen ?? "?"}`,
      score: err.severity === "critical" ? 100 : 60,
    });
  }

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.length > 0
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${recent.length} recent errors (${critical.length} critical/high)`,
    duration_ms: 0,
  };
};

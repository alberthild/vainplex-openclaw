import { safeCollect, readJsonSafe } from "./collector.js";
import { collectSystemdTimers } from "./collectors/systemd-timers.js";
import { collectNats } from "./collectors/nats.js";
import { collectGoals } from "./collectors/goals.js";
import { collectThreads } from "./collectors/threads.js";
import { collectErrors } from "./collectors/errors.js";
import { collectCalendar } from "./collectors/calendar.js";
import { runCustomCollector } from "./collectors/custom.js";
import type {
  SitrepConfig,
  SitrepReport,
  SitrepItem,
  CollectorFn,
  CollectorResult,
  PluginLogger,
} from "./types.js";

/** Registry of built-in collectors. */
const BUILT_IN_COLLECTORS: Record<string, CollectorFn> = {
  systemd_timers: collectSystemdTimers,
  nats: collectNats,
  goals: collectGoals,
  threads: collectThreads,
  errors: collectErrors,
  calendar: collectCalendar,
};

/** Run all built-in and custom collectors. */
async function runAllCollectors(
  config: SitrepConfig,
  logger: PluginLogger,
): Promise<Record<string, CollectorResult>> {
  const results: Record<string, CollectorResult> = {};

  for (const [name, fn] of Object.entries(BUILT_IN_COLLECTORS)) {
    const collectorConfig = config.collectors[name] ?? { enabled: false };
    results[name] = await safeCollect(name, fn, collectorConfig, logger);
  }

  for (const customDef of config.customCollectors) {
    const start = Date.now();
    try {
      const result = await runCustomCollector(customDef, logger);
      result.duration_ms = Date.now() - start;
      results[`custom:${customDef.id}`] = result;
    } catch (err) {
      results[`custom:${customDef.id}`] = {
        status: "error",
        items: [],
        summary: `error: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return results;
}

/** Compute overall health from items. */
function computeHealth(
  items: SitrepItem[],
  results: Record<string, CollectorResult>,
): SitrepReport["health"] {
  const details: Record<string, "ok" | "warn" | "critical" | "error" | "disabled"> = {};
  for (const [name, result] of Object.entries(results)) {
    details[name] = result.status as "ok" | "warn" | "critical" | "error" | "disabled";
  }

  const overall: "ok" | "warn" | "critical" = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  return { overall, details };
}

/** Compute delta against previous sitrep. */
function computeDelta(
  currentItems: SitrepItem[],
  previousPath: string,
): SitrepReport["delta"] {
  const previous = readJsonSafe<SitrepReport>(previousPath);
  const previousItemIds = new Set(previous?.items?.map((i) => i.id) ?? []);
  const currentItemIds = new Set(currentItems.map((i) => i.id));

  return {
    new_items: currentItems.filter((i) => !previousItemIds.has(i.id)).length,
    resolved_items: [...previousItemIds].filter((id) => !currentItemIds.has(id)).length,
    previous_generated: previous?.generated ?? null,
  };
}

/** Generate a human-readable summary string. */
function generateSummary(
  categories: SitrepReport["categories"],
  results: Record<string, CollectorResult>,
  maxChars: number,
): string {
  const parts: string[] = [];

  if (categories.needs_owner.length > 0) {
    parts.push(`${categories.needs_owner.length} item(s) need owner attention`);
  }
  if (categories.auto_fixable.length > 0) {
    parts.push(`${categories.auto_fixable.length} auto-fixable`);
  }

  for (const [name, result] of Object.entries(results)) {
    if (result.status !== "ok" && result.summary !== "disabled") {
      parts.push(`${name}: ${result.summary}`);
    }
  }

  if (parts.length === 0) {
    parts.push("All systems nominal");
  }

  return (parts.join(". ") + ".").slice(0, maxChars);
}

/**
 * Generate a full situation report.
 */
export async function generateSitrep(
  config: SitrepConfig,
  logger: PluginLogger,
): Promise<SitrepReport> {
  const results = await runAllCollectors(config, logger);

  // Flatten and sort items
  const allItems: SitrepItem[] = Object.values(results)
    .flatMap((r) => r.items)
    .sort((a, b) => b.score - a.score);

  // Categorize
  const categories: SitrepReport["categories"] = {
    needs_owner: allItems.filter((i) => i.category === "needs_owner"),
    auto_fixable: allItems.filter((i) => i.category === "auto_fixable"),
    delegatable: allItems.filter((i) => i.category === "delegatable"),
    informational: allItems.filter((i) => i.category === "informational"),
  };

  // Build collector metadata
  const collectors: SitrepReport["collectors"] = {};
  for (const [name, result] of Object.entries(results)) {
    collectors[name] = {
      status: result.status,
      duration_ms: result.duration_ms,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  return {
    version: 1,
    generated: new Date().toISOString(),
    summary: generateSummary(categories, results, config.summaryMaxChars),
    health: computeHealth(allItems, results),
    items: allItems,
    categories,
    delta: computeDelta(allItems, config.previousPath),
    collectors,
  };
}

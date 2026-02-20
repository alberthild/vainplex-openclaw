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

/**
 * Generate a full situation report.
 */
export async function generateSitrep(
  config: SitrepConfig,
  logger: PluginLogger,
): Promise<SitrepReport> {
  const collectorResults: Record<string, CollectorResult> = {};
  const allItems: SitrepItem[] = [];

  // Run built-in collectors
  for (const [name, fn] of Object.entries(BUILT_IN_COLLECTORS)) {
    const collectorConfig = config.collectors[name] ?? { enabled: false };
    const result = await safeCollect(name, fn, collectorConfig, logger);
    collectorResults[name] = result;
    allItems.push(...result.items);
  }

  // Run custom collectors
  for (const customDef of config.customCollectors) {
    const start = Date.now();
    try {
      const result = await runCustomCollector(customDef, logger);
      result.duration_ms = Date.now() - start;
      collectorResults[`custom:${customDef.id}`] = result;
      allItems.push(...result.items);
    } catch (err) {
      collectorResults[`custom:${customDef.id}`] = {
        status: "error",
        items: [],
        summary: `error: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Sort by score (highest first)
  allItems.sort((a, b) => b.score - a.score);

  // Categorize
  const categories: SitrepReport["categories"] = {
    needs_owner: allItems.filter((i) => i.category === "needs_owner"),
    auto_fixable: allItems.filter((i) => i.category === "auto_fixable"),
    delegatable: allItems.filter((i) => i.category === "delegatable"),
    informational: allItems.filter((i) => i.category === "informational"),
  };

  // Compute overall health
  const collectorStatuses = Object.entries(collectorResults).reduce(
    (acc, [name, result]) => {
      acc[name] = result.status as "ok" | "warn" | "critical" | "error" | "disabled";
      return acc;
    },
    {} as Record<string, "ok" | "warn" | "critical" | "error" | "disabled">,
  );

  const overallHealth: "ok" | "warn" | "critical" = allItems.some(
    (i) => i.severity === "critical",
  )
    ? "critical"
    : allItems.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  // Compute delta against previous sitrep
  const previous = readJsonSafe<SitrepReport>(config.previousPath);
  const previousItemIds = new Set(previous?.items?.map((i) => i.id) ?? []);
  const currentItemIds = new Set(allItems.map((i) => i.id));
  const newItems = allItems.filter((i) => !previousItemIds.has(i.id));
  const resolvedItems = [...previousItemIds].filter((id) => !currentItemIds.has(id));

  // Generate summary
  const summary = generateSummary(allItems, categories, collectorResults, config);

  // Build collector metadata (without items — those are in allItems)
  const collectors: SitrepReport["collectors"] = {};
  for (const [name, result] of Object.entries(collectorResults)) {
    collectors[name] = {
      status: result.status,
      duration_ms: result.duration_ms,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  return {
    version: 1,
    generated: new Date().toISOString(),
    summary,
    health: {
      overall: overallHealth,
      details: collectorStatuses,
    },
    items: allItems,
    categories,
    delta: {
      new_items: newItems.length,
      resolved_items: resolvedItems.length,
      previous_generated: previous?.generated ?? null,
    },
    collectors,
  };
}

/**
 * Generate a human-readable summary string.
 */
function generateSummary(
  items: SitrepItem[],
  categories: SitrepReport["categories"],
  results: Record<string, CollectorResult>,
  config: SitrepConfig,
): string {
  const parts: string[] = [];

  if (categories.needs_owner.length > 0) {
    parts.push(`${categories.needs_owner.length} item(s) need owner attention`);
  }
  if (categories.auto_fixable.length > 0) {
    parts.push(`${categories.auto_fixable.length} auto-fixable`);
  }

  // Add collector summaries
  for (const [name, result] of Object.entries(results)) {
    if (result.status !== "ok" && result.summary !== "disabled") {
      parts.push(`${name}: ${result.summary}`);
    }
  }

  if (items.length === 0) {
    parts.push("All systems nominal");
  }

  const summary = parts.join(". ") + ".";
  return summary.slice(0, config.summaryMaxChars);
}

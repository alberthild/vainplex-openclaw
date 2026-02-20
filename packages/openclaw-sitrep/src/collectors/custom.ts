import { shell } from "../collector.js";
import type {
  CollectorResult,
  SitrepItem,
  CustomCollectorDef,
  PluginLogger,
} from "../types.js";

/**
 * Run a single custom collector (shell command).
 */
export async function runCustomCollector(
  def: CustomCollectorDef,
  logger: PluginLogger,
): Promise<CollectorResult> {
  const items: SitrepItem[] = [];

  let output: string;
  try {
    output = shell(def.command);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[sitrep] Custom collector "${def.id}" command failed: ${msg}`);
    items.push({
      id: `custom-${def.id}-failed`,
      source: `custom:${def.id}`,
      severity: "warn",
      category: "auto_fixable",
      title: `Custom check "${def.id}" failed: ${msg.slice(0, 100)}`,
      score: 40,
    });
    return { status: "warn", items, summary: "command failed", duration_ms: 0 };
  }

  // Check thresholds
  if (def.warnIfOutput && output.trim()) {
    items.push({
      id: `custom-${def.id}-output`,
      source: `custom:${def.id}`,
      severity: "warn",
      category: "informational",
      title: `Custom check "${def.id}" produced output`,
      detail: output.slice(0, 500),
      score: 40,
    });
  }

  if (def.warnIfNoOutput && !output.trim()) {
    items.push({
      id: `custom-${def.id}-no-output`,
      source: `custom:${def.id}`,
      severity: "warn",
      category: "informational",
      title: `Custom check "${def.id}" produced no output (expected some)`,
      score: 30,
    });
  }

  if (def.warnThreshold && output.trim()) {
    const numericOutput = parseFloat(output.replace(/[^0-9.]/g, ""));
    const threshold = parseFloat(def.warnThreshold.replace(/[^0-9.]/g, ""));
    if (!isNaN(numericOutput) && !isNaN(threshold) && numericOutput >= threshold) {
      const isCritical =
        def.criticalThreshold !== undefined &&
        numericOutput >= parseFloat(def.criticalThreshold.replace(/[^0-9.]/g, ""));

      items.push({
        id: `custom-${def.id}-threshold`,
        source: `custom:${def.id}`,
        severity: isCritical ? "critical" : "warn",
        category: isCritical ? "needs_owner" : "auto_fixable",
        title: `Custom check "${def.id}": ${output.trim()} (threshold: ${def.warnThreshold})`,
        score: isCritical ? 90 : 50,
      });
    }
  }

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.length > 0
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: output.trim().slice(0, 200) || "ok",
    duration_ms: 0,
  };
}

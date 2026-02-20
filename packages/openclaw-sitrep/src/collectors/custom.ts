import { shell } from "../collector.js";
import type {
  CollectorResult,
  SitrepItem,
  CustomCollectorDef,
  PluginLogger,
} from "../types.js";

/** Check numeric threshold against output. */
function checkThresholds(
  output: string,
  def: CustomCollectorDef,
): SitrepItem | null {
  if (!def.warnThreshold) return null;

  const numericOutput = parseFloat(output.replace(/[^0-9.]/g, ""));
  const threshold = parseFloat(def.warnThreshold.replace(/[^0-9.]/g, ""));
  if (isNaN(numericOutput) || isNaN(threshold) || numericOutput < threshold) return null;

  const isCritical =
    def.criticalThreshold !== undefined &&
    numericOutput >= parseFloat(def.criticalThreshold.replace(/[^0-9.]/g, ""));

  return {
    id: `custom-${def.id}-threshold`,
    source: `custom:${def.id}`,
    severity: isCritical ? "critical" : "warn",
    category: isCritical ? "needs_owner" : "auto_fixable",
    title: `Custom check "${def.id}": ${output.trim()} (threshold: ${def.warnThreshold})`,
    score: isCritical ? 90 : 50,
  };
}

/** Check warnIfOutput / warnIfNoOutput flags. */
function checkOutputFlags(
  output: string,
  def: CustomCollectorDef,
): SitrepItem | null {
  if (def.warnIfOutput && output.trim()) {
    return {
      id: `custom-${def.id}-output`,
      source: `custom:${def.id}`,
      severity: "warn",
      category: "informational",
      title: `Custom check "${def.id}" produced output`,
      detail: output.slice(0, 500),
      score: 40,
    };
  }
  if (def.warnIfNoOutput && !output.trim()) {
    return {
      id: `custom-${def.id}-no-output`,
      source: `custom:${def.id}`,
      severity: "warn",
      category: "informational",
      title: `Custom check "${def.id}" produced no output (expected some)`,
      score: 30,
    };
  }
  return null;
}

/**
 * Run a single custom collector (shell command).
 */
export async function runCustomCollector(
  def: CustomCollectorDef,
  logger: PluginLogger,
): Promise<CollectorResult> {
  let output: string;
  try {
    output = shell(def.command);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[sitrep] Custom collector "${def.id}" command failed: ${msg}`);
    return {
      status: "warn",
      items: [{
        id: `custom-${def.id}-failed`,
        source: `custom:${def.id}`,
        severity: "warn",
        category: "auto_fixable",
        title: `Custom check "${def.id}" failed: ${msg.slice(0, 100)}`,
        score: 40,
      }],
      summary: "command failed",
      duration_ms: 0,
    };
  }

  const items: SitrepItem[] = [];
  const thresholdItem = checkThresholds(output, def);
  if (thresholdItem) items.push(thresholdItem);
  const flagItem = checkOutputFlags(output, def);
  if (flagItem) items.push(flagItem);

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.length > 0
      ? "warn"
      : "ok";

  return { status, items, summary: output.trim().slice(0, 200) || "ok", duration_ms: 0 };
}

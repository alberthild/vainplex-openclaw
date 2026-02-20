import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

/** Parse timer lines and detect stale timers. */
function checkTimerLines(lines: string[]): { items: SitrepItem[]; staleCount: number } {
  const items: SitrepItem[] = [];
  let staleCount = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s{2,}/);
    const unitField = parts[4] ?? parts[3] ?? "unknown";
    const timerName = unitField.replace(/\.timer$/, "");
    const leftField = (parts[1] ?? "").trim();

    if (leftField === "n/a" || leftField === "") {
      items.push({
        id: `timer-${timerName}-not-scheduled`,
        source: "systemd_timers",
        severity: "warn",
        category: "auto_fixable",
        title: `Timer ${timerName} is not scheduled (no next trigger)`,
        detail: `Raw: ${line.trim()}`,
        score: 50,
      });
      staleCount++;
    }
  }

  return { items, staleCount };
}

/** Check for failed systemd units. */
function checkFailedUnits(): SitrepItem[] {
  const failedRaw = shell(
    "systemctl --user list-units --state=failed --no-pager --no-legend 2>/dev/null || true",
  );

  if (!failedRaw) return [];

  return failedRaw
    .split("\n")
    .filter((l) => l.includes(".timer") || l.includes(".service"))
    .map((fl) => {
      const unitName = fl.trim().split(/\s+/)[0]?.replace(/\.(timer|service)$/, "") ?? "unknown";
      return {
        id: `timer-${unitName}-failed`,
        source: "systemd_timers",
        severity: "critical" as const,
        category: "auto_fixable" as const,
        title: `Unit ${unitName} is in failed state`,
        detail: fl.trim(),
        score: 100,
      };
    });
}

/**
 * Collector: systemd user timers.
 */
export const collectSystemdTimers: CollectorFn = async (
  _config: CollectorConfig,
): Promise<CollectorResult> => {
  const raw = shell(
    "systemctl --user list-timers --all --no-pager --no-legend 2>/dev/null || true",
  );

  if (!raw) {
    return { status: "ok", items: [], summary: "No user timers found", duration_ms: 0 };
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const { items: timerItems, staleCount } = checkTimerLines(lines);
  const failedItems = checkFailedUnits();
  const items = [...timerItems, ...failedItems];

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : staleCount > 0
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${lines.length} timers, ${staleCount} stale, ${items.length} issues`,
    duration_ms: 0,
  };
};

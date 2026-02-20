import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

/**
 * Collector: systemd user timers.
 * Detects stale, failed, or inactive timers.
 */
export const collectSystemdTimers: CollectorFn = async (
  _config: CollectorConfig,
): Promise<CollectorResult> => {
  const items: SitrepItem[] = [];

  // Get timer list
  const raw = shell(
    "systemctl --user list-timers --all --no-pager --no-legend 2>/dev/null || true",
  );

  if (!raw) {
    return { status: "ok", items: [], summary: "No user timers found", duration_ms: 0 };
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  let staleCount = 0;
  let totalCount = 0;

  for (const line of lines) {
    totalCount++;
    const parts = line.trim().split(/\s{2,}/);

    // Format: NEXT LEFT LAST PASSED UNIT ACTIVATES
    // The timer name is typically the 5th or 6th field
    const unitField = parts[4] ?? parts[3] ?? "unknown";
    const timerName = unitField.replace(/\.timer$/, "");
    const passedField = (parts[3] ?? "").trim();
    const leftField = (parts[1] ?? "").trim();

    // Check for "n/a" in NEXT (timer not scheduled)
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

  // Check for failed timer units
  const failedRaw = shell(
    "systemctl --user list-units --state=failed --no-pager --no-legend 2>/dev/null || true",
  );

  if (failedRaw) {
    const failedLines = failedRaw.split("\n").filter((l) => l.includes(".timer") || l.includes(".service"));
    for (const fl of failedLines) {
      const unitName = fl.trim().split(/\s+/)[0]?.replace(/\.(timer|service)$/, "") ?? "unknown";
      items.push({
        id: `timer-${unitName}-failed`,
        source: "systemd_timers",
        severity: "critical",
        category: "auto_fixable",
        title: `Unit ${unitName} is in failed state`,
        detail: fl.trim(),
        score: 100,
      });
    }
  }

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : staleCount > 0
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${totalCount} timers, ${staleCount} stale, ${items.length} issues`,
    duration_ms: 0,
  };
};

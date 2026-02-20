import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface CalendarCollectorConfig extends CollectorConfig {
  command?: string;
}

/** Convert lines of calendar output into sitrep items. */
function linesToItems(lines: string[]): SitrepItem[] {
  return lines.slice(0, 10).map((line) => ({
    id: `calendar-${Buffer.from(line.slice(0, 50)).toString("base64url").slice(0, 16)}`,
    source: "calendar",
    severity: "info" as const,
    category: "informational" as const,
    title: line.trim(),
    score: 10,
  }));
}

/**
 * Collector: Calendar events via configurable shell command.
 */
export const collectCalendar: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const calConfig = config as CalendarCollectorConfig;
  if (!calConfig.command) {
    return { status: "ok", items: [], summary: "no calendar command configured", duration_ms: 0 };
  }

  let output: string;
  try {
    output = shell(calConfig.command);
  } catch {
    return {
      status: "warn",
      items: [{
        id: "calendar-command-failed",
        source: "calendar",
        severity: "warn",
        category: "informational",
        title: "Calendar command failed",
        detail: `Command: ${calConfig.command}`,
        score: 20,
      }],
      summary: "calendar command failed",
      duration_ms: 0,
    };
  }

  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    return { status: "ok", items: [], summary: "no upcoming events", duration_ms: 0 };
  }

  return {
    status: "ok",
    items: linesToItems(lines),
    summary: `${lines.length} upcoming event(s)`,
    duration_ms: 0,
  };
};

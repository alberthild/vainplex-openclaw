import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface CalendarCollectorConfig extends CollectorConfig {
  command?: string;
}

/**
 * Collector: Calendar events via configurable shell command.
 * The command should output text — each line is treated as an event.
 */
export const collectCalendar: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const calConfig = config as CalendarCollectorConfig;
  const command = calConfig.command;

  if (!command) {
    return { status: "ok", items: [], summary: "no calendar command configured", duration_ms: 0 };
  }

  const items: SitrepItem[] = [];

  let output: string;
  try {
    output = shell(command);
  } catch {
    return {
      status: "warn",
      items: [{
        id: "calendar-command-failed",
        source: "calendar",
        severity: "warn",
        category: "informational",
        title: "Calendar command failed",
        detail: `Command: ${command}`,
        score: 20,
      }],
      summary: "calendar command failed",
      duration_ms: 0,
    };
  }

  if (!output.trim()) {
    return { status: "ok", items: [], summary: "no upcoming events", duration_ms: 0 };
  }

  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines.slice(0, 10)) {
    items.push({
      id: `calendar-${Buffer.from(line.slice(0, 50)).toString("base64url").slice(0, 16)}`,
      source: "calendar",
      severity: "info",
      category: "informational",
      title: line.trim(),
      score: 10,
    });
  }

  return {
    status: "ok",
    items,
    summary: `${lines.length} upcoming event(s)`,
    duration_ms: 0,
  };
};

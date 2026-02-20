import type { SitrepConfig, CollectorConfig } from "./types.js";
import { join } from "node:path";

const HOME = process.env["HOME"] ?? "/tmp";

export const DEFAULTS: SitrepConfig = {
  enabled: true,
  outputPath: join(HOME, ".openclaw", "sitrep", "sitrep.json"),
  previousPath: join(HOME, ".openclaw", "sitrep", "sitrep-previous.json"),
  intervalMinutes: 120,
  collectors: {
    systemd_timers: { enabled: true },
    nats: {
      enabled: false,
      natsUrl: "nats://localhost:4222",
      streamName: "openclaw-events",
    },
    goals: { enabled: false, goalsPath: "" },
    threads: { enabled: false, threadsPath: "" },
    errors: { enabled: false, patternsPath: "" },
    calendar: { enabled: false, command: "" },
    agents: { enabled: false },
    roadmap: { enabled: false, roadmapPath: "" },
    lessons: { enabled: false, lessonsPath: "" },
    daily_notes: { enabled: false, notesDir: "" },
  },
  customCollectors: [],
  scoring: {
    criticalWeight: 100,
    warnWeight: 50,
    infoWeight: 10,
    staleThresholdHours: 6,
  },
  summaryMaxChars: 2000,
};

function mergeCollectors(
  defaults: Record<string, CollectorConfig>,
  overrides: Record<string, unknown> | undefined,
): Record<string, CollectorConfig> {
  if (!overrides || typeof overrides !== "object") return { ...defaults };

  const result: Record<string, CollectorConfig> = { ...defaults };

  for (const [key, val] of Object.entries(overrides)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const base = defaults[key] ?? { enabled: false };
      result[key] = { ...base, ...(val as Record<string, unknown>) } as CollectorConfig;
    }
  }

  return result;
}

export function resolveConfig(raw: Record<string, unknown> | undefined): SitrepConfig {
  const r = raw ?? {};
  const scoring = (r["scoring"] as Record<string, unknown>) ?? {};

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : DEFAULTS.enabled,
    outputPath: typeof r["outputPath"] === "string" ? r["outputPath"] : DEFAULTS.outputPath,
    previousPath: typeof r["previousPath"] === "string" ? r["previousPath"] : DEFAULTS.previousPath,
    intervalMinutes:
      typeof r["intervalMinutes"] === "number" ? r["intervalMinutes"] : DEFAULTS.intervalMinutes,
    collectors: mergeCollectors(
      DEFAULTS.collectors,
      r["collectors"] as Record<string, unknown> | undefined,
    ),
    customCollectors: Array.isArray(r["customCollectors"])
      ? (r["customCollectors"] as SitrepConfig["customCollectors"])
      : DEFAULTS.customCollectors,
    scoring: {
      criticalWeight:
        typeof scoring["criticalWeight"] === "number"
          ? scoring["criticalWeight"]
          : DEFAULTS.scoring.criticalWeight,
      warnWeight:
        typeof scoring["warnWeight"] === "number"
          ? scoring["warnWeight"]
          : DEFAULTS.scoring.warnWeight,
      infoWeight:
        typeof scoring["infoWeight"] === "number"
          ? scoring["infoWeight"]
          : DEFAULTS.scoring.infoWeight,
      staleThresholdHours:
        typeof scoring["staleThresholdHours"] === "number"
          ? scoring["staleThresholdHours"]
          : DEFAULTS.scoring.staleThresholdHours,
    },
    summaryMaxChars:
      typeof r["summaryMaxChars"] === "number" ? r["summaryMaxChars"] : DEFAULTS.summaryMaxChars,
  };
}

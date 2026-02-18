import type { CortexConfig } from "./types.js";

export const DEFAULTS: CortexConfig = {
  enabled: true,
  workspace: "",
  threadTracker: {
    enabled: true,
    pruneDays: 7,
    maxThreads: 50,
  },
  decisionTracker: {
    enabled: true,
    maxDecisions: 100,
    dedupeWindowHours: 24,
  },
  bootContext: {
    enabled: true,
    maxChars: 16000,
    onSessionStart: true,
    maxThreadsInBoot: 7,
    maxDecisionsInBoot: 10,
    decisionRecencyDays: 14,
  },
  preCompaction: {
    enabled: true,
    maxSnapshotMessages: 15,
  },
  narrative: {
    enabled: true,
  },
  patterns: {
    language: "both",
  },
  llm: {
    enabled: false,
    endpoint: "http://localhost:11434/v1",
    model: "mistral:7b",
    apiKey: "",
    timeoutMs: 15000,
    batchSize: 3,
  },
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  return fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function lang(value: unknown): "en" | "de" | "both" {
  if (value === "en" || value === "de" || value === "both") return value;
  return "both";
}

export function resolveConfig(pluginConfig?: Record<string, unknown>): CortexConfig {
  const raw = pluginConfig ?? {};
  const tt = (raw.threadTracker ?? {}) as Record<string, unknown>;
  const dt = (raw.decisionTracker ?? {}) as Record<string, unknown>;
  const bc = (raw.bootContext ?? {}) as Record<string, unknown>;
  const pc = (raw.preCompaction ?? {}) as Record<string, unknown>;
  const nr = (raw.narrative ?? {}) as Record<string, unknown>;
  const pt = (raw.patterns ?? {}) as Record<string, unknown>;
  const lm = (raw.llm ?? {}) as Record<string, unknown>;

  return {
    enabled: bool(raw.enabled, DEFAULTS.enabled),
    workspace: str(raw.workspace, DEFAULTS.workspace),
    threadTracker: {
      enabled: bool(tt.enabled, DEFAULTS.threadTracker.enabled),
      pruneDays: int(tt.pruneDays, DEFAULTS.threadTracker.pruneDays),
      maxThreads: int(tt.maxThreads, DEFAULTS.threadTracker.maxThreads),
    },
    decisionTracker: {
      enabled: bool(dt.enabled, DEFAULTS.decisionTracker.enabled),
      maxDecisions: int(dt.maxDecisions, DEFAULTS.decisionTracker.maxDecisions),
      dedupeWindowHours: int(dt.dedupeWindowHours, DEFAULTS.decisionTracker.dedupeWindowHours),
    },
    bootContext: {
      enabled: bool(bc.enabled, DEFAULTS.bootContext.enabled),
      maxChars: int(bc.maxChars, DEFAULTS.bootContext.maxChars),
      onSessionStart: bool(bc.onSessionStart, DEFAULTS.bootContext.onSessionStart),
      maxThreadsInBoot: int(bc.maxThreadsInBoot, DEFAULTS.bootContext.maxThreadsInBoot),
      maxDecisionsInBoot: int(bc.maxDecisionsInBoot, DEFAULTS.bootContext.maxDecisionsInBoot),
      decisionRecencyDays: int(bc.decisionRecencyDays, DEFAULTS.bootContext.decisionRecencyDays),
    },
    preCompaction: {
      enabled: bool(pc.enabled, DEFAULTS.preCompaction.enabled),
      maxSnapshotMessages: int(pc.maxSnapshotMessages, DEFAULTS.preCompaction.maxSnapshotMessages),
    },
    narrative: {
      enabled: bool(nr.enabled, DEFAULTS.narrative.enabled),
    },
    patterns: {
      language: lang(pt.language),
    },
    llm: {
      enabled: bool(lm.enabled, DEFAULTS.llm.enabled),
      endpoint: str(lm.endpoint, DEFAULTS.llm.endpoint),
      model: str(lm.model, DEFAULTS.llm.model),
      apiKey: str(lm.apiKey, DEFAULTS.llm.apiKey),
      timeoutMs: int(lm.timeoutMs, DEFAULTS.llm.timeoutMs),
      batchSize: int(lm.batchSize, DEFAULTS.llm.batchSize),
    },
  };
}

/**
 * Resolve workspace directory from config, hook context, env, or cwd.
 */
export function resolveWorkspace(
  config: CortexConfig,
  ctx?: { workspaceDir?: string },
): string {
  if (config.workspace) return config.workspace;
  if (ctx?.workspaceDir) return ctx.workspaceDir;
  return process.env.WORKSPACE_DIR ?? process.cwd();
}

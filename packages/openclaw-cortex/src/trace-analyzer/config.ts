// ============================================================
// Trace Analyzer — Configuration
// ============================================================
//
// TraceAnalyzerConfig type, defaults, and resolver.
// Follows the same pattern as the existing src/config.ts.
// ============================================================

/** Signal identifiers for the failure signal taxonomy. */
export type SignalId =
  | "SIG-CORRECTION"
  | "SIG-TOOL-FAIL"
  | "SIG-DOOM-LOOP"
  | "SIG-DISSATISFIED"
  | "SIG-REPEAT-FAIL"
  | "SIG-HALLUCINATION"
  | "SIG-UNVERIFIED-CLAIM";

/** Severity levels for failure signals. */
export type Severity = "low" | "medium" | "high" | "critical";

/** Triage LLM configuration (fast/local model for filtering). */
export type TriageLlmConfig = {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
};

/** Trace analyzer configuration. */
export type TraceAnalyzerConfig = {
  /** Master switch. Default: false. */
  enabled: boolean;

  /** NATS connection for the trace source. */
  nats: {
    /** NATS server URL (e.g., "nats://localhost:4222"). */
    url: string;
    /** JetStream stream name (e.g., "openclaw-events"). */
    stream: string;
    /** NATS subject prefix (e.g., "openclaw.events"). */
    subjectPrefix: string;
    /** Optional credentials file path. */
    credentials?: string;
    /** Optional user. */
    user?: string;
    /** Optional password. */
    password?: string;
  };

  /** Scheduled analysis runs. */
  schedule: {
    /** Enable scheduled runs. Default: false. */
    enabled: boolean;
    /** Hours between runs. Default: 24. */
    intervalHours: number;
  };

  /** Inactivity gap in minutes for chain boundary detection. Default: 30. */
  chainGapMinutes: number;

  /** Per-signal toggles and severity overrides. */
  signals: Partial<Record<SignalId, { enabled: boolean; severity?: Severity }>>;

  /** LLM config overrides for trace analysis. */
  llm: {
    enabled: boolean;
    endpoint?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    /** Optional triage model (fast, local). */
    triage?: TriageLlmConfig;
  };

  /** Output configuration. */
  output: {
    /** Maximum findings in a single report. Default: 200. */
    maxFindings: number;
    /** Custom report output path. */
    reportPath?: string;
  };

  /** Redaction patterns (regex strings) applied before LLM/disk writes. */
  redactPatterns: string[];

  /** Context window size for incremental processing. Default: 500. */
  incrementalContextWindow: number;

  /** NATS consumer batch size for fetching events. Default: 500. */
  fetchBatchSize: number;

  /** Maximum events to process per run. Default: 100000. */
  maxEventsPerRun: number;
};

/** Default trace analyzer configuration. */
export const TRACE_ANALYZER_DEFAULTS: TraceAnalyzerConfig = {
  enabled: false,
  nats: {
    url: "nats://localhost:4222",
    stream: "openclaw-events",
    subjectPrefix: "openclaw.events",
  },
  schedule: {
    enabled: false,
    intervalHours: 24,
  },
  chainGapMinutes: 30,
  signals: {
    "SIG-CORRECTION":       { enabled: true },
    "SIG-TOOL-FAIL":        { enabled: true },
    "SIG-DOOM-LOOP":        { enabled: true },
    "SIG-DISSATISFIED":     { enabled: true },
    "SIG-REPEAT-FAIL":      { enabled: true },
    "SIG-HALLUCINATION":    { enabled: true },
    "SIG-UNVERIFIED-CLAIM": { enabled: false },
  },
  llm: {
    enabled: false,
  },
  output: {
    maxFindings: 200,
  },
  redactPatterns: [],
  incrementalContextWindow: 500,
  fetchBatchSize: 500,
  maxEventsPerRun: 100_000,
};

// ---- Typed extractors (same pattern as src/config.ts) ----

function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

function int(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d;
}

function str(v: unknown, d: string): string {
  return typeof v === "string" ? v : d;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function optInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((s): s is string => typeof s === "string");
}

const VALID_SIGNAL_IDS: readonly SignalId[] = [
  "SIG-CORRECTION",
  "SIG-TOOL-FAIL",
  "SIG-DOOM-LOOP",
  "SIG-DISSATISFIED",
  "SIG-REPEAT-FAIL",
  "SIG-HALLUCINATION",
  "SIG-UNVERIFIED-CLAIM",
];

const VALID_SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];

function isValidSignalId(v: string): v is SignalId {
  return (VALID_SIGNAL_IDS as readonly string[]).includes(v);
}

function isValidSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (VALID_SEVERITIES as readonly string[]).includes(v);
}

function resolveSignalConfig(
  raw: Record<string, unknown>,
): Partial<Record<SignalId, { enabled: boolean; severity?: Severity }>> {
  const result: Partial<Record<SignalId, { enabled: boolean; severity?: Severity }>> = {};

  // Start with defaults
  for (const [id, config] of Object.entries(TRACE_ANALYZER_DEFAULTS.signals)) {
    if (config) {
      result[id as SignalId] = { ...config };
    }
  }

  // Apply overrides
  for (const [key, value] of Object.entries(raw)) {
    if (!isValidSignalId(key)) continue;
    if (typeof value !== "object" || value === null) continue;

    const sig = value as Record<string, unknown>;
    const existing = result[key] ?? { enabled: true };

    result[key] = {
      enabled: bool(sig.enabled, existing.enabled),
      severity: isValidSeverity(sig.severity) ? sig.severity : existing.severity,
    };
  }

  return result;
}

/** Resolve NATS sub-config from raw input. */
function resolveNatsConfig(natsRaw: Record<string, unknown>): TraceAnalyzerConfig["nats"] {
  return {
    url: str(natsRaw.url, TRACE_ANALYZER_DEFAULTS.nats.url),
    stream: str(natsRaw.stream, TRACE_ANALYZER_DEFAULTS.nats.stream),
    subjectPrefix: str(natsRaw.subjectPrefix, TRACE_ANALYZER_DEFAULTS.nats.subjectPrefix),
    credentials: optStr(natsRaw.credentials),
    user: optStr(natsRaw.user),
    password: optStr(natsRaw.password),
  };
}

/** Resolve LLM sub-config from raw input. */
function resolveLlmConfig(llmRaw: Record<string, unknown>): TraceAnalyzerConfig["llm"] {
  const triageRaw = (llmRaw.triage ?? undefined) as Record<string, unknown> | undefined;
  return {
    enabled: bool(llmRaw.enabled, TRACE_ANALYZER_DEFAULTS.llm.enabled),
    endpoint: optStr(llmRaw.endpoint),
    model: optStr(llmRaw.model),
    apiKey: optStr(llmRaw.apiKey),
    timeoutMs: optInt(llmRaw.timeoutMs),
    triage: triageRaw ? {
      endpoint: str(triageRaw.endpoint, ""),
      model: str(triageRaw.model, ""),
      apiKey: optStr(triageRaw.apiKey),
      timeoutMs: optInt(triageRaw.timeoutMs),
    } : undefined,
  };
}

/**
 * Resolve a raw config object into a fully-typed TraceAnalyzerConfig.
 * Missing values are filled from TRACE_ANALYZER_DEFAULTS.
 */
export function resolveTraceAnalyzerConfig(
  raw?: Record<string, unknown>,
): TraceAnalyzerConfig {
  if (!raw) return { ...TRACE_ANALYZER_DEFAULTS };

  const natsRaw = (raw.nats ?? {}) as Record<string, unknown>;
  const schedRaw = (raw.schedule ?? {}) as Record<string, unknown>;
  const llmRaw = (raw.llm ?? {}) as Record<string, unknown>;
  const outRaw = (raw.output ?? {}) as Record<string, unknown>;
  const signalsRaw = (raw.signals ?? {}) as Record<string, unknown>;

  return {
    enabled: bool(raw.enabled, TRACE_ANALYZER_DEFAULTS.enabled),
    nats: resolveNatsConfig(natsRaw),
    schedule: {
      enabled: bool(schedRaw.enabled, TRACE_ANALYZER_DEFAULTS.schedule.enabled),
      intervalHours: int(schedRaw.intervalHours, TRACE_ANALYZER_DEFAULTS.schedule.intervalHours),
    },
    chainGapMinutes: int(raw.chainGapMinutes, TRACE_ANALYZER_DEFAULTS.chainGapMinutes),
    signals: resolveSignalConfig(signalsRaw),
    llm: resolveLlmConfig(llmRaw),
    output: {
      maxFindings: int(outRaw.maxFindings, TRACE_ANALYZER_DEFAULTS.output.maxFindings),
      reportPath: optStr(outRaw.reportPath),
    },
    redactPatterns: strArr(raw.redactPatterns) ?? [],
    incrementalContextWindow: int(raw.incrementalContextWindow, TRACE_ANALYZER_DEFAULTS.incrementalContextWindow),
    fetchBatchSize: int(raw.fetchBatchSize, TRACE_ANALYZER_DEFAULTS.fetchBatchSize),
    maxEventsPerRun: int(raw.maxEventsPerRun, TRACE_ANALYZER_DEFAULTS.maxEventsPerRun),
  };
}

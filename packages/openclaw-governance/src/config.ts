import type {
  AuditConfig,
  BuiltinDetectorId,
  BuiltinPoliciesConfig,
  FailMode,
  GovernanceConfig,
  LlmValidatorConfig,
  OutputValidationConfig,
  PerformanceConfig,
  Policy,
  RedactionConfig,
  TimeWindow,
  TrustConfig,
} from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveTrust(raw: unknown): TrustConfig {
  const r = isRecord(raw) ? raw : {};
  const decay = isRecord(r["decay"]) ? r["decay"] : {};

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : true,
    defaults: isRecord(r["defaults"])
      ? Object.fromEntries(
          Object.entries(r["defaults"]).filter(
            (e): e is [string, number] => typeof e[1] === "number",
          ),
        )
      : { main: 60, "*": 10 },
    persistIntervalSeconds:
      typeof r["persistIntervalSeconds"] === "number"
        ? r["persistIntervalSeconds"]
        : 60,
    decay: {
      enabled: typeof decay["enabled"] === "boolean" ? decay["enabled"] : true,
      inactivityDays:
        typeof decay["inactivityDays"] === "number"
          ? decay["inactivityDays"]
          : 30,
      rate: typeof decay["rate"] === "number" ? decay["rate"] : 0.95,
    },
    weights: isRecord(r["weights"])
      ? (r["weights"] as TrustConfig["weights"])
      : undefined,
    maxHistoryPerAgent:
      typeof r["maxHistoryPerAgent"] === "number"
        ? r["maxHistoryPerAgent"]
        : 100,
  };
}

function resolveAudit(raw: unknown): AuditConfig {
  const r = isRecord(raw) ? raw : {};
  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : true,
    retentionDays:
      typeof r["retentionDays"] === "number" ? r["retentionDays"] : 90,
    redactPatterns: Array.isArray(r["redactPatterns"])
      ? (r["redactPatterns"] as string[]).filter(
          (p): p is string => typeof p === "string",
        )
      : [],
    level:
      r["level"] === "minimal" || r["level"] === "standard" || r["level"] === "verbose"
        ? r["level"]
        : "standard",
  };
}

const ALL_DETECTOR_IDS: BuiltinDetectorId[] = [
  "system_state",
  "entity_name",
  "existence",
  "operational_status",
  "self_referential",
];

function resolveLlmValidator(raw: unknown): LlmValidatorConfig {
  const r = isRecord(raw) ? raw : {};
  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : false,
    model: typeof r["model"] === "string" ? r["model"] : undefined,
    maxTokens: typeof r["maxTokens"] === "number" ? r["maxTokens"] : 500,
    timeoutMs: typeof r["timeoutMs"] === "number" ? r["timeoutMs"] : 5000,
    externalChannels: Array.isArray(r["externalChannels"])
      ? (r["externalChannels"] as string[]).filter(
          (s): s is string => typeof s === "string",
        )
      : ["twitter", "linkedin", "email"],
    externalCommands: Array.isArray(r["externalCommands"])
      ? (r["externalCommands"] as string[]).filter(
          (s): s is string => typeof s === "string",
        )
      : ["bird tweet", "bird reply"],
  };
}

function resolveOutputValidation(raw: unknown): OutputValidationConfig {
  const r = isRecord(raw) ? raw : {};
  const thresholds = isRecord(r["contradictionThresholds"])
    ? r["contradictionThresholds"]
    : {};

  const rawDetectors = Array.isArray(r["enabledDetectors"])
    ? (r["enabledDetectors"] as string[]).filter(
        (d): d is BuiltinDetectorId =>
          ALL_DETECTOR_IDS.includes(d as BuiltinDetectorId),
      )
    : ALL_DETECTOR_IDS;

  const uvPolicy = r["unverifiedClaimPolicy"];
  const srPolicy = r["selfReferentialPolicy"];

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : false,
    enabledDetectors: rawDetectors,
    factRegistries: Array.isArray(r["factRegistries"])
      ? (r["factRegistries"] as OutputValidationConfig["factRegistries"])
      : [],
    unverifiedClaimPolicy:
      uvPolicy === "flag" || uvPolicy === "block" || uvPolicy === "ignore"
        ? uvPolicy
        : "ignore",
    selfReferentialPolicy:
      srPolicy === "flag" || srPolicy === "block" || srPolicy === "ignore"
        ? srPolicy
        : "ignore",
    contradictionThresholds: {
      flagAbove:
        typeof thresholds["flagAbove"] === "number"
          ? thresholds["flagAbove"]
          : 60,
      blockBelow:
        typeof thresholds["blockBelow"] === "number"
          ? thresholds["blockBelow"]
          : 40,
    },
    llmValidator: r["llmValidator"] !== undefined
      ? resolveLlmValidator(r["llmValidator"])
      : undefined,
  };
}

function resolvePerformance(raw: unknown): PerformanceConfig {
  const r = isRecord(raw) ? raw : {};
  return {
    maxEvalUs:
      typeof r["maxEvalUs"] === "number" ? r["maxEvalUs"] : 5000,
    maxContextMessages:
      typeof r["maxContextMessages"] === "number"
        ? r["maxContextMessages"]
        : 10,
    frequencyBufferSize:
      typeof r["frequencyBufferSize"] === "number"
        ? r["frequencyBufferSize"]
        : 1000,
  };
}

export function resolveConfig(
  raw?: Record<string, unknown>,
): GovernanceConfig {
  const r = raw ?? {};

  const failMode = r["failMode"];
  const resolvedFailMode: FailMode =
    failMode === "open" || failMode === "closed" ? failMode : "open";

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : true,
    timezone: typeof r["timezone"] === "string" ? r["timezone"] : "UTC",
    failMode: resolvedFailMode,
    policies: Array.isArray(r["policies"])
      ? (r["policies"] as Policy[])
      : [],
    timeWindows: isRecord(r["timeWindows"])
      ? (r["timeWindows"] as Record<string, TimeWindow>)
      : {},
    trust: resolveTrust(r["trust"]),
    audit: resolveAudit(r["audit"]),
    toolRiskOverrides: isRecord(r["toolRiskOverrides"])
      ? Object.fromEntries(
          Object.entries(r["toolRiskOverrides"]).filter(
            (e): e is [string, number] => typeof e[1] === "number",
          ),
        )
      : {},
    builtinPolicies: isRecord(r["builtinPolicies"])
      ? (r["builtinPolicies"] as BuiltinPoliciesConfig)
      : {},
    performance: resolvePerformance(r["performance"]),
    outputValidation: resolveOutputValidation(r["outputValidation"]),
    redaction: isRecord(r["redaction"])
      ? (r["redaction"] as unknown as RedactionConfig)
      : undefined,
  };
}

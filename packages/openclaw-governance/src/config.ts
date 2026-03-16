import type {
  Approval2FAConfig,
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
  SessionTrustConfig,
  TimeWindow,
  TrustConfig,
} from "./types.js";

import type { ERC8004Config } from "./security/types.js";
import { resolveResponseGate } from "./response-gate.js";

/** Clamp a config value to min/max bounds, falling back to defaultVal if not a number */
function clamp(value: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultVal;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveSessionTrust(raw: unknown): SessionTrustConfig {
  const r = isRecord(raw) ? raw : {};
  const signals = isRecord(r["signals"]) ? r["signals"] : {};

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : true,
    seedFactor: typeof r["seedFactor"] === "number" ? r["seedFactor"] : 0.7,
    ceilingFactor:
      typeof r["ceilingFactor"] === "number" ? r["ceilingFactor"] : 1.2,
    signals: {
      success: typeof signals["success"] === "number" ? signals["success"] : 1,
      policyBlock:
        typeof signals["policyBlock"] === "number" ? signals["policyBlock"] : -2,
      credentialViolation:
        typeof signals["credentialViolation"] === "number"
          ? signals["credentialViolation"]
          : -10,
      cleanStreakBonus:
        typeof signals["cleanStreakBonus"] === "number"
          ? signals["cleanStreakBonus"]
          : 3,
      cleanStreakThreshold:
        typeof signals["cleanStreakThreshold"] === "number"
          ? signals["cleanStreakThreshold"]
          : 10,
    },
  };
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
    sessionTrust: resolveSessionTrust(r["sessionTrust"]),
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

function resolveERC8004Config(raw: unknown): ERC8004Config | undefined {
  // Look for erc8004 under the top-level or under agentFirewall
  const r = isRecord(raw) ? raw : {};
  if (!isRecord(r)) return undefined;

  // Only return a config if at least one erc8004-related key was provided
  const hasAnyKey =
    typeof r["enabled"] === "boolean" ||
    typeof r["rpcUrl"] === "string" ||
    typeof r["identityRegistryAddress"] === "string" ||
    typeof r["agentProofCoreAddress"] === "string" ||
    isRecord(r["agentMapping"]) ||
    typeof r["apiKeyFile"] === "string" ||
    typeof r["restBaseUrl"] === "string" ||
    typeof r["preferRest"] === "boolean" ||
    typeof r["feedbackEnabled"] === "boolean" ||
    isRecord(r["cache"]);
  if (!hasAnyKey) return undefined;

  const cacheRaw = isRecord(r["cache"]) ? r["cache"] : {};

  const agentMapping: Record<string, number> = {};
  if (isRecord(r["agentMapping"])) {
    for (const [key, val] of Object.entries(r["agentMapping"])) {
      if (typeof val === "number") agentMapping[key] = val;
    }
  }

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : false,
    rpcUrl:
      typeof r["rpcUrl"] === "string"
        ? r["rpcUrl"]
        : "https://mainnet.base.org",
    identityRegistryAddress:
      typeof r["identityRegistryAddress"] === "string"
        ? r["identityRegistryAddress"]
        : "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentProofCoreAddress:
      typeof r["agentProofCoreAddress"] === "string"
        ? r["agentProofCoreAddress"]
        : "", // TBC with BuilderBen
    agentMapping,
    apiKeyFile:
      typeof r["apiKeyFile"] === "string"
        ? r["apiKeyFile"]
        : "~/.config/agentproof-key",
    restBaseUrl:
      typeof r["restBaseUrl"] === "string"
        ? r["restBaseUrl"]
        : "https://oracle.agentproof.sh/api/v1",
    preferRest:
      typeof r["preferRest"] === "boolean" ? r["preferRest"] : true,
    feedbackEnabled:
      typeof r["feedbackEnabled"] === "boolean" ? r["feedbackEnabled"] : false,
    cache: {
      ttlSeconds:
        typeof cacheRaw["ttlSeconds"] === "number"
          ? cacheRaw["ttlSeconds"]
          : 3600,
      maxEntries:
        typeof cacheRaw["maxEntries"] === "number"
          ? cacheRaw["maxEntries"]
          : 256,
    },
  };
}

export function resolveApproval2FA(raw: unknown): Approval2FAConfig | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw["enabled"] !== "boolean" || !raw["enabled"]) return undefined;
  if (typeof raw["totpSecret"] !== "string" || raw["totpSecret"].length === 0) return undefined;

  return {
    enabled: true,
    totpSecret: raw["totpSecret"] as string,
    totpIssuer: typeof raw["totpIssuer"] === "string" ? raw["totpIssuer"] : "Vainplex Governance",
    totpLabel: typeof raw["totpLabel"] === "string" ? raw["totpLabel"] : "Agent Approval",
    timeoutSeconds: clamp(raw["timeoutSeconds"], 30, 1800, 300),
    maxAttempts: clamp(raw["maxAttempts"], 1, 10, 3),
    cooldownSeconds: clamp(raw["cooldownSeconds"], 60, 3600, 900),
    batchWindowMs: clamp(raw["batchWindowMs"], 500, 10000, 3000),
    approvers: Array.isArray(raw["approvers"])
      ? (raw["approvers"] as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    notifyChannel: typeof raw["notifyChannel"] === "string" ? raw["notifyChannel"] : undefined,
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
    responseGate: resolveResponseGate(r["responseGate"]),
    erc8004: resolveERC8004Config(
      isRecord(r["agentFirewall"]) && isRecord((r["agentFirewall"] as Record<string, unknown>)["erc8004"])
        ? (r["agentFirewall"] as Record<string, unknown>)["erc8004"]
        : r["erc8004"],
    ),
    approval2fa: resolveApproval2FA(r["approval2fa"]),
  };
}

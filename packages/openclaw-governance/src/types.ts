// ── OpenClaw Plugin API (external contract, do not modify) ──

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

export type OpenClawPluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  registerService: (service: PluginService) => void;
  registerCommand: (command: PluginCommand) => void;
  registerGatewayMethod: (
    method: string,
    handler: (...args: unknown[]) => unknown,
  ) => void;
  on: <K extends string>(
    hookName: K,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number },
  ) => void;
};

export type PluginService = {
  id: string;
  start: (ctx: unknown) => void | Promise<void>;
  stop?: (ctx: unknown) => void | Promise<void>;
};

export type PluginCommand = {
  name: string;
  description: string;
  requireAuth?: boolean;
  handler: (ctx?: unknown) => { text: string } | Promise<{ text: string }>;
};

// ── Hook Event Types ──

export type HookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

export type HookBeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

export type HookToolContext = {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
};

export type HookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type HookMessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

export type HookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type HookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

export type HookBeforeAgentStartResult = {
  systemPrompt?: string;
  prependContext?: string;
};

export type HookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
};

export type HookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type HookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
};

export type HookSessionContext = {
  agentId?: string;
  sessionId: string;
};

export type HookGatewayStartEvent = { port: number };
export type HookGatewayStopEvent = { reason?: string };
export type HookGatewayContext = { port?: number };

// ── Trust ──

export type TrustTier =
  | "untrusted"
  | "restricted"
  | "standard"
  | "trusted"
  | "privileged";

export type TrustSignals = {
  successCount: number;
  violationCount: number;
  ageDays: number;
  cleanStreak: number;
  manualAdjustment: number;
};

export type TrustEvent = {
  timestamp: string;
  type: "success" | "violation" | "manual_adjustment";
  delta: number;
  reason?: string;
};

export type AgentTrust = {
  agentId: string;
  score: number;
  tier: TrustTier;
  signals: TrustSignals;
  history: TrustEvent[];
  lastEvaluation: string;
  created: string;
  locked?: TrustTier;
  floor?: number;
};

export type TrustStore = {
  version: 1;
  updated: string;
  agents: Record<string, AgentTrust>;
};

// ── Policy ──

export type PolicyHookName =
  | "before_tool_call"
  | "message_sending"
  | "before_agent_start"
  | "session_start";

export type PolicyScope = {
  agents?: string[];
  excludeAgents?: string[];
  channels?: string[];
  hooks?: PolicyHookName[];
};

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AuditLevel = "minimal" | "standard" | "verbose";

export type RuleEffect =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "audit"; level?: AuditLevel };

export type ParamMatcher =
  | { equals: string | number | boolean }
  | { contains: string }
  | { matches: string }
  | { startsWith: string }
  | { in: (string | number)[] };

// ── Condition Types ──

export type ToolCondition = {
  type: "tool";
  name?: string | string[];
  params?: Record<string, ParamMatcher>;
};

export type TimeCondition = {
  type: "time";
  window?: string;
  after?: string;
  before?: string;
  days?: number[];
};

export type AgentCondition = {
  type: "agent";
  id?: string | string[];
  trustTier?: TrustTier | TrustTier[];
  minScore?: number;
  maxScore?: number;
};

export type ContextCondition = {
  type: "context";
  conversationContains?: string | string[];
  messageContains?: string | string[];
  hasMetadata?: string | string[];
  channel?: string | string[];
  sessionKey?: string;
};

export type RiskCondition = {
  type: "risk";
  minRisk?: RiskLevel;
  maxRisk?: RiskLevel;
};

export type FrequencyCondition = {
  type: "frequency";
  maxCount: number;
  windowSeconds: number;
  scope?: "agent" | "session" | "global";
};

export type CompositeCondition = {
  type: "any";
  conditions: Condition[];
};

export type NegationCondition = {
  type: "not";
  condition: Condition;
};

export type Condition =
  | ToolCondition
  | TimeCondition
  | AgentCondition
  | ContextCondition
  | RiskCondition
  | FrequencyCondition
  | CompositeCondition
  | NegationCondition;

export type Rule = {
  id: string;
  description?: string;
  conditions: Condition[];
  effect: RuleEffect;
  minTrust?: TrustTier;
  maxTrust?: TrustTier;
};

export type Policy = {
  id: string;
  name: string;
  version: string;
  description?: string;
  scope: PolicyScope;
  rules: Rule[];
  enabled?: boolean;
  priority?: number;
  controls?: string[];
};

// ── Cross-Agent Governance (USP3) ──

export type AgentRelationship = {
  parentAgentId: string;
  parentSessionKey: string;
  childAgentId: string;
  childSessionKey: string;
  createdAt: number;
};

export type AgentGraph = {
  relationships: Map<string, AgentRelationship>;
};

export type CrossAgentAuditContext = {
  parentAgentId?: string;
  parentSessionKey?: string;
  inheritedPolicyIds?: string[];
  trustCeiling?: number;
};

// ── Evaluation ──

export type EvaluationContext = {
  hook: PolicyHookName;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
  timestamp: number;
  time: TimeContext;
  trust: { score: number; tier: TrustTier };
  conversationContext?: string[];
  metadata?: Record<string, unknown>;
  crossAgent?: CrossAgentAuditContext;
};

export type TimeContext = {
  hour: number;
  minute: number;
  dayOfWeek: number;
  date: string;
  timezone: string;
};

export type RiskFactor = {
  name: string;
  weight: number;
  value: number;
  description: string;
};

export type RiskAssessment = {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
};

export type MatchedPolicy = {
  policyId: string;
  ruleId: string;
  effect: RuleEffect;
  controls: string[];
};

export type Verdict = {
  action: "allow" | "deny";
  reason: string;
  risk: RiskAssessment;
  matchedPolicies: MatchedPolicy[];
  trust: { score: number; tier: TrustTier };
  evaluationUs: number;
};

// ── Audit ──

export type AuditVerdict =
  | "allow"
  | "deny"
  | "error_fallback"
  | "output_pass"
  | "output_flag"
  | "output_block";

export type AuditContext = {
  hook: string;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
  crossAgent?: CrossAgentAuditContext;
};

export type AuditRecord = {
  id: string;
  timestamp: number;
  timestampIso: string;
  verdict: AuditVerdict;
  reason: string;
  context: AuditContext;
  trust: { score: number; tier: TrustTier };
  risk: { level: RiskLevel; score: number };
  matchedPolicies: MatchedPolicy[];
  evaluationUs: number;
  controls: string[];
};

// ── Frequency ──

export type FrequencyEntry = {
  timestamp: number;
  agentId: string;
  sessionKey: string;
  toolName?: string;
};

// ── Config ──

export type TimeWindow = {
  name: string;
  start: string;
  end: string;
  days?: number[];
  timezone?: string;
};

export type TrustConfig = {
  enabled: boolean;
  defaults: Record<string, number>;
  persistIntervalSeconds: number;
  decay: { enabled: boolean; inactivityDays: number; rate: number };
  weights?: Partial<TrustWeights>;
  maxHistoryPerAgent: number;
};

export type TrustWeights = {
  agePerDay: number;
  ageMax: number;
  successPerAction: number;
  successMax: number;
  violationPenalty: number;
  cleanStreakPerDay: number;
  cleanStreakMax: number;
};

export type AuditConfig = {
  enabled: boolean;
  retentionDays: number;
  redactPatterns: string[];
  level: AuditLevel;
};

export type PerformanceConfig = {
  maxEvalUs: number;
  maxContextMessages: number;
  frequencyBufferSize: number;
};

export type BuiltinPoliciesConfig = {
  nightMode?: boolean | { after?: string; before?: string; start?: string; end?: string };
  credentialGuard?: boolean;
  productionSafeguard?: boolean;
  rateLimiter?: boolean | { maxPerMinute?: number };
};

export type FailMode = "open" | "closed";

export type GovernanceConfig = {
  enabled: boolean;
  timezone: string;
  failMode: FailMode;
  policies: Policy[];
  timeWindows: Record<string, TimeWindow>;
  trust: TrustConfig;
  audit: AuditConfig;
  toolRiskOverrides: Record<string, number>;
  builtinPolicies: BuiltinPoliciesConfig;
  performance: PerformanceConfig;
  outputValidation: OutputValidationConfig;
  redaction?: RedactionConfig;
};

// ── Policy Index (internal) ──

export type PolicyIndex = {
  byHook: Map<PolicyHookName, Policy[]>;
  byAgent: Map<string, Policy[]>;
  regexCache: Map<string, RegExp>;
};

// ── Condition Evaluator Types ──

export type ConditionDeps = {
  regexCache: Map<string, RegExp>;
  timeWindows: Record<string, TimeWindow>;
  risk: RiskAssessment;
  frequencyTracker: FrequencyTracker;
};

export type ConditionEvaluatorFn = (
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
) => boolean;

export type ConditionEvaluatorMap = Record<
  Condition["type"],
  ConditionEvaluatorFn
>;

// ── FrequencyTracker interface (for dependency injection) ──

export interface FrequencyTracker {
  record(entry: FrequencyEntry): void;
  count(
    windowSeconds: number,
    scope: "agent" | "session" | "global",
    agentId: string,
    sessionKey: string,
  ): number;
  clear(): void;
}

// ── Engine Status ──

export type GovernanceStatus = {
  enabled: boolean;
  policyCount: number;
  trustEnabled: boolean;
  auditEnabled: boolean;
  failMode: FailMode;
  stats: EvaluationStats;
};

export type EvaluationStats = {
  totalEvaluations: number;
  allowCount: number;
  denyCount: number;
  errorCount: number;
  avgEvaluationUs: number;
};

// ── Output Validation (v0.2.0) ──

export type ClaimType =
  | "system_state"
  | "entity_name"
  | "existence"
  | "operational_status"
  | "self_referential";

export type BuiltinDetectorId =
  | "system_state"
  | "entity_name"
  | "existence"
  | "operational_status"
  | "self_referential";

export type Claim = {
  type: ClaimType;
  subject: string;
  predicate: string;
  value: string;
  source: string;
  offset: number;
};

export type Fact = {
  subject: string;
  predicate: string;
  value: string;
  source?: string;
  updatedAt?: number;
};

export type FactCheckResult = {
  claim: Claim;
  fact: Fact | null;
  status: "verified" | "contradicted" | "unverified";
};

export type OutputVerdict = "pass" | "flag" | "block";

export type OutputValidationResult = {
  verdict: OutputVerdict;
  claims: Claim[];
  factCheckResults: FactCheckResult[];
  contradictions: FactCheckResult[];
  reason: string;
  evaluationUs: number;
};

export type UnverifiedClaimPolicy = "ignore" | "flag" | "block";

export type OutputValidationConfig = {
  enabled: boolean;
  enabledDetectors: BuiltinDetectorId[];
  factRegistries: FactRegistryConfig[];
  unverifiedClaimPolicy: UnverifiedClaimPolicy;
  selfReferentialPolicy: UnverifiedClaimPolicy;
  contradictionThresholds: {
    /** Trust score at or above which contradictions result in "flag" (default: 60) */
    flagAbove: number;
    /** Trust score below which contradictions result in "block" (default: 40) */
    blockBelow: number;
  };
  llmValidator?: LlmValidatorConfig;
};

export type FactRegistryConfig = {
  id?: string;
  facts?: Fact[];
  filePath?: string;
};

export type AuditOutputVerdict =
  | "output_pass"
  | "output_flag"
  | "output_block";

// ── LLM Output Validation Gate (v0.5.0 / RFC-006) ──

export type LlmValidatorConfig = {
  enabled: boolean;
  model?: string;
  maxTokens: number;
  timeoutMs: number;
  externalChannels: string[];
  externalCommands: string[];
  /** Behavior when LLM call fails. "open" = pass (default), "closed" = block */
  failMode?: "open" | "closed";
  /** Max retry attempts for transient LLM failures (default: 0) */
  retryAttempts?: number;
};

export type LlmValidationIssue = {
  category: string;
  claim: string;
  explanation: string;
  severity: "critical" | "high" | "medium" | "low";
};

export type LlmValidationResult = {
  verdict: OutputVerdict;
  issues: LlmValidationIssue[];
  reason: string;
  cached: boolean;
};

/** Standard finding format for cross-plugin interop (RFC-006 §8.2) */
export type TraceFinding = {
  id: string;
  agent: string;
  signal: {
    signal: string;
    severity: "critical" | "high" | "medium" | "low";
    summary: string;
  };
  classification?: {
    rootCause: string;
    actionType: string;
    actionText: string;
    confidence: number;
  };
  factCorrection?: FactCorrection;
};

export type FactCorrection = {
  subject: string;
  claimed: string;
  actual: string;
  predicate?: string;
};

// ── Audit Filter / Stats ──

export type AuditFilter = {
  agentId?: string;
  verdict?: AuditVerdict;
  after?: number;
  before?: number;
  limit?: number;
};

export type AuditStats = {
  totalRecords: number;
  todayRecords: number;
  oldestRecord?: string;
  newestRecord?: string;
};

// ── Redaction Layer (RFC-007) ──

export type RedactionCategory = "credential" | "pii" | "financial" | "custom";

export type RedactionPattern = {
  id: string;
  category: RedactionCategory;
  regex: RegExp;
  replacementType: string;
  /** Built-in patterns cannot be disabled via config */
  builtin: boolean;
};

export type RedactionAllowlist = {
  /** Channels where PII is allowed to pass through (e.g., internal Matrix) */
  piiAllowedChannels: string[];
  /** Channels where financial data is allowed (e.g., internal admin tools) */
  financialAllowedChannels: string[];
  /** Tools whose output should not be redacted (e.g., status commands) */
  exemptTools: string[];
  /** Agent IDs that are exempt from outbound redaction (e.g., admin agents) */
  exemptAgents: string[];
};

export type CustomPatternConfig = {
  name: string;
  regex: string;
  category: RedactionCategory;
};

export type RedactionConfig = {
  enabled: boolean;
  categories: RedactionCategory[];
  vaultExpirySeconds: number;
  failMode: FailMode;
  customPatterns: CustomPatternConfig[];
  allowlist: RedactionAllowlist;
  performanceBudgetMs: number;
};

export type VaultEntry = {
  original: string;
  category: RedactionCategory;
  placeholder: string;
  hash: string;
  createdAt: number;
  expiresAt: number;
};

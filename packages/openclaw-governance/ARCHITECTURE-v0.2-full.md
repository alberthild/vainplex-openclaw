# ARCHITECTURE.md — @vainplex/openclaw-governance

**Companion to:** RFC.md (normative specification)  
**Purpose:** Implementation blueprint for Forge (developer agent) and Cerberus (review agent)  
**Version:** 0.2.0  
**Date:** 2026-02-18  

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [USP Traceability Matrix](#2-usp-traceability-matrix)
3. [Type Definitions](#3-type-definitions)
4. [Module Specifications](#4-module-specifications)
5. [Data Flow](#5-data-flow)
6. [Configuration Resolution](#6-configuration-resolution)
7. [Testing Strategy](#7-testing-strategy)
8. [Implementation Order](#8-implementation-order)
9. [Build & Package](#9-build--package)

---

## 1. Project Structure

```
openclaw-governance/
├── index.ts                          # Plugin entry point (register function)
├── openclaw.plugin.json              # Plugin manifest with JSON Schema
├── package.json                      # NPM package definition
├── tsconfig.json                     # TypeScript configuration
├── README.md                         # Public documentation
├── RFC.md                            # Normative specification
├── ARCHITECTURE.md                   # This file
├── src/
│   ├── types.ts                      # All type definitions (single source of truth)
│   ├── config.ts                     # Configuration resolution and defaults
│   ├── engine.ts                     # GovernanceEngine — orchestrator
│   ├── policy-loader.ts              # Policy parsing, validation, indexing
│   ├── policy-evaluator.ts           # Rule matching and condition evaluation
│   ├── cross-agent.ts               # Cross-Agent Governance (NEW — USP3)
│   ├── conditions/
│   │   ├── index.ts                  # Condition evaluator registry
│   │   ├── tool.ts                   # ToolCondition evaluator
│   │   ├── time.ts                   # TimeCondition evaluator
│   │   ├── agent.ts                  # AgentCondition evaluator
│   │   ├── context.ts               # ContextCondition evaluator
│   │   ├── risk.ts                   # RiskCondition evaluator
│   │   ├── frequency.ts             # FrequencyCondition evaluator
│   │   ├── composite.ts             # CompositeCondition (any/not) evaluator
│   │   └── intent.ts                # IntentCondition evaluator (LLM)
│   ├── risk-assessor.ts             # Risk scoring engine
│   ├── trust-manager.ts             # Trust score computation and persistence
│   ├── audit-trail.ts               # Audit record generation, hash chain, storage
│   ├── audit-redactor.ts            # Sensitive data redaction
│   ├── approval-manager.ts          # Human-in-the-loop approval workflow
│   ├── llm-client.ts                # LLM escalation client (OpenAI-compatible)
│   ├── frequency-tracker.ts         # Ring buffer frequency counter
│   ├── builtin-policies.ts          # Built-in policy templates
│   ├── hooks.ts                     # OpenClaw hook registration and handlers
│   └── util.ts                      # Shared utilities (time, hashing, etc.)
├── test/
│   ├── config.test.ts
│   ├── engine.test.ts
│   ├── policy-loader.test.ts
│   ├── policy-evaluator.test.ts
│   ├── cross-agent.test.ts          # Cross-Agent Governance tests (NEW)
│   ├── conditions/
│   │   ├── tool.test.ts
│   │   ├── time.test.ts
│   │   ├── agent.test.ts
│   │   ├── context.test.ts
│   │   ├── risk.test.ts
│   │   ├── frequency.test.ts
│   │   ├── composite.test.ts
│   │   └── intent.test.ts
│   ├── risk-assessor.test.ts
│   ├── trust-manager.test.ts
│   ├── audit-trail.test.ts
│   ├── audit-redactor.test.ts
│   ├── approval-manager.test.ts
│   ├── llm-client.test.ts
│   ├── frequency-tracker.test.ts
│   ├── builtin-policies.test.ts
│   ├── hooks.test.ts
│   ├── util.test.ts
│   └── integration.test.ts          # End-to-end governance pipeline tests
└── dist/                             # Compiled output (git-ignored)
```

**File size constraint:** Max 400 lines per file. Max 40 lines per function (data tables exempt).

---

## 2. USP Traceability Matrix

This plugin differentiates itself from ALL competitors (Rampart, NeMo Guardrails, GuardrailsAI, LlamaFirewall) through 5 USPs. Every USP MUST be architecturally anchored in at least 2 modules, tested explicitly, and configurable.

### USP1: Contextual Policies
*Not "can agent X use tool Y?" but "should agent X run docker rm at 3 AM on prod, given trust history and maintenance schedule?"*

| Anchor | Role |
|---|---|
| `src/conditions/time.ts` | Time-of-day, maintenance window, day-of-week awareness |
| `src/conditions/context.ts` | Conversation history, metadata, channel, session key awareness |
| `src/conditions/agent.ts` | Agent identity + trust tier as condition input |
| `src/risk-assessor.ts` | Multi-factor risk (tool + time + trust + frequency + target) |
| `src/policy-evaluator.ts` | Composable conditions evaluated in context |
| **Tests** | `conditions/time.test.ts`, `conditions/context.test.ts`, `risk-assessor.test.ts`, `integration.test.ts` ("night mode + trust + tool = deny") |
| **Config** | `timeWindows`, `policies[].rules[].conditions`, `toolRiskOverrides` |

### USP2: Learning Guardrails (Trust Levels)
*Agents earn autonomy through successful operations. Score 0-100, 5 tiers, decay on inactivity.*

| Anchor | Role |
|---|---|
| `src/trust-manager.ts` | Score computation, decay, persistence, tier mapping |
| `src/conditions/agent.ts` | Trust tier/score as condition predicates |
| `src/cross-agent.ts` | Trust propagation to sub-agents, inherited trust ceilings |
| `src/hooks.ts` | `after_tool_call` feeds success/failure back into trust |
| **Tests** | `trust-manager.test.ts`, `conditions/agent.test.ts`, `cross-agent.test.ts` ("sub-agent trust propagation") |
| **Config** | `trust.enabled`, `trust.defaults`, `trust.decay`, `trust.weights` |

### USP3: Cross-Agent Governance
*Policies that span agent boundaries: sub-agent inheritance, trust propagation, agent-to-agent message governance.*

| Anchor | Role |
|---|---|
| `src/cross-agent.ts` | **Dedicated module**: policy inheritance resolution, sub-agent trust propagation, agent-to-agent message governance, agent graph tracking |
| `src/policy-evaluator.ts` | Calls cross-agent module to resolve inherited policies before evaluation |
| `src/trust-manager.ts` | Provides trust data; cross-agent reads parent trust for ceiling computation |
| `src/hooks.ts` | Intercepts `sessions_spawn` to register parent→child relationships, intercepts `message_sending` for agent-to-agent governance |
| **Tests** | `cross-agent.test.ts` (dedicated: 12+ test cases), `integration.test.ts` ("sub-agent inherits parent deny") |
| **Config** | `policies[].scope.agents`, `policies[].scope.excludeAgents`, `trust.defaults` |

### USP4: Compliance-ready Audit Trail
*Hash-chained JSONL, ISO 27001 Annex A control mapping, tamper-evident, exportable.*

| Anchor | Role |
|---|---|
| `src/audit-trail.ts` | Hash chain generation, JSONL persistence, chain verification, ISO control mapping |
| `src/audit-redactor.ts` | Sensitive data redaction before persistence |
| `src/cross-agent.ts` | Injects `parentAgentId` and `inheritedPolicies` into audit context for cross-agent traceability |
| **Tests** | `audit-trail.test.ts`, `audit-redactor.test.ts`, `integration.test.ts` ("chain integrity after 100 records") |
| **Config** | `audit.enabled`, `audit.backend`, `audit.retentionDays`, `audit.verifyOnStartup`, `audit.redactPatterns`, `audit.level` |

### USP5: Semantic Intent Understanding
*Hybrid: regex (<5ms) for 90% of cases, LLM escalation only for ambiguous situations.*

| Anchor | Role |
|---|---|
| `src/conditions/intent.ts` | LLM-based intent evaluation with confidence thresholds |
| `src/llm-client.ts` | OpenAI-compatible client with caching, concurrency control, timeouts |
| `src/policy-evaluator.ts` | Decides when to escalate to LLM based on risk threshold |
| `src/risk-assessor.ts` | Risk score determines whether LLM escalation is warranted |
| **Tests** | `conditions/intent.test.ts`, `llm-client.test.ts`, `integration.test.ts` ("high-risk ambiguous → LLM escalation") |
| **Config** | `llm.enabled`, `llm.escalationThreshold`, `llm.minRiskForEscalation`, `llm.cacheResults`, `llm.cacheTtlSeconds` |

---

## 3. Type Definitions

All types live in `src/types.ts`. This is the single source of truth. Other modules import from here.

### 3.1 Plugin API Types (from OpenClaw)

```typescript
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
  registerGatewayMethod: (method: string, handler: (...args: any[]) => any) => void;
  on: <K extends string>(
    hookName: K,
    handler: (...args: any[]) => any,
    opts?: { priority?: number },
  ) => void;
};

export type PluginService = {
  id: string;
  start: (ctx: any) => void | Promise<void>;
  stop?: (ctx: any) => void | Promise<void>;
};

export type PluginCommand = {
  name: string;
  description: string;
  requireAuth?: boolean;
  handler: (ctx?: any) => { text: string } | Promise<{ text: string }>;
};
```

### 3.2 Hook Event Types (from OpenClaw)

```typescript
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
```

### 3.3 Governance Domain Types

```typescript
// ── Trust ──

export type TrustTier = "untrusted" | "restricted" | "standard" | "trusted" | "privileged";

export type TrustSignals = {
  successCount: number;
  violationCount: number;
  approvedEscalations: number;
  deniedEscalations: number;
  ageDays: number;
  cleanStreak: number;
  manualAdjustment: number;
};

export type TrustEvent = {
  timestamp: string;
  type: "success" | "violation" | "escalation_approved" | "escalation_denied" | "manual_adjustment";
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
  | { action: "escalate"; to: EscalationTarget; timeout?: number; fallback?: "allow" | "deny" }
  | { action: "audit"; level?: AuditLevel };

export type EscalationTarget = "human";

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

export type IntentCondition = {
  type: "intent";
  description: string;
  confidence?: number;
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
  | IntentCondition
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
  /** Map of child session key → parent relationship */
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
  /** Cross-agent context — populated by cross-agent module (USP3) */
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
};

export type Verdict = {
  action: "allow" | "deny" | "escalate";
  reason: string;
  risk: RiskAssessment;
  matchedPolicies: MatchedPolicy[];
  trust: { score: number; tier: TrustTier };
  evaluationUs: number;
  llmEscalated: boolean;
};

// ── Audit ──

export type AuditVerdict =
  | "allow"
  | "deny"
  | "escalate"
  | "escalate_approved"
  | "escalate_denied"
  | "escalate_timeout"
  | "error_fallback";

export type AuditContext = {
  hook: string;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
  /** Cross-agent traceability (USP3 + USP4) */
  crossAgent?: CrossAgentAuditContext;
};

export type AuditRecord = {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: number;
  timestampIso: string;
  verdict: AuditVerdict;
  context: AuditContext;
  trust: { score: number; tier: TrustTier };
  risk: { level: RiskLevel; score: number };
  matchedPolicies: MatchedPolicy[];
  evaluationUs: number;
  llmEscalated: boolean;
  controls: string[];
};

export type AuditChainState = {
  seq: number;
  lastHash: string;
  lastTimestamp: number;
  recordCount: number;
};

// ── Approval ──

export type ApprovalStatus = "pending" | "approved" | "denied" | "timeout" | "expired";

export type PendingApproval = {
  id: string;
  agentId: string;
  sessionKey: string;
  verdict: Verdict;
  context: EvaluationContext;
  status: ApprovalStatus;
  createdAt: number;
  timeoutAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  fallback: "allow" | "deny";
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
  approvedEscalationBonus: number;
  deniedEscalationPenalty: number;
  cleanStreakPerDay: number;
  cleanStreakMax: number;
};

export type AuditConfig = {
  enabled: boolean;
  backend: "local" | "nats" | "both";
  retentionDays: number;
  verifyOnStartup: boolean;
  redactPatterns: string[];
  level: AuditLevel;
};

export type ApprovalConfig = {
  enabled: boolean;
  timeoutSeconds: number;
  defaultFallback: "allow" | "deny";
  maxPendingPerAgent: number;
  channel: "system_event" | "direct_message";
  target?: string;
};

export type LlmConfig = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  escalationThreshold: number;
  minRiskForEscalation: number;
  maxConcurrent: number;
  cacheResults: boolean;
  cacheTtlSeconds: number;
};

export type PerformanceConfig = {
  maxEvalUs: number;
  maxContextMessages: number;
  frequencyBufferSize: number;
};

export type BuiltinPoliciesConfig = {
  nightMode?: boolean | { after?: string; before?: string };
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
  approval: ApprovalConfig;
  llm: LlmConfig;
  toolRiskOverrides: Record<string, number>;
  builtinPolicies: BuiltinPoliciesConfig;
  performance: PerformanceConfig;
};

// ── Policy Index (internal) ──

export type PolicyIndex = {
  /** Policies indexed by hook name */
  byHook: Map<PolicyHookName, Policy[]>;
  /** Policies indexed by agent ID (includes "*" for global) */
  byAgent: Map<string, Policy[]>;
  /** All compiled regex patterns, keyed by their source string */
  regexCache: Map<string, RegExp>;
};
```

---

## 4. Module Specifications

### 4.1 `index.ts` — Plugin Entry Point

> **USP anchors:** All 5 USPs (orchestration layer that wires everything together)

**Responsibility:** Register the governance plugin with OpenClaw.

**Pattern:** Follows the exact same pattern as `nats-eventstore/index.ts` and `cortex/index.ts`.

```typescript
import { resolveConfig } from "./src/config.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    if (!config.enabled) {
      api.logger.info("[governance] Disabled via config");
      return;
    }
    const engine = new GovernanceEngine(config, api.logger);
    api.registerService({
      id: "governance-engine",
      start: async () => engine.start(),
      stop: async () => engine.stop(),
    });
    registerGovernanceHooks(api, engine, config);
    registerCommands(api, engine);
    api.registerGatewayMethod("governance.status", async () => engine.getStatus());
    api.registerGatewayMethod("governance.trust", async (params) => engine.getTrust(params?.agentId));
  },
};
export default plugin;
```

**Lines:** ~80

---

### 4.2 `src/config.ts` — Configuration Resolution

> **USP anchors:** USP1 (timeWindows, toolRiskOverrides), USP2 (trust config), USP4 (audit config), USP5 (llm config)

**Responsibility:** Resolve raw `pluginConfig` into a fully-typed `GovernanceConfig` with defaults.

**Exports:**
```typescript
export function resolveConfig(raw?: Record<string, unknown>): GovernanceConfig;
```

**Default values:**

| Field | Default |
|---|---|
| `enabled` | `true` |
| `timezone` | `"UTC"` |
| `failMode` | `"open"` |
| `policies` | `[]` |
| `timeWindows` | `{}` |
| `trust.enabled` | `true` |
| `trust.defaults` | `{ "main": 60, "*": 10 }` |
| `trust.persistIntervalSeconds` | `60` |
| `trust.decay.enabled` | `true` |
| `trust.decay.inactivityDays` | `30` |
| `trust.decay.rate` | `0.99` |
| `trust.maxHistoryPerAgent` | `100` |
| `audit.enabled` | `true` |
| `audit.backend` | `"local"` |
| `audit.retentionDays` | `90` |
| `audit.verifyOnStartup` | `true` |
| `audit.redactPatterns` | `[]` |
| `audit.level` | `"standard"` |
| `approval.enabled` | `true` |
| `approval.timeoutSeconds` | `300` |
| `approval.defaultFallback` | `"deny"` |
| `approval.maxPendingPerAgent` | `3` |
| `approval.channel` | `"system_event"` |
| `llm.enabled` | `false` |
| `llm.endpoint` | `"http://localhost:11434/v1"` |
| `llm.model` | `"mistral:7b"` |
| `llm.apiKey` | `""` |
| `llm.timeoutMs` | `5000` |
| `llm.escalationThreshold` | `50` |
| `llm.minRiskForEscalation` | `20` |
| `llm.maxConcurrent` | `2` |
| `llm.cacheResults` | `true` |
| `llm.cacheTtlSeconds` | `300` |
| `performance.maxEvalUs` | `5000` |
| `performance.maxContextMessages` | `10` |
| `performance.frequencyBufferSize` | `1000` |

**Pattern:** Same as `cortex/src/config.ts` — destructure with defaults, no validation library.

**Lines:** ~120

---

### 4.3 `src/engine.ts` — GovernanceEngine

> **USP anchors:** All 5 USPs (orchestrator — wires cross-agent, trust, audit, intent together)

**Responsibility:** Orchestrator that ties all subsystems together. This is the single entry point for hook handlers.

**Exports:**
```typescript
export class GovernanceEngine {
  constructor(config: GovernanceConfig, logger: PluginLogger);
  start(): Promise<void>;
  stop(): Promise<void>;
  evaluate(ctx: EvaluationContext): Promise<Verdict>;
  recordOutcome(agentId: string, toolName: string, success: boolean): void;
  getStatus(): GovernanceStatus;
  getTrust(agentId?: string): AgentTrust | TrustStore;
  setTrust(agentId: string, score: number): void;
  resolveApproval(id: string, approved: boolean, resolvedBy?: string): void;
  getPendingApprovals(): PendingApproval[];
  /** Register a parent→child agent relationship (USP3) */
  registerSubAgent(parentSessionKey: string, childSessionKey: string): void;
}
```

**Internal structure:**
```typescript
class GovernanceEngine {
  private config: GovernanceConfig;
  private logger: PluginLogger;
  private policyIndex: PolicyIndex;
  private evaluator: PolicyEvaluator;
  private riskAssessor: RiskAssessor;
  private trustManager: TrustManager;
  private crossAgentManager: CrossAgentManager;  // USP3
  private auditTrail: AuditTrail;
  private approvalManager: ApprovalManager;
  private llmClient: LlmClient | null;
  private frequencyTracker: FrequencyTracker;
  private stats: EvaluationStats;

  // evaluate() orchestration:
  // 1. crossAgentManager.enrichContext(ctx)       ← USP3: inject parent info + inherited policies
  // 2. riskAssessor.assess(ctx)                   ← USP1: multi-factor contextual risk
  // 3. crossAgentManager.resolveEffectivePolicies(ctx, policyIndex)  ← USP3: merge inherited policies
  // 4. evaluator.evaluate(ctx, effectivePolicies, risk)              ← USP1+USP5: contextual + semantic eval
  // 5. trustManager.checkTrustGates(verdict, ctx) ← USP2: trust-based access gates
  // 6. auditTrail.record(verdict, ctx, risk)      ← USP4: hash-chained compliance record
  // 7. return verdict
}
```

**Lines:** ~220

---

### 4.4 `src/cross-agent.ts` — Cross-Agent Governance (NEW)

> **USP anchors:** USP3 (primary), USP2 (trust propagation), USP4 (cross-agent audit context)
>
> **Why this is unique:** No competitor (Rampart, NeMo, GuardrailsAI, LlamaFirewall) has any concept of multi-agent governance. They all evaluate a single request in isolation. This module is the architectural core of what makes this plugin a *governance* system rather than a firewall.

**Responsibility:** Manage agent relationships, policy inheritance across agent boundaries, sub-agent trust propagation, and agent-to-agent communication governance.

**Exports:**
```typescript
export class CrossAgentManager {
  constructor(trustManager: TrustManager, logger: PluginLogger);

  // ── Agent Graph Management ──

  /** Register a parent→child relationship when sessions_spawn is detected */
  registerRelationship(parentSessionKey: string, childSessionKey: string): void;

  /** Remove a relationship (on session end) */
  removeRelationship(childSessionKey: string): void;

  /** Get parent relationship for a session (or null if root agent) */
  getParent(childSessionKey: string): AgentRelationship | null;

  /** Get all children of a parent session */
  getChildren(parentSessionKey: string): AgentRelationship[];

  /** Get full ancestor chain (child → parent → grandparent → ...) */
  getAncestorChain(sessionKey: string): AgentRelationship[];

  // ── Context Enrichment ──

  /** Enrich an EvaluationContext with cross-agent metadata.
   *  Adds parentAgentId, parentSessionKey, inheritedPolicyIds, trustCeiling.
   *  Called by engine.evaluate() BEFORE policy evaluation. */
  enrichContext(ctx: EvaluationContext): EvaluationContext;

  // ── Policy Inheritance ──

  /** Resolve effective policies for a given context.
   *  For root agents: returns policies from index matching the agent.
   *  For sub-agents: returns UNION of own policies + all ancestor policies.
   *  Deny-wins across inheritance chain (parent deny cannot be overridden by child allow).
   *  Returns a PolicyIndex-compatible structure for the evaluator. */
  resolveEffectivePolicies(
    ctx: EvaluationContext,
    index: PolicyIndex,
  ): Policy[];

  // ── Trust Propagation ──

  /** Compute the effective trust ceiling for a sub-agent.
   *  Rule: child trust can NEVER exceed parent trust.
   *  A sub-agent of a "standard" (score 50) parent cannot exceed score 50.
   *  For root agents, returns Infinity (no ceiling). */
  computeTrustCeiling(sessionKey: string): number;

  // ── Agent-to-Agent Message Governance ──

  /** Check if an agent-to-agent message is allowed.
   *  Evaluates BOTH sender's outbound policies AND receiver's inbound policies.
   *  Returns { allowed: boolean, reason?: string }.
   *  Called by hooks.ts when message_sending targets another agent. */
  evaluateAgentMessage(
    senderCtx: EvaluationContext,
    receiverAgentId: string,
  ): { allowed: boolean; reason?: string };

  /** Get a summary of the current agent graph (for status/debugging) */
  getGraphSummary(): { agentCount: number; relationships: AgentRelationship[] };
}
```

**Internal logic:**

```typescript
class CrossAgentManager {
  private graph: AgentGraph;
  private trustManager: TrustManager;
  private logger: PluginLogger;

  // enrichContext():
  //   1. Check if ctx.sessionKey indicates a sub-agent (contains "subagent:")
  //   2. If yes, lookup parent in graph
  //   3. Compute trust ceiling from parent chain
  //   4. Set ctx.crossAgent = { parentAgentId, parentSessionKey, inheritedPolicyIds, trustCeiling }
  //   5. Apply trust ceiling: ctx.trust.score = min(ctx.trust.score, trustCeiling)
  //   6. Recompute ctx.trust.tier from capped score

  // resolveEffectivePolicies():
  //   1. Collect policies matching ctx.agentId from index
  //   2. If sub-agent: walk ancestor chain
  //   3. For each ancestor: collect policies matching ancestor's agentId
  //   4. Union all policies (deduplicate by ID)
  //   5. Global policies (scope.agents = undefined) are already included once
  //   6. Return merged list — evaluator applies deny-wins as usual

  // computeTrustCeiling():
  //   1. Walk ancestor chain from sessionKey upward
  //   2. For each ancestor, get their current trust score
  //   3. Return minimum trust score in the chain
  //   4. Root agent → return Infinity (no ceiling)
}
```

**Agent identification pattern:**
- Session key format: `agent:main:subagent:abc123` → parent is `main`, child is extracted from full key
- Nested: `agent:main:subagent:forge:subagent:task1` → grandparent `main`, parent `forge`
- `util.extractAgentId()` and `util.isSubAgent()` provide the parsing

**Lines:** ~250

---

### 4.5 `src/policy-loader.ts` — Policy Loading and Indexing

> **USP anchors:** USP1 (composable condition compilation), USP3 (scope-aware indexing for cross-agent resolution)

**Responsibility:** Parse policy definitions from config, validate them, compile regex patterns, and build the policy index.

**Exports:**
```typescript
export function loadPolicies(
  policies: Policy[],
  builtinConfig: BuiltinPoliciesConfig,
  logger: PluginLogger,
): Policy[];

export function buildPolicyIndex(policies: Policy[]): PolicyIndex;

export function validateRegex(pattern: string): { valid: boolean; error?: string };
```

**Regex safety validation:**
- Reject patterns with nested quantifiers: `(a+)+`, `(a*)*`, `(a+)*b`
- Reject patterns longer than 500 characters
- On invalid pattern: log warning, skip the condition (treat as non-matching)

**Policy index structure:**
- `byHook`: Group policies by `scope.hooks`. No hook scope → ALL hook groups.
- `byAgent`: Group policies by `scope.agents`. No agent scope → `"*"` (global). *Cross-agent module reads this index to resolve inherited policies.*
- `regexCache`: Compile all `matches` patterns into `RegExp` objects.

**Lines:** ~180

---

### 4.6 `src/policy-evaluator.ts` — Rule Matching

> **USP anchors:** USP1 (contextual condition evaluation), USP3 (evaluates cross-agent-resolved policy set), USP5 (triggers LLM escalation for ambiguous cases)

**Responsibility:** Evaluate an `EvaluationContext` against policies and return matched policies with their effects.

**Exports:**
```typescript
export class PolicyEvaluator {
  constructor(conditionEvaluators: ConditionEvaluatorMap);

  /** Evaluate context against a list of policies.
   *  Note: policies may come from PolicyIndex directly (root agents)
   *  OR from CrossAgentManager.resolveEffectivePolicies (sub-agents). */
  evaluate(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
    llmClient: LlmClient | null,
  ): Promise<{ action: "allow" | "deny" | "escalate"; reason: string; matches: MatchedPolicy[] }>;
}
```

**Algorithm (per RFC §4.7 and §6.4):**

```
1. Filter policies by scope (excludeAgents, channels, enabled flag)
2. Sort by priority (desc), then specificity (desc)
3. For each policy, evaluate rules in order:
   a. Check minTrust/maxTrust against ctx.trust.tier
   b. Evaluate all conditions (AND logic, short-circuit on first false)
   c. First matching rule → policy verdict; break
4. Collect all policy verdicts
5. Apply deny-wins aggregation:
   deny > escalate > audit > allow
6. Return { action, reason, matches }
```

**Key change from v0.1.0:** The evaluator now receives a pre-resolved policy list (not the raw PolicyIndex). The cross-agent module handles policy inheritance resolution BEFORE the evaluator runs. This keeps the evaluator clean — it only does matching, not scope resolution.

**Lines:** ~150

---

### 4.7 `src/conditions/` — Condition Evaluators

> **USP anchors:** USP1 (each condition type enables contextual awareness), USP5 (intent.ts provides semantic understanding)

Each condition type has its own evaluator module. All follow this interface:

```typescript
export type ConditionEvaluatorFn = (
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
) => boolean | Promise<boolean>;

export type ConditionDeps = {
  regexCache: Map<string, RegExp>;
  timeWindows: Record<string, TimeWindow>;
  risk: RiskAssessment;
  frequencyTracker: FrequencyTracker;
  llmClient: LlmClient | null;
};

export type ConditionEvaluatorMap = Record<Condition["type"], ConditionEvaluatorFn>;
```

#### 4.7.1 `conditions/index.ts` — Registry (~50 lines)

```typescript
export function createConditionEvaluators(): ConditionEvaluatorMap;
export async function evaluateConditions(
  conditions: Condition[], ctx: EvaluationContext,
  deps: ConditionDeps, evaluators: ConditionEvaluatorMap,
): Promise<boolean>;
```

#### 4.7.2 `conditions/tool.ts` (~80 lines)
Exact match, glob, array, param matchers (equals/contains/matches/startsWith/in).

#### 4.7.3 `conditions/time.ts` (~70 lines)
Time ranges, midnight wrap, day-of-week, named window resolution. **USP1 core: makes policies time-aware.**

#### 4.7.4 `conditions/agent.ts` (~40 lines)
Agent ID match (glob), trust tier check, score range. **USP2 core: trust-based condition predicates.**

#### 4.7.5 `conditions/context.ts` (~70 lines)
Conversation search, message content, metadata, channel, session key. **USP1 core: conversation-aware policies.**

#### 4.7.6 `conditions/risk.ts` (~30 lines)
Risk level ordering and range check.

#### 4.7.7 `conditions/frequency.ts` (~30 lines)
Query frequency tracker, returns true if limit exceeded.

#### 4.7.8 `conditions/composite.ts` (~40 lines)
`any` (OR logic), `not` (negation). Recursive sub-condition evaluation.

#### 4.7.9 `conditions/intent.ts` (~50 lines)
**USP5 core.** LLM-based intent evaluation. Falls back to false if no LLM available. Builds prompt per RFC §9.4, parses JSON response, checks confidence threshold.

---

### 4.8 `src/risk-assessor.ts` — Risk Scoring

> **USP anchors:** USP1 (multi-factor contextual risk — combines tool + time + trust + frequency + target), USP5 (risk score determines LLM escalation threshold)

**Responsibility:** Compute risk score for an action based on 5 factors.

**Exports:**
```typescript
export class RiskAssessor {
  constructor(toolRiskOverrides: Record<string, number>);
  assess(ctx: EvaluationContext, frequencyTracker: FrequencyTracker): RiskAssessment;
}
```

**Built-in tool risk scores (overridable via config):**

```typescript
const DEFAULT_TOOL_RISK: Record<string, number> = {
  gateway: 95, cron: 90, elevated: 95,           // Critical
  exec: 70, write: 65, edit: 60,                 // High
  sessions_spawn: 45, sessions_send: 50,          // Medium
  browser: 40, message: 40,
  read: 10, memory_search: 5, memory_get: 5,     // Low
  web_search: 15, web_fetch: 20, image: 10, canvas: 15,
};
```

**Risk computation (per RFC §6.3):**
```
toolSensitivity = lookupToolRisk(ctx.toolName) * 0.30
timeRisk = isOffHours(ctx.time) ? 15 : 0
trustDeficit = ((100 - ctx.trust.score) / 100) * 20
frequencyRisk = min(recentActionCount / 20, 1) * 15
targetScope = isExternalTarget(ctx) ? 20 : 0
total = clamp(sum, 0, 100)
level = total <= 25 ? "low" : total <= 50 ? "medium" : total <= 75 ? "high" : "critical"
```

**Lines:** ~120

---

### 4.9 `src/trust-manager.ts` — Trust System

> **USP anchors:** USP2 (primary — score computation, tier mapping, decay, persistence), USP3 (provides trust data for cross-agent ceiling computation)

**Responsibility:** Manage agent trust scores, compute from signals, persist to disk.

**Exports:**
```typescript
export class TrustManager {
  constructor(config: TrustConfig, workspace: string, logger: PluginLogger);
  load(): void;
  getAgentTrust(agentId: string): AgentTrust;
  getStore(): TrustStore;
  recordSuccess(agentId: string, reason?: string): void;
  recordViolation(agentId: string, reason?: string): void;
  recordEscalation(agentId: string, approved: boolean, reason?: string): void;
  setScore(agentId: string, score: number): void;
  lockTier(agentId: string, tier: TrustTier): void;
  unlockTier(agentId: string): void;
  setFloor(agentId: string, floor: number): void;
  resetHistory(agentId: string): void;
  flush(): void;
  startPersistence(): void;
  stopPersistence(): void;
}
```

**Score computation (per RFC §5.2):**
```typescript
function computeScore(signals: TrustSignals, weights: TrustWeights): number {
  const base = Math.min(signals.ageDays * weights.agePerDay, weights.ageMax);
  const success = Math.min(signals.successCount * weights.successPerAction, weights.successMax);
  const violations = signals.violationCount * weights.violationPenalty;
  const escApproved = signals.approvedEscalations * weights.approvedEscalationBonus;
  const escDenied = signals.deniedEscalations * weights.deniedEscalationPenalty;
  const streak = Math.min(signals.cleanStreak * weights.cleanStreakPerDay, weights.cleanStreakMax);
  const raw = base + success + violations + escApproved + escDenied + streak + signals.manualAdjustment;
  return Math.max(0, Math.min(100, raw));
}
```

**Default weights:**

| Weight | Value |
|---|---|
| `agePerDay` | 0.5 |
| `ageMax` | 20 |
| `successPerAction` | 0.1 |
| `successMax` | 30 |
| `violationPenalty` | -2 |
| `approvedEscalationBonus` | 0.5 |
| `deniedEscalationPenalty` | -3 |
| `cleanStreakPerDay` | 0.3 |
| `cleanStreakMax` | 20 |

**Storage:** `{workspace}/governance/trust.json`

**Tier mapping:**
```typescript
function scoreToTier(score: number): TrustTier {
  if (score >= 80) return "privileged";
  if (score >= 60) return "trusted";
  if (score >= 40) return "standard";
  if (score >= 20) return "restricted";
  return "untrusted";
}
```

**Lines:** ~250

---

### 4.10 `src/audit-trail.ts` — Audit System

> **USP anchors:** USP4 (primary — hash chain, ISO 27001 mapping, tamper evidence), USP3 (cross-agent context in audit records)

**Responsibility:** Generate, hash-chain, and persist audit records.

**Exports:**
```typescript
export class AuditTrail {
  constructor(config: AuditConfig, workspace: string, logger: PluginLogger);
  load(verify: boolean): void;
  /** Create audit record. Accepts crossAgent context from EvaluationContext (USP3+USP4). */
  record(
    verdict: AuditVerdict,
    context: AuditContext,
    trust: { score: number; tier: TrustTier },
    risk: { level: RiskLevel; score: number },
    matchedPolicies: MatchedPolicy[],
    evaluationUs: number,
    llmEscalated: boolean,
  ): AuditRecord;
  query(filter: AuditFilter): AuditRecord[];
  flush(): void;
  startAutoFlush(): void;
  stopAutoFlush(): void;
  getChainState(): AuditChainState;
  verifyChain(from?: string, to?: string): { valid: boolean; breakAt?: number; error?: string };
  getStats(): AuditStats;
}
```

**Hash chain implementation:**
```typescript
function computeHash(record: Omit<AuditRecord, "hash">): string {
  const data = `${record.seq}|${record.timestamp}|${record.verdict}|${record.context.agentId}|${record.context.hook}|${record.context.toolName ?? ""}|${record.prevHash}`;
  return createHash("sha256").update(data).digest("hex");
}
```

**File format:** JSONL in `{workspace}/governance/audit/YYYY-MM-DD.jsonl`
**Chain state:** `{workspace}/governance/audit/chain-state.json`
**Buffer:** In-memory, flushed every 1s or 100 records.

**Cross-agent audit enrichment (USP3+USP4):** When `context.crossAgent` is present, the audit record preserves `parentAgentId`, `parentSessionKey`, and `inheritedPolicyIds`. This enables compliance queries like "show all actions by sub-agents of forge" and tracing policy inheritance chains.

**Lines:** ~250

---

### 4.11 `src/audit-redactor.ts` — Sensitive Data Redaction

> **USP anchors:** USP4 (compliance-ready output requires proper redaction)

**Exports:**
```typescript
export function createRedactor(customPatterns: string[]): (ctx: AuditContext) => AuditContext;
```

**Lines:** ~60

---

### 4.12 `src/approval-manager.ts` — Human-in-the-Loop

> **USP anchors:** USP1 (contextual escalation — not just "blocked" but "needs human review given context"), USP4 (approval lifecycle fully audited)

**Exports:**
```typescript
export class ApprovalManager {
  constructor(config: ApprovalConfig, workspace: string, logger: PluginLogger);
  load(): void;
  create(verdict: Verdict, ctx: EvaluationContext): PendingApproval;
  resolve(id: string, approved: boolean, resolvedBy?: string): PendingApproval | null;
  checkTimeouts(): PendingApproval[];
  getPending(): PendingApproval[];
  getPendingForAgent(agentId: string): PendingApproval[];
  canEscalate(agentId: string): boolean;
  formatNotification(approval: PendingApproval): string;
  flush(): void;
  startTimeoutChecker(): void;
  stopTimeoutChecker(): void;
}
```

**Storage:** `{workspace}/governance/pending-approvals.json`
**Timeout checker:** Every 10s.

**Lines:** ~200

---

### 4.13 `src/llm-client.ts` — LLM Escalation Client

> **USP anchors:** USP5 (primary — semantic intent understanding via LLM), USP1 (contextual information passed to LLM for richer evaluation)

**Exports:**
```typescript
export class LlmClient {
  constructor(config: LlmConfig, logger: PluginLogger);
  evaluateIntent(
    intent: IntentCondition,
    ctx: EvaluationContext,
  ): Promise<{ matches: boolean; confidence: number; reasoning: string } | null>;
  clearCache(): void;
  destroy(): void;
}
```

**Implementation:** `fetch` (Node 22), semaphore concurrency, `Map` cache with SHA-256 keys, `AbortController` timeouts. On error: return `null`.

**Lines:** ~150

---

### 4.14 `src/frequency-tracker.ts` — Ring Buffer Frequency Counter

> **USP anchors:** USP1 (frequency as contextual signal for rate-aware policies)

**Exports:**
```typescript
export class FrequencyTracker {
  constructor(bufferSize: number);
  record(entry: FrequencyEntry): void;
  count(windowSeconds: number, scope: "agent" | "session" | "global", agentId: string, sessionKey: string): number;
  clear(): void;
}
```

**Lines:** ~70

---

### 4.15 `src/builtin-policies.ts` — Built-in Policy Templates

> **USP anchors:** USP1 (night mode, credential guard — contextual defaults), USP3 (production safeguard applies cross-agent)

**Exports:**
```typescript
export function getBuiltinPolicies(config: BuiltinPoliciesConfig): Policy[];
```

**Templates:** Night Mode, Credential Guard, Production Safeguard, Rate Limiter.

**Lines:** ~150

---

### 4.16 `src/hooks.ts` — Hook Registration

> **USP anchors:** USP2 (after_tool_call → trust feedback loop), USP3 (sessions_spawn → register sub-agent, message_sending → agent-to-agent governance), USP4 (every hook produces audit records)

**Responsibility:** Register all OpenClaw hook handlers.

**Exports:**
```typescript
export function registerGovernanceHooks(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
  config: GovernanceConfig,
): void;
```

**Hook registrations:**

```typescript
function registerGovernanceHooks(api, engine, config) {
  // Primary enforcement — highest priority
  api.on("before_tool_call", handleBeforeToolCall(engine, config), { priority: 1000 });
  api.on("message_sending", handleMessageSending(engine, config), { priority: 1000 });

  // Informational hooks
  api.on("after_tool_call", handleAfterToolCall(engine), { priority: 900 });
  api.on("message_sent", handleMessageSent(engine), { priority: 900 });

  // Context injection
  api.on("before_agent_start", handleBeforeAgentStart(engine, config), { priority: 5 });

  // Lifecycle
  api.on("session_start", handleSessionStart(engine), { priority: 1 });
  api.on("gateway_start", handleGatewayStart(engine), { priority: 1 });
  api.on("gateway_stop", handleGatewayStop(engine), { priority: 999 });
}
```

**Cross-Agent hook logic (USP3):**

```typescript
// In handleBeforeToolCall:
//   If toolName === "sessions_spawn" || toolName === "subagents":
//     After tool completes (via after_tool_call), register parent→child relationship
//     engine.registerSubAgent(parentSessionKey, childSessionKey)

// In handleAfterToolCall:
//   If toolName was sessions_spawn and result contains sessionId:
//     engine.registerSubAgent(ctx.sessionKey, result.sessionId)

// In handleMessageSending:
//   If message target is another agent (detected by target pattern):
//     engine.crossAgentManager.evaluateAgentMessage(senderCtx, receiverAgentId)
//     If not allowed → return { cancel: true }
```

**Error handling:** Every handler wrapped in try/catch. On error: failMode controls allow vs deny.

**Lines:** ~220

---

### 4.17 `src/util.ts` — Shared Utilities

> **USP anchors:** USP3 (agent ID extraction, sub-agent detection from session keys)

**Exports:**
```typescript
export function parseTimeToMinutes(time: string): number;
export function isInTimeRange(currentMinutes: number, afterMinutes: number, beforeMinutes: number): boolean;
export function getCurrentTime(timezone: string): TimeContext;
export function globToRegex(pattern: string): RegExp;
export function sha256(data: string): string;
export function clamp(value: number, min: number, max: number): number;
export function nowUs(): number;
export function extractAgentId(sessionKey?: string, agentId?: string): string;
export function isSubAgent(sessionKey?: string): boolean;
/** Extract parent session key from a sub-agent session key (USP3) */
export function extractParentSessionKey(sessionKey: string): string | null;
/** Extract all agent IDs from a session key chain (USP3) */
export function extractAgentChain(sessionKey: string): string[];
```

**Lines:** ~120

---

## 5. Data Flow

### 5.1 Tool Call Governance (before_tool_call)

```
Agent calls exec("docker rm container-x")
         │
         ▼
┌─────────────────────────────────┐
│ OpenClaw: before_tool_call hook │
│ (priority 1000 = governance)    │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│ hooks.ts: handleBeforeToolCall  │
│ 1. Build EvaluationContext      │
│    - agentId, toolName, params  │
│    - time, trust                │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ engine.ts: evaluate(ctx)            │
│                                     │
│ 1. crossAgent.enrichContext(ctx)    │  ← USP3: inject parent info, trust ceiling
│    → caps trust if sub-agent        │
│                                     │
│ 2. riskAssessor.assess(ctx)         │  ← USP1: multi-factor risk
│    → { level:"high", score:72 }     │
│                                     │
│ 3. crossAgent.resolveEffective-     │  ← USP3: merge inherited policies
│    Policies(ctx, policyIndex)       │
│    → [own policies + parent's]      │
│                                     │
│ 4. evaluator.evaluate(ctx, merged)  │  ← USP1+USP5: contextual + semantic
│    → builtin-night-mode matches     │
│    → { action:"deny" }              │
│                                     │
│ 5. trustManager.recordViolation     │  ← USP2: trust feedback
│                                     │
│ 6. auditTrail.record(...)           │  ← USP4: hash-chained record
│    → includes crossAgent context    │
│                                     │
│ 7. return Verdict                   │
└─────────────┬───────────────────────┘
              │
              ▼
        Tool call blocked.
```

### 5.2 Sub-Agent Spawn Flow (USP3)

```
Main agent spawns forge sub-agent
         │
         ▼
┌────────────────────────────────────────┐
│ before_tool_call: sessions_spawn       │
│ → governance evaluates the spawn itself│
│ → if allowed, tool executes            │
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│ after_tool_call: sessions_spawn        │
│ → hooks.ts detects spawn success       │
│ → engine.registerSubAgent(             │
│     "agent:main",                      │
│     "agent:main:subagent:forge:abc"    │
│   )                                    │
│ → crossAgentManager stores relationship│
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│ Forge sub-agent makes a tool call      │
│ → before_tool_call fires               │
│ → engine.evaluate(ctx) runs:           │
│                                        │
│ 1. crossAgent.enrichContext:           │
│    - Detects sub-agent from sessionKey │
│    - Finds parent=main (score 60)      │
│    - trustCeiling = 60                 │
│    - Forge's own score (45) < 60 → ok  │
│    - ctx.crossAgent = {                │
│        parentAgentId: "main",          │
│        trustCeiling: 60,               │
│        inheritedPolicyIds: [...]       │
│      }                                 │
│                                        │
│ 2. crossAgent.resolveEffectivePolicies:│
│    - Forge's own policies              │
│    + Main's policies (inherited)       │
│    + Global policies                   │
│    → merged set for evaluator          │
│                                        │
│ 3. evaluator runs on merged policies   │
│    → parent's "no-deploy" denies       │
│    → forge can't escape parent's rules │
│                                        │
│ 4. Audit record includes crossAgent    │
│    context for traceability            │
└────────────────────────────────────────┘
```

### 5.3 Agent-to-Agent Message Governance (USP3)

```
Forge sends message to Cerberus
         │
         ▼
┌────────────────────────────────────────┐
│ message_sending hook fires             │
│ → hooks.ts detects target is an agent  │
│   (target matches agent:* pattern)     │
│                                        │
│ 1. Build sender EvaluationContext      │
│ 2. crossAgent.evaluateAgentMessage(    │
│      senderCtx, "cerberus")            │
│    → Checks sender's outbound policies │
│    → Checks receiver's inbound policies│
│    → Both must allow                   │
│ 3. If blocked → { cancel: true }       │
│ 4. Audit record captures both sides    │
└────────────────────────────────────────┘
```

### 5.4 Escalation Flow

```
Agent calls gateway("restart")
         │
         ▼
┌─────────────────────────────┐
│ evaluate(ctx)               │
│ → production-safeguard      │
│ → effect: "escalate"        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ approvalManager.create(...)  │
│ → notification formatted     │
│ → system event enqueued      │
└──────────┬──────────────────┘
           │
      ┌────┴────┐
      ▼         ▼
  Human sees   Timeout (300s)
      │         │
      ▼         ▼
  /approve    fallback applied
  or /deny
```

### 5.5 Trust Update Flow

```
after_tool_call event
    │
    ▼
┌────────────────────────────────┐
│ hooks.ts: handleAfterToolCall  │
│ → engine.recordOutcome(...)    │
│ → trustManager.recordSuccess() │
│   or recordViolation()         │
│ → computeScore → update tier   │
│ → debounced persist to disk    │
└────────────────────────────────┘
```

### 5.6 Startup Flow

```
gateway_start event
    │
    ▼
┌────────────────────────────────┐
│ engine.start()                 │
│ 1. policyLoader.loadPolicies() │
│    + builtinPolicies           │
│    → build policy index        │
│ 2. trustManager.load()         │
│    → apply decay if needed     │
│ 3. auditTrail.load(verify)     │
│    → verify hash chain         │
│ 4. approvalManager.load()      │
│    → expire stale approvals    │
│ 5. frequencyTracker.clear()    │
│ 6. Start timers                │
└────────────────────────────────┘
```

---

## 6. Configuration Resolution

### 6.1 Config in openclaw.json

```json
{
  "plugins": {
    "openclaw-governance": {
      "enabled": true,
      "timezone": "Europe/Berlin",
      "policies": [
        {
          "id": "forge-no-deploy",
          "name": "Forge Cannot Deploy",
          "version": "1.0.0",
          "scope": { "agents": ["forge"] },
          "rules": [
            {
              "id": "block-push",
              "conditions": [
                { "type": "tool", "name": "exec", "params": { "command": { "matches": "git push.*(main|master)" } } }
              ],
              "effect": { "action": "deny", "reason": "Forge cannot push to main" }
            }
          ]
        }
      ],
      "trust": {
        "defaults": {
          "main": 60,
          "forge": 45,
          "cerberus": 50,
          "harbor": 45,
          "atlas": 50,
          "leuko": 40,
          "stella": 35,
          "vera": 50,
          "viola": 45,
          "*": 10
        }
      },
      "builtinPolicies": {
        "nightMode": { "after": "23:00", "before": "08:00" },
        "credentialGuard": true,
        "productionSafeguard": true,
        "rateLimiter": { "maxPerMinute": 15 }
      },
      "audit": {
        "backend": "both",
        "retentionDays": 90,
        "level": "standard"
      },
      "llm": { "enabled": false }
    }
  }
}
```

### 6.2 Workspace Directory Resolution

```
{workspace}/governance/
├── trust.json
├── pending-approvals.json
└── audit/
    ├── chain-state.json
    ├── 2026-02-18.jsonl
    └── ...
```

Resolution: `config.workspace` → `workspaceDir` from context → `~/.openclaw/plugins/openclaw-governance/`

---

## 7. Testing Strategy

### 7.1 Unit Tests

Every module gets dedicated unit tests. Minimum coverage: 90% lines.

**Test framework:** vitest (consistent with other OpenClaw plugins)

### 7.2 Key Test Scenarios

| Module | Critical Test Cases |
|---|---|
| `config` | Defaults applied, partial overrides, invalid values rejected |
| `policy-loader` | Valid policy loads, invalid regex rejected, builtin templates, index built correctly |
| `policy-evaluator` | AND logic, deny-wins, priority ordering, scope filtering, empty passthrough |
| `conditions/tool` | Exact match, glob, array, param matchers, missing tool name |
| `conditions/time` | Normal range, midnight wrap, day filter, named window, edge: start==end |
| `conditions/agent` | ID match, trust tier, score range, glob ID |
| `conditions/context` | Conversation search, message search, metadata, channel, session key glob |
| `conditions/risk` | Level ordering, boundary values |
| `conditions/frequency` | Under/at/over limit, different scopes |
| `conditions/composite` | OR, NOT, nested composites |
| `conditions/intent` | LLM available/unavailable, timeout, confidence threshold |
| `risk-assessor` | Known/unknown tools, off-hours, trust deficit, overrides |
| `trust-manager` | Score computation, tier mapping, decay, manual adjust, lock, floor, persistence |
| `audit-trail` | Record creation, hash chain, verification, buffer flush, redaction, JSONL |
| `audit-redactor` | Sensitive keys, truncation, custom patterns, nested objects |
| `approval-manager` | Create, resolve, timeout, max pending, persistence |
| `llm-client` | Success, timeout, cache hit/miss, concurrent limit |
| `frequency-tracker` | Ring buffer wrap, time window expiry, scope filtering |
| `hooks` | Deny→block, allow→undefined, error→failMode, priority set |
| **`cross-agent`** | **See §7.3 below** |
| `integration` | Full pipeline end-to-end |

### 7.3 Cross-Agent Test Cases (USP3 — Dedicated)

`test/cross-agent.test.ts` MUST cover these scenarios:

```typescript
describe("CrossAgentManager", () => {
  // ── Agent Graph ──
  it("should register a parent→child relationship", () => { ... });
  it("should return null parent for root agents", () => { ... });
  it("should track nested relationships (grandparent→parent→child)", () => { ... });
  it("should remove relationship on session end", () => { ... });
  it("should return all children of a parent", () => { ... });

  // ── Context Enrichment ──
  it("should enrich sub-agent context with parent info", () => { ... });
  it("should NOT modify root agent context", () => { ... });

  // ── Policy Inheritance ──
  it("should return only own+global policies for root agents", () => { ... });
  it("should inherit parent's policies for sub-agents", () => {
    // Setup: parent has "no-deploy" policy, child has "allow-read" policy
    // Assert: child's effective policies include both
  });
  it("should apply deny-wins across inheritance (parent deny overrides child allow)", () => {
    // Setup: parent denies exec "docker rm", child policy allows it
    // Assert: deny wins — child cannot override parent's deny
  });
  it("should inherit policies through multiple levels (grandparent→parent→child)", () => { ... });

  // ── Trust Propagation ──
  it("should cap sub-agent trust at parent's trust score", () => {
    // Setup: parent score=50 (standard), child score=80 (configured high)
    // Assert: effective child score = 50 (capped by parent)
  });
  it("should compute trust ceiling through ancestor chain (minimum wins)", () => {
    // Setup: grandparent=80, parent=50, child=90
    // Assert: effective child score = 50 (min of chain)
  });
  it("should not cap root agent trust", () => { ... });

  // ── Agent-to-Agent Message Governance ──
  it("should allow agent-to-agent message when both policies allow", () => { ... });
  it("should block message when sender's outbound policy denies", () => { ... });
  it("should block message when receiver's inbound policy denies", () => { ... });

  // ── Audit Integration ──
  it("should include crossAgent context in enriched EvaluationContext", () => {
    // Assert: ctx.crossAgent.parentAgentId, inheritedPolicyIds, trustCeiling present
  });
});
```

### 7.4 Integration Tests

`test/integration.test.ts` tests the full governance pipeline:

```typescript
describe("Governance Integration", () => {
  it("should deny tool call matching a deny policy", async () => { ... });
  it("should allow tool call when no policies match", async () => { ... });
  it("should escalate when policy requests it", async () => { ... });
  it("should deny-wins across multiple policies", async () => { ... });
  it("should respect trust tier gates on rules", async () => { ... });
  it("should apply night mode builtin policy", async () => { ... });
  it("should handle engine errors with fail-open", async () => { ... });
  it("should maintain hash chain integrity", async () => { ... });

  // Cross-Agent Integration (USP3)
  it("should deny sub-agent action when parent policy denies", async () => {
    // Full pipeline: spawn sub-agent → sub-agent calls tool → parent's deny inherited → blocked
  });
  it("should cap sub-agent trust and evaluate accordingly", async () => {
    // Full pipeline: sub-agent with high config trust → capped by parent → rule minTrust gate fails
  });
  it("should produce audit record with cross-agent context", async () => {
    // Full pipeline: sub-agent action → audit record includes parentAgentId + inheritedPolicyIds
  });
});
```

### 7.5 Performance Tests

```typescript
describe("Performance", () => {
  it("should evaluate 10 regex policies in <5ms", () => { ... });
  it("should handle 1000 frequency entries without degradation", () => { ... });
  it("should resolve cross-agent policies in <1ms for 3-level nesting", () => { ... });
});
```

### 7.6 Test Configuration

```json
{
  "test": {
    "include": ["test/**/*.test.ts"],
    "coverage": {
      "provider": "v8",
      "include": ["src/**/*.ts"],
      "exclude": ["src/types.ts"],
      "thresholds": { "lines": 90, "functions": 90, "branches": 85 }
    }
  }
}
```

---

## 8. Implementation Order

Forge MUST implement modules in this order. Each phase builds on the previous.

### Phase 1: Foundation (types, config, utils)
1. `src/types.ts` — All type definitions (including CrossAgent types)
2. `src/util.ts` — Shared utilities (including `extractParentSessionKey`, `extractAgentChain`)
3. `src/config.ts` — Configuration resolution
4. `test/config.test.ts` + `test/util.test.ts`

### Phase 2: Core Engine (conditions, evaluation)
5. `src/conditions/tool.ts` + test
6. `src/conditions/time.ts` + test
7. `src/conditions/agent.ts` + test
8. `src/conditions/context.ts` + test
9. `src/conditions/risk.ts` + test
10. `src/conditions/frequency.ts` + test
11. `src/conditions/composite.ts` + test
12. `src/conditions/index.ts`
13. `src/frequency-tracker.ts` + test
14. `src/risk-assessor.ts` + test
15. `src/policy-loader.ts` + test
16. `src/policy-evaluator.ts` + test

### Phase 3: Trust, Cross-Agent, Audit
17. `src/trust-manager.ts` + test
18. **`src/cross-agent.ts` + `test/cross-agent.test.ts`** ← NEW (depends on trust-manager)
19. `src/audit-redactor.ts` + test
20. `src/audit-trail.ts` + test

### Phase 4: Approval & LLM
21. `src/approval-manager.ts` + test
22. `src/conditions/intent.ts` + test
23. `src/llm-client.ts` + test

### Phase 5: Integration
24. `src/builtin-policies.ts` + test
25. `src/engine.ts` + test
26. `src/hooks.ts` + test
27. `index.ts`
28. `test/integration.test.ts`

### Phase 6: Package
29. `openclaw.plugin.json`
30. `package.json`
31. `tsconfig.json`
32. `README.md`

---

## 9. Build & Package

### 9.1 package.json

```json
{
  "name": "@vainplex/openclaw-governance",
  "version": "0.1.0",
  "description": "Contextual, learning, cross-agent governance for AI agents",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "openclaw.plugin.json", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "oxlint src/ test/",
    "clean": "rm -rf dist/"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "oxlint": "^0.15.0"
  },
  "engines": { "node": ">=22.0.0" },
  "license": "MIT",
  "author": "Albert Hild <albert@vainplex.dev>",
  "repository": { "type": "git", "url": "https://github.com/alberthild/openclaw-governance.git" },
  "keywords": ["openclaw", "governance", "ai-agents", "policy-engine", "trust", "audit"]
}
```

**Zero runtime dependencies.** Only Node.js builtins: `node:crypto`, `node:fs`, `node:path`, `node:url`.

### 9.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["index.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 9.3 Dependencies Note

| Need | Solution |
|---|---|
| Hashing (SHA-256) | `node:crypto` → `createHash("sha256")` |
| UUIDs | `node:crypto` → `randomUUID()` |
| File I/O | `node:fs` |
| Path handling | `node:path` |
| HTTP (LLM client) | Global `fetch` (Node 22 built-in) |
| High-res timing | `performance.now()` (global) |
| Timezone handling | `Intl.DateTimeFormat` with `timeZone` option |

---

*End of Architecture Document.*
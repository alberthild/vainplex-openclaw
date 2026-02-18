# RFC: @vainplex/openclaw-governance

**Status:** Draft  
**Version:** 0.1.0  
**Date:** 2026-02-17  
**Authors:** Atlas (Architecture Agent), commissioned by Albert Hild  
**License:** MIT  

---

## Abstract

This RFC specifies **@vainplex/openclaw-governance**, a TypeScript plugin for OpenClaw that provides contextual, learning, cross-agent governance for AI agents. Unlike existing tools (Rampart, NeMo Guardrails, Guardrails AI, LlamaFirewall) which operate as firewalls or output validators, this system implements *true governance*: contextual policy evaluation, trust-based access control, time-aware rules, semantic intent understanding, human-in-the-loop approval, and compliance-ready audit trails.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Scope](#2-scope)
3. [Terminology](#3-terminology)
4. [Policy System](#4-policy-system)
5. [Trust System](#5-trust-system)
6. [Enforcement Pipeline](#6-enforcement-pipeline)
7. [Audit Trail](#7-audit-trail)
8. [Human-in-the-Loop](#8-human-in-the-loop)
9. [LLM Escalation](#9-llm-escalation)
10. [Configuration Schema](#10-configuration-schema)
11. [Hook Integration](#11-hook-integration)
12. [Cross-Agent Governance](#12-cross-agent-governance)
13. [Performance Requirements](#13-performance-requirements)
14. [Security Considerations](#14-security-considerations)
15. [Backward Compatibility](#15-backward-compatibility)
16. [Appendix A: Policy Examples](#appendix-a-policy-examples)
17. [Appendix B: Audit Record Schema](#appendix-b-audit-record-schema)
18. [Appendix C: Comparison with Existing Tools](#appendix-c-comparison-with-existing-tools)

---

## 1. Motivation

### 1.1 Problem Statement

AI agent frameworks provide tool-level permission controls (allowlists, denylists, sandbox modes) but lack governance. The distinction matters:

- **Permission control** answers: "Can this agent call `exec`?"
- **Governance** answers: "Should this agent run `docker rm` at 3 AM on a production database, given its trust history and the current maintenance schedule?"

OpenClaw's existing controls (`tools.deny`, `tools.allow`, `sandbox.mode`, per-agent tool profiles) are static and binary. They cannot express:

- Temporal constraints ("only during maintenance windows")
- Contextual requirements ("only if a ticket reference exists in the conversation")
- Progressive trust ("new agents start restricted; proven agents gain autonomy")
- Risk-proportional responses ("low-risk = allow, medium = log, high = require approval")

### 1.2 Market Gap

| Capability | Rampart | NeMo | Guardrails AI | LlamaFirewall | **This RFC** |
|---|---|---|---|---|---|
| Pattern matching | ✅ ~20μs | ✅ via Colang | ✅ regex validators | ✅ regex | ✅ <1ms |
| Contextual policies | ❌ | ❌ | ❌ | ❌ | ✅ |
| Trust levels | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-agent governance | ❌ | ❌ | ❌ | ❌ | ✅ |
| Time-aware rules | ❌ | ❌ | ❌ | ❌ | ✅ |
| Compliance audit trail | Partial | ❌ | ❌ | ❌ | ✅ |
| Human-in-the-loop | ❌ | ❌ | ❌ | ❌ | ✅ |
| Semantic intent | ❌ | ✅ (LLM-only) | ❌ | ✅ (CoT) | ✅ (hybrid) |
| Zero runtime deps | ❌ (Node) | ❌ (Python) | ❌ (Python) | ❌ (Python) | ✅ |
| OpenClaw native | Partial (shim) | ❌ | ❌ | ❌ | ✅ |

### 1.3 Goals

1. Provide a policy engine that evaluates agent actions against composable, contextual rules
2. Implement a trust system where agents earn autonomy through successful operation history
3. Support time-aware policies (night mode, maintenance windows, scheduled escalation)
4. Generate compliance-ready audit trails (ISO 27001, SOC2 compatible, hash-chained)
5. Enable human-in-the-loop approval for high-risk actions
6. Offer optional LLM-based semantic intent understanding for ambiguous cases
7. Work as a standard OpenClaw plugin with zero required runtime dependencies
8. Maintain <5ms evaluation latency for regex-based rules

---

## 2. Scope

### 2.1 In Scope

- Policy definition, parsing, and evaluation
- Trust level management and progression
- Audit trail generation and storage
- Hook-based enforcement via OpenClaw plugin system
- Time-aware policy evaluation
- Human-in-the-loop approval workflow
- Optional LLM-based intent classification
- Cross-agent policy composition
- Configuration schema for `openclaw.json`
- Slash commands for runtime governance status

### 2.2 Out of Scope

- Network-level firewalling (Rampart's domain)
- LLM output content filtering (Guardrails AI's domain)
- Prompt injection detection (LlamaFirewall's domain)
- User authentication/authorization (OpenClaw core's domain)
- Policy authoring GUI (future work)
- Distributed policy synchronization (future SaaS work)

---

## 3. Terminology

| Term | Definition |
|---|---|
| **Action** | An operation an agent attempts: tool call, message send, session spawn, etc. |
| **Policy** | A named set of rules governing a class of actions |
| **Rule** | A single conditional statement within a policy: "IF conditions THEN effect" |
| **Condition** | A predicate evaluated against the action context (agent, tool, time, trust, etc.) |
| **Effect** | The outcome of a matched rule: `allow`, `deny`, `escalate`, `audit` |
| **Verdict** | The final governance decision for an action, after all policies are evaluated |
| **Trust Level** | A numeric score (0–100) representing an agent's earned autonomy |
| **Trust Tier** | A named band within the trust score range: `untrusted`, `restricted`, `standard`, `trusted`, `privileged` |
| **Escalation** | Routing a governance decision to a higher authority (human, senior agent) |
| **Audit Record** | A hash-chained evidence entry for a governance decision |
| **Maintenance Window** | A named time range where elevated permissions apply |
| **Intent** | The inferred purpose behind an agent's action (beyond the literal tool call) |
| **Policy Scope** | The agents and/or contexts to which a policy applies |

---

## 4. Policy System

### 4.1 Policy Structure

A policy is a named, versioned collection of rules with a defined scope. Policies are defined in `openclaw.json` under the plugin configuration.

```typescript
type Policy = {
  /** Unique policy identifier (kebab-case, e.g., "production-database-access") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version of the policy definition */
  version: string;
  /** Optional description */
  description?: string;
  /** Policy scope — which agents and contexts this policy governs */
  scope: PolicyScope;
  /** Ordered list of rules (first match wins within a policy) */
  rules: Rule[];
  /** Whether this policy is active (default: true) */
  enabled?: boolean;
  /** Priority relative to other policies (higher = evaluated first, default: 0) */
  priority?: number;
};
```

### 4.2 Policy Scope

A scope defines where a policy applies. A policy with no scope applies globally.

```typescript
type PolicyScope = {
  /** Agent IDs this policy applies to. Empty/undefined = all agents. */
  agents?: string[];
  /** Agent IDs explicitly excluded from this policy. */
  excludeAgents?: string[];
  /** Channel IDs this policy applies to (e.g., "matrix", "telegram"). */
  channels?: string[];
  /** Hook names this policy applies to (e.g., "before_tool_call"). */
  hooks?: PolicyHookName[];
};

type PolicyHookName =
  | "before_tool_call"
  | "message_sending"
  | "before_agent_start"
  | "session_start";
```

**Scoping rules:**
- If `agents` is specified, the policy MUST only apply to listed agents.
- If `excludeAgents` is specified, the policy MUST NOT apply to listed agents.
- If both are specified, `excludeAgents` takes precedence.
- If `hooks` is specified, the policy MUST only be evaluated for those hooks.
- If no scope fields are set, the policy applies to all agents, all channels, all hooks.

### 4.3 Rule Structure

```typescript
type Rule = {
  /** Unique rule identifier within the policy */
  id: string;
  /** Human-readable description of what this rule governs */
  description?: string;
  /** Conditions that must ALL be true for this rule to match (AND logic) */
  conditions: Condition[];
  /** The governance effect when this rule matches */
  effect: RuleEffect;
  /** Minimum trust tier required for this rule's effect to apply */
  minTrust?: TrustTier;
  /** Maximum trust tier — rule only applies to agents at or below this tier */
  maxTrust?: TrustTier;
};

type RuleEffect =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "escalate"; to: EscalationTarget; timeout?: number; fallback?: "allow" | "deny" }
  | { action: "audit"; level?: AuditLevel };
```

**Rule evaluation:**
- The `conditions` array uses AND logic — ALL conditions MUST match.
- For OR logic, use separate rules within the same policy.
- The `minTrust` / `maxTrust` fields act as additional implicit conditions.
- The first matching rule within a policy determines that policy's verdict.
- If no rules match within a policy, the policy produces no verdict (passes through).

### 4.4 Condition Types

Conditions are the predicates that determine whether a rule matches. The system MUST support these condition types:

#### 4.4.1 Tool Condition

```typescript
type ToolCondition = {
  type: "tool";
  /** Tool name pattern (exact match or glob, e.g., "exec", "message*") */
  name?: string | string[];
  /** Parameter patterns to match against tool call params */
  params?: Record<string, ParamMatcher>;
};

type ParamMatcher =
  | { equals: string | number | boolean }
  | { contains: string }
  | { matches: string }  // regex pattern
  | { startsWith: string }
  | { in: (string | number)[] };
```

**Example:** "Block exec calls where the command contains `docker rm`"
```json
{
  "type": "tool",
  "name": "exec",
  "params": {
    "command": { "contains": "docker rm" }
  }
}
```

#### 4.4.2 Time Condition

```typescript
type TimeCondition = {
  type: "time";
  /** Named time window (references a window defined in config) */
  window?: string;
  /** Inline time range: hours in 24h format */
  after?: string;   // "HH:MM" in agent's configured timezone
  before?: string;  // "HH:MM"
  /** Day-of-week filter (0=Sunday, 6=Saturday) */
  days?: number[];
};
```

**Evaluation rules:**
- If `window` is specified, the engine MUST resolve it from the `timeWindows` configuration.
- If `after` and `before` are specified, the engine MUST evaluate whether the current time falls within the range (wrapping past midnight is supported: `after: "22:00"`, `before: "06:00"`).
- If `days` is specified, the engine MUST check the current day-of-week.
- All time conditions use the timezone configured in the plugin config (default: UTC).

#### 4.4.3 Agent Condition

```typescript
type AgentCondition = {
  type: "agent";
  /** Agent ID pattern */
  id?: string | string[];
  /** Trust tier requirement */
  trustTier?: TrustTier | TrustTier[];
  /** Minimum trust score (0-100) */
  minScore?: number;
  /** Maximum trust score */
  maxScore?: number;
};
```

#### 4.4.4 Context Condition

```typescript
type ContextCondition = {
  type: "context";
  /** Require a specific pattern to exist in the conversation history */
  conversationContains?: string | string[];
  /** Require a pattern to exist in the current message */
  messageContains?: string | string[];
  /** Require a specific metadata field to be present */
  hasMetadata?: string | string[];
  /** Channel filter */
  channel?: string | string[];
  /** Session key pattern */
  sessionKey?: string;
};
```

**Example:** "Allow production database access only if a Jira ticket reference exists"
```json
{
  "type": "context",
  "conversationContains": ["JIRA-\\d+", "TICKET-\\d+"]
}
```

#### 4.4.5 Risk Condition

```typescript
type RiskCondition = {
  type: "risk";
  /** Minimum risk score for this condition to match */
  minRisk?: RiskLevel;
  /** Maximum risk score */
  maxRisk?: RiskLevel;
};

type RiskLevel = "low" | "medium" | "high" | "critical";
```

#### 4.4.6 Frequency Condition

```typescript
type FrequencyCondition = {
  type: "frequency";
  /** Maximum number of matching actions allowed in the window */
  maxCount: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Scope of counting: per-agent, per-session, or global */
  scope?: "agent" | "session" | "global";
};
```

**Example:** "Allow at most 5 exec calls per minute per agent"
```json
{
  "type": "frequency",
  "maxCount": 5,
  "windowSeconds": 60,
  "scope": "agent"
}
```

#### 4.4.7 Composite Condition (OR logic)

```typescript
type CompositeCondition = {
  type: "any";
  /** At least one of these conditions must match */
  conditions: Condition[];
};
```

#### 4.4.8 Negation Condition

```typescript
type NegationCondition = {
  type: "not";
  /** This condition must NOT match */
  condition: Condition;
};
```

### 4.5 Condition Type Union

```typescript
type Condition =
  | ToolCondition
  | TimeCondition
  | AgentCondition
  | ContextCondition
  | RiskCondition
  | FrequencyCondition
  | CompositeCondition
  | NegationCondition;
```

### 4.6 Built-in Policy Templates

The plugin SHOULD ship with sensible default policies that can be enabled via config flags. These templates serve as both working defaults and documentation:

#### 4.6.1 Night Mode

Restricts all non-critical operations between 23:00 and 08:00 (configurable).

```yaml
id: builtin-night-mode
name: Night Mode
scope:
  hooks: [before_tool_call, message_sending]
rules:
  - id: allow-critical-tools
    description: Always allow critical monitoring tools at night
    conditions:
      - type: time
        after: "23:00"
        before: "08:00"
      - type: tool
        name: ["read", "memory_search", "memory_get"]
    effect:
      action: allow

  - id: deny-non-critical
    description: Deny non-critical tool use at night
    conditions:
      - type: time
        after: "23:00"
        before: "08:00"
      - type: not
        condition:
          type: tool
          name: ["read", "memory_search", "memory_get"]
    effect:
      action: deny
      reason: "Night mode active (23:00-08:00). Only critical operations allowed."
```

#### 4.6.2 Credential Guard

Prevents agents from accessing credential files or environment variables.

#### 4.6.3 Production Safeguard

Requires explicit approval for any production-impacting operations (gateway restart, deployment, DNS changes).

#### 4.6.4 Rate Limiter

Prevents runaway agents from making excessive tool calls.

### 4.7 Policy Evaluation Order

When multiple policies match an action, the engine MUST apply the following precedence:

1. **Priority:** Higher priority policies are evaluated first.
2. **Specificity:** Policies with narrower scopes (specific agents) take precedence over broader ones (all agents).
3. **Restrictiveness:** Among equal-priority, equal-specificity policies, the most restrictive verdict wins:
   - `deny` > `escalate` > `audit` > `allow`
4. **First match:** Within a single policy, the first matching rule determines the policy's verdict.

The final verdict MUST be computed as follows:
- Collect verdicts from all applicable policies.
- If ANY policy produces `deny`, the final verdict is `deny`.
- If ANY policy produces `escalate` (and none denied), the final verdict is `escalate`.
- If ANY policy produces `audit` (and none denied or escalated), the final verdict is `audit` (action allowed but logged at elevated detail).
- If ALL applicable policies produce `allow` (or no policies match), the final verdict is `allow`.

This is the **deny-wins** principle, consistent with mandatory access control systems (SELinux, AppArmor).

---

## 5. Trust System

### 5.1 Trust Tiers

Every agent MUST have an associated trust score (0–100) that maps to a tier:

| Tier | Score Range | Description |
|---|---|---|
| `untrusted` | 0–19 | New or misbehaving agent. Highly restricted. |
| `restricted` | 20–39 | Limited track record. Basic operations only. |
| `standard` | 40–59 | Normal operation. Default for established agents. |
| `trusted` | 60–79 | Proven track record. Access to sensitive operations. |
| `privileged` | 80–100 | Highest autonomy. Can perform most operations unsupervised. |

### 5.2 Trust Score Computation

The trust score is a weighted composite of the following signals:

```typescript
type TrustSignals = {
  /** Number of successful operations (no policy violations) */
  successCount: number;
  /** Number of policy violations (denied actions that were attempted) */
  violationCount: number;
  /** Number of escalations that were approved by human */
  approvedEscalations: number;
  /** Number of escalations that were denied by human */
  deniedEscalations: number;
  /** Age of the agent in days since first action */
  ageDays: number;
  /** Number of consecutive days without violations */
  cleanStreak: number;
  /** Manual trust adjustment by human operator (-50 to +50) */
  manualAdjustment: number;
};
```

**Computation formula:**

```
base = min(ageDays * 0.5, 20)                          // Age contribution: max 20 points
success = min(successCount * 0.1, 30)                   // Success contribution: max 30 points  
violations = violationCount * -2                        // Each violation costs 2 points
escalation_approved = approvedEscalations * 0.5         // Approved escalations add trust
escalation_denied = deniedEscalations * -3              // Denied escalations cost more
streak = min(cleanStreak * 0.3, 20)                     // Clean streak: max 20 points

raw = base + success + violations + escalation_approved + escalation_denied + streak + manualAdjustment
score = clamp(raw, 0, 100)
```

The engine MUST recompute trust scores after every policy evaluation. The engine SHOULD persist trust data to disk at a configurable interval (default: every 60 seconds, debounced).

### 5.3 Trust Score Persistence

```typescript
type TrustStore = {
  version: 1;
  updated: string;  // ISO 8601
  agents: Record<string, AgentTrust>;
};

type AgentTrust = {
  agentId: string;
  score: number;
  tier: TrustTier;
  signals: TrustSignals;
  history: TrustEvent[];  // Last N events (configurable, default: 100)
  lastEvaluation: string; // ISO 8601
  created: string;        // ISO 8601
};

type TrustEvent = {
  timestamp: string;
  type: "success" | "violation" | "escalation_approved" | "escalation_denied" | "manual_adjustment";
  delta: number;
  reason?: string;
};
```

### 5.4 Trust Decay

Trust SHOULD decay slowly over periods of inactivity to prevent stale high-trust scores. The engine SHOULD apply decay on trust score reads (lazy evaluation):

```
if (daysSinceLastAction > 30) {
  decayFactor = 0.99 ^ (daysSinceLastAction - 30)
  score = score * decayFactor
}
```

### 5.5 Trust Overrides

A human operator MUST be able to:
1. Set an agent's trust score to any value via the `/trust` command.
2. Lock an agent's trust tier (prevent automatic changes).
3. Reset an agent's trust history.
4. Set a minimum trust floor for an agent (score never drops below this value).

### 5.6 Default Trust Scores

| Agent Type | Default Score | Rationale |
|---|---|---|
| Main agent | 60 (`trusted`) | Primary agent, established track record |
| Named sub-agents (e.g., forge, cerberus) | 40 (`standard`) | Known roles, moderate trust |
| Ephemeral sub-agents (spawned dynamically) | 10 (`untrusted`) | No history, maximum restriction |

Default scores MUST be configurable per-agent in the plugin config. If no default is configured, new agents MUST start at score 10 (`untrusted`).

---

## 6. Enforcement Pipeline

### 6.1 Pipeline Overview

Every governed action flows through the enforcement pipeline:

```
Action → Context Build → Risk Assessment → Policy Evaluation → Trust Check → Verdict → Enforcement
                                                                                  ↓
                                                                            Audit Record
```

### 6.2 Context Building

The engine MUST build an `EvaluationContext` from the hook event and runtime state:

```typescript
type EvaluationContext = {
  /** The hook that triggered this evaluation */
  hook: PolicyHookName;
  /** Agent performing the action */
  agentId: string;
  /** Current session key */
  sessionKey: string;
  /** Channel (if applicable) */
  channel?: string;
  /** Tool name (for before_tool_call) */
  toolName?: string;
  /** Tool parameters (for before_tool_call) */
  toolParams?: Record<string, unknown>;
  /** Message content (for message_sending) */
  messageContent?: string;
  /** Message recipient (for message_sending) */
  messageTo?: string;
  /** Current timestamp */
  timestamp: number;
  /** Current time components (for time conditions) */
  time: {
    hour: number;
    minute: number;
    dayOfWeek: number;  // 0=Sunday
    date: string;       // YYYY-MM-DD
    timezone: string;
  };
  /** Agent's current trust state */
  trust: {
    score: number;
    tier: TrustTier;
  };
  /** Recent conversation context (last N messages, configurable) */
  conversationContext?: string[];
  /** Action metadata */
  metadata?: Record<string, unknown>;
};
```

### 6.3 Risk Assessment

The engine MUST compute a risk level for every action before policy evaluation. Risk assessment provides an independent signal that policies can reference via `RiskCondition`.

```typescript
type RiskAssessment = {
  level: RiskLevel;
  score: number;      // 0-100
  factors: RiskFactor[];
};

type RiskFactor = {
  name: string;
  weight: number;
  value: number;
  description: string;
};
```

**Risk factors** (all MUST be evaluated):

| Factor | Weight | Description |
|---|---|---|
| `tool_sensitivity` | 30 | Tool's inherent risk (exec=high, read=low) |
| `time_of_day` | 15 | Off-hours increase risk |
| `trust_deficit` | 20 | Lower trust = higher risk |
| `frequency` | 15 | Rapid consecutive calls increase risk |
| `target_scope` | 20 | External/production targets = higher risk |

**Tool sensitivity classification** (built-in, extensible via config):

| Level | Tools |
|---|---|
| Critical (90-100) | `gateway`, `cron`, `elevated` |
| High (60-89) | `exec`, `write`, `edit`, `message` (cross-context) |
| Medium (30-59) | `sessions_spawn`, `sessions_send`, `browser` |
| Low (0-29) | `read`, `memory_search`, `memory_get`, `web_search` |

### 6.4 Policy Evaluation

As specified in [Section 4.7](#47-policy-evaluation-order), policies are evaluated in priority order with deny-wins semantics.

The engine MUST:
1. Collect all policies whose scope matches the current context.
2. Sort by priority (descending), then specificity (descending).
3. For each policy, evaluate rules in order until one matches.
4. Collect all per-policy verdicts.
5. Apply deny-wins aggregation.
6. Return the final verdict with all matched rules as evidence.

### 6.5 Verdict Structure

```typescript
type Verdict = {
  /** Final decision */
  action: "allow" | "deny" | "escalate";
  /** Human-readable explanation */
  reason: string;
  /** Risk assessment */
  risk: RiskAssessment;
  /** All policies that contributed to this verdict */
  matchedPolicies: MatchedPolicy[];
  /** Agent's trust state at evaluation time */
  trust: { score: number; tier: TrustTier };
  /** Evaluation duration in microseconds */
  evaluationUs: number;
  /** Whether LLM escalation was used */
  llmEscalated: boolean;
};

type MatchedPolicy = {
  policyId: string;
  ruleId: string;
  effect: RuleEffect;
};
```

### 6.6 Enforcement

After computing the verdict, the engine MUST enforce it:

| Verdict | Hook Action | Side Effects |
|---|---|---|
| `allow` | Return `undefined` (no modification) | Audit record (if audit-level policy matched) |
| `deny` | Return `{ block: true, blockReason: reason }` for `before_tool_call`; Return `{ cancel: true }` for `message_sending` | Audit record, trust decrement |
| `escalate` | Pause execution, request human approval (see [Section 8](#8-human-in-the-loop)) | Audit record |

For hooks that don't support blocking (`message_received`, `session_start`, `after_tool_call`), the engine MUST still evaluate policies and produce audit records, but enforcement is limited to logging and trust adjustments.

---

## 7. Audit Trail

### 7.1 Requirements

The audit trail MUST:
1. Record every governance evaluation (not just denials).
2. Be tamper-evident via hash chaining.
3. Include sufficient context for compliance review.
4. Support ISO 27001 Annex A control mapping.
5. Be exportable in JSON and CSV formats.
6. Be queryable by agent, time range, verdict, policy, and risk level.

### 7.2 Audit Record Schema

```typescript
type AuditRecord = {
  /** Unique record ID (UUIDv4) */
  id: string;
  /** Record sequence number (monotonically increasing) */
  seq: number;
  /** SHA-256 hash of the previous record (chain integrity) */
  prevHash: string;
  /** SHA-256 hash of this record's content */
  hash: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** ISO 8601 timestamp */
  timestampIso: string;
  /** The governance verdict */
  verdict: AuditVerdict;
  /** Context snapshot at evaluation time */
  context: AuditContext;
  /** Trust state at evaluation time */
  trust: { score: number; tier: TrustTier };
  /** Risk assessment */
  risk: { level: RiskLevel; score: number };
  /** Matched policies and rules */
  matchedPolicies: MatchedPolicy[];
  /** Evaluation performance */
  evaluationUs: number;
  /** Whether LLM was consulted */
  llmEscalated: boolean;
  /** ISO 27001 controls this record maps to */
  controls: string[];
};

type AuditVerdict = "allow" | "deny" | "escalate" | "escalate_approved" | "escalate_denied" | "escalate_timeout";

type AuditContext = {
  hook: string;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  /** Sanitized tool params (sensitive values redacted) */
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
};
```

### 7.3 Hash Chain

The audit trail MUST maintain a hash chain for tamper evidence:

```
hash(record_N) = SHA-256(
  record_N.seq + "|" +
  record_N.timestamp + "|" + 
  record_N.verdict + "|" +
  record_N.context.agentId + "|" +
  record_N.context.hook + "|" +
  record_N.context.toolName + "|" +
  record_N.prevHash
)
```

The genesis record (seq=0) MUST use a well-known seed hash: `"0000000000000000000000000000000000000000000000000000000000000000"` (64 zeros).

The engine MUST verify chain integrity on startup. If a break is detected, the engine MUST:
1. Log a critical warning.
2. Start a new chain segment with a reference to the break point.
3. NOT delete or modify existing records.

### 7.4 Storage Backends

The audit trail MUST support pluggable storage backends:

#### 7.4.1 Local File Backend (Default)

- Records written to `{workspace}/governance/audit/YYYY-MM-DD.jsonl` (one JSON object per line).
- Daily rotation.
- The engine MUST write the latest chain hash to `{workspace}/governance/audit/chain-state.json`.
- Retention configurable (default: 90 days).

#### 7.4.2 NATS Backend (Optional)

If the NATS event store plugin is active, audit records SHOULD also be published to NATS JetStream:
- Subject: `openclaw.governance.audit.{agentId}.{verdict}`
- The engine SHOULD detect NATS availability via `api.registerGatewayMethod` or service registry.
- NATS publishing MUST be fire-and-forget (never block evaluation).

### 7.5 ISO 27001 Control Mapping

The engine MUST map governance events to ISO 27001 Annex A controls:

| Event Type | Controls |
|---|---|
| Tool call governance | A.8.3 (Access restriction), A.8.5 (Secure authentication) |
| Message governance | A.5.14 (Information transfer) |
| Trust adjustment | A.5.15 (Access control), A.8.2 (Privileged access) |
| Policy violation | A.5.24 (Information security incident), A.5.28 (Evidence collection) |
| Escalation (human approval) | A.5.17 (Authentication information), A.8.2 (Privileged access) |
| Configuration change | A.8.9 (Configuration management) |

### 7.6 Sensitive Data Redaction

Before writing audit records, the engine MUST redact sensitive data:
- Tool parameters matching patterns: `password`, `secret`, `token`, `apiKey`, `credential`, `auth` — values replaced with `"[REDACTED]"`.
- Message content exceeding 500 characters — truncated with `"[TRUNCATED at 500 chars]"`.
- File paths containing `.env`, `credentials`, `secrets` — path preserved, content not logged.
- Custom redaction patterns configurable via `audit.redactPatterns`.

---

## 8. Human-in-the-Loop

### 8.1 Approval Workflow

When a policy verdict is `escalate`, the engine MUST:

1. **Pause** the action (do not execute).
2. **Notify** the designated approver via the configured channel.
3. **Wait** for approval, denial, or timeout.
4. **Execute or block** based on the response.
5. **Record** the complete interaction in the audit trail.

### 8.2 Notification Format

The approval request MUST include:

```
🔒 Governance Approval Required

Agent: {agentId}
Action: {toolName} with params: {sanitizedParams}
Risk: {riskLevel} ({riskScore}/100)
Policy: {policyName} → Rule: {ruleId}
Reason: {reason}
Trust: {trustTier} ({trustScore}/100)

Reply: ✅ to approve, ❌ to deny
Timeout: {timeoutSeconds}s → auto-{fallbackAction}
```

### 8.3 Approval Channels

The engine MUST support approval delivery via:
1. **System event** (default): Enqueued as a system event in the main agent's session. The human responds naturally.
2. **Direct message**: Sent to a configured channel/recipient (e.g., Telegram DM to the operator).

### 8.4 Timeout and Fallback

- The engine MUST enforce a configurable timeout (default: 300 seconds / 5 minutes).
- If the timeout expires, the engine MUST apply the rule's `fallback` effect:
  - `fallback: "deny"` (default) — action is blocked.
  - `fallback: "allow"` — action is allowed (use only for low-risk escalations).
- The engine MUST record the timeout event in the audit trail.

### 8.5 Approval State Machine

```
PENDING → APPROVED → (action executes)
       → DENIED   → (action blocked)
       → TIMEOUT  → (fallback applied)
       → EXPIRED  → (session ended before resolution)
```

The engine MUST persist pending approvals to survive gateway restarts. Pending approvals SHOULD be stored in `{workspace}/governance/pending-approvals.json`.

### 8.6 Concurrent Approvals

The engine MUST handle concurrent approval requests:
- Each request has a unique ID.
- Approvals are matched by ID, not by temporal order.
- The engine MUST limit the number of concurrent pending approvals per agent (default: 3). Additional escalations beyond this limit MUST be auto-denied with a clear message.

---

## 9. LLM Escalation

### 9.1 Purpose

Some actions are ambiguous when evaluated by regex/pattern matching alone. LLM escalation provides semantic intent understanding for these cases.

### 9.2 When to Escalate to LLM

The engine SHOULD escalate to LLM when:
1. No regex-based policy matches, but the action's risk score exceeds the `llm.escalationThreshold` (default: 50).
2. A policy rule explicitly requests LLM evaluation via a condition of type `"intent"`.
3. The tool parameters contain complex natural language that pattern matching cannot reliably classify.

The engine MUST NOT escalate to LLM when:
1. LLM is disabled in config.
2. A regex-based policy has already produced a definitive `deny` verdict.
3. The action's risk score is below `llm.minRiskForEscalation` (default: 20).

### 9.3 Intent Condition

```typescript
type IntentCondition = {
  type: "intent";
  /** Natural language description of the intent to detect */
  description: string;
  /** Confidence threshold (0.0-1.0, default: 0.7) */
  confidence?: number;
};
```

**Example:** "Detect if the agent is trying to access production infrastructure"
```json
{
  "type": "intent",
  "description": "The agent is attempting to modify, delete, or access production infrastructure, databases, or deployed services",
  "confidence": 0.8
}
```

### 9.4 LLM Evaluation Protocol

The engine MUST use the following prompt structure for LLM evaluation:

```
You are a governance policy evaluator. Analyze the following agent action and determine if it matches the described intent.

Action:
- Agent: {agentId}
- Tool: {toolName}
- Parameters: {sanitizedParams}
- Context: {recentConversation}

Intent to evaluate:
{intentDescription}

Respond with JSON:
{
  "matches": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}
```

### 9.5 LLM Configuration

```typescript
type LlmConfig = {
  enabled: boolean;
  endpoint: string;           // OpenAI-compatible API
  model: string;              // e.g., "mistral:7b"
  apiKey?: string;
  timeoutMs: number;          // default: 5000
  escalationThreshold: number; // Risk score threshold, default: 50
  minRiskForEscalation: number; // Minimum risk to consider LLM, default: 20
  maxConcurrent: number;      // Max parallel LLM calls, default: 2
  cacheResults: boolean;      // Cache intent evaluations, default: true
  cacheTtlSeconds: number;    // Cache TTL, default: 300
};
```

### 9.6 Performance Envelope

- LLM evaluations MUST complete within `timeoutMs` (default: 5000ms).
- If the LLM times out, the engine MUST fall back to the regex-only verdict.
- LLM call failures MUST NOT cause the governance engine to fail — the engine MUST gracefully degrade.

### 9.7 Intent Evaluation Caching

To avoid redundant LLM calls, the engine SHOULD cache intent evaluations:
- Cache key: `SHA-256(intentDescription + toolName + serializedParams)`.
- Cache TTL: configurable (default: 300 seconds).
- Cache MUST be invalidated when policies change.

---

## 10. Configuration Schema

### 10.1 Plugin Configuration

The plugin is configured via `openclaw.json` under `plugins.openclaw-governance`:

```typescript
type GovernanceConfig = {
  /** Enable/disable the governance engine (default: true) */
  enabled: boolean;

  /** Timezone for time-aware policies (default: "UTC") */
  timezone: string;

  /** Policy definitions */
  policies: Policy[];

  /** Named time windows referenced by time conditions */
  timeWindows: Record<string, TimeWindow>;

  /** Trust system configuration */
  trust: {
    /** Enable trust scoring (default: true) */
    enabled: boolean;
    /** Default trust scores per agent ID pattern */
    defaults: Record<string, number>;
    /** Trust score persistence interval in seconds (default: 60) */
    persistIntervalSeconds: number;
    /** Trust decay configuration */
    decay: {
      enabled: boolean;
      inactivityDays: number;  // default: 30
      rate: number;            // default: 0.99 per day
    };
    /** Trust score computation weights (override defaults) */
    weights?: Partial<TrustWeights>;
  };

  /** Audit trail configuration */
  audit: {
    /** Enable audit trail (default: true) */
    enabled: boolean;
    /** Storage backend: "local" | "nats" | "both" (default: "local") */
    backend: "local" | "nats" | "both";
    /** Local file retention in days (default: 90) */
    retentionDays: number;
    /** Verify hash chain on startup (default: true) */
    verifyOnStartup: boolean;
    /** Custom sensitive field patterns to redact */
    redactPatterns?: string[];
    /** Audit detail level: "minimal" | "standard" | "verbose" (default: "standard") */
    level: "minimal" | "standard" | "verbose";
  };

  /** Human-in-the-loop configuration */
  approval: {
    /** Enable approval workflows (default: true) */
    enabled: boolean;
    /** Default timeout in seconds (default: 300) */
    timeoutSeconds: number;
    /** Default fallback action on timeout (default: "deny") */
    defaultFallback: "allow" | "deny";
    /** Max concurrent pending approvals per agent (default: 3) */
    maxPendingPerAgent: number;
    /** Delivery channel for approval requests */
    channel: "system_event" | "direct_message";
    /** Target user/channel for direct_message delivery */
    target?: string;
  };

  /** LLM escalation configuration */
  llm: {
    enabled: boolean;
    endpoint: string;
    model: string;
    apiKey?: string;
    timeoutMs: number;
    escalationThreshold: number;
    minRiskForEscalation: number;
    maxConcurrent: number;
    cacheResults: boolean;
    cacheTtlSeconds: number;
  };

  /** Tool sensitivity overrides (tool name → risk score 0-100) */
  toolRiskOverrides?: Record<string, number>;

  /** Built-in policy templates to enable */
  builtinPolicies?: {
    nightMode?: boolean | { after?: string; before?: string };
    credentialGuard?: boolean;
    productionSafeguard?: boolean;
    rateLimiter?: boolean | { maxPerMinute?: number };
  };

  /** Governance engine performance settings */
  performance?: {
    /** Max evaluation time before short-circuit to allow (μs, default: 5000 = 5ms) */
    maxEvalUs: number;
    /** Max conversation context messages for context conditions (default: 10) */
    maxContextMessages: number;
    /** Frequency counter ring buffer size (default: 1000) */
    frequencyBufferSize: number;
  };
};
```

### 10.2 Time Window Definition

```typescript
type TimeWindow = {
  /** Human-readable name */
  name: string;
  /** Start time "HH:MM" */
  start: string;
  /** End time "HH:MM" (wraps past midnight) */
  end: string;
  /** Days of week (0=Sunday, 6=Saturday). Empty = all days. */
  days?: number[];
  /** Override timezone for this window */
  timezone?: string;
};
```

### 10.3 openclaw.plugin.json Schema

```json
{
  "id": "openclaw-governance",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "Enable/disable the governance engine"
      },
      "timezone": {
        "type": "string",
        "default": "UTC",
        "description": "Timezone for time-aware policies (IANA format)"
      },
      "policies": {
        "type": "array",
        "items": { "$ref": "#/definitions/Policy" },
        "default": [],
        "description": "Policy definitions"
      },
      "timeWindows": {
        "type": "object",
        "additionalProperties": { "$ref": "#/definitions/TimeWindow" },
        "default": {},
        "description": "Named time windows for time conditions"
      },
      "trust": { "$ref": "#/definitions/TrustConfig" },
      "audit": { "$ref": "#/definitions/AuditConfig" },
      "approval": { "$ref": "#/definitions/ApprovalConfig" },
      "llm": { "$ref": "#/definitions/LlmConfig" },
      "toolRiskOverrides": {
        "type": "object",
        "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 100 },
        "description": "Tool sensitivity overrides (tool name → risk score 0-100)"
      },
      "builtinPolicies": { "$ref": "#/definitions/BuiltinPoliciesConfig" },
      "performance": { "$ref": "#/definitions/PerformanceConfig" }
    }
  }
}
```

---

## 11. Hook Integration

### 11.1 Hook Mapping

The governance engine integrates with OpenClaw via the plugin hook system. The following hooks are governed:

| Hook | Governance Action | Can Block? | Priority |
|---|---|---|---|
| `before_tool_call` | Evaluate tool call against policies | ✅ Yes (`block: true`) | 1000 (highest) |
| `message_sending` | Evaluate outgoing message against policies | ✅ Yes (`cancel: true`) | 1000 |
| `before_agent_start` | Inject governance context into system prompt | ❌ No (informational) | 5 (low, after other plugins) |
| `session_start` | Initialize trust state, load policies | ❌ No | 1 (lowest) |
| `after_tool_call` | Record outcome, update trust | ❌ No | 900 |
| `message_sent` | Record outcome | ❌ No | 900 |
| `gateway_start` | Verify audit chain, load state | ❌ No | 1 |
| `gateway_stop` | Flush pending state, close audit | ❌ No | 999 |

### 11.2 before_tool_call Handler

This is the primary enforcement point. The handler MUST:

1. Build `EvaluationContext` from `PluginHookBeforeToolCallEvent` and `PluginHookToolContext`.
2. Run the enforcement pipeline.
3. If verdict is `deny`: return `{ block: true, blockReason: reason }`.
4. If verdict is `escalate`: trigger approval workflow; return `{ block: true, blockReason: "Awaiting governance approval..." }` if synchronous, or hold execution if the hook supports async blocking.
5. If verdict is `allow`: return `undefined` or `{ params: adjustedParams }` if params were sanitized.
6. Write audit record (async, fire-and-forget).

**Critical constraint:** Since `before_tool_call` runs in `runModifyingHook` (sequential, awaited), the handler CAN perform async operations including LLM escalation, but MUST respect the performance budget. Regex-only evaluation MUST complete in <5ms. LLM escalation MUST complete in <500ms.

### 11.3 message_sending Handler

Similar to `before_tool_call`, but using the `PluginHookMessageSendingResult`:
- Deny: `{ cancel: true }`
- Modify: `{ content: sanitizedContent }`
- Allow: `undefined`

### 11.4 before_agent_start Handler

The engine SHOULD inject governance awareness into the agent's system prompt by returning a `prependContext` with:
- Current trust level and tier
- Active governance policies (summary)
- Any restrictions in effect (night mode, etc.)
- Pending approval count

This helps the LLM avoid actions it knows will be denied, reducing unnecessary governance evaluations.

### 11.5 session_start Handler

On session start, the engine MUST:
1. Load or initialize the agent's trust state.
2. Load all policies from config.
3. Verify audit chain integrity (if `audit.verifyOnStartup` is enabled).
4. Log governance engine readiness.

### 11.6 after_tool_call Handler

After a tool completes, the engine MUST:
1. Record the tool result in the trust system (success/failure).
2. Increment the agent's `successCount` or `violationCount`.
3. Write an audit record for the completed action.

### 11.7 Priority Rationale

The governance plugin MUST use high priority (1000) for enforcement hooks to ensure it runs before any other plugin can modify or act on the same event. For informational hooks (session_start, after_tool_call), lower priorities are appropriate to not delay other plugins.

---

## 12. Cross-Agent Governance

### 12.1 Per-Agent Policies

Policies can target specific agents via the `scope.agents` field. This enables role-based governance:

```json
{
  "id": "forge-restrictions",
  "name": "Forge Developer Restrictions",
  "scope": { "agents": ["forge"] },
  "rules": [
    {
      "id": "no-deploy",
      "conditions": [{ "type": "tool", "name": "exec", "params": { "command": { "matches": "(docker push|git push|deploy)" } } }],
      "effect": { "action": "deny", "reason": "Forge can write code but cannot deploy to production" }
    }
  ]
}
```

### 12.2 Agent Role Templates

The engine SHOULD support role templates that map to common agent archetypes:

| Role | Default Policies |
|---|---|
| `developer` | Can write/edit code, run tests. Cannot deploy, access production, modify infra. |
| `reviewer` | Can read code, run tests. Cannot write production code, deploy. |
| `operator` | Can manage infrastructure, deploy. Cannot modify business logic. |
| `monitor` | Read-only. Can observe, query, report. Cannot modify anything. |
| `unrestricted` | No governance restrictions (use with caution, audit-only). |

### 12.3 Sub-Agent Governance

Ephemeral sub-agents spawned via `sessions_spawn` MUST:
1. Inherit the parent agent's governance policies plus any sub-agent-specific policies.
2. Start at the `untrusted` trust tier unless explicitly configured otherwise.
3. Be subject to all parent agent restrictions (policies compose additively — deny-wins).

The engine MUST identify sub-agents via the session key pattern (e.g., `agent:forge:subagent:*`).

### 12.4 Cross-Agent Communication Governance

When agent-to-agent messaging is enabled (`tools.agentToAgent.enabled`), the governance engine MUST:
1. Evaluate the sending agent's policies for outbound messages.
2. Evaluate the receiving agent's policies for inbound messages (if governance is active for that agent).
3. Both must allow for the message to be delivered.

---

## 13. Performance Requirements

### 13.1 Latency Budgets

| Operation | Budget | Justification |
|---|---|---|
| Context building | <500μs | Pure data extraction, no I/O |
| Risk assessment | <500μs | Arithmetic + lookup |
| Policy evaluation (regex) | <3ms | Pattern matching, indexed conditions |
| Policy evaluation (total, no LLM) | <5ms | Context + risk + regex policies |
| LLM intent evaluation | <500ms | Network call to local/remote LLM |
| Audit record write | <1ms | Async, fire-and-forget to buffer |
| Trust score update | <100μs | In-memory, debounced persist |
| Hash computation | <50μs | Single SHA-256 |

### 13.2 Optimization Strategies

The engine MUST implement:

1. **Pre-compiled regex cache:** All regex patterns in conditions MUST be compiled once at policy load time and reused. Regex objects MUST be stored in a `Map<string, RegExp>`.

2. **Policy index:** Policies MUST be indexed by hook name and agent ID for O(1) lookup of applicable policies. Avoid scanning all policies for every evaluation.

3. **Short-circuit evaluation:** If the first condition in a rule fails, skip remaining conditions. If a `deny` verdict is found, skip lower-priority policies.

4. **Frequency counter ring buffer:** Use a fixed-size ring buffer (not growing arrays) for frequency tracking. Default size: 1000 entries per scope.

5. **Lazy context building:** Conversation context MUST only be loaded when a policy references `ContextCondition.conversationContains`. Use lazy evaluation on the context object.

6. **Audit write buffering:** Audit records MUST be buffered in memory and flushed to disk in batches (default: every 1 second or 100 records, whichever comes first).

### 13.3 Memory Budget

The governance engine SHOULD use <10MB of memory in typical operation:
- Policy definitions: ~1KB per policy (100 policies = ~100KB)
- Trust store: ~500 bytes per agent (50 agents = ~25KB)
- Frequency buffers: ~80KB per scope (1000 entries × 80 bytes)
- Regex cache: ~200 bytes per pattern (500 patterns = ~100KB)
- Audit write buffer: ~500KB (100 records × ~5KB each)
- LLM response cache: ~2MB (configurable)

---

## 14. Security Considerations

### 14.1 Policy Injection

Policies are loaded from `openclaw.json` which is a trusted configuration file. The engine MUST NOT:
- Load policies from untrusted sources (agent messages, tool outputs).
- Allow agents to modify policies at runtime (except via the human-operated `/governance` command).
- Evaluate regex patterns from untrusted input (all patterns come from config).

### 14.2 Trust Manipulation

The trust system MUST be resistant to gaming:
- An agent cannot increase its own trust score via tool calls.
- Trust signals are recorded by the governance engine, not by the agent.
- Manual trust adjustments require the `/trust` command (human-only).

### 14.3 Audit Trail Integrity

The hash chain provides tamper evidence but not tamper prevention. For production compliance:
- The audit trail SHOULD be forwarded to an immutable external store (NATS JetStream with retention policy, or an external SIEM).
- The engine MUST log a critical alert if chain integrity verification fails.

### 14.4 Regex Denial of Service

Condition regex patterns MUST be validated at policy load time:
- The engine MUST reject patterns that exhibit catastrophic backtracking (nested quantifiers like `(a+)+`).
- The engine SHOULD enforce a maximum pattern length (default: 500 characters).
- Each regex evaluation MUST have a timeout (implicit via the overall evaluation budget).

### 14.5 Sensitive Data in Evaluation Context

The `EvaluationContext` contains tool parameters and message content. The engine MUST:
- Never log the full evaluation context at `info` level.
- Redact sensitive fields before writing audit records (see [Section 7.6](#76-sensitive-data-redaction)).
- Not persist conversation context beyond the current evaluation.

---

## 15. Backward Compatibility

### 15.1 Coexistence with Existing Controls

The governance engine MUST NOT conflict with OpenClaw's built-in permission system:

- `tools.deny` / `tools.allow` are evaluated by OpenClaw core **before** the plugin hook system. If a tool is denied by core, the governance engine never sees it.
- The governance engine operates **on top of** core permissions — it can further restrict, but cannot override core denials.
- `sandbox.mode` restrictions apply independently of governance.

### 15.2 Plugin Compatibility

The governance engine MUST coexist with:
- **nats-eventstore:** Both use `before_tool_call` and `after_tool_call`. Governance uses priority 1000; NATS eventstore uses default priority. Governance runs first.
- **cortex:** Both use `message_received` and `message_sent`. No conflict — cortex is informational only.
- **knowledge-engine:** Both use `message_received` and `session_start`. No conflict — knowledge-engine is informational only.

### 15.3 Graceful Degradation

If the governance engine encounters an internal error during evaluation, it MUST:
1. Log the error at `error` level.
2. **Default to allow** (fail-open) for the current action. This prevents a buggy governance plugin from blocking all agent operation.
3. Record the error in the audit trail with verdict `"error_fallback"`.

This fail-open default is a conscious design decision. For environments requiring fail-closed behavior, the configuration SHOULD offer a `failMode: "closed"` option that defaults to deny on engine errors.

```typescript
type FailMode = "open" | "closed";
```

### 15.4 Migration from SOUL.md Rules

The existing SOUL.md PREFLIGHT rules map to governance policies as follows:

| SOUL.md Rule | Governance Policy |
|---|---|
| 🔴-Zone: "ASK before gateway, DNS, production, systemd changes" | `production-safeguard` with escalation |
| NIGHT: "23:00-08:00 only CRITICAL alerts" | `builtin-night-mode` |
| CREDS: "never ask, never plaintext" | `builtin-credential-guard` |
| RESTART: "never gateway.restart without permission" | Tool condition on `gateway` with escalation |
| #code-review: "Only react to @mentions" | Context condition on channel + mentions |

---

## 16. Commands

### 16.1 /governance Command

```
/governance                    — Show governance engine status
/governance policies           — List active policies
/governance audit [agent] [N]  — Show last N audit records for agent
/governance trust [agent]      — Show trust state for agent
/governance stats              — Evaluation statistics
```

### 16.2 /trust Command

```
/trust                        — Show trust summary for all agents
/trust <agent>                — Show detailed trust for specific agent
/trust <agent> set <score>    — Manually set trust score (0-100)
/trust <agent> lock <tier>    — Lock agent to a trust tier
/trust <agent> unlock         — Remove trust tier lock
/trust <agent> reset          — Reset trust history
/trust <agent> floor <score>  — Set minimum trust score floor
```

### 16.3 /approve Command

```
/approve <id>                 — Approve a pending escalation
/deny <id>                    — Deny a pending escalation
/pending                      — List pending escalations
```

---

## Appendix A: Policy Examples

### A.1 Production Database Access

```json
{
  "id": "production-db-access",
  "name": "Production Database Access",
  "scope": { "hooks": ["before_tool_call"] },
  "rules": [
    {
      "id": "require-ticket",
      "description": "Production DB access requires a ticket reference",
      "conditions": [
        { "type": "tool", "name": "exec", "params": { "command": { "matches": "(psql|mysql|mongo|redis-cli).*prod" } } },
        { "type": "not", "condition": { "type": "context", "conversationContains": ["(JIRA|TICKET|INC)-\\d+"] } }
      ],
      "effect": { "action": "deny", "reason": "Production database access requires a ticket reference in the conversation" }
    },
    {
      "id": "allow-with-ticket",
      "description": "Allow production DB access with ticket reference",
      "conditions": [
        { "type": "tool", "name": "exec", "params": { "command": { "matches": "(psql|mysql|mongo|redis-cli).*prod" } } },
        { "type": "context", "conversationContains": ["(JIRA|TICKET|INC)-\\d+"] }
      ],
      "effect": { "action": "audit", "level": "verbose" },
      "minTrust": "standard"
    }
  ]
}
```

### A.2 Cross-Agent Code Review

```json
{
  "id": "forge-code-review",
  "name": "Forge: Require Review Before Merge",
  "scope": { "agents": ["forge"], "hooks": ["before_tool_call"] },
  "rules": [
    {
      "id": "no-direct-push",
      "conditions": [
        { "type": "tool", "name": "exec", "params": { "command": { "matches": "git push.*(main|master|production)" } } }
      ],
      "effect": { "action": "escalate", "to": "human", "timeout": 600, "fallback": "deny" }
    }
  ]
}
```

### A.3 Maintenance Window Escalation

```json
{
  "id": "maintenance-window",
  "name": "Maintenance Window Permissions",
  "scope": { "hooks": ["before_tool_call"] },
  "priority": 10,
  "rules": [
    {
      "id": "allow-infra-during-maintenance",
      "description": "Allow infrastructure changes during maintenance windows",
      "conditions": [
        { "type": "time", "window": "weekly-maintenance" },
        { "type": "tool", "name": ["exec", "gateway"], "params": { "command": { "matches": "(docker|systemctl|gateway)" } } }
      ],
      "effect": { "action": "allow" },
      "minTrust": "trusted"
    }
  ]
}
```

### A.4 Rate Limiting

```json
{
  "id": "exec-rate-limit",
  "name": "Exec Rate Limiter",
  "scope": { "hooks": ["before_tool_call"] },
  "rules": [
    {
      "id": "limit-exec-per-minute",
      "conditions": [
        { "type": "tool", "name": "exec" },
        { "type": "frequency", "maxCount": 10, "windowSeconds": 60, "scope": "agent" }
      ],
      "effect": { "action": "deny", "reason": "Rate limit exceeded: max 10 exec calls per minute" }
    }
  ]
}
```

---

## Appendix B: Audit Record Schema

### B.1 Full Record Example

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "seq": 4217,
  "prevHash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "timestamp": 1739822400000,
  "timestampIso": "2026-02-17T20:00:00.000Z",
  "verdict": "deny",
  "context": {
    "hook": "before_tool_call",
    "agentId": "forge",
    "sessionKey": "agent:forge:subagent:abc123",
    "channel": "matrix",
    "toolName": "exec",
    "toolParams": { "command": "git push origin main" }
  },
  "trust": { "score": 42, "tier": "standard" },
  "risk": { "level": "high", "score": 72 },
  "matchedPolicies": [
    { "policyId": "forge-code-review", "ruleId": "no-direct-push", "effect": { "action": "deny", "reason": "Forge cannot push to main without review" } }
  ],
  "evaluationUs": 1240,
  "llmEscalated": false,
  "controls": ["A.8.3", "A.5.15"]
}
```

### B.2 Minimal Record (audit.level = "minimal")

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "seq": 4217,
  "prevHash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "timestamp": 1739822400000,
  "verdict": "deny",
  "context": {
    "agentId": "forge",
    "toolName": "exec"
  },
  "evaluationUs": 1240
}
```

---

## Appendix C: Comparison with Existing Tools

### C.1 vs Rampart

Rampart is a shell-level command firewall. It pattern-matches commands and maintains a hash-chained audit trail. **Complementary, not competing.** Rampart can serve as an additional defense layer *beneath* governance:

- Rampart blocks `rm -rf /` at the shell level (last line of defense).
- Governance blocks "agent X shouldn't be doing destructive operations at 3 AM" (policy level).

The governance engine MAY integrate with Rampart by configuring Rampart as the exec backend and consuming Rampart's audit events via NATS.

### C.2 vs NeMo Guardrails

NeMo uses a custom DSL (Colang) to define "rails" for LLM interactions. It requires an LLM for rail evaluation and is Python-only. Key differences:

- NeMo focuses on **output filtering** (what the LLM says). Governance focuses on **action control** (what the agent does).
- NeMo requires LLM for every evaluation. Governance is regex-first, LLM-optional.
- NeMo is monolithic. Governance is a plugin in an existing ecosystem.

### C.3 vs Guardrails AI

Guardrails AI validates LLM outputs against schemas and validators (PII, toxicity, regex). It has no concept of agents, trust, or policies:

- Guardrails AI: "Does this output contain PII?" (validation)
- Governance: "Should this agent access customer data at this time with this trust level?" (governance)

### C.4 vs LlamaFirewall

LlamaFirewall provides PromptGuard (jailbreak detection), Agent Alignment Checks (CoT auditing), and CodeShield (static analysis). It's research-grade and not pluggable:

- LlamaFirewall: Security-focused (is the agent being manipulated?)
- Governance: Policy-focused (is the agent authorized for this action in this context?)

Both are needed in a comprehensive agent security stack.

---

## Appendix D: Escalation Target Types

```typescript
type EscalationTarget =
  | "human"                    // Notify human operator for approval
  | { agent: string }          // Escalate to a more privileged agent (future)
  | { channel: string;         // Escalate to a specific channel
      recipient?: string };    // with optional specific recipient
```

For v0.1.0, only `"human"` escalation MUST be implemented. Agent-to-agent escalation is reserved for future versions.

---

## Appendix E: Governance Event Types (for NATS)

When publishing to NATS via the event store integration, the governance engine MUST use these event types:

| Event Type | Description |
|---|---|
| `governance.eval` | Policy evaluation completed |
| `governance.deny` | Action denied by policy |
| `governance.escalate` | Action escalated for approval |
| `governance.approve` | Escalation approved |
| `governance.reject` | Escalation denied |
| `governance.timeout` | Escalation timed out |
| `governance.trust.update` | Trust score changed |
| `governance.policy.load` | Policies loaded/reloaded |
| `governance.chain.break` | Audit chain integrity violation detected |

---

*End of RFC.*
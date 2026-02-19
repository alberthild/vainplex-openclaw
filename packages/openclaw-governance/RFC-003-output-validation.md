# RFC-003: Output Validation — v0.2.0

**Author:** Atlas (Architect)  
**Date:** 2026-02-19  
**Status:** Draft  
**Package:** `@vainplex/openclaw-governance`  
**Repo:** `alberthild/vainplex-openclaw` → `packages/openclaw-governance`  
**Triggered by:** Production hallucination incidents (Sub-Agents making false claims)

---

## Abstract

Sub-agents in production are hallucinating: making false claims about system state ("X is not installed"), using wrong names ("Irina" → "Iulia"), declaring features missing that they built themselves, and reporting systems as broken that are running fine. The current governance system evaluates **tool calls** (pre-tool) and **outbound messages** (pre-delivery) but never inspects the **content** of agent outputs for factual accuracy.

This RFC specifies **Output Validation** — a new governance subsystem that intercepts agent-generated text before it reaches users or parent agents, applies pattern-based claim detection and fact-checking against known ground truth, and produces a three-level verdict: `pass`, `flag` (allow with audit warning), or `block`.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Scope](#2-scope)
3. [Terminology](#3-terminology)
4. [Claim Detection](#4-claim-detection)
5. [Fact-Check Policies](#5-fact-check-policies)
6. [Output Validation Pipeline](#6-output-validation-pipeline)
7. [Verdict System](#7-verdict-system)
8. [Hook Integration](#8-hook-integration)
9. [Trust-Proportional Validation](#9-trust-proportional-validation)
10. [Configuration Schema](#10-configuration-schema)
11. [Audit Integration](#11-audit-integration)
12. [Performance Requirements](#12-performance-requirements)
13. [Anti-Pattern Coverage](#13-anti-pattern-coverage)
14. [Security Considerations](#14-security-considerations)
15. [Backward Compatibility](#15-backward-compatibility)

---

## 1. Motivation

### 1.1 Problem Statement

In production since 2026-02-18, the governance plugin evaluates **what agents do** (tool calls) but not **what agents say** (message content). This creates a gap:

| What governance catches | What governance misses |
|---|---|
| Agent calling `exec rm -rf /` | Agent saying "the database is corrupted" when it isn't |
| Agent accessing credentials | Agent using wrong names for team members |
| Agent deploying without permission | Agent claiming "feature X doesn't exist" when it does |
| Agent exceeding rate limits | Agent reporting "pipeline is broken" without checking |

Sub-agents are the primary offenders. With trust scores of 10–45, they operate with limited context and high hallucination risk. A sub-agent spawned to check system status may confidently report incorrect information that the parent agent then relays to the user as fact.

### 1.2 Observed Anti-Patterns (Production Data)

| Anti-Pattern | Frequency | Impact | Example |
|---|---|---|---|
| False system state claims | High | Causes unnecessary debugging | "X is not installed" when X is running |
| Name substitution | Medium | Erodes user trust | "Irina" → "Iulia" |
| False negative existence claims | High | Triggers re-work | "Feature Y doesn't exist" when it was just built |
| Unfounded failure claims | Medium | Triggers incident response | "Pipeline is broken" when it's green |
| Self-referential reflection | Low | Wastes tokens, confuses parent | Sub-agent discussing its own system prompt instead of working |

### 1.3 Design Constraints

Output validation is fundamentally different from tool-call governance:

1. **Volume**: Every agent turn produces text. Tool calls are discrete events. Output validation runs on EVERY response.
2. **Latency**: Users are waiting for the response. Adding 200ms is unacceptable. Adding 5ms is fine.
3. **Ambiguity**: Tool calls have structured parameters. Text is natural language — more false positives expected.
4. **Cost**: An LLM-based fact-checker for every output would be prohibitively expensive and slow.

Therefore:

- **Pattern-based + rule-based ONLY**. No LLM calls per output.
- **No external API calls**. All evaluation local.
- **<10ms total** for the validation pipeline.
- **Configurable strictness** per agent, scaling with trust level.

### 1.4 Goals

1. Detect claims about system state, entity names, and existence assertions in agent output
2. Validate detected claims against configurable fact registries
3. Produce graduated verdicts (pass/flag/block) rather than binary allow/deny
4. Integrate into the existing governance audit trail for compliance
5. Scale validation strictness inversely with agent trust level
6. Add zero perceptible latency to agent responses

---

## 2. Scope

### 2.1 In Scope

- Claim detection in agent output text (pattern-based)
- Fact-check validation against configured ground-truth registries
- Graduated verdict system (pass/flag/block)
- Hook integration via `message_sending` and `before_message_write`
- Trust-proportional validation intensity
- Audit trail integration for flagged/blocked content
- Configuration schema for claim patterns and fact registries
- Builtin claim detectors for common anti-patterns

### 2.2 Out of Scope

- Semantic understanding of claims (requires LLM — deferred to v0.3)
- Automatic fact gathering (the system validates against manually curated facts)
- Output content filtering (profanity, PII — different problem domain)
- Prompt injection detection (LlamaFirewall's domain)
- Grammar or quality assessment of agent output
- Image/media output validation

---

## 3. Terminology

| Term | Definition |
|---|---|
| **Claim** | A statement in agent output that asserts something about the world: system state, entity identity, existence of resources, operational status. |
| **Claim Detector** | A pattern-based function that identifies claims in text. Returns structured `DetectedClaim` objects. |
| **Fact Registry** | A configured set of ground-truth facts that claims can be validated against. |
| **Fact** | A single ground-truth assertion with an ID, value, and optional TTL. |
| **Output Verdict** | The result of validating an agent's output: `pass`, `flag`, or `block`. |
| **Flag** | A verdict meaning "allow but warn" — the output reaches its destination, but an audit warning is recorded. |
| **Claim Category** | A classification of claim type: `system_state`, `entity_name`, `existence`, `operational_status`, `capability`. |

---

## 4. Claim Detection

### 4.1 Overview

Claim detection is the process of identifying statements in agent output that assert facts about the world. These are NOT opinions ("I think X might be slow") but assertions ("X is not installed", "Y is broken", "The user's name is Z").

### 4.2 Claim Categories

The system MUST support these claim categories:

| Category | Description | Pattern Examples |
|---|---|---|
| `system_state` | Claims about whether something is installed, running, configured | "X is not installed", "Y is not running", "Z is not configured" |
| `entity_name` | Claims that identify people, projects, or systems by name | "The user is Iulia", "The project is called X" |
| `existence` | Claims about whether something exists or doesn't exist | "Feature X doesn't exist", "There is no file Y", "The config has no Z field" |
| `operational_status` | Claims about whether systems are working or failing | "Pipeline is broken", "Build failed", "Service is down" |
| `capability` | Claims about what the system can or cannot do | "OpenClaw doesn't support X", "This feature is not available" |

### 4.3 DetectedClaim Type

```typescript
type ClaimCategory =
  | "system_state"
  | "entity_name"
  | "existence"
  | "operational_status"
  | "capability";

type DetectedClaim = {
  /** The claim category */
  category: ClaimCategory;
  /** The specific pattern/detector that matched */
  detectorId: string;
  /** The matched text segment */
  matchedText: string;
  /** Character offset in the original text */
  offset: number;
  /** The subject of the claim (e.g., "X" in "X is not installed") */
  subject: string;
  /** The assertion being made (e.g., "not_installed") */
  assertion: string;
  /** Is this a negative claim? ("not X" / "no X" / "X doesn't") */
  negative: boolean;
  /** Confidence: how certain the pattern match is (0.0-1.0). High for exact match, lower for fuzzy. */
  confidence: number;
};
```

### 4.4 Builtin Claim Detectors

The system MUST ship with these builtin detectors. Each detector is a set of regex patterns that extract structured claims.

#### 4.4.1 System State Detector

Detects claims about installation, configuration, and runtime state.

**Patterns:**

```
/{subject}\s+(is|isn't|is not|was not|wasn't)\s+(installed|running|configured|available|enabled|active|loaded|present)/i
/(not|no longer|cannot find|unable to find|failed to find|could not find)\s+{subject}/i
/{subject}\s+(does not exist|doesn't exist|is missing|is absent|is not found|was not found|cannot be found)/i
```

**Subject extraction:** The word or quoted string immediately preceding the verb phrase. For compound subjects ("the docker service"), capture the full noun phrase.

**Examples:**

| Input | Detected? | Subject | Assertion |
|---|---|---|---|
| "Node.js is not installed" | ✅ | "Node.js" | `not_installed` |
| "The service is running fine" | ✅ | "The service" | `running` |
| "I couldn't find docker" | ✅ | "docker" | `not_found` |
| "You might want to install X" | ❌ | — | — (suggestion, not assertion) |

#### 4.4.2 Entity Name Detector

Detects when an agent names a person, project, or system entity.

**Patterns:**

```
/(user|person|team member|developer|author|owner|maintainer|creator)\s+(is|named|called)\s+["']?{name}["']?/i
/(name is|named|called|known as)\s+["']?{name}["']?/i
/(?:^|\.\s+){CapitalizedName}\s+(said|wrote|created|built|developed|designed|reviewed)/i
```

**Name extraction:** Capitalized words or quoted strings after the trigger phrase.

#### 4.4.3 Existence Detector

Detects claims about whether features, files, configs, or resources exist.

**Patterns:**

```
/(there is no|there's no|there are no|no such)\s+{subject}/i
/{subject}\s+(doesn't|does not|didn't|did not)\s+(exist|have|contain|include|support)/i
/(feature|function|method|file|config|option|setting|field|parameter)\s+["']?{name}["']?\s+(is missing|doesn't exist|is not (available|present|defined|implemented))/i
/(?:we|you|they|I)\s+(don't|do not|didn't)\s+have\s+(a|an|the|any)\s+{subject}/i
```

#### 4.4.4 Operational Status Detector

Detects claims about system health and operation.

**Patterns:**

```
/(pipeline|build|test|deploy|service|server|database|queue|cluster)\s+(is|are|was|were)\s+(broken|down|failing|crashed|dead|offline|unreachable|unresponsive)/i
/(pipeline|build|test|deploy|service|server|database|queue|cluster)\s+(failed|crashed|timed out|errored)/i
/(everything|all (systems|services|tests|builds))\s+(is|are)\s+(broken|failing|down)/i
```

#### 4.4.5 Self-Referential Detector

Detects when agents reflect on their own instructions instead of working.

**Patterns:**

```
/(my (system prompt|instructions|guidelines|rules|constraints))\s+(say|tell|instruct|direct|require)/i
/(I am|I'm)\s+(an? )?(AI|assistant|language model|sub-agent|agent)/i
/(according to my|based on my)\s+(instructions|prompt|guidelines|training)/i
/I was (told|instructed|asked|tasked) to/i
```

### 4.5 Custom Claim Detectors

Users MUST be able to define custom detectors via config:

```typescript
type CustomClaimDetector = {
  /** Unique detector ID */
  id: string;
  /** Claim category */
  category: ClaimCategory;
  /** Regex patterns (strings, compiled at load time) */
  patterns: string[];
  /** Named capture group for subject (default: first capture group) */
  subjectGroup?: string;
  /** The assertion to record when matched */
  assertion: string;
  /** Whether the match indicates a negative claim (default: false) */
  negative?: boolean;
  /** Confidence score for matches (default: 0.8) */
  confidence?: number;
};
```

### 4.6 Claim Detector Interface

```typescript
type ClaimDetectorFn = (
  text: string,
  regexCache: Map<string, RegExp>,
) => DetectedClaim[];

type ClaimDetectorRegistry = {
  /** All registered detectors (builtin + custom) */
  detectors: Map<string, ClaimDetectorFn>;
  /** Run all detectors on text, return all detected claims */
  detect(text: string): DetectedClaim[];
};
```

### 4.7 Performance Constraints

- Each detector MUST complete in <1ms for a 2000-character text
- Total claim detection across all detectors MUST complete in <5ms
- Patterns MUST be pre-compiled at startup
- Short-circuit: if text is shorter than 10 characters, skip detection

---

## 5. Fact-Check Policies

### 5.1 Overview

After claims are detected, they are validated against **Fact Registries** — configured sets of ground-truth assertions. A fact registry is not a knowledge base; it's a curated list of things the operator knows to be true.

### 5.2 Fact Structure

```typescript
type Fact = {
  /** Unique fact ID (kebab-case) */
  id: string;
  /** What category of claims this fact can validate */
  category: ClaimCategory;
  /** Subject pattern — what entity this fact is about (regex or exact string) */
  subject: string;
  /** Whether this is an exact match or regex (default: false = case-insensitive exact) */
  subjectIsRegex?: boolean;
  /** The known truth about this subject */
  value: FactValue;
  /** Human-readable description (for audit/debugging) */
  description?: string;
  /** Optional TTL — fact expires after this many seconds (for dynamic facts) */
  ttlSeconds?: number;
  /** When this fact was last updated (ISO 8601) */
  updatedAt?: string;
};

type FactValue =
  | { type: "exists"; exists: boolean }
  | { type: "state"; state: string }
  | { type: "name"; correctName: string; aliases?: string[] }
  | { type: "status"; status: "operational" | "degraded" | "down" }
  | { type: "capability"; supported: boolean };
```

### 5.3 Fact Registry

```typescript
type FactRegistry = {
  /** Registry ID (used for config reference) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Facts in this registry */
  facts: Fact[];
  /** Whether this registry is active (default: true) */
  enabled?: boolean;
};
```

### 5.4 Fact Matching

When a claim is detected, the system MUST attempt to find a matching fact:

1. **Subject match:** Compare claim.subject against fact.subject (case-insensitive exact match, or regex if `subjectIsRegex: true`)
2. **Category match:** Claim.category MUST match fact.category
3. **TTL check:** If the fact has a TTL and has expired, treat it as not found
4. **Value comparison:** Compare the claim's assertion against the fact's value

**Match result types:**

```typescript
type FactCheckResult =
  | { status: "no_fact_found" }         // No matching fact → can't validate
  | { status: "confirmed" }             // Claim matches known fact
  | { status: "contradicted";           // Claim contradicts known fact
      factId: string;
      expected: string;
      claimed: string;
    }
  | { status: "expired_fact" };         // Matching fact has expired TTL
```

### 5.5 Example Fact Registries

#### 5.5.1 Team Names Registry

```json
{
  "id": "team-names",
  "name": "Team Member Names",
  "facts": [
    {
      "id": "owner-name",
      "category": "entity_name",
      "subject": "(user|owner|boss|creator|Albert|albert)",
      "subjectIsRegex": true,
      "value": { "type": "name", "correctName": "Albert", "aliases": ["albert", "Albert Hild", "alberthild"] },
      "description": "The system owner's name is Albert"
    },
    {
      "id": "irina-name",
      "category": "entity_name",
      "subject": "(Irina|irina|Iulia|iulia|partner)",
      "subjectIsRegex": true,
      "value": { "type": "name", "correctName": "Irina", "aliases": ["irina"] },
      "description": "Albert's partner is Irina, NOT Iulia"
    }
  ]
}
```

#### 5.5.2 System State Registry

```json
{
  "id": "system-state",
  "name": "Known System State",
  "facts": [
    {
      "id": "governance-plugin",
      "category": "existence",
      "subject": "(governance|openclaw-governance|@vainplex/openclaw-governance)",
      "subjectIsRegex": true,
      "value": { "type": "exists", "exists": true },
      "description": "The governance plugin exists and is deployed"
    },
    {
      "id": "node-installed",
      "category": "system_state",
      "subject": "(node|node.js|nodejs|Node.js)",
      "subjectIsRegex": true,
      "value": { "type": "state", "state": "installed" },
      "description": "Node.js is installed (v22)"
    }
  ]
}
```

#### 5.5.3 Infrastructure Status Registry

```json
{
  "id": "infra-status",
  "name": "Infrastructure Status",
  "facts": [
    {
      "id": "gateway-status",
      "category": "operational_status",
      "subject": "(gateway|openclaw gateway|OpenClaw)",
      "subjectIsRegex": true,
      "value": { "type": "status", "status": "operational" },
      "description": "OpenClaw gateway is running"
    }
  ]
}
```

### 5.6 Dynamic Fact Sources

For v0.2, facts are configured statically in `openclaw.json`. However, the architecture MUST support dynamic fact injection via the `governance.facts.update` gateway method (v0.3):

```typescript
// v0.3 — NOT in scope for v0.2
api.registerGatewayMethod("governance.facts.update", (params) => {
  engine.updateFact(params.registryId, params.fact);
});
```

This enables future integration where tool call results can update the fact registry in real-time (e.g., after `exec which node` succeeds, the fact "Node.js is installed" is refreshed).

---

## 6. Output Validation Pipeline

### 6.1 Pipeline Overview

```
Agent Output (text)
       │
       ▼
┌──────────────────────────────┐
│ 1. Length Check              │  → Skip if text < 10 chars
│    (fast bail-out)           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Claim Detection           │  → Run all detectors on text
│    (pattern matching, <5ms)  │  → Returns DetectedClaim[]
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Fact Validation           │  → For each claim, check registries
│    (lookup, <2ms)            │  → Returns FactCheckResult[]
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Verdict Computation       │  → Apply trust-scaled thresholds
│    (logic, <1ms)             │  → Apply per-agent overrides
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 5. Enforcement               │  → pass: no action
│                              │  → flag: audit warning, output allowed
│                              │  → block: output suppressed
└──────────────────────────────┘
```

### 6.2 Pipeline Entry Points

The pipeline MUST be invoked from two hooks:

1. **`message_sending`** — Outbound messages to users/channels. This is the primary enforcement point. Already used by governance for tool-call-related message governance.

2. **`before_message_write`** — Before agent messages are persisted to session JSONL. This catches sub-agent outputs before they're relayed to parent agents. This is a NEW hook for governance.

### 6.3 Skippable Conditions

The pipeline MUST skip validation when:

- `outputValidation.enabled` is `false`
- The text is shorter than `outputValidation.minTextLength` (default: 10)
- The agent is in the `outputValidation.exempt` agent list
- The agent's trust score is above `outputValidation.trustExemptThreshold` (default: 90)
- The message is a tool call result (not agent-generated text)

---

## 7. Verdict System

### 7.1 Output Verdict

The existing governance verdict is binary: `allow` or `deny`. Output validation introduces a graduated verdict:

```typescript
type OutputVerdict = "pass" | "flag" | "block";

type OutputValidationResult = {
  /** The final verdict */
  verdict: OutputVerdict;
  /** All claims detected in the output */
  claims: DetectedClaim[];
  /** Fact-check results for each claim */
  factChecks: Array<{
    claim: DetectedClaim;
    result: FactCheckResult;
  }>;
  /** If blocked or flagged: the specific reasons */
  violations: OutputViolation[];
  /** Pipeline duration in microseconds */
  evaluationUs: number;
  /** Agent's trust at evaluation time */
  trust: { score: number; tier: TrustTier };
};

type OutputViolation = {
  /** The claim that caused the violation */
  claim: DetectedClaim;
  /** Why this is a violation */
  reason: string;
  /** The severity of the violation */
  severity: "low" | "medium" | "high";
  /** The fact that contradicts the claim (if any) */
  contradictedFact?: { factId: string; expected: string };
};
```

### 7.2 Verdict Logic

The verdict MUST be computed as follows:

1. **No claims detected** → `pass`
2. **Claims detected, no facts found** → Apply `unverifiedClaimPolicy`:
   - `"ignore"` → `pass` (default for trusted agents)
   - `"flag"` → `flag` (default for standard agents)
   - `"block"` → `block` (default for untrusted agents)
3. **Claims detected, facts confirm** → `pass`
4. **Claims detected, facts contradict** → Apply `contradictionPolicy`:
   - `"flag"` → `flag` (default for trusted agents)
   - `"block"` → `block` (default for all others)
5. **Self-referential claims detected** → Apply `selfReferentialPolicy`:
   - `"ignore"` → `pass`
   - `"flag"` → `flag` (default)
   - `"block"` → `block`

Multiple violations use **worst-wins**: if any claim triggers `block`, the overall verdict is `block`. If any triggers `flag` and none trigger `block`, the verdict is `flag`.

### 7.3 Verdict-to-Action Mapping

| Verdict | `message_sending` | `before_message_write` | Audit |
|---|---|---|---|
| `pass` | No modification | No modification | Standard record (if audit enabled) |
| `flag` | No modification (output passes through) | No modification | **Warning-level** record with full claim details |
| `block` | `{ cancel: true }` | `{ block: true }` | **Alert-level** record with full claim details |

### 7.4 Block Replacement

When an output is blocked, the system MUST NOT silently drop it. Instead:

- For `message_sending`: return `{ cancel: true }` — OpenClaw's delivery system will not send the message. The governance engine SHOULD inject a replacement message via the audit system or a dedicated channel: `"⚠️ Governance: Agent output was blocked due to detected factual inconsistency. See audit log for details."`

- For `before_message_write`: return `{ block: true }` to prevent persistence, then inject a warning annotation visible to the parent agent.

---

## 8. Hook Integration

### 8.1 Available Hooks in OpenClaw

Based on analysis of the OpenClaw plugin hook system (`src/plugins/types.ts`):

| Hook | Type | Can Modify? | Fires When |
|---|---|---|---|
| `message_sending` | Modifying (async) | ✅ content, cancel | Before outbound delivery to user/channel |
| `before_message_write` | Modifying (sync) | ✅ block, message | Before agent message persisted to JSONL |
| `llm_output` | Void (async) | ❌ | After LLM response received |
| `message_sent` | Void (async) | ❌ | After successful delivery |

### 8.2 Hook Selection

**Primary hook: `message_sending`** (already registered by governance)

- Fires before outbound message delivery to Matrix/Telegram/etc.
- Can cancel delivery (`{ cancel: true }`)
- Can modify content (`{ content: "..." }`)
- Context includes `channelId`, content, metadata
- **Limitation:** Only fires for channel-bound messages, NOT for sub-agent→parent communication

**Secondary hook: `before_message_write`** (NEW for governance)

- Fires before any message is written to session JSONL
- Can block persistence (`{ block: true }`)
- Can modify message content
- Context includes the full `AgentMessage` object
- **Critical:** This is where sub-agent outputs pass through before the parent agent sees them
- **Constraint:** Handler MUST be synchronous (no Promises)

**Informational hook: `llm_output`** (NEW for governance)

- Fires after each LLM response
- Contains `assistantTexts` (the raw LLM output)
- Void hook — cannot block or modify
- Used for: audit-only validation (detect claims, record but don't block)
- **Use case:** Lightweight monitoring mode where blocking isn't desired

### 8.3 Hook Registration

```typescript
// In hooks.ts — new registrations for output validation:

// Output validation on channel delivery (already-registered hook gets enhanced)
api.on("message_sending", handleMessageSending(engine, config, logger), { priority: 1000 });

// Output validation on message persistence (NEW)
api.on("before_message_write", handleBeforeMessageWrite(engine, config, logger), { priority: 1000 });

// Output monitoring via LLM output (NEW, informational only)
api.on("llm_output", handleLlmOutput(engine, config, logger), { priority: 900 });
```

### 8.4 `message_sending` Enhancement

The existing `handleMessageSending` handler MUST be extended:

```
Current flow:
  1. Build message evaluation context
  2. Evaluate against policies (tool/time/context conditions)
  3. If deny → cancel

Enhanced flow:
  1. Build message evaluation context
  2. Evaluate against policies (existing — tool/time/context conditions)
  3. If deny → cancel
  4. NEW: Run output validation pipeline on message content
  5. If block → cancel
  6. If flag → allow, but record warning in audit
```

### 8.5 `before_message_write` Handler (NEW)

```typescript
function handleBeforeMessageWrite(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (event: unknown, hookCtx: unknown): { block?: boolean; message?: unknown } | undefined => {
    // Must be synchronous — no async allowed for before_message_write
    const ev = event as { message: { role?: string; content?: string } };
    
    // Only validate assistant messages
    if (ev.message.role !== "assistant") return undefined;
    if (!ev.message.content) return undefined;
    
    const agentId = resolveAgentId(hookCtx, undefined, logger);
    const result = engine.validateOutput(agentId, ev.message.content);
    
    if (result.verdict === "block") {
      return { block: true };
    }
    // "flag" and "pass" both allow the write to proceed
    return undefined;
  };
}
```

**Critical constraint:** `before_message_write` is synchronous. The output validation pipeline MUST be fully synchronous. This means:
- No async fact lookups
- No LLM calls
- Pattern matching + in-memory fact lookup only
- This aligns perfectly with the <10ms performance requirement

### 8.6 `llm_output` Handler (NEW)

```typescript
function handleLlmOutput(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (event: unknown, hookCtx: unknown): void => {
    const ev = event as { assistantTexts: string[] };
    const agentId = resolveAgentId(hookCtx, undefined, logger);
    
    // Fire-and-forget validation for monitoring/audit
    for (const text of ev.assistantTexts) {
      engine.validateOutput(agentId, text, { auditOnly: true });
    }
  };
}
```

---

## 9. Trust-Proportional Validation

### 9.1 Rationale

Not all agents need the same level of output scrutiny. The main agent (trust 60) has more context and is less likely to hallucinate. A freshly spawned sub-agent (trust 10) is high-risk.

### 9.2 Trust-Based Validation Profiles

| Trust Tier | unverifiedClaimPolicy | contradictionPolicy | selfReferentialPolicy | Detection Depth |
|---|---|---|---|---|
| `untrusted` (0-19) | `block` | `block` | `block` | All detectors |
| `restricted` (20-39) | `flag` | `block` | `flag` | All detectors |
| `standard` (40-59) | `flag` | `flag` | `flag` | All detectors |
| `trusted` (60-79) | `ignore` | `flag` | `ignore` | Contradiction-only |
| `privileged` (80-100) | `ignore` | `flag` | `ignore` | Contradiction-only |

### 9.3 Detection Depth

"Detection Depth" controls which detectors run:

- **All detectors**: Run all builtin + custom detectors
- **Contradiction-only**: Only run detectors for claims that CAN be fact-checked (skip detectors with no matching facts in any registry). This reduces false positives for trusted agents.

### 9.4 Per-Agent Overrides

The system MUST support per-agent overrides:

```typescript
type OutputValidationAgentOverride = {
  /** Agent ID (or glob pattern) */
  agent: string;
  /** Override the validation profile */
  profile?: "strict" | "standard" | "lenient" | "disabled";
  /** Override individual policies */
  unverifiedClaimPolicy?: "ignore" | "flag" | "block";
  contradictionPolicy?: "ignore" | "flag" | "block";
  selfReferentialPolicy?: "ignore" | "flag" | "block";
  /** Additional fact registries to apply for this agent */
  additionalRegistries?: string[];
  /** Fact registries to exclude for this agent */
  excludeRegistries?: string[];
};
```

---

## 10. Configuration Schema

### 10.1 Output Validation Config

```typescript
type OutputValidationConfig = {
  /** Enable/disable output validation (default: true) */
  enabled: boolean;
  
  /** Minimum text length to validate (default: 10) */
  minTextLength: number;
  
  /** Agents exempt from output validation */
  exempt: string[];
  
  /** Trust score above which validation is skipped (default: 90) */
  trustExemptThreshold: number;
  
  /** Fact registries */
  factRegistries: FactRegistry[];
  
  /** Custom claim detectors (in addition to builtins) */
  customDetectors: CustomClaimDetector[];
  
  /** Which builtin detectors are enabled (default: all true) */
  builtinDetectors: {
    systemState?: boolean;
    entityName?: boolean;
    existence?: boolean;
    operationalStatus?: boolean;
    selfReferential?: boolean;
  };
  
  /** Default policies (overridden by trust-proportional profiles) */
  defaults: {
    unverifiedClaimPolicy: "ignore" | "flag" | "block";
    contradictionPolicy: "ignore" | "flag" | "block";
    selfReferentialPolicy: "ignore" | "flag" | "block";
  };
  
  /** Per-agent overrides */
  agentOverrides: OutputValidationAgentOverride[];
  
  /** Which hooks to enable output validation on */
  hooks: {
    /** Validate on message_sending (outbound to users). Default: true */
    messageSending: boolean;
    /** Validate on before_message_write (persistence). Default: true */
    beforeMessageWrite: boolean;
    /** Monitor on llm_output (audit-only, never blocks). Default: false */
    llmOutput: boolean;
  };
  
  /** Performance settings */
  performance: {
    /** Max validation time before bail-out in microseconds (default: 8000 = 8ms) */
    maxEvalUs: number;
    /** Max claims to process per output (default: 50) */
    maxClaimsPerOutput: number;
    /** Max text length to validate (default: 10000 chars). Longer text: only first N chars. */
    maxTextLength: number;
  };
};
```

### 10.2 Default Configuration

```typescript
const OUTPUT_VALIDATION_DEFAULTS: OutputValidationConfig = {
  enabled: true,
  minTextLength: 10,
  exempt: [],
  trustExemptThreshold: 90,
  factRegistries: [],
  customDetectors: [],
  builtinDetectors: {
    systemState: true,
    entityName: true,
    existence: true,
    operationalStatus: true,
    selfReferential: true,
  },
  defaults: {
    unverifiedClaimPolicy: "flag",
    contradictionPolicy: "block",
    selfReferentialPolicy: "flag",
  },
  agentOverrides: [],
  hooks: {
    messageSending: true,
    beforeMessageWrite: true,
    llmOutput: false,
  },
  performance: {
    maxEvalUs: 8000,
    maxClaimsPerOutput: 50,
    maxTextLength: 10000,
  },
};
```

### 10.3 Configuration in openclaw.json

```json
{
  "plugins": {
    "openclaw-governance": {
      "outputValidation": {
        "enabled": true,
        "factRegistries": [
          {
            "id": "team-names",
            "name": "Team Member Names",
            "facts": [
              {
                "id": "owner-name",
                "category": "entity_name",
                "subject": "(user|owner|Albert|albert)",
                "subjectIsRegex": true,
                "value": { "type": "name", "correctName": "Albert", "aliases": ["albert", "Albert Hild"] }
              },
              {
                "id": "irina-name",
                "category": "entity_name",
                "subject": "(Irina|irina|Iulia|iulia)",
                "subjectIsRegex": true,
                "value": { "type": "name", "correctName": "Irina" }
              }
            ]
          },
          {
            "id": "system-state",
            "name": "Known System State",
            "facts": [
              {
                "id": "governance-deployed",
                "category": "existence",
                "subject": "(governance plugin|openclaw-governance)",
                "subjectIsRegex": true,
                "value": { "type": "exists", "exists": true }
              }
            ]
          }
        ],
        "agentOverrides": [
          { "agent": "main", "profile": "lenient" },
          { "agent": "forge", "profile": "standard" },
          { "agent": "*", "profile": "strict" }
        ]
      }
    }
  }
}
```

---

## 11. Audit Integration

### 11.1 Output Validation Audit Records

Output validation events MUST be recorded in the existing audit trail. The `AuditVerdict` type is extended:

```typescript
// Existing:
type AuditVerdict = "allow" | "deny" | "error_fallback";

// Extended:
type AuditVerdict = "allow" | "deny" | "error_fallback"
  | "output_pass"              // Output validation passed
  | "output_flag"              // Output validation flagged (allowed with warning)
  | "output_block";            // Output validation blocked
```

### 11.2 Output Validation Audit Context

The `AuditContext` type is extended:

```typescript
type AuditContext = {
  // ...existing fields...
  
  /** Output validation details (present when verdict is output_*) */
  outputValidation?: {
    /** Number of claims detected */
    claimCount: number;
    /** Claims that triggered violations */
    violations: Array<{
      detectorId: string;
      category: ClaimCategory;
      matchedText: string;
      subject: string;
      assertion: string;
      reason: string;
      severity: "low" | "medium" | "high";
      contradictedFactId?: string;
    }>;
    /** Which hook triggered the validation */
    triggerHook: "message_sending" | "before_message_write" | "llm_output";
  };
};
```

### 11.3 ISO 27001 Control Mapping

Output validation events MUST map to these controls:

| Event | Controls |
|---|---|
| `output_pass` | `A.8.10` (Information deletion — validates before propagation) |
| `output_flag` | `A.8.10`, `A.5.24` (Incident management — warning recorded) |
| `output_block` | `A.8.10`, `A.5.24`, `A.5.28` (Evidence collection) |

### 11.4 Audit Query Support

The existing `AuditFilter` type SHOULD be extended to support querying output validation events:

```typescript
type AuditFilter = {
  // ...existing fields...
  
  /** Filter for output validation events only */
  outputValidationOnly?: boolean;
  /** Filter by claim category */
  claimCategory?: ClaimCategory;
};
```

---

## 12. Performance Requirements

### 12.1 Latency Budgets

| Operation | Budget | Justification |
|---|---|---|
| Length check + bail-out | <10μs | Single comparison |
| Claim detection (all detectors) | <5ms | Pre-compiled regex matching |
| Fact lookup (all registries) | <2ms | In-memory hash map |
| Verdict computation | <1ms | Simple logic |
| Audit record generation | <1ms | Async, fire-and-forget |
| **Total pipeline** | **<10ms** | **User-imperceptible** |

### 12.2 Optimization Strategies

1. **Pre-compiled regex**: All detector patterns MUST be compiled at startup. Stored in the existing `PolicyIndex.regexCache`.

2. **Fact index**: Facts MUST be indexed by `(category, subject)` for O(1) lookup. Use a `Map<string, Fact[]>` keyed by category.

3. **Subject normalization**: Both claim subjects and fact subjects MUST be lowercased before matching to avoid redundant case-insensitive regex.

4. **Short-circuit**: If no fact registries are configured, skip the fact validation step entirely. If text is below minTextLength, skip everything.

5. **Truncation**: For texts longer than `maxTextLength`, only validate the first N characters. Most hallucination claims appear early in responses.

6. **Synchronous-only**: The entire pipeline MUST be synchronous to work with `before_message_write`. No Promises, no awaits.

### 12.3 Memory Budget

- Compiled detector patterns: ~50KB (100 patterns × 500 bytes)
- Fact index: ~10KB per registry (100 facts × 100 bytes)
- Per-invocation: ~5KB (detected claims array, transient)
- Total steady-state: <200KB

---

## 13. Anti-Pattern Coverage

This section maps each observed production anti-pattern to the detection mechanism that catches it.

### 13.1 "X is not installed" (False system state)

- **Detector:** `system_state` (builtin)
- **Pattern:** `/{subject}\s+is not\s+installed/i`
- **Claim:** `{ category: "system_state", subject: "X", assertion: "not_installed", negative: true }`
- **Validation:** Check `system-state` fact registry. If fact `{ subject: "X", value: { type: "state", state: "installed" } }` exists → `contradicted`
- **Verdict:** `block` (for untrusted/restricted agents) or `flag` (for standard+)

### 13.2 "Irina" → "Iulia" (Name substitution)

- **Detector:** `entity_name` (builtin)
- **Pattern:** `/(name is|called|named)\s+["']?Iulia["']?/i`
- **Claim:** `{ category: "entity_name", subject: "Iulia", assertion: "name_reference" }`
- **Validation:** Check `team-names` registry. Fact `{ subject: "Iulia", value: { type: "name", correctName: "Irina" } }` → `contradicted`
- **Verdict:** `block` (wrong name is always high severity)

### 13.3 "Feature Y doesn't exist" (False existence claim)

- **Detector:** `existence` (builtin)
- **Pattern:** `/{subject}\s+doesn't\s+exist/i`
- **Claim:** `{ category: "existence", subject: "Y", assertion: "not_exists", negative: true }`
- **Validation:** Check fact registry for `{ subject: "Y", value: { type: "exists", exists: true } }` → `contradicted`
- **Verdict:** `block` or `flag`

### 13.4 "Pipeline is broken" (Unfounded failure claim)

- **Detector:** `operational_status` (builtin)
- **Pattern:** `/(pipeline)\s+(is)\s+(broken)/i`
- **Claim:** `{ category: "operational_status", subject: "pipeline", assertion: "broken" }`
- **Validation:** Check `infra-status` registry. If fact `{ subject: "pipeline", value: { type: "status", status: "operational" } }` → `contradicted`
- **Verdict:** `flag` or `block`

### 13.5 Sub-Agent Self-Reflection

- **Detector:** `self_referential` (builtin)
- **Pattern:** `/(my (system prompt|instructions))\s+(say|tell)/i`
- **Claim:** `{ category: "capability", subject: "self", assertion: "self_referential" }`
- **Validation:** No fact needed — the detection IS the violation
- **Verdict:** Per `selfReferentialPolicy` (default: `flag`)

---

## 14. Security Considerations

### 14.1 Pattern Safety

All regex patterns (builtin and custom) MUST undergo the same safety validation as policy condition patterns (per RFC-001 §14.4):
- Reject patterns with catastrophic backtracking
- Enforce maximum pattern length (500 chars)
- Compile at startup, not per-invocation

### 14.2 Fact Registry Integrity

Fact registries are part of the trusted configuration (`openclaw.json`). They MUST NOT be:
- Modifiable by agents at runtime
- Sourced from agent output or tool results
- Loaded from untrusted files

### 14.3 Content Exposure

The output validation pipeline processes agent output text. The system MUST:
- Not log full agent output at `info` level
- Redact agent output in audit records beyond `matchedText` segments
- Apply the existing `audit-redactor` to violation details

### 14.4 False Positive Handling

Pattern-based claim detection will have false positives. The system MUST NOT:
- Block agent output unless confidence is high AND a fact contradicts the claim
- Treat all detected claims as violations — `no_fact_found` is NOT a violation by default
- Be overly aggressive with untrusted agents — `block` for unverified claims should be opt-in, not default

### 14.5 Gaming Prevention

Agents cannot game the output validation by:
- Using synonyms to avoid patterns: the detector patterns cover common variations
- Splitting claims across sentences: each sentence is evaluated independently
- Using quotes or code blocks: the detector operates on the full text including formatted content

For v0.2, the system acknowledges that a sufficiently creative agent can bypass pattern matching. Semantic detection (v0.3) will address this.

---

## 15. Backward Compatibility

### 15.1 Existing Governance Behavior

Output validation is purely additive. Existing governance behavior is unchanged:
- `before_tool_call` evaluation → unchanged
- `message_sending` policy evaluation → unchanged, output validation runs AFTER existing policy check
- Audit record format → extended (new verdicts), old records remain valid
- Configuration → new `outputValidation` block, no changes to existing config

### 15.2 Fail-Open Behavior

If the output validation pipeline encounters an error (regex engine failure, memory issue):
- The pipeline MUST fail open: output is allowed through
- An `error_fallback` audit record MUST be written
- The error MUST be logged at `error` level
- This is consistent with the governance engine's existing fail-open behavior

### 15.3 Opt-In

Output validation is enabled by default (`outputValidation.enabled: true`), but has NO effect without configured fact registries. This means:
- Upgrading to v0.2 with no config changes → claim detection runs but all claims are `no_fact_found` → verdict is controlled by `unverifiedClaimPolicy` which defaults to `"flag"` → agents whose output contains claims will generate audit warnings, but nothing is blocked
- This is the safe default: monitoring without enforcement

### 15.4 Gradual Rollout Path

1. Deploy v0.2 with `outputValidation.hooks.llmOutput: true` only → audit-only monitoring
2. Review flagged claims in audit trail → curate fact registries
3. Enable `beforeMessageWrite: true` → validate sub-agent output
4. Enable `messageSending: true` → validate all outbound messages
5. Tighten policies: move from `"flag"` to `"block"` for contradiction policy

---

## Appendix A: Interaction with Existing Governance Policies

Output validation is a separate subsystem from the policy evaluator. They compose:

```
Agent Action
    │
    ├── Tool Call → Policy Evaluator (before_tool_call)
    │                  → allow/deny
    │
    └── Message Output → Policy Evaluator (message_sending, existing)
                             → allow/deny
                         → Output Validator (message_sending + before_message_write, NEW)
                             → pass/flag/block
```

Both must `allow`/`pass` for the output to proceed. Policy deny overrides output pass. Output block overrides policy allow.

---

## Appendix B: v0.3 Roadmap

Features deferred from this RFC but architecturally prepared for:

1. **Semantic Claim Detection** — LLM-based claim extraction for ambiguous text
2. **Dynamic Fact Sources** — Real-time fact updates from tool call results
3. **Cross-Reference Validation** — Validate claims against previous agent outputs in the same session
4. **Claim Confidence Calibration** — Learn false-positive rates per detector and auto-adjust thresholds
5. **Output Rewriting** — Instead of blocking, rewrite flagged claims (e.g., "X might not be installed" → "X is installed (verified)")

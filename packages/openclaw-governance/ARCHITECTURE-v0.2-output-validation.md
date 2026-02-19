# ARCHITECTURE.md — @vainplex/openclaw-governance v0.2.0 — Output Validation

**Companion to:** RFC-003-output-validation.md (normative specification)  
**Builds on:** ARCHITECTURE.md (v0.1.0 implementation blueprint)  
**Purpose:** Implementation blueprint for Forge (developer agent) and Cerberus (review agent)  
**Version:** 0.2.0  
**Date:** 2026-02-19  

---

## Table of Contents

1. [Delta Summary](#1-delta-summary)
2. [Project Structure Changes](#2-project-structure-changes)
3. [USP Traceability — USP6: Output Validation](#3-usp-traceability--usp6-output-validation)
4. [New Type Definitions](#4-new-type-definitions)
5. [New Module Specifications](#5-new-module-specifications)
6. [Modified Module Specifications](#6-modified-module-specifications)
7. [Data Flow — Output Validation](#7-data-flow--output-validation)
8. [Configuration Resolution Changes](#8-configuration-resolution-changes)
9. [Testing Strategy — Output Validation](#9-testing-strategy--output-validation)
10. [Implementation Order](#10-implementation-order)
11. [Migration from v0.1.x](#11-migration-from-v01x)

---

## 1. Delta Summary

v0.2.0 adds one major feature: **Output Validation**. This is the diff from v0.1.x:

### New Files

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/output-validator.ts` | Output validation pipeline orchestrator | ~200 |
| `src/claim-detector.ts` | Pattern-based claim detection engine | ~250 |
| `src/fact-checker.ts` | Fact registry management + claim-to-fact validation | ~180 |
| `test/output-validator.test.ts` | Output validator unit tests | ~300 |
| `test/claim-detector.test.ts` | Claim detector unit tests | ~350 |
| `test/fact-checker.test.ts` | Fact checker unit tests | ~250 |

### Modified Files

| File | Change | Size Impact |
|---|---|---|
| `src/types.ts` | Add OutputValidation types (~120 lines) | +120 |
| `src/config.ts` | Add `resolveOutputValidationConfig()` (~40 lines) | +40 |
| `src/engine.ts` | Add `validateOutput()` method, wire output validator (~30 lines) | +30 |
| `src/hooks.ts` | Add `handleBeforeMessageWrite`, `handleLlmOutput`, enhance `handleMessageSending` (~80 lines) | +80 |
| `src/audit-trail.ts` | Extend AuditVerdict enum, add outputValidation context (~20 lines) | +20 |
| `index.ts` | No changes (engine wires everything internally) | +0 |
| `openclaw.plugin.json` | Add `outputValidation` schema (~60 lines) | +60 |
| `test/integration.test.ts` | Add output validation integration tests (~100 lines) | +100 |
| `test/hooks.test.ts` | Add before_message_write + llm_output handler tests (~50 lines) | +50 |

### Unchanged Files

All other v0.1.x files remain unchanged. The output validation subsystem is additive — it plugs into the existing engine without modifying the policy evaluation, trust, or audit core.

**Total new source code:** ~660 lines (3 files)  
**Total new test code:** ~900 lines (3 files)  
**Total modifications:** ~350 lines across 7 files  

---

## 2. Project Structure Changes

```diff
 openclaw-governance/
 ├── index.ts
 ├── openclaw.plugin.json
 ├── package.json
 ├── tsconfig.json
 ├── RFC.md                            # v0.1 RFC (RFC-001)
 ├── RFC-002-production-bugfixes.md    # v0.1.1 bugfix RFC
+├── RFC-003-output-validation.md      # v0.2 output validation RFC
 ├── ARCHITECTURE.md                   # v0.1 architecture
+├── ARCHITECTURE-v0.2-output-validation.md  # This file
 ├── src/
 │   ├── types.ts                      # MODIFIED: +OutputValidation types
 │   ├── config.ts                     # MODIFIED: +outputValidation defaults
 │   ├── engine.ts                     # MODIFIED: +validateOutput() method
 │   ├── hooks.ts                      # MODIFIED: +before_message_write, +llm_output, enhanced message_sending
 │   ├── audit-trail.ts               # MODIFIED: +output_* verdicts
+│   ├── output-validator.ts           # NEW: Output validation pipeline orchestrator
+│   ├── claim-detector.ts            # NEW: Claim detection engine
+│   ├── fact-checker.ts              # NEW: Fact registry + validation
 │   ├── policy-loader.ts             # unchanged
 │   ├── policy-evaluator.ts          # unchanged
 │   ├── cross-agent.ts              # unchanged
 │   ├── conditions/                  # unchanged
 │   ├── risk-assessor.ts            # unchanged
 │   ├── trust-manager.ts            # unchanged
 │   ├── audit-redactor.ts           # unchanged
 │   ├── frequency-tracker.ts        # unchanged
 │   ├── builtin-policies.ts         # unchanged
 │   └── util.ts                     # unchanged
 ├── test/
+│   ├── output-validator.test.ts     # NEW
+│   ├── claim-detector.test.ts       # NEW
+│   ├── fact-checker.test.ts         # NEW
 │   ├── integration.test.ts          # MODIFIED: +output validation scenarios
 │   ├── hooks.test.ts               # MODIFIED: +new handler tests
 │   └── ... (all others unchanged)
 └── dist/
```

**New source files:** 3  
**File size constraint:** Max 400 lines per file. Max 40 lines per function.

---

## 3. USP Traceability — USP6: Output Validation

*Agents are governed not just by what they do, but by what they say. Pattern-based claim detection + fact validation catches hallucinations before they reach users.*

| Anchor | Role |
|---|---|
| `src/claim-detector.ts` | Pattern-based identification of factual claims in agent text |
| `src/fact-checker.ts` | Validates detected claims against configured ground truth |
| `src/output-validator.ts` | Orchestrates the detection→validation→verdict pipeline |
| `src/hooks.ts` | Intercepts agent output at `message_sending`, `before_message_write`, `llm_output` |
| `src/engine.ts` | Exposes `validateOutput()` to hook handlers |
| `src/audit-trail.ts` | Records output validation events with claim details |
| **Tests** | `claim-detector.test.ts`, `fact-checker.test.ts`, `output-validator.test.ts`, `integration.test.ts` |
| **Config** | `outputValidation.enabled`, `outputValidation.factRegistries`, `outputValidation.agentOverrides` |

**Why this is unique:** No competing governance tool validates the *content* of agent responses against known facts. Rampart/NeMo/GuardrailsAI filter for prompt injection and toxicity, not factual accuracy. This is the first pattern-based hallucination detector for multi-agent systems.

---

## 4. New Type Definitions

All new types go in `src/types.ts`. Grouped below for clarity.

### 4.1 Claim Detection Types

```typescript
// ── Claim Detection ──

export type ClaimCategory =
  | "system_state"
  | "entity_name"
  | "existence"
  | "operational_status"
  | "capability";

export type DetectedClaim = {
  /** The claim category */
  category: ClaimCategory;
  /** The specific pattern/detector that matched */
  detectorId: string;
  /** The matched text segment (the actual substring from agent output) */
  matchedText: string;
  /** Character offset in the original text */
  offset: number;
  /** The subject of the claim (e.g., "Node.js" in "Node.js is not installed") */
  subject: string;
  /** The assertion being made (e.g., "not_installed") */
  assertion: string;
  /** Is this a negative claim? ("not X" / "no X" / "doesn't exist") */
  negative: boolean;
  /** Detection confidence: 1.0 for exact match, lower for fuzzy */
  confidence: number;
};

export type CustomClaimDetector = {
  /** Unique detector ID (kebab-case) */
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

### 4.2 Fact Registry Types

```typescript
// ── Fact Registry ──

export type FactValueType = "exists" | "state" | "name" | "status" | "capability";

export type FactValue =
  | { type: "exists"; exists: boolean }
  | { type: "state"; state: string }
  | { type: "name"; correctName: string; aliases?: string[] }
  | { type: "status"; status: "operational" | "degraded" | "down" }
  | { type: "capability"; supported: boolean };

export type Fact = {
  /** Unique fact ID (kebab-case) */
  id: string;
  /** Claim category this fact validates */
  category: ClaimCategory;
  /** Subject pattern — what entity this fact is about */
  subject: string;
  /** Is subject a regex pattern? (default: false = case-insensitive exact) */
  subjectIsRegex?: boolean;
  /** The known truth about this subject */
  value: FactValue;
  /** Human-readable description */
  description?: string;
  /** Optional TTL in seconds (fact expires after this) */
  ttlSeconds?: number;
  /** When this fact was last updated (ISO 8601) */
  updatedAt?: string;
};

export type FactRegistry = {
  /** Registry ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Facts in this registry */
  facts: Fact[];
  /** Whether this registry is active (default: true) */
  enabled?: boolean;
};

export type FactCheckResult =
  | { status: "no_fact_found" }
  | { status: "confirmed" }
  | { status: "contradicted"; factId: string; expected: string; claimed: string }
  | { status: "expired_fact" };
```

### 4.3 Output Validation Types

```typescript
// ── Output Validation ──

export type OutputVerdict = "pass" | "flag" | "block";

export type OutputViolation = {
  /** The claim that caused the violation */
  claim: DetectedClaim;
  /** Why this is a violation */
  reason: string;
  /** Severity: low=unverified claim, medium=suspicious, high=contradicts fact */
  severity: "low" | "medium" | "high";
  /** The fact that contradicts the claim (if any) */
  contradictedFact?: { factId: string; expected: string };
};

export type OutputValidationResult = {
  /** The final verdict */
  verdict: OutputVerdict;
  /** All claims detected in the output */
  claims: DetectedClaim[];
  /** Fact-check results for each claim */
  factChecks: Array<{
    claim: DetectedClaim;
    result: FactCheckResult;
  }>;
  /** Claims that triggered violations */
  violations: OutputViolation[];
  /** Pipeline duration in microseconds */
  evaluationUs: number;
  /** Agent's trust at evaluation time */
  trust: { score: number; tier: TrustTier };
};

export type OutputValidationAgentOverride = {
  /** Agent ID (or glob pattern, e.g., "*" for all) */
  agent: string;
  /** Override the validation profile */
  profile?: "strict" | "standard" | "lenient" | "disabled";
  /** Override individual policies */
  unverifiedClaimPolicy?: "ignore" | "flag" | "block";
  contradictionPolicy?: "ignore" | "flag" | "block";
  selfReferentialPolicy?: "ignore" | "flag" | "block";
  /** Additional fact registries to apply */
  additionalRegistries?: string[];
  /** Fact registries to exclude */
  excludeRegistries?: string[];
};

export type OutputValidationHooksConfig = {
  /** Validate on message_sending (outbound to users). Default: true */
  messageSending: boolean;
  /** Validate on before_message_write (persistence). Default: true */
  beforeMessageWrite: boolean;
  /** Monitor on llm_output (audit-only, never blocks). Default: false */
  llmOutput: boolean;
};

export type OutputValidationPerformanceConfig = {
  /** Max validation time before bail-out in μs (default: 8000) */
  maxEvalUs: number;
  /** Max claims to process per output (default: 50) */
  maxClaimsPerOutput: number;
  /** Max text length to validate (default: 10000 chars) */
  maxTextLength: number;
};

export type OutputValidationConfig = {
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
  /** Custom claim detectors */
  customDetectors: CustomClaimDetector[];
  /** Which builtin detectors are enabled */
  builtinDetectors: {
    systemState: boolean;
    entityName: boolean;
    existence: boolean;
    operationalStatus: boolean;
    selfReferential: boolean;
  };
  /** Default policies for each claim resolution type */
  defaults: {
    unverifiedClaimPolicy: "ignore" | "flag" | "block";
    contradictionPolicy: "ignore" | "flag" | "block";
    selfReferentialPolicy: "ignore" | "flag" | "block";
  };
  /** Per-agent overrides */
  agentOverrides: OutputValidationAgentOverride[];
  /** Which hooks to enable output validation on */
  hooks: OutputValidationHooksConfig;
  /** Performance settings */
  performance: OutputValidationPerformanceConfig;
};
```

### 4.4 Extended Audit Types

```typescript
// ── Extended Audit (add to existing) ──

// Extend AuditVerdict:
export type AuditVerdict =
  | "allow"
  | "deny"
  | "error_fallback"
  | "output_pass"
  | "output_flag"
  | "output_block";

// Extend AuditContext:
export type OutputValidationAuditContext = {
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

// AuditContext gets an optional field:
// outputValidation?: OutputValidationAuditContext;
```

---

## 5. New Module Specifications

### 5.1 `src/claim-detector.ts` — Claim Detection Engine

> **USP anchor:** USP6 (primary — identifies factual claims in agent text)

**Responsibility:** Pattern-based identification of factual claims in agent output text. Ships builtin detectors for the 5 claim categories. Supports custom detectors from config.

**Exports:**

```typescript
export class ClaimDetector {
  constructor(
    builtinConfig: OutputValidationConfig["builtinDetectors"],
    customDetectors: CustomClaimDetector[],
    regexCache: Map<string, RegExp>,
  );
  
  /** Run all enabled detectors on text. Returns all detected claims.
   *  MUST be synchronous. MUST complete in <5ms for 10k chars. */
  detect(text: string): DetectedClaim[];
  
  /** Get count of loaded detectors (for status reporting) */
  getDetectorCount(): number;
}
```

**Internal structure:**

```typescript
class ClaimDetector {
  private detectors: DetectorEntry[];
  private regexCache: Map<string, RegExp>;
  
  // Each detector is a struct:
  type DetectorEntry = {
    id: string;
    category: ClaimCategory;
    patterns: RegExp[];      // Pre-compiled
    assertion: string;
    negative: boolean;
    confidence: number;
    subjectExtractor: (match: RegExpMatchArray) => string;
  };
  
  // detect() algorithm:
  // 1. For each detector in this.detectors:
  //    a. For each pattern in detector.patterns:
  //       - Run pattern.exec(text) in a loop (global flag)
  //       - For each match: extract subject, build DetectedClaim
  //    b. Break early if total claims > maxClaimsPerOutput
  // 2. Deduplicate by (subject + assertion + offset)
  // 3. Return sorted by offset
}
```

**Builtin detector implementations:**

#### 5.1.1 System State Detector (`builtin-system-state`)

```typescript
const SYSTEM_STATE_PATTERNS: [RegExp, string][] = [
  // "X is not installed/running/configured/available/active"
  [/(\b[A-Z][\w.-]+(?:\s+\w+)?)\s+(?:is|isn't|is not|was not|wasn't)\s+(not\s+)?(installed|running|configured|available|enabled|active|loaded|present)\b/gi, "state_assertion"],
  
  // "cannot find / unable to find / could not find X"
  [/(?:cannot|can't|could not|couldn't|unable to|failed to)\s+find\s+["']?(\b[\w.-]+\b)["']?/gi, "not_found"],
  
  // "X does not exist / is missing / is not found"  
  [/(\b[\w.-]+(?:\s+\w+)?)\s+(?:does not|doesn't|did not|didn't)\s+(?:exist|work)\b/gi, "not_exists"],
  
  // "there is no X / there's no X"
  [/(?:there(?:'s| is| are) no)\s+["']?(\b[\w.-]+(?:\s+\w+)?)["']?/gi, "not_exists"],
];
```

**Subject extraction:** The first capture group in each pattern is the subject. Subjects are trimmed and lowercased for matching.

#### 5.1.2 Entity Name Detector (`builtin-entity-name`)

```typescript
const ENTITY_NAME_PATTERNS: [RegExp, string][] = [
  // "The user/person/owner is NAME" or "named NAME" or "called NAME"
  [/(?:user|person|team member|developer|author|owner|maintainer|creator|partner)\s+(?:is|named|called)\s+["']?([A-Z][a-zA-Z]+)["']?/gi, "name_reference"],
  
  // "NAME said/wrote/created/built"
  [/\b([A-Z][a-zA-Z]{2,})\s+(?:said|wrote|created|built|developed|designed|reviewed|mentioned|suggested|reported)\b/g, "name_action"],
  
  // "name is NAME"
  [/\bname\s+is\s+["']?([A-Z][a-zA-Z]+)["']?/gi, "name_assertion"],
];
```

**Confidence:** Name action patterns get 0.6 confidence (could be legitimate). Name assertion patterns get 0.9.

#### 5.1.3 Existence Detector (`builtin-existence`)

```typescript
const EXISTENCE_PATTERNS: [RegExp, string][] = [
  // "there is no X / there's no X / there are no X"
  [/(?:there(?:'s| is| are)\s+no)\s+(?:such\s+)?(?:thing as\s+)?["']?(\b[\w.-]+(?:\s+[\w.-]+)?)["']?/gi, "not_exists"],
  
  // "X doesn't/does not exist/have/contain/support"
  [/["']?(\b[\w.-]+(?:\s+[\w.-]+)?)["']?\s+(?:doesn't|does not|didn't|did not)\s+(?:exist|have|contain|include|support)/gi, "not_exists"],
  
  // "feature/file/config X is missing / doesn't exist / is not available"
  [/(?:feature|function|method|file|config|option|setting|field|parameter|module|package|plugin)\s+["']?([\w.-]+(?:\s+[\w.-]+)?)["']?\s+(?:is missing|doesn't exist|does not exist|is not (?:available|present|defined|implemented|found))/gi, "not_exists"],
  
  // "we/I don't have X"
  [/(?:we|you|they|I)\s+(?:don't|do not|didn't)\s+have\s+(?:a|an|the|any)\s+["']?([\w.-]+(?:\s+[\w.-]+)?)["']?/gi, "not_exists"],
];
```

#### 5.1.4 Operational Status Detector (`builtin-operational-status`)

```typescript
const OPERATIONAL_STATUS_PATTERNS: [RegExp, string][] = [
  // "X is broken/down/failing/crashed/dead/offline"
  [/(pipeline|build|test suite|deploy|service|server|database|queue|cluster|gateway|system|CI|CD)\s+(?:is|are|was|were)\s+(broken|down|failing|crashed|dead|offline|unreachable|unresponsive)/gi, "status_negative"],
  
  // "X failed/crashed/timed out"
  [/(pipeline|build|test suite|deploy|service|server|database|queue|cluster|gateway|system)\s+(failed|crashed|timed out|errored|hung|froze)/gi, "status_failed"],
  
  // "everything is broken/failing"
  [/(?:everything|all (?:systems|services|tests|builds))\s+(?:is|are)\s+(broken|failing|down)/gi, "status_all_negative"],
];
```

#### 5.1.5 Self-Referential Detector (`builtin-self-referential`)

```typescript
const SELF_REFERENTIAL_PATTERNS: [RegExp, string][] = [
  // "my system prompt/instructions say..."
  [/(?:my|the)\s+(?:system prompt|instructions|guidelines|rules|constraints|directives)\s+(?:say|tell|instruct|direct|require|state)/gi, "self_referential"],
  
  // "I am an AI/assistant/language model/agent"
  [/\bI(?:'m| am)\s+(?:an? )?(?:AI|artificial intelligence|assistant|language model|sub-agent|chat ?bot)/gi, "self_identity"],
  
  // "according to my instructions/based on my training"
  [/(?:according to|based on)\s+my\s+(?:instructions|prompt|guidelines|training|programming)/gi, "self_referential"],
  
  // "I was told/instructed/asked to"
  [/\bI was (?:told|instructed|asked|tasked|designed|programmed|configured) to\b/gi, "self_referential"],
];
```

**Lines:** ~250

---

### 5.2 `src/fact-checker.ts` — Fact Registry + Validation

> **USP anchor:** USP6 (secondary — validates claims against ground truth)

**Responsibility:** Manage fact registries, index facts for fast lookup, validate detected claims against known facts.

**Exports:**

```typescript
export class FactChecker {
  constructor(registries: FactRegistry[], regexCache: Map<string, RegExp>);
  
  /** Check a detected claim against all fact registries.
   *  MUST be synchronous. MUST complete in <1ms per claim. */
  check(claim: DetectedClaim): FactCheckResult;
  
  /** Check a claim against specific registries only */
  checkWithRegistries(claim: DetectedClaim, registryIds: string[]): FactCheckResult;
  
  /** Get total fact count across all registries (for status) */
  getFactCount(): number;
  
  /** Get registry IDs */
  getRegistryIds(): string[];
}
```

**Internal structure:**

```typescript
class FactChecker {
  // Indexed for O(1) category lookup, then linear scan within category
  private factsByCategory: Map<ClaimCategory, IndexedFact[]>;
  private regexCache: Map<string, RegExp>;
  
  type IndexedFact = {
    fact: Fact;
    registryId: string;
    subjectPattern: RegExp | null;  // Pre-compiled if subjectIsRegex
    subjectLower: string;           // Lowercased for exact match
    expiresAt: number | null;       // Computed from ttlSeconds + updatedAt
  };
  
  // check() algorithm:
  // 1. Get facts for claim.category from factsByCategory
  // 2. For each fact:
  //    a. Check TTL expiry → if expired, skip (return expired_fact only if this was the only match)
  //    b. Match subject:
  //       - If subjectIsRegex: test claim.subject.toLowerCase() against fact.subjectPattern
  //       - Else: test claim.subject.toLowerCase() === fact.subjectLower
  //              OR fact.subjectLower includes claim.subject.toLowerCase()
  //    c. If subject matches: compare claim assertion vs fact value
  //       - exists: claim.negative XOR fact.exists → contradicted
  //       - state: claim asserts "not_installed" + fact says "installed" → contradicted
  //       - name: claim.subject matches an alias but not correctName → contradicted
  //       - status: claim says "broken" but fact says "operational" → contradicted
  //       - capability: claim.negative XOR fact.supported → contradicted
  //    d. Return confirmed or contradicted
  // 3. If no fact matched: return no_fact_found
  
  // Subject matching helper:
  private matchesSubject(claim: DetectedClaim, fact: IndexedFact): boolean {
    const claimSubject = claim.subject.toLowerCase();
    if (fact.subjectPattern) {
      return fact.subjectPattern.test(claimSubject);
    }
    // Exact match or contains
    return claimSubject === fact.subjectLower 
      || claimSubject.includes(fact.subjectLower)
      || fact.subjectLower.includes(claimSubject);
  }
  
  // Contradiction detection per fact value type:
  private checkContradiction(claim: DetectedClaim, fact: Fact): FactCheckResult {
    const v = fact.value;
    switch (v.type) {
      case "exists":
        // Claim says "doesn't exist" but fact says it does (or vice versa)
        if (claim.negative !== !v.exists) return { status: "confirmed" };
        return { status: "contradicted", factId: fact.id, 
          expected: v.exists ? "exists" : "does not exist",
          claimed: claim.negative ? "does not exist" : "exists" };
      
      case "state":
        // Claim says "not installed" but fact says "installed"
        if (claim.negative && v.state === claim.assertion.replace(/^not_/, "")) {
          return { status: "contradicted", factId: fact.id,
            expected: v.state, claimed: claim.assertion };
        }
        return { status: "confirmed" };
      
      case "name":
        // Claim references a name — check if it's the correct name or an alias
        const claimedName = claim.subject.toLowerCase();
        const correctLower = v.correctName.toLowerCase();
        const aliasesLower = (v.aliases ?? []).map(a => a.toLowerCase());
        if (claimedName === correctLower || aliasesLower.includes(claimedName)) {
          return { status: "confirmed" };
        }
        return { status: "contradicted", factId: fact.id,
          expected: v.correctName, claimed: claim.subject };
      
      case "status":
        const negativeStatuses = ["broken", "down", "failing", "crashed", "dead", 
          "offline", "unreachable", "unresponsive", "failed", "status_negative", 
          "status_failed", "status_all_negative"];
        const claimIsNegative = negativeStatuses.includes(claim.assertion);
        if (claimIsNegative && v.status === "operational") {
          return { status: "contradicted", factId: fact.id,
            expected: v.status, claimed: claim.assertion };
        }
        if (!claimIsNegative && v.status === "down") {
          return { status: "contradicted", factId: fact.id,
            expected: v.status, claimed: claim.assertion };
        }
        return { status: "confirmed" };
      
      case "capability":
        if (claim.negative !== !v.supported) return { status: "confirmed" };
        return { status: "contradicted", factId: fact.id,
          expected: v.supported ? "supported" : "not supported",
          claimed: claim.negative ? "not supported" : "supported" };
    }
  }
}
```

**Lines:** ~180

---

### 5.3 `src/output-validator.ts` — Pipeline Orchestrator

> **USP anchor:** USP6 (orchestrator — ties detection, validation, and verdict together)

**Responsibility:** Orchestrate the output validation pipeline: claim detection → fact checking → verdict computation. Applies trust-proportional policies and per-agent overrides.

**Exports:**

```typescript
export class OutputValidator {
  constructor(
    config: OutputValidationConfig,
    claimDetector: ClaimDetector,
    factChecker: FactChecker,
  );
  
  /** Run the full output validation pipeline on text.
   *  MUST be synchronous. MUST complete in <10ms.
   *  
   *  @param agentId - The agent that produced this output
   *  @param text - The agent output text to validate
   *  @param trust - The agent's current trust state
   *  @param opts - Optional: auditOnly mode (never blocks, for llm_output)
   */
  validate(
    agentId: string,
    text: string,
    trust: { score: number; tier: TrustTier },
    opts?: { auditOnly?: boolean },
  ): OutputValidationResult;
  
  /** Check if an agent should be validated at all */
  shouldValidate(agentId: string, trust: { score: number }): boolean;
  
  /** Get the effective policies for an agent (considering trust + overrides) */
  getEffectivePolicies(agentId: string, trust: { score: number; tier: TrustTier }): ResolvedValidationPolicies;
  
  /** Get status for /governance command */
  getStatus(): { enabled: boolean; detectorCount: number; factCount: number; registryCount: number };
}

type ResolvedValidationPolicies = {
  unverifiedClaimPolicy: "ignore" | "flag" | "block";
  contradictionPolicy: "ignore" | "flag" | "block";
  selfReferentialPolicy: "ignore" | "flag" | "block";
  detectionDepth: "all" | "contradiction_only";
};
```

**Internal structure:**

```typescript
class OutputValidator {
  private config: OutputValidationConfig;
  private detector: ClaimDetector;
  private checker: FactChecker;
  
  // validate() algorithm:
  //
  // 1. BAIL-OUT CHECKS (fast path):
  //    - if !config.enabled → pass
  //    - if text.length < config.minTextLength → pass
  //    - if !shouldValidate(agentId, trust) → pass
  //
  // 2. TEXT PREPARATION:
  //    - Truncate to config.performance.maxTextLength
  //    - startUs = nowUs()
  //
  // 3. CLAIM DETECTION:
  //    - claims = detector.detect(text)
  //    - if claims.length === 0 → pass
  //    - Truncate claims to config.performance.maxClaimsPerOutput
  //
  // 4. FACT CHECKING:
  //    - For each claim: factChecks.push({ claim, result: checker.check(claim) })
  //
  // 5. RESOLVE POLICIES:
  //    - policies = getEffectivePolicies(agentId, trust)
  //
  // 6. COMPUTE VIOLATIONS:
  //    - For each factCheck:
  //      - If result.status === "contradicted":
  //          → violation with severity "high", apply policies.contradictionPolicy
  //      - If result.status === "no_fact_found" AND claim.category !== self-referential:
  //          → violation with severity "low", apply policies.unverifiedClaimPolicy
  //      - If claim is self-referential:
  //          → violation with severity "medium", apply policies.selfReferentialPolicy
  //      - If result.status === "confirmed":
  //          → no violation
  //
  // 7. COMPUTE VERDICT:
  //    - If any violation maps to "block" AND NOT auditOnly → block
  //    - If any violation maps to "flag" → flag
  //    - Else → pass
  //
  // 8. BUDGET CHECK:
  //    - If nowUs() - startUs > config.performance.maxEvalUs:
  //      → bail out, return pass (fail-open on timeout)
  //
  // 9. RETURN OutputValidationResult
  
  // shouldValidate():
  //   - if agentId in config.exempt → false
  //   - if trust.score >= config.trustExemptThreshold → false
  //   - if agent override has profile "disabled" → false
  //   - else → true
  
  // getEffectivePolicies():
  //   1. Start with trust-based defaults (per trust tier table from RFC)
  //   2. Apply per-agent override (first matching glob wins)
  //   3. If profile specified: apply profile template
  //   4. If individual policies specified: override those
  //   5. Return resolved policies
  
  // Profile templates:
  // "strict":  { unverified: "block", contradiction: "block", selfRef: "block", depth: "all" }
  // "standard": { unverified: "flag", contradiction: "block", selfRef: "flag", depth: "all" }
  // "lenient": { unverified: "ignore", contradiction: "flag", selfRef: "ignore", depth: "contradiction_only" }
  // "disabled": skip validation entirely
}
```

**Lines:** ~200

---

## 6. Modified Module Specifications

### 6.1 `src/types.ts` — Changes

**Add all types from Section 4** (~120 new lines).

**Modify `AuditVerdict`:**
```diff
- export type AuditVerdict = "allow" | "deny" | "error_fallback";
+ export type AuditVerdict = "allow" | "deny" | "error_fallback"
+   | "output_pass" | "output_flag" | "output_block";
```

**Modify `AuditContext`:**
```diff
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
+   /** Output validation details (present for output_* verdicts) */
+   outputValidation?: OutputValidationAuditContext;
  };
```

**Modify `GovernanceConfig`:**
```diff
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
+   outputValidation: OutputValidationConfig;
  };
```

**Modify `PolicyHookName`:**
```diff
  export type PolicyHookName =
    | "before_tool_call"
    | "message_sending"
    | "before_agent_start"
-   | "session_start";
+   | "session_start"
+   | "before_message_write"
+   | "llm_output";
```

---

### 6.2 `src/config.ts` — Changes

**Add `resolveOutputValidationConfig()` function:**

```typescript
function resolveOutputValidationConfig(
  raw?: Record<string, unknown>,
): OutputValidationConfig {
  if (!raw) return OUTPUT_VALIDATION_DEFAULTS;
  return {
    enabled: (raw.enabled as boolean) ?? true,
    minTextLength: (raw.minTextLength as number) ?? 10,
    exempt: (raw.exempt as string[]) ?? [],
    trustExemptThreshold: (raw.trustExemptThreshold as number) ?? 90,
    factRegistries: (raw.factRegistries as FactRegistry[]) ?? [],
    customDetectors: (raw.customDetectors as CustomClaimDetector[]) ?? [],
    builtinDetectors: {
      systemState: (raw.builtinDetectors as Record<string, boolean>)?.systemState ?? true,
      entityName: (raw.builtinDetectors as Record<string, boolean>)?.entityName ?? true,
      existence: (raw.builtinDetectors as Record<string, boolean>)?.existence ?? true,
      operationalStatus: (raw.builtinDetectors as Record<string, boolean>)?.operationalStatus ?? true,
      selfReferential: (raw.builtinDetectors as Record<string, boolean>)?.selfReferential ?? true,
    },
    defaults: {
      unverifiedClaimPolicy: (raw.defaults as Record<string, string>)?.unverifiedClaimPolicy as "ignore" | "flag" | "block" ?? "flag",
      contradictionPolicy: (raw.defaults as Record<string, string>)?.contradictionPolicy as "ignore" | "flag" | "block" ?? "block",
      selfReferentialPolicy: (raw.defaults as Record<string, string>)?.selfReferentialPolicy as "ignore" | "flag" | "block" ?? "flag",
    },
    agentOverrides: (raw.agentOverrides as OutputValidationAgentOverride[]) ?? [],
    hooks: {
      messageSending: (raw.hooks as Record<string, boolean>)?.messageSending ?? true,
      beforeMessageWrite: (raw.hooks as Record<string, boolean>)?.beforeMessageWrite ?? true,
      llmOutput: (raw.hooks as Record<string, boolean>)?.llmOutput ?? false,
    },
    performance: {
      maxEvalUs: (raw.performance as Record<string, number>)?.maxEvalUs ?? 8000,
      maxClaimsPerOutput: (raw.performance as Record<string, number>)?.maxClaimsPerOutput ?? 50,
      maxTextLength: (raw.performance as Record<string, number>)?.maxTextLength ?? 10000,
    },
  };
}

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

**Modify `resolveConfig()`:**
```diff
  export function resolveConfig(raw?: Record<string, unknown>): GovernanceConfig {
    return {
      // ...existing...
+     outputValidation: resolveOutputValidationConfig(
+       raw?.outputValidation as Record<string, unknown> | undefined,
+     ),
    };
  }
```

**Lines added:** ~40

---

### 6.3 `src/engine.ts` — Changes

**Add OutputValidator construction and `validateOutput()` method:**

```typescript
import { OutputValidator } from "./output-validator.js";
import { ClaimDetector } from "./claim-detector.js";
import { FactChecker } from "./fact-checker.js";

export class GovernanceEngine {
  // ...existing fields...
  private outputValidator: OutputValidator | null = null;
  
  async start(): Promise<void> {
    // ...existing startup...
    
    // Initialize output validation subsystem
    if (this.config.outputValidation.enabled) {
      const claimDetector = new ClaimDetector(
        this.config.outputValidation.builtinDetectors,
        this.config.outputValidation.customDetectors,
        this.policyIndex.regexCache,  // Share regex cache
      );
      const factChecker = new FactChecker(
        this.config.outputValidation.factRegistries,
        this.policyIndex.regexCache,
      );
      this.outputValidator = new OutputValidator(
        this.config.outputValidation,
        claimDetector,
        factChecker,
      );
      this.logger.info(
        `[governance] Output validation started: ${claimDetector.getDetectorCount()} detectors, ${factChecker.getFactCount()} facts`,
      );
    }
  }
  
  /** Validate agent output text. Called by hook handlers.
   *  Fully synchronous — safe for before_message_write. */
  validateOutput(
    agentId: string,
    text: string,
    opts?: { auditOnly?: boolean },
  ): OutputValidationResult {
    if (!this.outputValidator) {
      return {
        verdict: "pass",
        claims: [],
        factChecks: [],
        violations: [],
        evaluationUs: 0,
        trust: { score: 0, tier: "untrusted" },
      };
    }
    
    const trust = this.getTrust(agentId);
    const trustData = "score" in trust
      ? { score: trust.score, tier: trust.tier }
      : { score: 10, tier: "untrusted" as const };
    
    const result = this.outputValidator.validate(agentId, text, trustData, opts);
    
    // Record in audit trail
    if (this.config.audit.enabled && result.verdict !== "pass") {
      this.recordOutputAudit(agentId, result, opts?.auditOnly ? "llm_output" : "message_sending");
    }
    
    // Trust feedback: contradictions are violations
    if (this.config.trust.enabled && result.violations.some(v => v.severity === "high")) {
      this.trustManager.recordViolation(
        agentId,
        `Output validation: ${result.violations.filter(v => v.severity === "high").map(v => v.reason).join("; ")}`,
      );
    }
    
    return result;
  }
  
  private recordOutputAudit(
    agentId: string,
    result: OutputValidationResult,
    triggerHook: "message_sending" | "before_message_write" | "llm_output",
  ): void {
    const verdict = result.verdict === "block" ? "output_block"
      : result.verdict === "flag" ? "output_flag"
      : "output_pass";
    
    const reason = result.violations.length > 0
      ? result.violations.map(v => v.reason).join("; ")
      : "Output validation passed";
    
    this.auditTrail.record(
      verdict as AuditVerdict,
      reason,
      {
        hook: triggerHook,
        agentId,
        sessionKey: `agent:${agentId}`,
        outputValidation: {
          claimCount: result.claims.length,
          violations: result.violations.map(v => ({
            detectorId: v.claim.detectorId,
            category: v.claim.category,
            matchedText: v.claim.matchedText.substring(0, 100),  // Truncate for audit
            subject: v.claim.subject,
            assertion: v.claim.assertion,
            reason: v.reason,
            severity: v.severity,
            contradictedFactId: v.contradictedFact?.factId,
          })),
          triggerHook,
        },
      },
      result.trust,
      { level: "low", score: 0 },  // Risk not applicable for output validation
      [],  // No matched policies (output validation is separate from policy system)
      result.evaluationUs,
    );
  }
  
  // Extend getStatus():
  getStatus(): GovernanceStatus {
    // ...existing...
    return {
      // ...existing fields...
      outputValidation: this.outputValidator?.getStatus() ?? {
        enabled: false,
        detectorCount: 0,
        factCount: 0,
        registryCount: 0,
      },
    };
  }
}
```

**Lines added:** ~80

**GovernanceStatus extension:**
```diff
  export type GovernanceStatus = {
    enabled: boolean;
    policyCount: number;
    trustEnabled: boolean;
    auditEnabled: boolean;
    failMode: FailMode;
    stats: EvaluationStats;
+   outputValidation: {
+     enabled: boolean;
+     detectorCount: number;
+     factCount: number;
+     registryCount: number;
+   };
  };
```

---

### 6.4 `src/hooks.ts` — Changes

**Add three new hook handlers + enhance existing:**

```typescript
// ── NEW: before_message_write handler ──

function handleBeforeMessageWrite(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    hookCtx: unknown,
  ): { block?: boolean; message?: unknown } | undefined => {
    // MUST be synchronous — before_message_write doesn't support Promises
    if (!config.outputValidation.enabled) return undefined;
    if (!config.outputValidation.hooks.beforeMessageWrite) return undefined;
    
    try {
      const ev = event as {
        message: { role?: string; content?: unknown };
      };
      
      // Only validate assistant messages (not user messages, tool results, etc.)
      if (ev.message.role !== "assistant") return undefined;
      
      // Extract text content
      const content = typeof ev.message.content === "string"
        ? ev.message.content
        : Array.isArray(ev.message.content)
          ? (ev.message.content as Array<{ type?: string; text?: string }>)
              .filter(p => p.type === "text" && p.text)
              .map(p => p.text)
              .join("\n")
          : null;
      
      if (!content) return undefined;
      
      const ctx = hookCtx as { agentId?: string; sessionKey?: string };
      const agentId = resolveAgentId(ctx, undefined, logger);
      const result = engine.validateOutput(agentId, content);
      
      if (result.verdict === "block") {
        logger.warn(
          `[governance] Output blocked for ${agentId}: ${result.violations.map(v => v.reason).join("; ")}`,
        );
        return { block: true };
      }
      
      return undefined;
    } catch {
      // Fail open — never break message persistence
      return undefined;
    }
  };
}

// ── NEW: llm_output handler (informational only) ──

function handleLlmOutput(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (event: unknown, hookCtx: unknown): void => {
    if (!config.outputValidation.enabled) return;
    if (!config.outputValidation.hooks.llmOutput) return;
    
    try {
      const ev = event as { assistantTexts?: string[] };
      if (!ev.assistantTexts || ev.assistantTexts.length === 0) return;
      
      const ctx = hookCtx as { agentId?: string; sessionKey?: string };
      const agentId = resolveAgentId(ctx, undefined, logger);
      
      // Audit-only: detect and record but never block
      for (const text of ev.assistantTexts) {
        if (text.length >= (config.outputValidation.minTextLength ?? 10)) {
          engine.validateOutput(agentId, text, { auditOnly: true });
        }
      }
    } catch {
      // Never fail on informational hook
    }
  };
}

// ── MODIFIED: handleMessageSending ──
// Add output validation AFTER existing policy evaluation

function handleMessageSending(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return async (
    event: unknown,
    hookCtx: unknown,
  ): Promise<HookMessageSendingResult | undefined> => {
    try {
      const ev = event as HookMessageSendingEvent;
      const ctx = hookCtx as HookMessageContext;
      const evalCtx = buildMessageEvalContext(ev, ctx, config, engine, logger);
      
      // Step 1: Existing policy evaluation (unchanged)
      const verdict = await engine.evaluate(evalCtx);
      if (verdict.action === "deny") {
        return { cancel: true };
      }
      
      // Step 2: NEW — Output validation
      if (config.outputValidation.enabled && config.outputValidation.hooks.messageSending) {
        const agentId = evalCtx.agentId;
        const outputResult = engine.validateOutput(agentId, ev.content);
        
        if (outputResult.verdict === "block") {
          logger.warn(
            `[governance] Outbound message blocked for ${agentId}: ${outputResult.violations.map(v => v.reason).join("; ")}`,
          );
          return { cancel: true };
        }
        // "flag" → allow through (audit was already recorded by validateOutput)
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  };
}
```

**Modified hook registration:**

```diff
  export function registerGovernanceHooks(
    api: OpenClawPluginApi,
    engine: GovernanceEngine,
    config: GovernanceConfig,
  ): void {
    const logger = api.logger;

    // Primary enforcement
    api.on("before_tool_call", handleBeforeToolCall(engine, config, logger), { priority: 1000 });
    api.on("message_sending", handleMessageSending(engine, config, logger), { priority: 1000 });

+   // Output validation — message persistence (NEW)
+   api.on("before_message_write", handleBeforeMessageWrite(engine, config, logger), { priority: 1000 });
+
+   // Output monitoring — LLM output (NEW, informational only)
+   api.on("llm_output", handleLlmOutput(engine, config, logger), { priority: 900 });

    // Trust feedback
    api.on("after_tool_call", handleAfterToolCall(engine, logger), { priority: 900 });

    // ...rest unchanged...
  }
```

**Lines added:** ~80

---

### 6.5 `src/audit-trail.ts` — Changes

**Minimal changes** — the `record()` method already accepts `AuditVerdict` and `AuditContext`. The new output validation verdicts and context fields flow through without structural changes.

**Add ISO 27001 controls for output validation:**

```typescript
// In deriveControls() — add output validation mappings:
function deriveControls(
  matchedPolicies: MatchedPolicy[],
  verdict: AuditVerdict,
  context: AuditContext,
): string[] {
  const controls = new Set<string>();
  
  // Existing: policy-level controls
  for (const mp of matchedPolicies) {
    for (const c of mp.controls) {
      controls.add(c);
    }
  }
  
  // Existing: deny always includes incident controls
  if (verdict === "deny") {
    controls.add("A.5.24");
    controls.add("A.5.28");
  }
  
  // NEW: output validation controls
  if (context.outputValidation) {
    controls.add("A.8.10");  // Information deletion (validates before propagation)
    if (verdict === "output_flag" || verdict === "output_block") {
      controls.add("A.5.24");  // Incident management
    }
    if (verdict === "output_block") {
      controls.add("A.5.28");  // Evidence collection
    }
  }
  
  return [...controls].sort();
}
```

**Lines added:** ~20

---

### 6.6 `openclaw.plugin.json` — Changes

Add the `outputValidation` section to the config schema:

```json
{
  "outputValidation": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "minTextLength": { "type": "number", "default": 10 },
      "exempt": { "type": "array", "items": { "type": "string" }, "default": [] },
      "trustExemptThreshold": { "type": "number", "default": 90 },
      "factRegistries": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "facts": { "type": "array", "items": { "type": "object" } },
            "enabled": { "type": "boolean", "default": true }
          },
          "required": ["id", "name", "facts"]
        },
        "default": []
      },
      "customDetectors": { "type": "array", "default": [] },
      "builtinDetectors": {
        "type": "object",
        "properties": {
          "systemState": { "type": "boolean", "default": true },
          "entityName": { "type": "boolean", "default": true },
          "existence": { "type": "boolean", "default": true },
          "operationalStatus": { "type": "boolean", "default": true },
          "selfReferential": { "type": "boolean", "default": true }
        }
      },
      "defaults": {
        "type": "object",
        "properties": {
          "unverifiedClaimPolicy": { "type": "string", "enum": ["ignore", "flag", "block"], "default": "flag" },
          "contradictionPolicy": { "type": "string", "enum": ["ignore", "flag", "block"], "default": "block" },
          "selfReferentialPolicy": { "type": "string", "enum": ["ignore", "flag", "block"], "default": "flag" }
        }
      },
      "agentOverrides": { "type": "array", "default": [] },
      "hooks": {
        "type": "object",
        "properties": {
          "messageSending": { "type": "boolean", "default": true },
          "beforeMessageWrite": { "type": "boolean", "default": true },
          "llmOutput": { "type": "boolean", "default": false }
        }
      },
      "performance": {
        "type": "object",
        "properties": {
          "maxEvalUs": { "type": "number", "default": 8000 },
          "maxClaimsPerOutput": { "type": "number", "default": 50 },
          "maxTextLength": { "type": "number", "default": 10000 }
        }
      }
    }
  }
}
```

---

## 7. Data Flow — Output Validation

### 7.1 Sub-Agent Output (before_message_write)

```
Sub-agent (trust 35) generates response:
  "The governance plugin doesn't exist yet. 
   Iulia mentioned we should build it."
         │
         ▼
┌────────────────────────────────────┐
│ OpenClaw: before_message_write     │
│ (priority 1000 = governance)       │
│ Event: { message: { role:          │
│   "assistant", content: "..." } }  │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ hooks.ts: handleBeforeMessageWrite │
│ 1. Check role === "assistant" ✅   │
│ 2. Extract text content            │
│ 3. Resolve agentId → "forge"       │
│ 4. engine.validateOutput("forge",  │
│    text)                           │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ output-validator.ts: validate()        │
│                                        │
│ 1. shouldValidate("forge", {score:35}) │
│    → true (not exempt, score < 90)     │
│                                        │
│ 2. claimDetector.detect(text)          │
│    → Claim 1: {                        │
│        category: "existence",          │
│        subject: "governance plugin",   │
│        assertion: "not_exists",        │
│        negative: true,                 │
│        confidence: 0.9                 │
│      }                                 │
│    → Claim 2: {                        │
│        category: "entity_name",        │
│        subject: "Iulia",               │
│        assertion: "name_reference",    │
│        confidence: 0.8                 │
│      }                                 │
│                                        │
│ 3. factChecker.check(claim1)           │
│    → { status: "contradicted",         │
│        factId: "governance-deployed",  │
│        expected: "exists",             │
│        claimed: "does not exist" }     │
│                                        │
│ 4. factChecker.check(claim2)           │
│    → { status: "contradicted",         │
│        factId: "irina-name",           │
│        expected: "Irina",              │
│        claimed: "Iulia" }              │
│                                        │
│ 5. getEffectivePolicies("forge",       │
│    {score:35, tier:"restricted"})      │
│    → contradictionPolicy: "block"      │
│                                        │
│ 6. Verdict: BLOCK                      │
│    → 2 high-severity violations        │
│                                        │
│ 7. Audit: output_block recorded        │
│    Trust: violation recorded            │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ Return { block: true }             │
│ → Message NOT written to JSONL     │
│ → Parent agent never sees it       │
│ → Sub-agent's false claims stopped │
└────────────────────────────────────┘
```

### 7.2 Main Agent Output (message_sending)

```
Main agent (trust 60) sends to Matrix:
  "The deploy pipeline is green and running."
         │
         ▼
┌────────────────────────────────────┐
│ OpenClaw: message_sending          │
│ (priority 1000 = governance)       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ hooks.ts: handleMessageSending         │
│                                        │
│ 1. Policy evaluation (existing)        │
│    → allow (no policy denies)          │
│                                        │
│ 2. Output validation (NEW)             │
│    → Claim: { category: "operational   │
│      _status", subject: "deploy        │
│      pipeline", assertion: "running" } │
│    → Fact check: fact "pipeline-status" │
│      says "operational" → CONFIRMED    │
│    → Verdict: PASS                     │
│                                        │
│ 3. Return undefined (allow delivery)   │
└────────────────────────────────────────┘
```

### 7.3 Monitoring Mode (llm_output)

```
Agent generates LLM response
         │
         ▼
┌────────────────────────────────────┐
│ OpenClaw: llm_output               │
│ (priority 900, void hook)          │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ hooks.ts: handleLlmOutput              │
│                                        │
│ 1. For each assistantText:             │
│    → engine.validateOutput(agentId,    │
│      text, { auditOnly: true })        │
│                                        │
│ 2. If violations found:               │
│    → Audit record written (flag/block  │
│      severity)                         │
│    → BUT output NOT blocked            │
│    → Monitor-only mode                 │
│                                        │
│ 3. Return void (can't modify output)   │
└────────────────────────────────────────┘
```

---

## 8. Configuration Resolution Changes

### 8.1 Example Production Configuration

```json
{
  "plugins": {
    "openclaw-governance": {
      "enabled": true,
      "timezone": "Europe/Berlin",
      "failMode": "open",
      "trust": {
        "defaults": {
          "main": 60,
          "forge": 45,
          "cerberus": 50,
          "atlas": 50,
          "leuko": 40,
          "stella": 35,
          "*": 10
        }
      },
      "builtinPolicies": {
        "nightMode": { "after": "23:00", "before": "08:00" },
        "credentialGuard": true,
        "productionSafeguard": true,
        "rateLimiter": { "maxPerMinute": 15 }
      },
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
                "subject": "(Irina|irina|Iulia|iulia|partner)",
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
              },
              {
                "id": "gateway-status",
                "category": "operational_status",
                "subject": "(gateway|openclaw|OpenClaw)",
                "subjectIsRegex": true,
                "value": { "type": "status", "status": "operational" }
              }
            ]
          }
        ],
        "agentOverrides": [
          { "agent": "main", "profile": "lenient" },
          { "agent": "forge", "profile": "standard" },
          { "agent": "cerberus", "profile": "standard" },
          { "agent": "*", "profile": "strict" }
        ],
        "hooks": {
          "messageSending": true,
          "beforeMessageWrite": true,
          "llmOutput": false
        }
      }
    }
  }
}
```

---

## 9. Testing Strategy — Output Validation

### 9.1 `test/claim-detector.test.ts`

```typescript
describe("ClaimDetector", () => {
  // ── System State Detector ──
  it("should detect 'X is not installed'");
  it("should detect 'X is running'");
  it("should detect 'cannot find X'");
  it("should detect 'X does not exist'");
  it("should NOT detect suggestions ('you might want to install X')");
  it("should NOT detect questions ('is X installed?')");
  it("should extract correct subject from compound noun phrases");
  
  // ── Entity Name Detector ──
  it("should detect 'the user is NAME'");
  it("should detect 'NAME created the feature'");
  it("should detect 'named NAME'");
  it("should NOT detect common words as names");
  it("should extract name from quoted strings");
  
  // ── Existence Detector ──
  it("should detect 'there is no X'");
  it("should detect 'feature X doesn't exist'");
  it("should detect 'we don't have X'");
  it("should detect 'X is missing'");
  
  // ── Operational Status Detector ──
  it("should detect 'pipeline is broken'");
  it("should detect 'service crashed'");
  it("should detect 'build failed'");
  it("should detect 'everything is down'");
  
  // ── Self-Referential Detector ──
  it("should detect 'my instructions say'");
  it("should detect 'I am an AI assistant'");
  it("should detect 'I was told to'");
  
  // ── Custom Detectors ──
  it("should apply custom detector patterns");
  it("should respect custom confidence levels");
  
  // ── Edge Cases ──
  it("should handle empty text");
  it("should handle text shorter than minLength");
  it("should handle text with special characters");
  it("should handle multiple claims in one text");
  it("should deduplicate overlapping claims");
  it("should respect maxClaimsPerOutput limit");
  
  // ── Performance ──
  it("should detect claims in 10k text in <5ms");
  it("should handle 100 custom detectors without degradation");
});
```

### 9.2 `test/fact-checker.test.ts`

```typescript
describe("FactChecker", () => {
  // ── Subject Matching ──
  it("should match exact subject (case-insensitive)");
  it("should match regex subject");
  it("should match partial subject (contains)");
  it("should not match unrelated subjects");
  
  // ── Existence Facts ──
  it("should confirm positive existence claim when fact says exists");
  it("should contradict negative existence claim when fact says exists");
  it("should confirm negative existence claim when fact says not exists");
  
  // ── State Facts ──
  it("should confirm 'installed' claim when fact says installed");
  it("should contradict 'not_installed' claim when fact says installed");
  
  // ── Name Facts ──
  it("should confirm correct name");
  it("should confirm alias as correct");
  it("should contradict wrong name (Iulia vs Irina)");
  
  // ── Status Facts ──
  it("should contradict 'broken' claim when fact says operational");
  it("should confirm 'broken' claim when fact says down");
  
  // ── Capability Facts ──
  it("should confirm supported capability claim");
  it("should contradict 'not supported' when fact says supported");
  
  // ── TTL ──
  it("should return expired_fact when fact has expired TTL");
  it("should return confirmed when fact TTL is still valid");
  
  // ── No Match ──
  it("should return no_fact_found when no fact matches");
  it("should return no_fact_found for unrelated category");
  
  // ── Registry Filtering ──
  it("should check only specified registries with checkWithRegistries()");
  it("should skip disabled registries");
  
  // ── Performance ──
  it("should check 50 claims against 100 facts in <2ms");
});
```

### 9.3 `test/output-validator.test.ts`

```typescript
describe("OutputValidator", () => {
  // ── Pipeline Flow ──
  it("should pass when text has no claims");
  it("should pass when text is below minLength");
  it("should pass when agent is exempt");
  it("should pass when trust is above exemptThreshold");
  it("should pass when all claims are confirmed by facts");
  it("should flag when unverified claim + flag policy");
  it("should block when claim contradicts fact + block policy");
  it("should flag self-referential claim with flag policy");
  it("should block self-referential claim with block policy");
  
  // ── Trust-Proportional Behavior ──
  it("should apply strict policies for untrusted agents (trust 10)");
  it("should apply standard policies for standard agents (trust 45)");
  it("should apply lenient policies for trusted agents (trust 65)");
  it("should skip validation for privileged agents above threshold");
  
  // ── Per-Agent Overrides ──
  it("should apply agent-specific override");
  it("should apply glob pattern override");
  it("should apply profile template override");
  it("should prefer specific agent match over glob");
  
  // ── Multiple Claims ──
  it("should use worst-wins for multiple violations");
  it("should block if any violation is block-level");
  it("should flag if any violation is flag-level and none block");
  
  // ── Audit-Only Mode ──
  it("should never return 'block' in auditOnly mode");
  it("should still detect and report violations in auditOnly mode");
  
  // ── Performance ──
  it("should validate 2000-char text with 5 claims in <10ms");
  it("should bail out gracefully when maxEvalUs exceeded");
  
  // ── Anti-Pattern Coverage ──
  it("should catch 'X is not installed' with system-state fact");
  it("should catch Irina→Iulia name substitution");
  it("should catch 'feature doesn't exist' with existence fact");
  it("should catch 'pipeline is broken' with status fact");
  it("should catch sub-agent self-reflection");
});
```

### 9.4 Integration Tests

Add to `test/integration.test.ts`:

```typescript
describe("Output Validation Integration", () => {
  it("should block sub-agent output that contradicts facts (before_message_write)");
  it("should flag main agent output with unverified claims (message_sending)");
  it("should record audit trail for flagged output");
  it("should record trust violation for contradicted claims");
  it("should not block when output validation is disabled");
  it("should compose correctly: policy allow + output block = blocked");
  it("should compose correctly: policy deny overrides output pass");
});
```

### 9.5 Test Coverage Targets

| Module | Lines | Functions | Branches |
|---|---|---|---|
| `claim-detector.ts` | 95% | 95% | 90% |
| `fact-checker.ts` | 95% | 95% | 90% |
| `output-validator.ts` | 90% | 90% | 85% |

---

## 10. Implementation Order

Forge MUST implement in this order. Each step builds on the previous.

### Phase 1: Types + Config (Foundation)

1. **`src/types.ts`** — Add all new types from Section 4
2. **`src/config.ts`** — Add `resolveOutputValidationConfig()` + defaults
3. **`test/config.test.ts`** — Add output validation config resolution tests

### Phase 2: Claim Detection (Core)

4. **`src/claim-detector.ts`** — Full implementation with all 5 builtin detectors + custom detector support
5. **`test/claim-detector.test.ts`** — All claim detection tests

### Phase 3: Fact Checking (Core)

6. **`src/fact-checker.ts`** — Fact registry management + claim validation
7. **`test/fact-checker.test.ts`** — All fact checking tests

### Phase 4: Output Validation Pipeline (Integration)

8. **`src/output-validator.ts`** — Pipeline orchestrator
9. **`test/output-validator.test.ts`** — All pipeline tests

### Phase 5: Hook Wiring (Integration)

10. **`src/engine.ts`** — Add `validateOutput()`, wire OutputValidator
11. **`src/hooks.ts`** — Add `handleBeforeMessageWrite`, `handleLlmOutput`, enhance `handleMessageSending`
12. **`src/audit-trail.ts`** — Extend AuditVerdict, add output validation controls
13. **`test/hooks.test.ts`** — Add new handler tests
14. **`test/integration.test.ts`** — Add output validation integration tests

### Phase 6: Config Schema + Docs

15. **`openclaw.plugin.json`** — Add `outputValidation` schema
16. **`package.json`** — Bump version to `0.2.0`

### Dependency Graph

```
Phase 1: types.ts → config.ts
                ↓
Phase 2: claim-detector.ts (depends on types)
                ↓
Phase 3: fact-checker.ts (depends on types)
                ↓
Phase 4: output-validator.ts (depends on claim-detector + fact-checker)
                ↓
Phase 5: engine.ts → hooks.ts → audit-trail.ts (depends on output-validator)
                ↓
Phase 6: plugin.json + package.json
```

---

## 11. Migration from v0.1.x

### 11.1 Breaking Changes

**None.** v0.2.0 is fully backward compatible with v0.1.x.

### 11.2 New Config Section

The `outputValidation` config section is optional. If absent, defaults are applied:
- Output validation is `enabled: true`
- No fact registries configured → claims are detected but unverifiable → `unverifiedClaimPolicy` defaults to `"flag"` → warnings in audit
- No blocking until fact registries are configured and `contradictionPolicy: "block"` is set

### 11.3 Audit Record Compatibility

New audit verdicts (`output_pass`, `output_flag`, `output_block`) are additive. Tools querying old verdicts continue to work. The new `outputValidation` field in `AuditContext` is optional.

### 11.4 Recommended Rollout

1. **Deploy v0.2.0** with default config (no fact registries) → monitoring only
2. **Review audit trail** → identify real hallucination patterns
3. **Curate fact registries** based on observed violations
4. **Configure per-agent overrides** → strict for sub-agents, lenient for main
5. **Enable blocking** → change `contradictionPolicy` from `"flag"` to `"block"`

### 11.5 Version Bump

```diff
- "version": "0.1.0"
+ "version": "0.2.0"
```

---

## Appendix: Regex Pattern Reference

All builtin detector patterns are listed here for Cerberus review and for operators who want to understand what triggers detection.

### System State Patterns

| Pattern | Matches | Doesn't Match |
|---|---|---|
| `{subject} is not installed` | "Node.js is not installed" | "make sure X is installed" |
| `{subject} is not running` | "Docker is not running" | "try running X" |
| `cannot find {subject}` | "cannot find docker" | "you can find it at..." |
| `{subject} does not exist` | "the file does not exist" | "if it doesn't exist, create it" |

### Entity Name Patterns

| Pattern | Matches | Doesn't Match |
|---|---|---|
| `user is {Name}` | "the user is Iulia" | "the user is authenticated" |
| `{Name} created` | "Albert created the repo" | "the function created a file" |

### Existence Patterns

| Pattern | Matches | Doesn't Match |
|---|---|---|
| `there is no {subject}` | "there is no governance plugin" | "there is no way to know" |
| `feature {name} doesn't exist` | "feature X doesn't exist" | "this feature doesn't exist yet in v3" |

### Operational Status Patterns

| Pattern | Matches | Doesn't Match |
|---|---|---|
| `pipeline is broken` | "the deploy pipeline is broken" | "if the pipeline is broken, check logs" |
| `{system} failed` | "the build failed" | "after the build failed, we fixed it" |

### Self-Referential Patterns

| Pattern | Matches | Doesn't Match |
|---|---|---|
| `my instructions say` | "my instructions say to..." | "the user's instructions say" |
| `I am an AI` | "I am an AI assistant" | "what if I am assigned to..." |
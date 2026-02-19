# RFC-002: Production Bugfixes — v0.1.1

**Author:** Atlas (Architect)  
**Date:** 2026-02-19  
**Status:** Draft  
**Package:** `@vainplex/openclaw-governance`  
**Repo:** `alberthild/vainplex-openclaw` → `packages/openclaw-governance`  
**Triggered by:** Production Audit (Albert + Claudia, 2026-02-18/19)

---

## Abstract

After 2 days in production (since 2026-02-18), the governance plugin exhibits 4 bugs that degrade trust-based enforcement, compliance auditability, and trust score learning. This RFC specifies root causes, fixes, and test requirements for each bug.

## Production Data Summary

| Metric | Value |
|---|---|
| Total audit records | 1,067 (899 Feb 18 + 168 Feb 19) |
| Records with `agentId: "unknown"` | 529 (49.6%) |
| Total denials | 14 (all `agentId: "unknown"`) |
| Trust agents with `successCount: 0` | 4 of 5 (`atlas`, `main`, `leuko`, `cerberus`) |
| `"unknown"` agent trust signals | `success: 340, violations: 32, streak: 6` |
| Controls `["A.8.3","A.8.5"]` | 1,030 of 1,067 records (96.5%) |

---

## Bug 1: `agentId: "unknown"` for ~50% of Audit Records

### Symptoms
- 529 of 1,067 audit entries have `agentId: "unknown"`, `sessionKey: "agent:unknown"`
- Trust scores accumulate on `"unknown"` instead of actual agents
- Trust-based policies (tier restrictions, agent-scoped rules) are ineffective for half of all evaluations

### Root Cause

**File:** `src/hooks.ts` → `buildToolEvalContext()` (line 21)  
**File:** `src/util.ts` → `extractAgentId()` (line 74)

```ts
// hooks.ts:21
const agentId = extractAgentId(hookCtx.sessionKey, hookCtx.agentId);
```

```ts
// util.ts:74
export function extractAgentId(sessionKey?: string, agentId?: string): string {
  if (agentId) return agentId;
  if (!sessionKey) return "unknown";
  // parse sessionKey...
}
```

OpenClaw's `HookToolContext` provides `agentId` and `sessionKey` as **optional** fields. In production, ~50% of hook calls arrive with **neither** field populated. This happens when:

1. **Sub-agents spawned via `sessions_spawn`** — the hook context may not propagate the parent's `agentId`
2. **Direct gateway calls** — some code paths in OpenClaw core don't set `agentId` on the hook context
3. **The `sessionKey` format varies** — not always `"agent:<name>"`; sometimes it's a UUID or session hash

The function falls through to `"unknown"` when both inputs are `undefined`.

### Fix Specification

**Strategy:** Multi-fallback agent ID resolution with broader context inspection.

1. **Extend `extractAgentId` with additional fallback sources:**
   ```
   Priority order:
   1. hookCtx.agentId (explicit)
   2. hookCtx.sessionKey → parse agent name
   3. hookCtx.sessionId → lookup in CrossAgentManager
   4. event metadata (if available) → event.agentId or event.metadata.agentId
   5. "unresolved" (not "unknown" — distinguishable in queries)
   ```

2. **In `buildToolEvalContext` and `buildMessageEvalContext`:** Pass the full `hookCtx` object to a new `resolveAgentId(hookCtx, event?)` function that tries all fallback paths.

3. **In `HookToolContext` type:** The type already has `agentId?` and `sessionKey?`. Add a JSDoc comment noting that both may be undefined and the plugin must handle this.

4. **Log a warning** when falling back to `"unresolved"` — this makes it visible in logs that OpenClaw isn't providing context, enabling upstream fixes.

### Files to Change

| File | Change |
|---|---|
| `src/util.ts` | Extend `extractAgentId()` → `resolveAgentId()` with multi-fallback |
| `src/hooks.ts` | Use `resolveAgentId()` in `buildToolEvalContext` and `buildMessageEvalContext` |
| `test/util.test.ts` | New tests for fallback chain |
| `test/hooks.test.ts` | Test with missing agentId/sessionKey |

### Test Requirements

- `resolveAgentId(undefined, undefined)` → `"unresolved"`
- `resolveAgentId(undefined, "atlas")` → `"atlas"`
- `resolveAgentId("agent:forge:abc", undefined)` → `"forge"` (existing)
- `resolveAgentId("abc-123-uuid", undefined)` → `"unresolved"` (UUID sessionKey)
- Warning logged when `"unresolved"` returned

---

## Bug 2: No Top-Level `reason` in Audit Records for Denials

### Symptoms
- 14 denials in 2 days, but no quick way to query WHY
- The `reason` is buried in `matchedPolicies[0].effect.reason`
- Compliance tools need a top-level `reason` field for direct grep/jq queries
- Report stated "`matchedPolicies` Array ist leer bei Denials" — **investigation shows this is NOT the case**: all 14 denials have `matchedPolicies` with `effect.reason` present. The actual problem is the missing top-level field.

### Root Cause

**File:** `src/audit-trail.ts` → `record()` method (line 62)  
**File:** `src/types.ts` → `AuditRecord` type (line 188)

The `AuditRecord` type has no `reason` field. The verdict reason (from `PolicyEvaluator.aggregateMatches()`) is passed to `engine.recordAudit()` via the `Verdict` object, but only `matchedPolicies` is forwarded to `AuditTrail.record()` — the top-level `verdict.reason` string is dropped.

```ts
// engine.ts:recordAudit — note: verdict.reason is NOT passed
this.auditTrail.record(
  verdict.action as AuditVerdict,
  auditCtx, verdict.trust,
  { level: risk.level, score: risk.score },
  verdict.matchedPolicies, elapsedUs,
);
```

### Fix Specification

1. **Add `reason` field to `AuditRecord` type:**
   ```ts
   export type AuditRecord = {
     // ...existing fields...
     reason: string;        // NEW: top-level deny/allow reason
   };
   ```

2. **Pass `verdict.reason` through to `AuditTrail.record()`:**
   - Add `reason: string` parameter to `AuditTrail.record()` method signature
   - Update the call in `engine.ts` → `recordAudit()` to pass `verdict.reason`
   - Update the call in `engine.ts` → `handleEvalError()` to pass the fallback reason

3. **Write `reason` into the `AuditRecord`:**
   ```ts
   const rec: AuditRecord = {
     // ...existing...
     reason: reason,  // NEW
   };
   ```

### Files to Change

| File | Change |
|---|---|
| `src/types.ts` | Add `reason: string` to `AuditRecord` |
| `src/audit-trail.ts` | Add `reason` param to `record()`, include in record |
| `src/engine.ts` | Pass `verdict.reason` in `recordAudit()` and `handleEvalError()` |
| `test/audit-trail.test.ts` | Verify `reason` field present in records |
| `test/engine.test.ts` | Verify denial audit records have non-empty reason |

### Test Requirements

- Denial audit record has `reason: "Production Safeguard: ..."` (not empty)
- Allow audit record has `reason: "No matching policies"` or `"Allowed by governance policy"`
- Error fallback has `reason: "Governance engine error (fail-open)"` or `"...(fail-closed)"`
- `query()` results include `reason` field

---

## Bug 3: Trust Scores Don't Update (Static Signals)

### Symptoms
- Trust store: `atlas`, `main`, `leuko`, `cerberus` all have `successCount: 0, violationCount: 0, cleanStreak: 0`
- Only `"unknown"` has learning signals (`success: 340, violations: 32, streak: 6`)
- Trust is supposed to learn from governance evaluations, not just tool outcomes

### Root Cause

**File:** `src/hooks.ts` → `handleAfterToolCall()` (line 100)  
**File:** `src/engine.ts` → `recordOutcome()` (line 115)

The trust learning path works like this:

```
after_tool_call hook → handleAfterToolCall() → engine.recordOutcome()
  → trustManager.recordSuccess() / recordViolation()
```

This path IS connected and working — but it only fires for `after_tool_call` events. The problem is **twofold**:

1. **Bug 1 cascades:** Because `agentId` resolves to `"unknown"` for ~50% of calls, `recordOutcome("unknown", ...)` updates the wrong agent. The `"unknown"` entry HAS 340 successes — that's all the learning that went to the wrong agent.

2. **`recordOutcome` uses tool success/failure, not governance verdict:** `ev.error` indicates whether the TOOL errored, not whether governance allowed/denied it. A governance `allow` followed by a successful tool call correctly calls `recordSuccess`, but since `agentId` is `"unknown"`, it goes to the wrong agent.

3. **No learning from `before_tool_call` denials:** When governance denies a tool call, `after_tool_call` never fires (the tool was blocked). So denials DON'T trigger `recordViolation`. The 32 violations on `"unknown"` come from tools that were ALLOWED but then threw errors.

### Fix Specification

1. **Fix Bug 1 first** — this is the primary cause. Once `agentId` resolves correctly, the existing `after_tool_call` → `recordOutcome` path will update the right agents.

2. **Add learning from governance denials:** In `engine.runPipeline()`, after evaluating, if the verdict is `deny`, call `recordOutcome(ctx.agentId, ctx.toolName, false)`:

   ```ts
   // engine.ts:runPipeline
   private runPipeline(ctx: EvaluationContext, startUs: number): Verdict {
     // ...existing evaluation...
     
     // NEW: Trust learning from governance verdict
     if (verdict.action === "deny") {
       this.recordOutcome(ctx.agentId, ctx.toolName ?? "unknown", false);
     }
     
     this.recordAudit(enrichedCtx, verdict, risk, elapsedUs);
     return verdict;
   }
   ```

3. **Ensure `after_tool_call` only counts as success for governance-allowed calls** (current behavior is correct — `after_tool_call` only fires for allowed calls, and tool errors count as violations).

4. **Add `ageDays` recalculation on load:** Currently `ageDays` stays 0 because `recalculate()` computes it from `created` time, but `created` was set when the agent was first seen. The `recalculate()` call happens in `recordSuccess`/`recordViolation`, but not on `load()`. Add an `ageDays` refresh in `TrustManager.load()`:

   ```ts
   // trust-manager.ts:load
   load(): void {
     // ...existing load...
     this.refreshAgeDays(); // NEW
   }
   
   private refreshAgeDays(): void {
     const now = Date.now();
     for (const agent of Object.values(this.store.agents)) {
       agent.signals.ageDays = Math.floor(
         (now - new Date(agent.created).getTime()) / (1000 * 60 * 60 * 24)
       );
     }
   }
   ```

### Files to Change

| File | Change |
|---|---|
| `src/engine.ts` | Add denial → `recordOutcome` call in `runPipeline()` |
| `src/trust-manager.ts` | Add `refreshAgeDays()` called from `load()` |
| `test/engine.test.ts` | Verify denial triggers `recordViolation` |
| `test/trust-manager.test.ts` | Verify `ageDays` refreshed on load |

### Test Requirements

- After governance deny: agent's `violationCount` incremented, `cleanStreak` reset to 0
- After governance allow + successful tool: agent's `successCount` incremented, `cleanStreak` incremented
- After `load()`: agents with `created` 2 days ago have `ageDays: 2`
- Trust score recalculated after each learning event (not static)

---

## Bug 4: ISO 27001 Controls Are Hardcoded by Hook, Not by Policy

### Symptoms
- 1,030 of 1,067 records have `controls: ["A.8.3", "A.8.5"]` — regardless of which policy matched
- 23 message_sending records have `["A.5.14"]`
- 14 denial records have `["A.5.24", "A.5.28", "A.8.3", "A.8.5"]` (deny controls appended to hook controls)
- Credential Guard should map to A.8.11 (Data masking), not A.8.3/A.8.5
- Night Mode should map to A.7.1 (Working hours), not A.8.3/A.8.5
- Production Safeguard should map to A.8.31 (Change management)
- Users with SOC 2, NIS2, GDPR need custom control IDs

### Root Cause

**File:** `src/audit-trail.ts` → lines 22-35

```ts
const ISO_CONTROLS_MAP: Record<string, string[]> = {
  before_tool_call: ["A.8.3", "A.8.5"],
  message_sending: ["A.5.14"],
  trust_adjustment: ["A.5.15", "A.8.2"],
  violation: ["A.5.24", "A.5.28"],
  config_change: ["A.8.9"],
};

function getControls(hook: string, verdict: AuditVerdict): string[] {
  const controls = ISO_CONTROLS_MAP[hook] ?? [];
  if (verdict === "deny") {
    return [...controls, "A.5.24", "A.5.28"];
  }
  return controls;
}
```

Controls are derived from the **hook name** and **verdict**, not from the **matched policy**. This means:
- Every `before_tool_call` gets `A.8.3, A.8.5` regardless of which policy matched
- The actual policy (Credential Guard vs Night Mode vs Rate Limiter) is irrelevant
- Users cannot configure their own compliance framework control IDs

### Fix Specification

**Strategy:** Move control mapping from hook-level to policy-level. Policies own their controls. Builtin policies get sensible defaults. The hardcoded `ISO_CONTROLS_MAP` is removed.

1. **Add `controls` field to `Policy` type:**
   ```ts
   export type Policy = {
     // ...existing fields...
     controls?: string[];  // NEW: compliance control IDs (ISO 27001, SOC 2, etc.)
   };
   ```

2. **Add `controls` field to `MatchedPolicy` type:**
   ```ts
   export type MatchedPolicy = {
     policyId: string;
     ruleId: string;
     effect: RuleEffect;
     controls: string[];   // NEW: inherited from parent Policy
   };
   ```

3. **Populate `controls` in `PolicyEvaluator.matchPolicy()`:**
   ```ts
   private matchPolicy(policy: Policy, ctx, deps): MatchedPolicy | null {
     for (const rule of policy.rules) {
       // ...existing matching...
       if (evaluateConditions(...)) {
         return {
           policyId: policy.id,
           ruleId: rule.id,
           effect: rule.effect,
           controls: policy.controls ?? [],  // NEW
         };
       }
     }
     return null;
   }
   ```

4. **Update `AuditTrail.record()` to derive controls from matched policies:**
   ```ts
   // Replace ISO_CONTROLS_MAP + getControls with:
   function deriveControls(matchedPolicies: MatchedPolicy[], verdict: AuditVerdict): string[] {
     const controls = new Set<string>();
     for (const mp of matchedPolicies) {
       for (const c of mp.controls) {
         controls.add(c);
       }
     }
     // Deny always includes incident controls (A.5.24, A.5.28) as baseline
     if (verdict === "deny") {
       controls.add("A.5.24");
       controls.add("A.5.28");
     }
     return [...controls].sort();
   }
   ```

5. **Add default controls to builtin policies:**

   | Builtin Policy | Default Controls |
   |---|---|
   | Night Mode | `["A.7.1", "A.6.2"]` (working hours, remote working) |
   | Credential Guard | `["A.8.11", "A.8.4", "A.5.33"]` (data masking, access to source, protection of records) |
   | Production Safeguard | `["A.8.31", "A.8.32", "A.8.9"]` (change management, change control, config management) |
   | Rate Limiter | `["A.8.6"]` (capacity management) |

6. **Remove `ISO_CONTROLS_MAP` and `getControls()` from `audit-trail.ts`.**

### Files to Change

| File | Change |
|---|---|
| `src/types.ts` | Add `controls?: string[]` to `Policy`, add `controls: string[]` to `MatchedPolicy` |
| `src/policy-evaluator.ts` | Pass `policy.controls` through to `MatchedPolicy` |
| `src/audit-trail.ts` | Remove `ISO_CONTROLS_MAP`, new `deriveControls()` function |
| `src/builtin-policies.ts` | Add `controls` arrays to each builtin policy |
| `test/audit-trail.test.ts` | Verify controls derived from policies, not hooks |
| `test/policy-evaluator.test.ts` | Verify `controls` in `MatchedPolicy` output |
| `test/builtin-policies.test.ts` | Verify each builtin has controls |

### Test Requirements

- Credential Guard denial → `controls` includes `A.8.11` (not `A.8.3`)
- Night Mode denial → `controls` includes `A.7.1`
- Custom policy with `controls: ["SOC2-CC6.1"]` → audit record includes `SOC2-CC6.1`
- Policy without `controls` → empty array (not hardcoded defaults)
- Denials always include `A.5.24, A.5.28` as baseline incident controls
- No record contains `A.8.3, A.8.5` unless a policy explicitly declares them

---

## Dependency Graph

```
Bug 1 (agentId resolution)
  ↓ unblocks
Bug 3 (trust learning) ← also needs denial-based learning
  
Bug 2 (audit reason) ← independent
Bug 4 (controls)      ← independent

Recommended implementation order:
  1. Bug 1 (agentId) — highest impact, unblocks Bug 3
  2. Bug 4 (controls) — independent, biggest code change
  3. Bug 2 (audit reason) — small, surgical
  4. Bug 3 (trust learning) — depends on Bug 1 being merged
```

## Migration Notes

- **Audit format change (Bugs 2 + 4):** New fields (`reason`, different `controls`) mean audit records before/after v0.1.1 have different shapes. The `query()` method should handle missing `reason` gracefully for old records.
- **Trust store:** After Bug 1 fix, the `"unknown"` agent entry in `trust.json` should be cleaned up (signals redistributed or reset). Add a one-time migration in `TrustManager.load()`.
- **No config breaking changes.** The new `controls` field on policies is optional. Existing policy configs work unchanged.

## Version

These fixes constitute **v0.1.1** — patch release. No API breaking changes.

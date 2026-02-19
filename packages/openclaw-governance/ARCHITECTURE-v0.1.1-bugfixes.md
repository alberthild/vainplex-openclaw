# Architecture: v0.1.1 Production Bugfixes

**Package:** `@vainplex/openclaw-governance`  
**RFC:** RFC-002-production-bugfixes.md  
**Date:** 2026-02-19  
**Scope:** 4 bugs, 8 source files, 6 test files

---

## 1. Change Map

### 1.1 Files to Modify

| # | File | Bug(s) | Change Summary |
|---|---|---|---|
| 1 | `src/types.ts` | 2, 4 | Add `reason` to `AuditRecord`, `controls` to `Policy` + `MatchedPolicy` |
| 2 | `src/util.ts` | 1 | New `resolveAgentId()` with multi-fallback chain |
| 3 | `src/hooks.ts` | 1 | Use `resolveAgentId()` in context builders |
| 4 | `src/engine.ts` | 2, 3 | Pass reason to audit, add denial learning |
| 5 | `src/policy-evaluator.ts` | 4 | Propagate `policy.controls` into `MatchedPolicy` |
| 6 | `src/audit-trail.ts` | 2, 4 | Add `reason` param, replace `ISO_CONTROLS_MAP` with `deriveControls()` |
| 7 | `src/builtin-policies.ts` | 4 | Add `controls` arrays to all 4 builtin policies |
| 8 | `src/trust-manager.ts` | 3 | Add `refreshAgeDays()` on load |

### 1.2 Files to Modify (Tests)

| # | File | Bug(s) | Test Coverage |
|---|---|---|---|
| 1 | `test/util.test.ts` | 1 | `resolveAgentId` fallback chain |
| 2 | `test/hooks.test.ts` | 1 | Hook context with missing agentId |
| 3 | `test/engine.test.ts` | 2, 3 | Audit reason propagation, denial learning |
| 4 | `test/audit-trail.test.ts` | 2, 4 | Reason field, policy-based controls |
| 5 | `test/policy-evaluator.test.ts` | 4 | Controls in MatchedPolicy |
| 6 | `test/trust-manager.test.ts` | 3 | ageDays refresh, learning after deny |

---

## 2. Bug 1: Agent ID Resolution

### 2.1 Current Flow

```
HookToolContext { agentId?: string, sessionKey?: string }
        │
        ▼
extractAgentId(sessionKey, agentId)
        │
        ├─ agentId present? → return agentId ✓
        ├─ sessionKey present? → parse "agent:NAME" → return NAME ✓
        └─ both undefined? → return "unknown" ✗ (BUG)
```

### 2.2 New Flow

```
HookToolContext { agentId?, sessionKey?, sessionId? }
HookBeforeToolCallEvent { toolName, params, metadata? }
        │
        ▼
resolveAgentId(hookCtx, event?)
        │
        ├─ 1. hookCtx.agentId → return directly
        ├─ 2. hookCtx.sessionKey → parse agent name (existing logic)
        ├─ 3. hookCtx.sessionId → extract if contains agent hint
        ├─ 4. event?.metadata?.agentId → check event metadata
        └─ 5. return "unresolved" + log warning
```

### 2.3 Code: `src/util.ts`

**Add new function** (keep `extractAgentId` for backward compat, mark deprecated):

```ts
/**
 * Resolve agent ID from hook context with multi-source fallback.
 * Returns "unresolved" (not "unknown") when all sources fail.
 */
export function resolveAgentId(
  hookCtx: { agentId?: string; sessionKey?: string; sessionId?: string },
  event?: { metadata?: Record<string, unknown> },
  logger?: { warn: (msg: string) => void },
): string {
  // 1. Explicit agentId
  if (hookCtx.agentId) return hookCtx.agentId;

  // 2. Parse from sessionKey
  if (hookCtx.sessionKey) {
    const parsed = parseAgentFromSessionKey(hookCtx.sessionKey);
    if (parsed) return parsed;
  }

  // 3. Parse from sessionId (some OpenClaw paths use sessionId with agent hint)
  if (hookCtx.sessionId) {
    const parsed = parseAgentFromSessionKey(hookCtx.sessionId);
    if (parsed) return parsed;
  }

  // 4. Check event metadata
  if (event?.metadata?.agentId && typeof event.metadata.agentId === "string") {
    return event.metadata.agentId;
  }

  // 5. Fallback
  logger?.warn(
    `[governance] Could not resolve agentId from context: ` +
    `sessionKey=${hookCtx.sessionKey ?? "none"}, ` +
    `sessionId=${hookCtx.sessionId ?? "none"}`
  );
  return "unresolved";
}

/**
 * Parse agent name from a session key string.
 * Returns null if the key doesn't contain a parseable agent name.
 *
 * Patterns:
 *   "agent:NAME" → NAME
 *   "agent:NAME:subagent:CHILD:..." → CHILD
 *   UUID or unparseable → null
 */
function parseAgentFromSessionKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    if (parts.length >= 4 && parts[2] === "subagent") {
      return parts[3] || null;
    }
    return parts[1] || null;
  }
  return null;
}
```

### 2.4 Code: `src/hooks.ts`

**Replace `extractAgentId` calls with `resolveAgentId`:**

```ts
// buildToolEvalContext — BEFORE:
const agentId = extractAgentId(hookCtx.sessionKey, hookCtx.agentId);

// AFTER:
const agentId = resolveAgentId(hookCtx, event as { metadata?: Record<string, unknown> }, logger);
```

Where `logger` is the plugin logger, passed into `buildToolEvalContext` as an additional parameter or captured in a closure.

**Implementation approach:** Add `logger` to the `buildToolEvalContext` and `buildMessageEvalContext` parameter lists:

```ts
function buildToolEvalContext(
  event: HookBeforeToolCallEvent,
  hookCtx: HookToolContext,
  config: GovernanceConfig,
  engine: GovernanceEngine,
  logger: PluginLogger,             // NEW
) {
  const agentId = resolveAgentId(hookCtx, undefined, logger);
  // ...rest unchanged
}
```

Update `handleBeforeToolCall`, `handleMessageSending`, `handleAfterToolCall`, and `handleBeforeAgentStart` to pass `config` or a captured `logger`.

**For `buildMessageEvalContext`:** Currently hardcodes `agentId = "main"`. Replace with:

```ts
// BEFORE:
const agentId = "main";

// AFTER:
const agentId = resolveAgentId(hookCtx, event as { metadata?: Record<string, unknown> }, logger);
```

**For `handleAfterToolCall`:** Currently calls `extractAgentId(ctx.sessionKey, ctx.agentId)`. Replace with `resolveAgentId(ctx)`.

**For `handleSessionStart`:** Currently calls `extractAgentId(undefined, ctx.agentId)`. Replace with `resolveAgentId(ctx)`.

---

## 3. Bug 2: Audit Record Missing `reason` Field

### 3.1 Type Change: `src/types.ts`

```ts
export type AuditRecord = {
  id: string;
  timestamp: number;
  timestampIso: string;
  verdict: AuditVerdict;
  reason: string;           // NEW — top-level verdict reason
  context: AuditContext;
  trust: { score: number; tier: TrustTier };
  risk: { level: RiskLevel; score: number };
  matchedPolicies: MatchedPolicy[];
  evaluationUs: number;
  controls: string[];
};
```

### 3.2 Code: `src/audit-trail.ts` → `record()` method

**Add `reason` parameter:**

```ts
record(
  verdict: AuditVerdict,
  reason: string,           // NEW parameter (position 2)
  context: AuditContext,
  trust: { score: number; tier: TrustTier },
  risk: { level: RiskLevel; score: number },
  matchedPolicies: MatchedPolicy[],
  evaluationUs: number,
): AuditRecord {
  // ...
  const rec: AuditRecord = {
    id: randomUUID(),
    timestamp: now,
    timestampIso: new Date(now).toISOString(),
    verdict,
    reason,                 // NEW
    context: redacted,
    trust,
    risk,
    matchedPolicies,
    evaluationUs,
    controls: deriveControls(matchedPolicies, verdict),  // changed for Bug 4
  };
  // ...
}
```

### 3.3 Code: `src/engine.ts` → callers

**`recordAudit` method:**

```ts
private recordAudit(
  ctx: EvaluationContext,
  verdict: Verdict,
  risk: { level: RiskLevel; score: number },
  elapsedUs: number,
): void {
  if (!this.config.audit.enabled) return;
  // ...build auditCtx...
  this.auditTrail.record(
    verdict.action as AuditVerdict,
    verdict.reason,             // NEW — pass reason
    auditCtx, verdict.trust,
    { level: risk.level, score: risk.score },
    verdict.matchedPolicies, elapsedUs,
  );
}
```

**`handleEvalError` method:**

```ts
private handleEvalError(e: unknown, ctx: EvaluationContext, startUs: number): Verdict {
  // ...
  const reason = fallback === "deny"
    ? "Governance engine error (fail-closed)"
    : "Governance engine error (fail-open)";

  if (this.config.audit.enabled) {
    this.auditTrail.record(
      "error_fallback",
      reason,                   // NEW
      { hook: ctx.hook, agentId: ctx.agentId, sessionKey: ctx.sessionKey, toolName: ctx.toolName },
      ctx.trust, { level: "critical", score: 100 }, [], elapsedUs,
    );
  }
  // ...
}
```

---

## 4. Bug 3: Trust Learning from Governance Denials

### 4.1 Code: `src/engine.ts` → `runPipeline()`

**Add denial learning BEFORE audit recording:**

```ts
private runPipeline(ctx: EvaluationContext, startUs: number): Verdict {
  const enrichedCtx = this.crossAgentManager.enrichContext(ctx);
  this.frequencyTracker.record({
    timestamp: Date.now(),
    agentId: enrichedCtx.agentId,
    sessionKey: enrichedCtx.sessionKey,
    toolName: enrichedCtx.toolName,
  });

  const risk = this.riskAssessor.assess(enrichedCtx, this.frequencyTracker);
  const policies = this.crossAgentManager.resolveEffectivePolicies(
    enrichedCtx, this.policyIndex,
  );
  const evalResult = this.evaluator.evaluateWithDeps(
    enrichedCtx, policies, risk, this.buildDeps(risk),
  );

  const elapsedUs = nowUs() - startUs;
  const verdict: Verdict = {
    action: evalResult.action, reason: evalResult.reason, risk,
    matchedPolicies: evalResult.matches,
    trust: enrichedCtx.trust, evaluationUs: elapsedUs,
  };

  // NEW: Trust learning from governance denial
  if (verdict.action === "deny" && this.config.trust.enabled) {
    this.trustManager.recordViolation(
      enrichedCtx.agentId,
      `Policy denial: ${verdict.reason}`,
    );
  }

  this.recordAudit(enrichedCtx, verdict, risk, elapsedUs);
  return verdict;
}
```

**Important:** This means a governance denial now triggers TWO trust signals:
1. `recordViolation` in `runPipeline` (from governance denial)
2. No `after_tool_call` fires (tool was blocked)

For allows, `after_tool_call` fires and handles success/failure via `recordOutcome`. This is the correct split.

### 4.2 Code: `src/trust-manager.ts` → `load()`

**Add `refreshAgeDays()` call:**

```ts
load(): void {
  if (existsSync(this.filePath)) {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as TrustStore;
      this.store = parsed;
      this.applyDecay();
      this.refreshAgeDays();   // NEW
      this.logger.info(
        `[governance] Trust store loaded: ${Object.keys(this.store.agents).length} agents`,
      );
    } catch (e) {
      // ...existing error handling...
    }
  }
}

// NEW method
private refreshAgeDays(): void {
  const now = Date.now();
  for (const agent of Object.values(this.store.agents)) {
    const created = new Date(agent.created).getTime();
    if (!Number.isNaN(created)) {
      agent.signals.ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    }
  }
}
```

### 4.3 Trust Store Migration

**Add cleanup for `"unknown"` agent in `load()`:**

```ts
load(): void {
  // ...existing load...
  this.migrateUnknownAgent();  // NEW — one-time migration
}

// NEW method
private migrateUnknownAgent(): void {
  const unknown = this.store.agents["unknown"];
  if (!unknown) return;

  // Log the orphaned signals for visibility
  this.logger.warn(
    `[governance] Trust migration: "unknown" agent has ` +
    `${unknown.signals.successCount} successes, ` +
    `${unknown.signals.violationCount} violations — ` +
    `resetting (signals were misattributed due to agentId resolution bug)`
  );

  // Remove the "unknown" entry — signals can't be redistributed accurately
  delete this.store.agents["unknown"];
  this.dirty = true;
}
```

**Note:** The `"unresolved"` agent (new fallback name) will accumulate going forward but at a much lower rate once Bug 1 is fixed. This is intentional — it makes the remaining resolution failures visible.

---

## 5. Bug 4: Policy-Based Controls

### 5.1 Type Changes: `src/types.ts`

```ts
// Policy type — add controls
export type Policy = {
  id: string;
  name: string;
  version: string;
  description?: string;
  scope: PolicyScope;
  rules: Rule[];
  enabled?: boolean;
  priority?: number;
  controls?: string[];     // NEW — compliance control IDs
};

// MatchedPolicy type — add controls
export type MatchedPolicy = {
  policyId: string;
  ruleId: string;
  effect: RuleEffect;
  controls: string[];      // NEW — inherited from Policy
};
```

### 5.2 Code: `src/policy-evaluator.ts`

**Propagate `policy.controls` into `MatchedPolicy`:**

```ts
private matchPolicy(
  policy: Policy,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): MatchedPolicy | null {
  for (const rule of policy.rules) {
    if (rule.minTrust && !isTierAtLeast(ctx.trust.tier, rule.minTrust)) {
      continue;
    }
    if (rule.maxTrust && !isTierAtMost(ctx.trust.tier, rule.maxTrust)) {
      continue;
    }
    if (evaluateConditions(rule.conditions, ctx, deps, this.evaluators)) {
      return {
        policyId: policy.id,
        ruleId: rule.id,
        effect: rule.effect,
        controls: policy.controls ?? [],   // NEW
      };
    }
  }
  return null;
}
```

### 5.3 Code: `src/audit-trail.ts`

**Remove hardcoded map, add `deriveControls`:**

```ts
// DELETE these lines:
// const ISO_CONTROLS_MAP: Record<string, string[]> = { ... };
// function getControls(hook: string, verdict: AuditVerdict): string[] { ... }

// NEW:
function deriveControls(
  matchedPolicies: MatchedPolicy[],
  verdict: AuditVerdict,
): string[] {
  const controls = new Set<string>();
  for (const mp of matchedPolicies) {
    for (const c of mp.controls) {
      controls.add(c);
    }
  }
  // Denials always include incident response controls as baseline
  if (verdict === "deny") {
    controls.add("A.5.24");  // Information security incident management
    controls.add("A.5.28");  // Collection of evidence
  }
  return [...controls].sort();
}
```

**Update `record()` method to use `deriveControls`:**

```ts
// In record() method, replace:
controls: [...new Set(getControls(context.hook, verdict))],

// With:
controls: deriveControls(matchedPolicies, verdict),
```

### 5.4 Code: `src/builtin-policies.ts`

**Add `controls` arrays to each builtin policy:**

```ts
// Night Mode
return {
  id: "builtin-night-mode",
  name: "Night Mode",
  // ...existing...
  controls: ["A.7.1", "A.6.2"],  // NEW — Working hours, Remote working
  rules: [/* ...existing... */],
};

// Credential Guard
return {
  id: "builtin-credential-guard",
  name: "Credential Guard",
  // ...existing...
  controls: ["A.8.11", "A.8.4", "A.5.33"],  // NEW — Data masking, Access to source, Protection of records
  rules: [/* ...existing... */],
};

// Production Safeguard
return {
  id: "builtin-production-safeguard",
  name: "Production Safeguard",
  // ...existing...
  controls: ["A.8.31", "A.8.32", "A.8.9"],  // NEW — Change management, Change control, Config mgmt
  rules: [/* ...existing... */],
};

// Rate Limiter
return {
  id: "builtin-rate-limiter",
  name: "Rate Limiter",
  // ...existing...
  controls: ["A.8.6"],  // NEW — Capacity management
  rules: [/* ...existing... */],
};
```

---

## 6. Cross-Cutting: Updated Function Signatures

### 6.1 `AuditTrail.record()` — full new signature

```ts
record(
  verdict: AuditVerdict,
  reason: string,                                    // NEW (Bug 2)
  context: AuditContext,
  trust: { score: number; tier: TrustTier },
  risk: { level: RiskLevel; score: number },
  matchedPolicies: MatchedPolicy[],                  // MatchedPolicy now has controls (Bug 4)
  evaluationUs: number,
): AuditRecord
```

### 6.2 All callers of `AuditTrail.record()` must be updated

| Caller | File | Line | Change |
|---|---|---|---|
| `recordAudit()` | `src/engine.ts` | ~95 | Add `verdict.reason` as 2nd arg |
| `handleEvalError()` | `src/engine.ts` | ~118 | Add `reason` as 2nd arg |

### 6.3 All constructors of `MatchedPolicy` must include `controls`

| Constructor | File | Change |
|---|---|---|
| `matchPolicy()` | `src/policy-evaluator.ts` | Add `controls: policy.controls ?? []` |
| `handleEvalError()` | `src/engine.ts` | `matchedPolicies: []` — OK, empty array |
| Test fixtures | `test/*.test.ts` | Add `controls: []` or `controls: ["A.8.3"]` |

---

## 7. Test Specifications

### 7.1 `test/util.test.ts` — New tests for `resolveAgentId`

```ts
describe("resolveAgentId", () => {
  test("returns agentId when provided", () => {
    expect(resolveAgentId({ agentId: "atlas" })).toBe("atlas");
  });

  test("parses from sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "agent:forge:abc" })).toBe("forge");
  });

  test("parses subagent from sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "agent:main:subagent:forge:abc" })).toBe("forge");
  });

  test("returns 'unresolved' when both undefined", () => {
    expect(resolveAgentId({})).toBe("unresolved");
  });

  test("returns 'unresolved' for UUID sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "78b1f33b-e9a4-4eae-8341-7c57bbc69843" })).toBe("unresolved");
  });

  test("uses event metadata as fallback", () => {
    expect(resolveAgentId({}, { metadata: { agentId: "forge" } })).toBe("forge");
  });

  test("logs warning when unresolved", () => {
    const warnings: string[] = [];
    resolveAgentId({}, undefined, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Could not resolve agentId");
  });

  test("agentId takes priority over sessionKey", () => {
    expect(resolveAgentId({ agentId: "atlas", sessionKey: "agent:forge" })).toBe("atlas");
  });
});
```

### 7.2 `test/engine.test.ts` — New tests

```ts
describe("denial trust learning (Bug 3)", () => {
  test("governance denial increments violationCount", async () => {
    // Setup: policy that denies a specific tool
    // Evaluate with that tool
    // Assert: agent trust has violationCount: 1, cleanStreak: 0
  });

  test("governance allow does NOT increment successCount (left to after_tool_call)", async () => {
    // Evaluate with allowed tool
    // Assert: agent trust still has successCount: 0
    // (success only comes from after_tool_call)
  });
});

describe("audit reason propagation (Bug 2)", () => {
  test("denial audit record has top-level reason", async () => {
    // Evaluate denied tool call
    // Query audit trail
    // Assert: record.reason === "Production Safeguard: ..."
  });

  test("allow audit record has reason", async () => {
    // Evaluate allowed tool call
    // Query audit trail
    // Assert: record.reason contains "No matching policies" or similar
  });

  test("error fallback audit record has reason", async () => {
    // Force evaluation error
    // Assert: record.reason contains "Governance engine error"
  });
});
```

### 7.3 `test/audit-trail.test.ts` — Updated tests

```ts
describe("deriveControls (Bug 4)", () => {
  test("controls come from matched policies", () => {
    const matchedPolicies = [{
      policyId: "builtin-credential-guard",
      ruleId: "block-credential-read",
      effect: { action: "deny", reason: "blocked" },
      controls: ["A.8.11", "A.8.4"],
    }];
    // Record with these matchedPolicies
    // Assert: record.controls includes "A.8.11" and "A.8.4"
  });

  test("denials include baseline incident controls", () => {
    // Record a denial
    // Assert: record.controls includes "A.5.24" and "A.5.28"
  });

  test("allows with no policies have empty controls", () => {
    // Record an allow with empty matchedPolicies
    // Assert: record.controls is []
  });

  test("custom SOC 2 controls propagated", () => {
    const matchedPolicies = [{
      policyId: "custom-soc2",
      ruleId: "r1",
      effect: { action: "audit" },
      controls: ["SOC2-CC6.1", "SOC2-CC7.2"],
    }];
    // Assert: record.controls includes "SOC2-CC6.1"
  });
});

describe("reason field (Bug 2)", () => {
  test("record includes reason", () => {
    const rec = auditTrail.record(
      "deny",
      "Night mode active",  // reason
      { hook: "before_tool_call", agentId: "test", sessionKey: "agent:test" },
      { score: 50, tier: "standard" },
      { level: "low", score: 10 },
      [],
      100,
    );
    expect(rec.reason).toBe("Night mode active");
  });
});
```

### 7.4 `test/trust-manager.test.ts` — New tests

```ts
describe("refreshAgeDays (Bug 3)", () => {
  test("ageDays calculated on load", () => {
    // Create trust.json with agent created 3 days ago
    // Load trust manager
    // Assert: agent.signals.ageDays === 3
  });
});

describe("unknown agent migration (Bug 3)", () => {
  test("removes 'unknown' agent on load", () => {
    // Create trust.json with "unknown" agent entry
    // Load trust manager
    // Assert: store.agents["unknown"] is undefined
  });

  test("logs warning about migration", () => {
    // Create trust.json with "unknown" agent with signals
    // Load trust manager
    // Assert: logger.warn was called with migration message
  });
});
```

---

## 8. Affected Existing Tests

The following existing test files may need updates due to changed signatures:

| Test File | Required Update |
|---|---|
| `test/policy-evaluator.test.ts` | `MatchedPolicy` assertions need `controls` field |
| `test/engine.test.ts` | `AuditTrail.record` mock needs `reason` param |
| `test/audit-trail.test.ts` | `record()` calls need `reason` param added |
| `test/hooks.test.ts` | May need logger mock for `resolveAgentId` |

**Strategy:** Update all existing test fixtures to include the new fields with sensible defaults (`controls: []`, `reason: "test"`) before adding new test cases.

---

## 9. Implementation Order

```
Step 1: src/types.ts
  ├── Add reason to AuditRecord
  ├── Add controls to Policy
  └── Add controls to MatchedPolicy

Step 2: src/util.ts
  └── Add resolveAgentId() + parseAgentFromSessionKey()

Step 3: src/builtin-policies.ts
  └── Add controls arrays to all 4 builtins

Step 4: src/policy-evaluator.ts
  └── Propagate policy.controls into MatchedPolicy

Step 5: src/audit-trail.ts
  ├── Add reason param to record()
  ├── Remove ISO_CONTROLS_MAP + getControls
  └── Add deriveControls()

Step 6: src/engine.ts
  ├── Pass verdict.reason to auditTrail.record()
  └── Add denial → trustManager.recordViolation() in runPipeline()

Step 7: src/hooks.ts
  ├── Import resolveAgentId
  ├── Update buildToolEvalContext
  ├── Update buildMessageEvalContext
  ├── Update handleAfterToolCall
  └── Update handleSessionStart

Step 8: src/trust-manager.ts
  ├── Add refreshAgeDays()
  ├── Add migrateUnknownAgent()
  └── Call both from load()

Step 9: Update all test files
```

---

## 10. Risk Assessment

| Risk | Mitigation |
|---|---|
| Audit format change breaks downstream parsers | `reason` field is additive. Old records without it return `undefined` on access. `query()` method works unchanged. |
| `"unknown"` → `"unresolved"` rename may confuse monitoring | One-time migration removes `"unknown"`. Log message explains. |
| Trust double-counting (denial in runPipeline + error in after_tool_call) | `after_tool_call` doesn't fire for blocked tools. No double-count. |
| `controls: []` on MatchedPolicy breaks existing test assertions | Update fixtures in Step 9 before new tests. |
| `deriveControls` returns empty array for allows with no policies | Correct behavior. Empty controls = no compliance relevance for that evaluation. |

---

## 11. Verification Checklist

After implementation, verify against production data patterns:

- [ ] `grep '"unresolved"' audit/*.jsonl | wc -l` should be << 50% (vs 49.6% "unknown" before)
- [ ] `grep '"deny"' audit/*.jsonl | python3 -c "import json,sys; [print(json.loads(l).get('reason','MISSING')) for l in sys.stdin]"` — no "MISSING"
- [ ] Trust store: no `"unknown"` entry, named agents have non-zero `successCount`
- [ ] `grep 'A.8.3' audit/*.jsonl | wc -l` should be 0 (no more hardcoded controls)
- [ ] Credential Guard denials have `A.8.11` in controls
- [ ] Night Mode denials have `A.7.1` in controls

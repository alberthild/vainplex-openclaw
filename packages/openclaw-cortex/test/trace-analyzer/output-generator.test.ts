import { describe, it, expect } from "vitest";
import { generateOutputs } from "../../src/trace-analyzer/output-generator.js";
import type { Finding, FindingClassification } from "../../src/trace-analyzer/signals/types.js";

// ---- Test helpers ----

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `finding-${Math.random().toString(36).slice(2, 10)}`,
    chainId: "chain-1",
    agent: "main",
    session: "test-session",
    signal: {
      signal: "SIG-TOOL-FAIL",
      severity: "medium",
      eventRange: { start: 0, end: 1 },
      summary: "Tool exec failed without recovery",
      evidence: { toolName: "exec" },
    },
    detectedAt: Date.now(),
    occurredAt: 1700000000000,
    classification: null,
    ...overrides,
  };
}

function makeClassification(overrides: Partial<FindingClassification> = {}): FindingClassification {
  return {
    rootCause: "Agent retried without changing approach",
    actionType: "soul_rule",
    actionText: "NIEMALS denselben Befehl 3× wiederholen — stattdessen Strategie wechseln. [Grund: Doom Loop]",
    confidence: 0.85,
    model: "gpt-4o",
    ...overrides,
  };
}

// ---- Tests ----

describe("generateOutputs()", () => {
  it("returns empty array for empty findings", () => {
    expect(generateOutputs([])).toEqual([]);
  });

  it("returns empty array when no findings have classification", () => {
    const findings = [makeFinding(), makeFinding()];
    expect(generateOutputs(findings)).toEqual([]);
  });

  it("skips findings with manual_review actionType — no output generated", () => {
    const findings = [makeFinding({
      classification: makeClassification({ actionType: "manual_review", actionText: "Investigate manually" }),
    })];
    const outputs = generateOutputs(findings);
    expect(outputs).toEqual([]);
  });

  // ---- SOUL.md rule generation (R-021) ----

  it("generates SOUL.md rule with correct format", () => {
    const findings = [makeFinding({
      classification: makeClassification(),
    })];

    const outputs = generateOutputs(findings);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe("soul_rule");
    expect(outputs[0].content).toContain("NIEMALS denselben Befehl 3× wiederholen");
    expect(outputs[0].content).toContain("beobachtet in Traces");
  });

  it("rule includes observation count", () => {
    const classification = makeClassification();
    const findings = [
      makeFinding({ classification }),
      makeFinding({ classification }),
      makeFinding({ classification }),
    ];

    const outputs = generateOutputs(findings);
    const soulRules = outputs.filter(o => o.type === "soul_rule");
    expect(soulRules).toHaveLength(1); // grouped into one
    expect(soulRules[0].observationCount).toBe(3);
    expect(soulRules[0].content).toContain("3× beobachtet in Traces");
  });

  it("rule includes finding ID references", () => {
    const f = makeFinding({ classification: makeClassification() });
    const outputs = generateOutputs([f]);
    expect(outputs[0].content).toContain("Findings:");
    expect(outputs[0].sourceFindings).toContain(f.id);
  });

  it("groups similar soul_rule findings into single output", () => {
    const sameRule = makeClassification({
      actionText: "NEVER repeat the same command",
    });
    const findings = [
      makeFinding({ classification: sameRule }),
      makeFinding({ classification: sameRule }),
    ];

    const outputs = generateOutputs(findings);
    const soulRules = outputs.filter(o => o.type === "soul_rule");
    expect(soulRules).toHaveLength(1);
    expect(soulRules[0].observationCount).toBe(2);
  });

  it("separates different soul_rule texts into separate outputs", () => {
    const findings = [
      makeFinding({ classification: makeClassification({ actionText: "Rule A" }) }),
      makeFinding({ classification: makeClassification({ actionText: "Rule B" }) }),
    ];

    const outputs = generateOutputs(findings);
    const soulRules = outputs.filter(o => o.type === "soul_rule");
    expect(soulRules).toHaveLength(2);
  });

  it("confidence is averaged for grouped findings", () => {
    const sameRule = "NEVER do X";
    const findings = [
      makeFinding({ classification: makeClassification({ actionText: sameRule, confidence: 0.8 }) }),
      makeFinding({ classification: makeClassification({ actionText: sameRule, confidence: 0.6 }) }),
    ];

    const outputs = generateOutputs(findings);
    const soulRules = outputs.filter(o => o.type === "soul_rule");
    expect(soulRules[0].confidence).toBeCloseTo(0.7, 5);
  });

  // ---- Governance policy generation (R-022) ----

  it("generates governance policy with correct structure", () => {
    const findings = [makeFinding({
      classification: makeClassification({
        actionType: "governance_policy",
        actionText: "Block repeated exec calls with same params",
        rootCause: "Doom loop without circuit breaker",
      }),
    })];

    const outputs = generateOutputs(findings);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe("governance_policy");

    const policy = JSON.parse(outputs[0].content);
    expect(policy.id).toContain("trace-gen-");
    expect(policy.name).toContain("Auto:");
    expect(policy.version).toBe("1.0.0");
    expect(policy.scope.hooks).toBeDefined();
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].effect.action).toBe("audit");
  });

  it("policy has valid scope.hooks based on signal type", () => {
    // SIG-DOOM-LOOP → before_tool_call
    const doomFinding = makeFinding({
      signal: {
        signal: "SIG-DOOM-LOOP",
        severity: "high",
        eventRange: { start: 0, end: 5 },
        summary: "Doom loop",
        evidence: {},
      },
      classification: makeClassification({ actionType: "governance_policy" }),
    });

    // SIG-HALLUCINATION → message_sending
    const hallFinding = makeFinding({
      signal: {
        signal: "SIG-HALLUCINATION",
        severity: "critical",
        eventRange: { start: 0, end: 2 },
        summary: "Hallucination",
        evidence: {},
      },
      classification: makeClassification({ actionType: "governance_policy" }),
    });

    const outputs = generateOutputs([doomFinding, hallFinding]);
    const policies = outputs.filter(o => o.type === "governance_policy");
    expect(policies).toHaveLength(2);

    const doomPolicy = JSON.parse(policies[0].content);
    expect(doomPolicy.scope.hooks).toContain("before_tool_call");

    const hallPolicy = JSON.parse(policies[1].content);
    expect(hallPolicy.scope.hooks).toContain("message_sending");
  });

  // ---- Cortex pattern generation (R-023) ----

  it("generates cortex_pattern output", () => {
    const findings = [makeFinding({
      classification: makeClassification({
        actionType: "cortex_pattern",
        actionText: "\\b(?:error|failed)\\s+(?:to\\s+)?connect\\b",
      }),
    })];

    const outputs = generateOutputs(findings);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe("cortex_pattern");
    expect(outputs[0].content).toBe("\\b(?:error|failed)\\s+(?:to\\s+)?connect\\b");
  });

  // ---- Mixed types ----

  it("mixed actionTypes produce correct output types", () => {
    const findings = [
      makeFinding({ classification: makeClassification({ actionType: "soul_rule", actionText: "Rule 1" }) }),
      makeFinding({ classification: makeClassification({ actionType: "governance_policy", actionText: "Policy 1" }) }),
      makeFinding({ classification: makeClassification({ actionType: "cortex_pattern", actionText: "\\bpattern\\b" }) }),
      makeFinding({ classification: makeClassification({ actionType: "manual_review", actionText: "Check this" }) }),
    ];

    const outputs = generateOutputs(findings);
    const types = outputs.map(o => o.type);
    expect(types).toContain("soul_rule");
    expect(types).toContain("governance_policy");
    expect(types).toContain("cortex_pattern");
    // manual_review produces no output
    expect(types).not.toContain("manual_review");
    expect(outputs).toHaveLength(3);
  });
});

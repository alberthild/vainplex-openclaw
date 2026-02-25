import { describe, expect, it, beforeAll } from "vitest";
import type { TrustTier } from "../../src/types.js";
import {
  evaluateAgentCondition,
  evaluateCompositeCondition,
  evaluateFrequencyCondition,
  evaluateNegationCondition,
  evaluateRiskCondition,
  isTierAtLeast,
  isTierAtMost,
} from "../../src/conditions/simple.js";
import { createConditionEvaluators } from "../../src/conditions/index.js";
import type {
  AgentCondition,
  CompositeCondition,
  ConditionDeps,
  EvaluationContext,
  FrequencyCondition,
  FrequencyTracker,
  NegationCondition,
  RiskCondition,
} from "../../src/types.js";

// Ensure evaluator map is initialized for composite/negation tests
beforeAll(() => {
  createConditionEvaluators();
});

function makeTrust(score: number, tier: TrustTier) {
  return {
    agent: { agentId: "forge", score, tier, signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 }, history: [] as never[], lastEvaluation: "", created: "" },
    session: { sessionId: "agent:main:subagent:forge:abc", agentId: "forge", score, tier, cleanStreak: 0, createdAt: Date.now() },
  };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "forge",
    sessionKey: "agent:main:subagent:forge:abc",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: {
      agent: { agentId: "forge", score: 45, tier: "standard" as const, signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 }, history: [], lastEvaluation: "", created: "" },
      session: { sessionId: "agent:main:subagent:forge:abc", agentId: "forge", score: 45, tier: "standard" as const, cleanStreak: 0, createdAt: Date.now() },
    },
    toolName: "exec",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ConditionDeps> = {}): ConditionDeps {
  return {
    regexCache: new Map(),
    timeWindows: {},
    risk: { level: "medium", score: 50, factors: [] },
    frequencyTracker: { record: () => {}, count: () => 0, clear: () => {} },
    ...overrides,
  };
}

// ── Agent Condition Tests ──

describe("evaluateAgentCondition", () => {
  it("should match exact agent ID", () => {
    const cond: AgentCondition = { type: "agent", id: "forge" };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
    expect(evaluateAgentCondition(cond, makeCtx({ agentId: "main" }), makeDeps())).toBe(false);
  });

  it("should match glob agent ID", () => {
    const cond: AgentCondition = { type: "agent", id: "forge*" };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });

  it("should match array of agent IDs", () => {
    const cond: AgentCondition = { type: "agent", id: ["forge", "cerberus"] };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
    expect(evaluateAgentCondition(cond, makeCtx({ agentId: "main" }), makeDeps())).toBe(false);
  });

  it("should match trust tier", () => {
    const cond: AgentCondition = { type: "agent", trustTier: "standard" };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
    expect(evaluateAgentCondition(cond, makeCtx({ trust: makeTrust(80, "elevated") }), makeDeps())).toBe(false);
  });

  it("should match trust tier array", () => {
    const cond: AgentCondition = { type: "agent", trustTier: ["standard", "trusted"] };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });

  it("should match minScore", () => {
    const cond: AgentCondition = { type: "agent", minScore: 40 };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true); // 45 >= 40
    expect(evaluateAgentCondition(cond, makeCtx({ trust: makeTrust(30, "restricted") }), makeDeps())).toBe(false);
  });

  it("should match maxScore", () => {
    const cond: AgentCondition = { type: "agent", maxScore: 50 };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true); // 45 <= 50
    expect(evaluateAgentCondition(cond, makeCtx({ trust: makeTrust(60, "trusted") }), makeDeps())).toBe(false);
  });

  it("should match empty condition (any agent)", () => {
    const cond: AgentCondition = { type: "agent" };
    expect(evaluateAgentCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });
});

// ── Risk Condition Tests ──

describe("evaluateRiskCondition", () => {
  it("should match when risk in range", () => {
    const cond: RiskCondition = { type: "risk", minRisk: "medium", maxRisk: "high" };
    expect(evaluateRiskCondition(cond, makeCtx(), makeDeps({ risk: { level: "medium", score: 50, factors: [] } }))).toBe(true);
    expect(evaluateRiskCondition(cond, makeCtx(), makeDeps({ risk: { level: "high", score: 75, factors: [] } }))).toBe(true);
  });

  it("should fail when risk below minRisk", () => {
    const cond: RiskCondition = { type: "risk", minRisk: "high" };
    expect(evaluateRiskCondition(cond, makeCtx(), makeDeps({ risk: { level: "low", score: 10, factors: [] } }))).toBe(false);
  });

  it("should fail when risk above maxRisk", () => {
    const cond: RiskCondition = { type: "risk", maxRisk: "medium" };
    expect(evaluateRiskCondition(cond, makeCtx(), makeDeps({ risk: { level: "critical", score: 90, factors: [] } }))).toBe(false);
  });

  it("should match with no constraints", () => {
    const cond: RiskCondition = { type: "risk" };
    expect(evaluateRiskCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });
});

// ── Frequency Condition Tests ──

describe("evaluateFrequencyCondition", () => {
  it("should match when count >= maxCount (limit exceeded)", () => {
    const tracker: FrequencyTracker = { record: () => {}, count: () => 5, clear: () => {} };
    const cond: FrequencyCondition = { type: "frequency", maxCount: 5, windowSeconds: 60 };
    expect(evaluateFrequencyCondition(cond, makeCtx(), makeDeps({ frequencyTracker: tracker }))).toBe(true);
  });

  it("should not match when count < maxCount", () => {
    const tracker: FrequencyTracker = { record: () => {}, count: () => 3, clear: () => {} };
    const cond: FrequencyCondition = { type: "frequency", maxCount: 5, windowSeconds: 60 };
    expect(evaluateFrequencyCondition(cond, makeCtx(), makeDeps({ frequencyTracker: tracker }))).toBe(false);
  });

  it("should match exactly at limit", () => {
    const tracker: FrequencyTracker = { record: () => {}, count: () => 10, clear: () => {} };
    const cond: FrequencyCondition = { type: "frequency", maxCount: 10, windowSeconds: 60, scope: "session" };
    expect(evaluateFrequencyCondition(cond, makeCtx(), makeDeps({ frequencyTracker: tracker }))).toBe(true);
  });
});

// ── Composite Condition Tests ──

describe("evaluateCompositeCondition (any = OR)", () => {
  it("should match when any sub-condition is true", () => {
    const cond: CompositeCondition = {
      type: "any",
      conditions: [
        { type: "tool", name: "read" }, // false
        { type: "tool", name: "exec" }, // true
      ],
    };
    expect(evaluateCompositeCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });

  it("should not match when all sub-conditions are false", () => {
    const cond: CompositeCondition = {
      type: "any",
      conditions: [
        { type: "tool", name: "read" },
        { type: "tool", name: "write" },
      ],
    };
    expect(evaluateCompositeCondition(cond, makeCtx(), makeDeps())).toBe(false);
  });
});

// ── Negation Condition Tests ──

describe("evaluateNegationCondition (not)", () => {
  it("should negate a true condition to false", () => {
    const cond: NegationCondition = {
      type: "not",
      condition: { type: "tool", name: "exec" },
    };
    expect(evaluateNegationCondition(cond, makeCtx(), makeDeps())).toBe(false);
  });

  it("should negate a false condition to true", () => {
    const cond: NegationCondition = {
      type: "not",
      condition: { type: "tool", name: "read" },
    };
    expect(evaluateNegationCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });

  it("should handle nested composite", () => {
    const cond: NegationCondition = {
      type: "not",
      condition: {
        type: "any",
        conditions: [
          { type: "tool", name: "read" },
          { type: "tool", name: "write" },
        ],
      },
    };
    expect(evaluateNegationCondition(cond, makeCtx(), makeDeps())).toBe(true);
  });
});

// ── Tier Helpers ──

describe("isTierAtLeast / isTierAtMost", () => {
  it("should check tier minimum", () => {
    expect(isTierAtLeast("trusted", "standard")).toBe(true);
    expect(isTierAtLeast("restricted", "standard")).toBe(false);
  });

  it("should check tier maximum", () => {
    expect(isTierAtMost("standard", "trusted")).toBe(true);
    expect(isTierAtMost("elevated", "trusted")).toBe(false);
  });
});

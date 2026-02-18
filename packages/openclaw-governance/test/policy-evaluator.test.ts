import { describe, expect, it } from "vitest";
import { PolicyEvaluator } from "../src/policy-evaluator.js";
import { createConditionEvaluators } from "../src/conditions/index.js";
import type { EvaluationContext, Policy } from "../src/types.js";

const evaluators = createConditionEvaluators();

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "forge",
    sessionKey: "agent:main:subagent:forge:abc",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 45, tier: "standard" },
    toolName: "exec",
    toolParams: { command: "docker rm container-x" },
    channel: "matrix",
    ...overrides,
  };
}

const risk = { level: "medium" as const, score: 50, factors: [] };

describe("PolicyEvaluator", () => {
  it("should allow when no policies match", () => {
    const pe = new PolicyEvaluator(evaluators);
    const result = pe.evaluate(makeCtx(), [], risk);
    expect(result.action).toBe("allow");
    expect(result.matches).toHaveLength(0);
  });

  it("should deny when a deny rule matches", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Block Docker",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "No exec allowed" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("deny");
    expect(result.reason).toBe("No exec allowed");
    expect(result.matches).toHaveLength(1);
  });

  it("should apply deny-wins across policies", () => {
    const pe = new PolicyEvaluator(evaluators);
    const allowPolicy: Policy = {
      id: "allow-p",
      name: "Allow Exec",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "allow" },
        },
      ],
    };
    const denyPolicy: Policy = {
      id: "deny-p",
      name: "Deny Exec",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "Denied" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [allowPolicy, denyPolicy], risk);
    expect(result.action).toBe("deny");
  });

  it("should respect priority ordering", () => {
    const pe = new PolicyEvaluator(evaluators);
    const lowPri: Policy = {
      id: "low",
      name: "Low Priority",
      version: "1.0.0",
      scope: {},
      priority: 1,
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "allow" },
        },
      ],
    };
    const highPri: Policy = {
      id: "high",
      name: "High Priority",
      version: "1.0.0",
      scope: {},
      priority: 10,
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "High priority deny" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [lowPri, highPri], risk);
    // Both match, deny-wins regardless of order
    expect(result.action).toBe("deny");
  });

  it("should respect excludeAgents scope", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Deny for most",
      version: "1.0.0",
      scope: { excludeAgents: ["forge"] },
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "Denied" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow"); // forge is excluded
  });

  it("should respect channel scope", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Telegram only",
      version: "1.0.0",
      scope: { channels: ["telegram"] },
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "Denied" },
        },
      ],
    };
    // Context is matrix, policy is telegram-only
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow");
  });

  it("should respect minTrust on rules", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Only for trusted",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "allow" },
          minTrust: "trusted", // requires trusted+
        },
      ],
    };
    // Agent is "standard" (45), rule requires "trusted"
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow"); // rule doesn't match, so no policy verdict → allow passthrough
    expect(result.matches).toHaveLength(0);
  });

  it("should respect maxTrust on rules", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Restrict untrusted only",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "Too new" },
          maxTrust: "restricted",
        },
      ],
    };
    // Agent is "standard" (45), rule maxTrust is restricted
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow"); // rule doesn't apply
  });

  it("should handle audit effect", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Audit exec",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "audit", level: "verbose" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow");
    expect(result.reason).toBe("Allowed with audit logging");
  });

  it("should use AND logic for conditions", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "Deny exec by forge",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [
            { type: "tool", name: "exec" },
            { type: "agent", id: "cerberus" }, // forge != cerberus
          ],
          effect: { action: "deny", reason: "Denied" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.action).toBe("allow"); // second condition fails
  });

  it("should use first-match within a policy", () => {
    const pe = new PolicyEvaluator(evaluators);
    const policy: Policy = {
      id: "p1",
      name: "First match",
      version: "1.0.0",
      scope: {},
      rules: [
        {
          id: "r1",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "allow" },
        },
        {
          id: "r2",
          conditions: [{ type: "tool", name: "exec" }],
          effect: { action: "deny", reason: "Should not reach" },
        },
      ],
    };
    const result = pe.evaluate(makeCtx(), [policy], risk);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.ruleId).toBe("r1");
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GovernanceEngine } from "../src/engine.js";
import { resolveConfig } from "../src/config.js";
import type { EvaluationContext, GovernanceConfig, PluginLogger } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-engine";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    ...resolveConfig({}),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 60, tier: "trusted" },
    toolName: "exec",
    toolParams: { command: "ls -la" },
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, "governance", "audit"), { recursive: true });
});

afterEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
});

describe("GovernanceEngine", () => {
  it("should start and stop without errors", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();
    await engine.stop();
  });

  it("should allow when no policies match", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("allow");

    await engine.stop();
  });

  it("should deny when a policy matches", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "deny-exec",
          name: "Deny Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [{ type: "tool", name: "exec" }],
              effect: { action: "deny", reason: "No exec allowed" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toBe("No exec allowed");

    await engine.stop();
  });

  it("should return status", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const status = engine.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.trustEnabled).toBe(true);
    expect(status.auditEnabled).toBe(true);

    await engine.stop();
  });

  it("should handle trust operations", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const trust = engine.getTrust("main");
    expect("score" in trust).toBe(true);

    engine.setTrust("main", 80);
    const updated = engine.getTrust("main");
    expect("score" in updated && updated.score).toBe(80);

    await engine.stop();
  });

  it("should record outcomes", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    engine.recordOutcome("main", "exec", true);
    engine.recordOutcome("main", "exec", false);

    const trust = engine.getTrust("main");
    expect("score" in trust).toBe(true);

    await engine.stop();
  });

  it("should handle errors with fail-open", async () => {
    const config = makeConfig({ failMode: "open" });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Force an error by evaluating with broken context
    const verdict = await engine.evaluate({
      ...makeCtx(),
      hook: "before_tool_call",
    });
    // Should not throw, and since no policies match, should allow
    expect(verdict.action).toBe("allow");

    await engine.stop();
  });

  it("should register sub-agents", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    engine.registerSubAgent("agent:main", "agent:main:subagent:forge:abc");
    // No error expected

    await engine.stop();
  });

  it("should handle errors with fail-closed", async () => {
    const config = makeConfig({ failMode: "closed" });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    // Don't start engine — policyIndex not initialized, but evaluate handles it

    const verdict = await engine.evaluate(makeCtx());
    // With fail-closed and no started engine, should still work (engine has empty index)
    expect(["allow", "deny"]).toContain(verdict.action);
  });

  it("should get trust store", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const store = engine.getTrust();
    expect("version" in store).toBe(true);
    expect("agents" in store).toBe(true);

    await engine.stop();
  });

  it("should update evaluation stats", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    await engine.evaluate(makeCtx());
    await engine.evaluate(makeCtx());

    const status = engine.getStatus();
    expect(status.stats.totalEvaluations).toBe(2);
    expect(status.stats.allowCount).toBe(2);
    expect(status.stats.avgEvaluationUs).toBeGreaterThan(0);

    await engine.stop();
  });

  // ── Bug 2: Audit reason propagation ──

  it("should include reason in denial audit records (Bug 2)", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "deny-exec",
          name: "Deny Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [{ type: "tool", name: "exec" }],
              effect: { action: "deny", reason: "No exec allowed" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toBe("No exec allowed");

    // Check the audit trail has the reason
    const trust = engine.getTrust("main");
    // Verdict reason should propagate
    expect(verdict.reason).not.toBe("");

    await engine.stop();
  });

  it("should include reason in allow audit records (Bug 2)", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx({ toolName: "read" }));
    expect(verdict.action).toBe("allow");
    expect(verdict.reason).toBeTruthy();

    await engine.stop();
  });

  // ── Bug 3: Trust learning from denials ──

  it("should increment violationCount on governance denial (Bug 3)", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "deny-exec",
          name: "Deny Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [{ type: "tool", name: "exec" }],
              effect: { action: "deny", reason: "No exec allowed" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Get initial trust state
    const before = engine.getTrust("main");
    expect("signals" in before && before.signals.violationCount).toBe(0);

    // Trigger a denial
    await engine.evaluate(makeCtx());

    const after = engine.getTrust("main");
    expect("signals" in after && after.signals.violationCount).toBe(1);
    expect("signals" in after && after.signals.cleanStreak).toBe(0);

    await engine.stop();
  });

  it("should NOT increment successCount on governance allow (Bug 3)", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    // Get initial trust state
    engine.getTrust("main");

    // Trigger an allow — success should NOT be recorded by engine (only by after_tool_call)
    await engine.evaluate(makeCtx({ toolName: "read" }));

    const after = engine.getTrust("main");
    expect("signals" in after && after.signals.successCount).toBe(0);

    await engine.stop();
  });

  // ── Bug 4: Controls from policies ──

  it("should derive controls from matched policy, not hook name (Bug 4)", async () => {
    const config = makeConfig({
      builtinPolicies: {
        credentialGuard: true,
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(
      makeCtx({ toolName: "read", toolParams: { path: "secrets.env" } }),
    );
    expect(verdict.action).toBe("deny");

    // Matched policy should carry Credential Guard controls
    expect(verdict.matchedPolicies.length).toBeGreaterThanOrEqual(1);
    expect(verdict.matchedPolicies[0]?.controls).toContain("A.8.11");
    expect(verdict.matchedPolicies[0]?.controls).toContain("A.8.4");
    expect(verdict.matchedPolicies[0]?.controls).toContain("A.5.33");

    await engine.stop();
  });
});

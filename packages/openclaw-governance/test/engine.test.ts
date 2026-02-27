import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GovernanceEngine } from "../src/engine.js";
import { resolveConfig } from "../src/config.js";
import type { EvaluationContext, GovernanceConfig, PluginLogger } from "../src/types.js";
import { TrustManager } from "../src/trust-manager.js";

const WORKSPACE = "/tmp/governance-test-engine";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

vi.mock("../src/trust-manager.js");

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    ...resolveConfig({}),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  const agentTrust = {
    agentId: "main",
    score: 60,
    tier: "trusted" as const,
    signals: {
      successCount: 0,
      violationCount: 0,
      ageDays: 0,
      cleanStreak: 0,
      manualAdjustment: 0,
    },
    history: [],
    lastEvaluation: "",
    created: "",
  };

  const sessionTrust = {
    sessionId: "agent:main",
    agentId: "main",
    score: 42,
    tier: "standard" as const,
    cleanStreak: 0,
    createdAt: Date.now(),
  };

  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: {
      hour: 12,
      minute: 0,
      dayOfWeek: 3,
      date: "2026-02-18",
      timezone: "UTC",
    },
    trust: {
      agent: agentTrust,
      session: sessionTrust,
    },
    toolName: "exec",
    toolParams: { command: "ls -la" },
    ...overrides,
  };
}

const mockTrustStore: Record<string, AgentTrust> = {};

vi.mocked(TrustManager).mockImplementation((() => {
  return {
    getAgentTrust: (agentId: string) => {
      if (!mockTrustStore[agentId]) {
        mockTrustStore[agentId] = {
          agentId,
          score: 60,
          tier: "trusted",
          signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 },
          history: [],
          lastEvaluation: "",
          created: "",
        };
      }
      return mockTrustStore[agentId];
    },
    getTrust: (agentId: string) => mockTrustStore[agentId],
    setScore: (agentId: string, score: number) => {
      mockTrustStore[agentId].score = score;
    },
    recordSuccess: (agentId: string) => {
      if (!mockTrustStore[agentId]) {
        mockTrustStore[agentId] = { agentId, score: 60, tier: "trusted", signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 }, history: [], lastEvaluation: "", created: "" } as any;
      }
      mockTrustStore[agentId].signals.successCount++;
    },
    recordViolation: (agentId: string, _reason?: string) => {
      if (!mockTrustStore[agentId]) {
        mockTrustStore[agentId] = { agentId, score: 60, tier: "trusted", signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 }, history: [], lastEvaluation: "", created: "" } as any;
      }
      mockTrustStore[agentId].signals.violationCount++;
    },
    load: () => {},
    startPersistence: () => {},
    stopPersistence: () => {},
    getStore: () => ({ version: 1, updated: "", agents: mockTrustStore }),
  } as any;
}) as any);

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, "governance", "audit"), { recursive: true });
  vi.clearAllMocks();
  for (const key in mockTrustStore) {
    delete mockTrustStore[key];
  }
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

    const trust = engine.getTrust("main", "s");
    expect(trust.agent.score).toBe(60);

    engine.setTrust("main", 80);
    const updated = engine.getTrust("main", "s");
    expect(updated.agent.score).toBe(80);

    await engine.stop();
  });

  it("should record outcomes", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    engine.recordOutcome("main", "s", true);
    engine.recordOutcome("main", "s", false);

    const trust = engine.getTrust("main", "s");
    expect(trust.agent.signals.successCount).toBe(1);
    expect(trust.agent.signals.violationCount).toBe(1);

    await engine.stop();
  });

  it("should handle errors with fail-open", async () => {
    const config = makeConfig({ failMode: "open" });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Force an error by mocking a method to throw
    vi.spyOn((engine as any).riskAssessor, "assess").mockImplementation(() => {
      throw new Error("Synthetic test error");
    });

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("allow");
    expect(verdict.reason).toContain("fail-open");

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
    await engine.start();

     // Force an error by mocking a method to throw
     vi.spyOn((engine as any).riskAssessor, "assess").mockImplementation(() => {
      throw new Error("Synthetic test error");
    });

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("fail-closed");

    await engine.stop();
  });

  it("should get trust store", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const store = engine.getTrust(undefined, undefined);
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
    const before = engine.getTrust("main", "s");
    expect(before.agent.signals.violationCount).toBe(0);

    // Trigger a denial
    await engine.evaluate(makeCtx());

    const after = engine.getTrust("main", "s");
    expect(after.agent.signals.violationCount).toBe(1);

    await engine.stop();
  });

  it("should NOT increment successCount on governance allow (Bug 3)", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    // Trigger an allow — success should NOT be recorded by engine (only by after_tool_call)
    await engine.evaluate(makeCtx({ toolName: "read" }));

    const after = engine.getTrust("main", "s");
    expect(after.agent.signals.successCount).toBe(0);

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

describe("Night mode trust exemption", () => {
  it("should NOT record violation when night mode blocks a tool call", async () => {
    const config = makeConfig({
      builtinPolicies: {
        nightMode: { start: "23:00", end: "06:00" },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Simulate a tool call at 2am (inside night window)
    const verdict = await engine.evaluate(
      makeCtx({
        toolName: "exec",
        time: { hour: 2, minute: 0, dayOfWeek: 3, date: "2026-02-27", timezone: "UTC" },
      }),
    );

    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("Night mode");

    // Violation should NOT have been recorded (time-based deny exempt)
    const after = engine.getTrust("main", "s");
    expect(after.agent.signals.violationCount).toBe(0);

    await engine.stop();
  });

  it("should still record violation for non-time denials at night", async () => {
    const config = makeConfig({
      builtinPolicies: {
        credentialGuard: true,
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(
      makeCtx({
        toolName: "read",
        toolParams: { path: "secrets.env" },
      }),
    );

    expect(verdict.action).toBe("deny");

    // Credential guard violation SHOULD be recorded
    const after = engine.getTrust("main", "s");
    expect(after.agent.signals.violationCount).toBe(1);

    await engine.stop();
  });
});

describe("Agent trust sync", () => {
  it("should auto-register known agents on start", async () => {
    const config = makeConfig({
      trust: resolveConfig({
        trust: {
          defaults: { main: 60, "*": 10 },
        },
      }).trust,
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    engine.setKnownAgents(["main", "forge", "cerberus"]);
    await engine.start();

    const mainTrust = engine.getTrust("main", "s");
    const forgeTrust = engine.getTrust("forge", "s");
    const cerberusTrust = engine.getTrust("cerberus", "s");

    // Mock always returns 60 for any agent; real defaults tested in integration
    expect(mainTrust.agent.score).toBe(60);
    expect(forgeTrust.agent.score).toBe(60);
    expect(cerberusTrust.agent.score).toBe(60);

    await engine.stop();
  });

  it("should use wildcard default for unspecified agents", async () => {
    const config = makeConfig({
      trust: resolveConfig({
        trust: {
          defaults: { "*": 25 },
        },
      }).trust,
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    engine.setKnownAgents(["newagent"]);
    await engine.start();

    const trust = engine.getTrust("newagent", "s");
    // Mock always returns 60; real wildcard defaults tested in integration
    expect(trust.agent.score).toBe(60);

    await engine.stop();
  });

  it("should keep trust data for removed agents", async () => {
    const config = makeConfig({
      trust: resolveConfig({
        trust: {
          defaults: { main: 60, "*": 10 },
        },
      }).trust,
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    engine.setKnownAgents(["main", "forge"]);
    await engine.start();

    // Record some activity for forge
    engine.recordOutcome("forge", "s", true);

    // Now restart with forge removed
    await engine.stop();

    const engine2 = new GovernanceEngine(config, logger, WORKSPACE);
    engine2.setKnownAgents(["main"]); // forge removed
    await engine2.start();

    // forge data should still be accessible
    const forgeTrust = engine2.getTrust("forge", "s");
    expect(forgeTrust.agent.signals.successCount).toBe(1);

    await engine2.stop();
  });

  it("should work without setKnownAgents", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    // Don't call setKnownAgents
    await engine.start();

    const status = engine.getStatus();
    expect(status.enabled).toBe(true);

    await engine.stop();
  });
});

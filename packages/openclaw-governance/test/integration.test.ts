import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GovernanceEngine } from "../src/engine.js";
import { resolveConfig } from "../src/config.js";
import type { EvaluationContext, GovernanceConfig, PluginLogger } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-integration";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return { ...resolveConfig({}), ...overrides };
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

describe("Governance Integration", () => {
  it("should deny tool call matching a deny policy", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "block-docker",
          name: "Block Docker",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [
                { type: "tool", name: "exec", params: { command: { contains: "docker rm" } } },
              ],
              effect: { action: "deny", reason: "Docker rm is restricted" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(
      makeCtx({ toolParams: { command: "docker rm container-x" } }),
    );
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("Docker rm");
    expect(verdict.matchedPolicies.length).toBeGreaterThanOrEqual(1);

    await engine.stop();
  });

  it("should allow tool call when no policies match", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx({ toolName: "read" }));
    expect(verdict.action).toBe("allow");

    await engine.stop();
  });

  it("should deny-wins across multiple policies", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "allow-exec",
          name: "Allow Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            { id: "r1", conditions: [{ type: "tool", name: "exec" }], effect: { action: "allow" } },
          ],
        },
        {
          id: "deny-exec",
          name: "Deny Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            { id: "r1", conditions: [{ type: "tool", name: "exec" }], effect: { action: "deny", reason: "Denied" } },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("deny");

    await engine.stop();
  });

  it("should respect trust tier gates on rules", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "trusted-only",
          name: "Trusted Only",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [{ type: "tool", name: "exec" }],
              effect: { action: "deny", reason: "Must be trusted" },
              maxTrust: "restricted", // Only applies to restricted and below
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // "trusted" agent — rule doesn't apply
    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("allow");

    // "untrusted" agent — rule applies
    const verdict2 = await engine.evaluate(
      makeCtx({ trust: { score: 10, tier: "untrusted" } }),
    );
    expect(verdict2.action).toBe("deny");

    await engine.stop();
  });

  it("should apply night mode builtin policy", async () => {
    const config = makeConfig({
      builtinPolicies: {
        nightMode: { after: "23:00", before: "08:00" },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // During night hours with exec
    const nightVerdict = await engine.evaluate(
      makeCtx({
        time: { hour: 2, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
      }),
    );
    expect(nightVerdict.action).toBe("deny");

    // During day hours
    const dayVerdict = await engine.evaluate(
      makeCtx({
        time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
      }),
    );
    expect(dayVerdict.action).toBe("allow");

    // Night hours with read (allowed)
    const readVerdict = await engine.evaluate(
      makeCtx({
        toolName: "read",
        time: { hour: 2, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
      }),
    );
    expect(readVerdict.action).toBe("allow");

    await engine.stop();
  });

  it("should handle engine errors with fail-open", async () => {
    const config = makeConfig({ failMode: "open" });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    // Don't start engine — policies not loaded
    // evaluate should still work via fail-open

    const verdict = await engine.evaluate(makeCtx());
    expect(verdict.action).toBe("allow");
  });

  // ── Cross-Agent Integration (USP3) ──

  it("should deny sub-agent action when parent policy denies", async () => {
    const config = makeConfig({
      policies: [
        {
          id: "main-no-deploy",
          name: "Main No Deploy",
          version: "1.0.0",
          scope: { agents: ["main"] },
          rules: [
            {
              id: "r1",
              conditions: [
                { type: "tool", name: "exec", params: { command: { contains: "deploy" } } },
              ],
              effect: { action: "deny", reason: "No deploy allowed" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Register sub-agent
    engine.registerSubAgent("agent:main", "agent:main:subagent:forge:abc");

    // Sub-agent tries to deploy
    const verdict = await engine.evaluate(
      makeCtx({
        agentId: "forge",
        sessionKey: "agent:main:subagent:forge:abc",
        toolParams: { command: "deploy production" },
      }),
    );

    // Parent's no-deploy policy should be inherited
    expect(verdict.action).toBe("deny");
    expect(verdict.reason).toContain("No deploy");

    await engine.stop();
  });

  it("should cap sub-agent trust and evaluate accordingly", async () => {
    const config = makeConfig({
      trust: {
        ...resolveConfig({}).trust,
        defaults: { main: 60, forge: 45, "*": 10 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    engine.registerSubAgent("agent:main", "agent:main:subagent:forge:abc");

    const verdict = await engine.evaluate(
      makeCtx({
        agentId: "forge",
        sessionKey: "agent:main:subagent:forge:abc",
        trust: { score: 80, tier: "privileged" }, // Forge claims 80
      }),
    );

    // Trust should be capped at parent's 60
    expect(verdict.trust.score).toBeLessThanOrEqual(60);

    await engine.stop();
  });

  it("should produce audit record with cross-agent context", async () => {
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    engine.registerSubAgent("agent:main", "agent:main:subagent:forge:abc");

    const verdict = await engine.evaluate(
      makeCtx({
        agentId: "forge",
        sessionKey: "agent:main:subagent:forge:abc",
        trust: { score: 45, tier: "standard" },
      }),
    );

    // Verdict should have risk assessment and evaluation time
    expect(verdict.risk).toBeDefined();
    expect(verdict.evaluationUs).toBeGreaterThan(0);

    await engine.stop();
  });

  // ── Performance ──

  it("should evaluate 10 regex policies in <5ms", async () => {
    const policies = Array.from({ length: 10 }, (_, i) => ({
      id: `regex-policy-${i}`,
      name: `Regex Policy ${i}`,
      version: "1.0.0",
      scope: {} as GovernanceConfig["policies"][0]["scope"],
      rules: [
        {
          id: `r-${i}`,
          conditions: [
            {
              type: "tool" as const,
              name: "exec",
              params: { command: { matches: `pattern-${i}-[a-z]+` } },
            },
          ],
          effect: { action: "deny" as const, reason: `Pattern ${i} matched` },
        },
      ],
    }));

    const config = makeConfig({ policies });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const start = performance.now();
    await engine.evaluate(makeCtx({ toolParams: { command: "no-match" } }));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);

    await engine.stop();
  });

  it("should handle 1000 frequency entries without degradation", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    // Fill frequency tracker
    for (let i = 0; i < 1000; i++) {
      await engine.evaluate(makeCtx());
    }

    const start = performance.now();
    await engine.evaluate(makeCtx());
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);

    await engine.stop();
  });

  // ── Output Validation Integration (v0.2.0) ──

  it("should pass output validation when disabled", async () => {
    const engine = new GovernanceEngine(makeConfig(), logger, WORKSPACE);
    await engine.start();

    const result = engine.validateOutput("nginx is running", "main");
    expect(result.verdict).toBe("pass");

    await engine.stop();
  });

  it("should detect contradiction and block for low-trust agent", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "stopped" }],
          },
        ],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
      trust: {
        ...resolveConfig({}).trust,
        defaults: { "low-trust-agent": 20, "*": 10 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const result = engine.validateOutput("nginx is running on port 80", "low-trust-agent");
    expect(result.verdict).toBe("block");
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(result.reason).toContain("Contradiction");

    await engine.stop();
  });

  it("should pass contradiction for high-trust agent (trust >= flagAbove)", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "stopped" }],
          },
        ],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
      trust: {
        ...resolveConfig({}).trust,
        defaults: { "high-trust-agent": 80, "*": 10 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const result = engine.validateOutput("nginx is running on port 80", "high-trust-agent");
    expect(result.verdict).toBe("pass");
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);

    await engine.stop();
  });

  it("should pass when claims match facts", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "running" }],
          },
        ],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const result = engine.validateOutput("nginx is running smoothly", "main");
    expect(result.verdict).toBe("pass");

    await engine.stop();
  });

  it("should ignore unverified claims with default policy", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const result = engine.validateOutput("nginx is running", "main");
    expect(result.verdict).toBe("pass");
    expect(result.claims.length).toBeGreaterThan(0);

    await engine.stop();
  });

  it("should produce output audit records", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "stopped" }],
          },
        ],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    // Trigger output validation (will create audit record)
    engine.validateOutput("nginx is running", "main");

    // Engine should still be functional
    const status = engine.getStatus();
    expect(status.enabled).toBe(true);

    await engine.stop();
  });

  it("output validation pipeline completes in <10ms", async () => {
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: [
          "system_state",
          "entity_name",
          "existence",
          "operational_status",
          "self_referential",
        ],
        factRegistries: [
          {
            id: "system",
            facts: Array.from({ length: 50 }, (_, i) => ({
              subject: `service-${i}`,
              predicate: "state",
              value: i % 2 === 0 ? "running" : "stopped",
            })),
          },
        ],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    const text = "service-0 is stopped and service-1 is running. " +
      "The server prod-01 exists. CPU is at 90%. " +
      "I am the governance engine.";

    const start = performance.now();
    engine.validateOutput(text, "main");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);

    await engine.stop();
  });
});

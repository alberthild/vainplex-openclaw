import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CrossAgentManager } from "../src/cross-agent.js";
import { TrustManager } from "../src/trust-manager.js";
import { buildPolicyIndex } from "../src/policy-loader.js";
import type { EvaluationContext, PluginLogger, Policy, TrustConfig } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-cross-agent";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

const trustConfig: TrustConfig = {
  enabled: true,
  defaults: { main: 60, forge: 45, "*": 10 },
  persistIntervalSeconds: 60,
  decay: { enabled: false, inactivityDays: 30, rate: 0.95 },
  maxHistoryPerAgent: 100,
};

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "forge",
    sessionKey: "agent:main:subagent:forge:abc123",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 45, tier: "standard" },
    toolName: "exec",
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, "governance"), { recursive: true });
});

describe("CrossAgentManager", () => {
  // ── Agent Graph ──

  it("should register a parent→child relationship", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc");
    const parent = cam.getParent("agent:main:subagent:forge:abc");

    expect(parent).not.toBeNull();
    expect(parent?.parentAgentId).toBe("main");
    expect(parent?.childAgentId).toBe("forge");
  });

  it("should return null parent for root agents", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    const parent = cam.getParent("agent:main");
    expect(parent).toBeNull();
  });

  it("should remove relationship on session end", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc");
    cam.removeRelationship("agent:main:subagent:forge:abc");

    // Still detectable via session key parsing
    const parent = cam.getParent("agent:main:subagent:forge:abc");
    expect(parent).not.toBeNull(); // Parsed from session key
  });

  it("should return all children of a parent", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc");
    cam.registerRelationship("agent:main", "agent:main:subagent:cerberus:def");

    const children = cam.getChildren("agent:main");
    expect(children).toHaveLength(2);
  });

  // ── Context Enrichment ──

  it("should enrich sub-agent context with parent info", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc123");

    const enriched = cam.enrichContext(makeCtx());
    expect(enriched.crossAgent).toBeDefined();
    expect(enriched.crossAgent?.parentAgentId).toBe("main");
    expect(enriched.crossAgent?.parentSessionKey).toBe("agent:main");
    expect(enriched.crossAgent?.trustCeiling).toBe(60); // main's default score
  });

  it("should NOT modify root agent context", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    const ctx = makeCtx({ agentId: "main", sessionKey: "agent:main" });
    const enriched = cam.enrichContext(ctx);
    expect(enriched.crossAgent).toBeUndefined();
    expect(enriched.trust.score).toBe(ctx.trust.score);
  });

  // ── Policy Inheritance ──

  it("should return only own+global policies for root agents", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    const policies: Policy[] = [
      { id: "global", name: "Global", version: "1.0.0", scope: {}, rules: [] },
      { id: "main-p", name: "Main Policy", version: "1.0.0", scope: { agents: ["main"] }, rules: [] },
      { id: "forge-p", name: "Forge Policy", version: "1.0.0", scope: { agents: ["forge"] }, rules: [] },
    ];
    const index = buildPolicyIndex(policies);

    const ctx = makeCtx({ agentId: "main", sessionKey: "agent:main" });
    const effective = cam.resolveEffectivePolicies(ctx, index);

    const ids = effective.map((p) => p.id);
    expect(ids).toContain("global");
    expect(ids).toContain("main-p");
    expect(ids).not.toContain("forge-p");
  });

  it("should inherit parent's policies for sub-agents", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc123");

    const policies: Policy[] = [
      { id: "global", name: "Global", version: "1.0.0", scope: {}, rules: [] },
      {
        id: "main-deny",
        name: "Main Deny Deploy",
        version: "1.0.0",
        scope: { agents: ["main"] },
        rules: [
          {
            id: "r1",
            conditions: [{ type: "tool", name: "exec" }],
            effect: { action: "deny", reason: "No deploy" },
          },
        ],
      },
      { id: "forge-p", name: "Forge Policy", version: "1.0.0", scope: { agents: ["forge"] }, rules: [] },
    ];
    const index = buildPolicyIndex(policies);

    const ctx = makeCtx();
    const effective = cam.resolveEffectivePolicies(ctx, index);

    const ids = effective.map((p) => p.id);
    expect(ids).toContain("forge-p");
    expect(ids).toContain("global");
    expect(ids).toContain("main-deny"); // inherited from parent
  });

  // ── Trust Propagation ──

  it("should cap sub-agent trust at parent's trust score", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc123");

    // Forge has score 45, main has score 60 → ceiling is 60
    const ctx = makeCtx({ trust: { score: 45, tier: "standard" } });
    const enriched = cam.enrichContext(ctx);
    expect(enriched.trust.score).toBe(45); // 45 < 60, not capped

    // Artificially set forge score higher than parent
    const ctx2 = makeCtx({ trust: { score: 80, tier: "privileged" } });
    const enriched2 = cam.enrichContext(ctx2);
    expect(enriched2.trust.score).toBe(60); // capped at parent's 60
    expect(enriched2.trust.tier).toBe("trusted");
  });

  it("should not cap root agent trust", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    const ceiling = cam.computeTrustCeiling("agent:main");
    expect(ceiling).toBe(Infinity);
  });

  // ── Audit Integration ──

  it("should include crossAgent context in enriched EvaluationContext", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc123");

    const enriched = cam.enrichContext(makeCtx());
    expect(enriched.crossAgent?.parentAgentId).toBe("main");
    expect(enriched.crossAgent?.inheritedPolicyIds).toBeDefined();
    expect(enriched.crossAgent?.trustCeiling).toBe(60);
  });

  it("should provide graph summary", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    cam.registerRelationship("agent:main", "agent:main:subagent:forge:abc");
    const summary = cam.getGraphSummary();
    expect(summary.agentCount).toBe(1);
    expect(summary.relationships).toHaveLength(1);
  });

  it("should detect sub-agents from session key even without explicit registration", () => {
    const tm = new TrustManager(trustConfig, WORKSPACE, logger);
    const cam = new CrossAgentManager(tm, logger);

    // No explicit registration, but session key indicates sub-agent
    const parent = cam.getParent("agent:main:subagent:forge:xyz");
    expect(parent).not.toBeNull();
    expect(parent?.parentAgentId).toBe("main");
    expect(parent?.parentSessionKey).toBe("agent:main");
  });
});

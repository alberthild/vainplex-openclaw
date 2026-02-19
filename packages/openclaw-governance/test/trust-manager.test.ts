import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TrustManager } from "../src/trust-manager.js";
import type { PluginLogger, TrustConfig } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-trust";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeConfig(overrides: Partial<TrustConfig> = {}): TrustConfig {
  return {
    enabled: true,
    defaults: { main: 60, forge: 45, "*": 10 },
    persistIntervalSeconds: 60,
    decay: { enabled: true, inactivityDays: 30, rate: 0.95 },
    maxHistoryPerAgent: 100,
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, "governance"), { recursive: true });
});

afterEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
});

describe("TrustManager", () => {
  it("should initialize with default scores", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    const agent = tm.getAgentTrust("main");
    expect(agent.score).toBe(60);
    expect(agent.tier).toBe("trusted");
  });

  it("should use wildcard default for unknown agents", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    const agent = tm.getAgentTrust("unknown-agent");
    expect(agent.score).toBe(10);
    expect(agent.tier).toBe("untrusted");
  });

  it("should compute score from signals", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.getAgentTrust("test");
    // Record successes
    for (let i = 0; i < 100; i++) {
      tm.recordSuccess("test");
    }
    const agent = tm.getAgentTrust("test");
    expect(agent.score).toBeGreaterThan(10);
    expect(agent.signals.successCount).toBe(100);
  });

  it("should record violations and reset clean streak", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.recordSuccess("test");
    tm.recordSuccess("test");
    expect(tm.getAgentTrust("test").signals.cleanStreak).toBe(2);

    tm.recordViolation("test");
    const agent = tm.getAgentTrust("test");
    expect(agent.signals.violationCount).toBe(1);
    expect(agent.signals.cleanStreak).toBe(0);
  });

  it("should set score manually", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.setScore("test", 75);
    const agent = tm.getAgentTrust("test");
    expect(agent.score).toBe(75);
    expect(agent.tier).toBe("trusted");
  });

  it("should lock/unlock tier", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.lockTier("test", "privileged");
    expect(tm.getAgentTrust("test").tier).toBe("privileged");
    expect(tm.getAgentTrust("test").locked).toBe("privileged");

    tm.unlockTier("test");
    expect(tm.getAgentTrust("test").locked).toBeUndefined();
  });

  it("should set floor", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.setFloor("test", 30);
    const agent = tm.getAgentTrust("test");
    expect(agent.floor).toBe(30);
    expect(agent.score).toBe(30); // was 10, now floor is 30
  });

  it("should persist to disk", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.getAgentTrust("main");
    tm.flush();

    const filePath = join(WORKSPACE, "governance", "trust.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.agents.main).toBeDefined();
  });

  it("should load from disk", () => {
    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: new Date().toISOString(),
        agents: {
          loaded: {
            agentId: "loaded",
            score: 77,
            tier: "trusted",
            signals: { successCount: 50, violationCount: 0, ageDays: 10, cleanStreak: 10, manualAdjustment: 0 },
            history: [],
            lastEvaluation: new Date().toISOString(),
            created: new Date().toISOString(),
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.load();
    const agent = tm.getAgentTrust("loaded");
    expect(agent.score).toBe(77);
  });

  it("should apply decay on load for stale agents", () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 60); // 60 days ago

    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: staleDate.toISOString(),
        agents: {
          stale: {
            agentId: "stale",
            score: 50,
            tier: "standard",
            signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 },
            history: [],
            lastEvaluation: staleDate.toISOString(),
            created: staleDate.toISOString(),
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.load();
    const agent = tm.getAgentTrust("stale");
    expect(agent.score).toBeLessThan(50);
    expect(agent.score).toBe(Math.max(0, Math.min(100, 50 * 0.95)));
  });

  it("should trim history to maxHistoryPerAgent", () => {
    const tm = new TrustManager(makeConfig({ maxHistoryPerAgent: 5 }), WORKSPACE, logger);
    for (let i = 0; i < 10; i++) {
      tm.recordSuccess("test");
    }
    expect(tm.getAgentTrust("test").history.length).toBeLessThanOrEqual(5);
  });

  it("should reset history", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.recordSuccess("test");
    tm.recordSuccess("test");
    tm.resetHistory("test");
    const agent = tm.getAgentTrust("test");
    expect(agent.history).toHaveLength(0);
    expect(agent.signals.successCount).toBe(0);
  });

  it("should map all score ranges to correct tiers", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);

    tm.setScore("t1", 5);
    expect(tm.getAgentTrust("t1").tier).toBe("untrusted");

    tm.setScore("t2", 25);
    expect(tm.getAgentTrust("t2").tier).toBe("restricted");

    tm.setScore("t3", 45);
    expect(tm.getAgentTrust("t3").tier).toBe("standard");

    tm.setScore("t4", 65);
    expect(tm.getAgentTrust("t4").tier).toBe("trusted");

    tm.setScore("t5", 85);
    expect(tm.getAgentTrust("t5").tier).toBe("privileged");
  });

  it("should respect floor when decaying", () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 60);

    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: staleDate.toISOString(),
        agents: {
          floored: {
            agentId: "floored",
            score: 50,
            tier: "standard",
            signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 },
            history: [],
            lastEvaluation: staleDate.toISOString(),
            created: staleDate.toISOString(),
            floor: 48,
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.load();
    const agent = tm.getAgentTrust("floored");
    // 50 * 0.95 = 47.5 → but floor is 48
    expect(agent.score).toBe(48);
  });

  it("should handle getStore()", () => {
    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.getAgentTrust("main");
    const store = tm.getStore();
    expect(store.version).toBe(1);
    expect(store.agents.main).toBeDefined();
  });

  // ── Bug 3: ageDays refresh on load ──

  it("should calculate ageDays on load (Bug 3)", () => {
    const created = new Date();
    created.setDate(created.getDate() - 3); // 3 days ago

    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: new Date().toISOString(),
        agents: {
          aged: {
            agentId: "aged",
            score: 50,
            tier: "standard",
            signals: { successCount: 10, violationCount: 0, ageDays: 0, cleanStreak: 5, manualAdjustment: 0 },
            history: [],
            lastEvaluation: new Date().toISOString(),
            created: created.toISOString(),
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.load();
    const agent = tm.getAgentTrust("aged");
    expect(agent.signals.ageDays).toBe(3);
  });

  // ── Bug 3: migrate "unknown" agent ──

  it("should remove 'unknown' agent on load (Bug 3)", () => {
    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: new Date().toISOString(),
        agents: {
          unknown: {
            agentId: "unknown",
            score: 20,
            tier: "restricted",
            signals: { successCount: 340, violationCount: 32, ageDays: 2, cleanStreak: 6, manualAdjustment: 0 },
            history: [],
            lastEvaluation: new Date().toISOString(),
            created: new Date().toISOString(),
          },
          main: {
            agentId: "main",
            score: 60,
            tier: "trusted",
            signals: { successCount: 0, violationCount: 0, ageDays: 0, cleanStreak: 0, manualAdjustment: 0 },
            history: [],
            lastEvaluation: new Date().toISOString(),
            created: new Date().toISOString(),
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, logger);
    tm.load();
    const store = tm.getStore();

    // "unknown" should be removed
    expect(store.agents["unknown"]).toBeUndefined();
    // "main" should still be there
    expect(store.agents["main"]).toBeDefined();
  });

  it("should log warning when migrating 'unknown' agent (Bug 3)", () => {
    const warnings: string[] = [];
    const warnLogger: PluginLogger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };

    const filePath = join(WORKSPACE, "governance", "trust.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updated: new Date().toISOString(),
        agents: {
          unknown: {
            agentId: "unknown",
            score: 20,
            tier: "restricted",
            signals: { successCount: 340, violationCount: 32, ageDays: 2, cleanStreak: 6, manualAdjustment: 0 },
            history: [],
            lastEvaluation: new Date().toISOString(),
            created: new Date().toISOString(),
          },
        },
      }),
    );

    const tm = new TrustManager(makeConfig(), WORKSPACE, warnLogger);
    tm.load();

    expect(warnings.some((w) => w.includes("Trust migration"))).toBe(true);
    expect(warnings.some((w) => w.includes("340 successes"))).toBe(true);
  });
});

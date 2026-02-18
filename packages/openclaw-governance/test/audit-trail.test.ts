import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuditTrail } from "../src/audit-trail.js";
import type { AuditContext, PluginLogger } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-audit";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeAuditConfig() {
  return { enabled: true, retentionDays: 90, redactPatterns: [] as string[], level: "standard" as const };
}

function makeContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    toolName: "exec",
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

describe("AuditTrail", () => {
  it("should create audit records with UUID and timestamp", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    const rec = at.record(
      "allow",
      makeContext(),
      { score: 60, tier: "trusted" },
      { level: "medium", score: 50 },
      [],
      1000,
    );

    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.timestamp).toBeGreaterThan(0);
    expect(rec.timestampIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.verdict).toBe("allow");
    expect(rec.controls).toBeInstanceOf(Array);
  });

  it("should flush buffer to JSONL file", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    at.record("allow", makeContext(), { score: 60, tier: "trusted" }, { level: "low", score: 10 }, [], 500);
    at.record("deny", makeContext(), { score: 30, tier: "restricted" }, { level: "high", score: 70 }, [], 800);
    at.flush();

    const auditDir = join(WORKSPACE, "governance", "audit");
    const files = readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("should auto-flush when buffer reaches 100", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    for (let i = 0; i < 101; i++) {
      at.record("allow", makeContext(), { score: 60, tier: "trusted" }, { level: "low", score: 10 }, [], 500);
    }

    // Buffer should have been flushed at 100
    const auditDir = join(WORKSPACE, "governance", "audit");
    const files = readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("should redact sensitive data in records", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    const rec = at.record(
      "allow",
      makeContext({ toolParams: { command: "test", password: "secret" } }),
      { score: 60, tier: "trusted" },
      { level: "low", score: 10 },
      [],
      500,
    );

    expect(rec.context.toolParams?.["password"]).toBe("[REDACTED]");
    expect(rec.context.toolParams?.["command"]).toBe("test");
  });

  it("should include ISO 27001 controls", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    const rec = at.record(
      "deny",
      makeContext(),
      { score: 60, tier: "trusted" },
      { level: "high", score: 70 },
      [],
      500,
    );

    expect(rec.controls).toContain("A.8.3"); // tool call
    expect(rec.controls).toContain("A.5.24"); // violation/deny
  });

  it("should query records by filter", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    at.record("allow", makeContext({ agentId: "main" }), { score: 60, tier: "trusted" }, { level: "low", score: 10 }, [], 500);
    at.record("deny", makeContext({ agentId: "forge" }), { score: 30, tier: "restricted" }, { level: "high", score: 70 }, [], 500);
    at.flush();

    const results = at.query({ agentId: "forge" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.context.agentId === "forge")).toBe(true);
  });

  it("should respect retention and clean old files", () => {
    const config = { ...makeAuditConfig(), retentionDays: 1 };
    const auditDir = join(WORKSPACE, "governance", "audit");

    // Create an old file
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 5);
    const oldFileName = oldDate.toISOString().slice(0, 10) + ".jsonl";
    writeFileSync(join(auditDir, oldFileName), '{"test": true}\n');

    const at = new AuditTrail(config, WORKSPACE, logger);
    at.load();

    // Old file should be cleaned
    expect(existsSync(join(auditDir, oldFileName))).toBe(false);
  });

  it("should preserve cross-agent context in records", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    const rec = at.record(
      "deny",
      makeContext({
        crossAgent: {
          parentAgentId: "main",
          parentSessionKey: "agent:main",
          inheritedPolicyIds: ["policy-1"],
          trustCeiling: 60,
        },
      }),
      { score: 45, tier: "standard" },
      { level: "medium", score: 50 },
      [],
      500,
    );

    expect(rec.context.crossAgent?.parentAgentId).toBe("main");
    expect(rec.context.crossAgent?.trustCeiling).toBe(60);
  });

  it("should return stats", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();

    at.record("allow", makeContext(), { score: 60, tier: "trusted" }, { level: "low", score: 10 }, [], 500);

    const stats = at.getStats();
    expect(stats.todayRecords).toBe(1);
  });

  it("should handle stopAutoFlush", () => {
    const at = new AuditTrail(makeAuditConfig(), WORKSPACE, logger);
    at.load();
    at.startAutoFlush();

    at.record("allow", makeContext(), { score: 60, tier: "trusted" }, { level: "low", score: 10 }, [], 500);
    at.stopAutoFlush();

    // Should have flushed on stop
    const auditDir = join(WORKSPACE, "governance", "audit");
    const files = readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import { RiskAssessor } from "../src/risk-assessor.js";
import type { EvaluationContext, FrequencyTracker } from "../src/types.js";

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 60, tier: "trusted" },
    toolName: "exec",
    ...overrides,
  };
}

const noFreq: FrequencyTracker = { record: () => {}, count: () => 0, clear: () => {} };

describe("RiskAssessor", () => {
  it("should assess risk for a known tool", () => {
    const ra = new RiskAssessor({});
    const result = ra.assess(makeCtx(), noFreq);

    expect(result.level).toBeDefined();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(5);
  });

  it("should compute higher risk for critical tools", () => {
    const ra = new RiskAssessor({});
    const gateway = ra.assess(makeCtx({ toolName: "gateway" }), noFreq);
    const read = ra.assess(makeCtx({ toolName: "read" }), noFreq);

    expect(gateway.score).toBeGreaterThan(read.score);
  });

  it("should compute higher risk during off-hours", () => {
    const ra = new RiskAssessor({});
    const day = ra.assess(makeCtx({ time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" } }), noFreq);
    const night = ra.assess(makeCtx({ time: { hour: 2, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" } }), noFreq);

    expect(night.score).toBeGreaterThan(day.score);
  });

  it("should compute higher risk for low trust", () => {
    const ra = new RiskAssessor({});
    const high = ra.assess(makeCtx({ trust: { score: 80, tier: "privileged" } }), noFreq);
    const low = ra.assess(makeCtx({ trust: { score: 10, tier: "untrusted" } }), noFreq);

    expect(low.score).toBeGreaterThan(high.score);
  });

  it("should use tool risk overrides", () => {
    const ra = new RiskAssessor({ read: 90 });
    const result = ra.assess(makeCtx({ toolName: "read" }), noFreq);

    // With override read=90, risk should be higher
    const raDefault = new RiskAssessor({});
    const defaultResult = raDefault.assess(makeCtx({ toolName: "read" }), noFreq);

    expect(result.score).toBeGreaterThan(defaultResult.score);
  });

  it("should handle unknown tools with default risk", () => {
    const ra = new RiskAssessor({});
    const result = ra.assess(makeCtx({ toolName: "custom_tool" }), noFreq);
    expect(result.score).toBeGreaterThan(0);
  });

  it("should handle missing toolName", () => {
    const ra = new RiskAssessor({});
    const result = ra.assess(makeCtx({ toolName: undefined }), noFreq);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("should factor in frequency", () => {
    const ra = new RiskAssessor({});
    const highFreq: FrequencyTracker = { record: () => {}, count: () => 20, clear: () => {} };
    const high = ra.assess(makeCtx(), highFreq);
    const low = ra.assess(makeCtx(), noFreq);

    expect(high.score).toBeGreaterThan(low.score);
  });

  it("should detect external targets", () => {
    const ra = new RiskAssessor({});
    const ext = ra.assess(makeCtx({ toolParams: { host: "gateway" } }), noFreq);
    const int = ra.assess(makeCtx({ toolParams: { host: "sandbox" } }), noFreq);

    expect(ext.score).toBeGreaterThan(int.score);
  });

  it("should detect elevated as external", () => {
    const ra = new RiskAssessor({});
    const result = ra.assess(makeCtx({ toolParams: { elevated: true } }), noFreq);
    const normal = ra.assess(makeCtx({ toolParams: {} }), noFreq);

    expect(result.score).toBeGreaterThan(normal.score);
  });

  it("should detect messageTo as external target", () => {
    const ra = new RiskAssessor({});
    const result = ra.assess(makeCtx({ messageTo: "user@example.com" }), noFreq);
    const normal = ra.assess(makeCtx(), noFreq);

    expect(result.score).toBeGreaterThan(normal.score);
  });

  it("should classify risk levels correctly", () => {
    const ra = new RiskAssessor({});
    // Low: read, trusted, business hours, no freq, internal
    const low = ra.assess(makeCtx({
      toolName: "read",
      trust: { score: 80, tier: "privileged" },
    }), noFreq);
    expect(low.level).toBe("low");

    // Critical: gateway, untrusted, off-hours, high freq, external
    const highFreq: FrequencyTracker = { record: () => {}, count: () => 30, clear: () => {} };
    const critical = ra.assess(makeCtx({
      toolName: "gateway",
      trust: { score: 5, tier: "untrusted" },
      time: { hour: 2, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
      toolParams: { elevated: true },
    }), highFreq);
    expect(critical.level).toBe("critical");
  });
});

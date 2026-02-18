import { describe, expect, it } from "vitest";
import { evaluateTimeCondition } from "../../src/conditions/time.js";
import type { ConditionDeps, EvaluationContext, TimeCondition } from "../../src/types.js";

function makeCtx(hour: number, minute: number, dayOfWeek = 3): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: { hour, minute, dayOfWeek, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 60, tier: "trusted" },
  };
}

const stubFreq = { record: () => {}, count: () => 0, clear: () => {} };

function makeDeps(windows: ConditionDeps["timeWindows"] = {}): ConditionDeps {
  return {
    regexCache: new Map(),
    timeWindows: windows,
    risk: { level: "low", score: 10, factors: [] },
    frequencyTracker: stubFreq,
  };
}

describe("evaluateTimeCondition", () => {
  it("should match normal time range", () => {
    const cond: TimeCondition = { type: "time", after: "08:00", before: "17:00" };
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(7, 59), makeDeps())).toBe(false);
    expect(evaluateTimeCondition(cond, makeCtx(17, 0), makeDeps())).toBe(false);
  });

  it("should match midnight wrap range", () => {
    const cond: TimeCondition = { type: "time", after: "23:00", before: "06:00" };
    expect(evaluateTimeCondition(cond, makeCtx(23, 30), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(2, 0), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(false);
  });

  it("should match day-of-week filter", () => {
    const cond: TimeCondition = { type: "time", days: [1, 2, 3, 4, 5] }; // Mon-Fri
    expect(evaluateTimeCondition(cond, makeCtx(12, 0, 3), makeDeps())).toBe(true); // Wed
    expect(evaluateTimeCondition(cond, makeCtx(12, 0, 0), makeDeps())).toBe(false); // Sun
    expect(evaluateTimeCondition(cond, makeCtx(12, 0, 6), makeDeps())).toBe(false); // Sat
  });

  it("should match named time window", () => {
    const windows = {
      maintenance: { name: "Maintenance", start: "02:00", end: "04:00" },
    };
    const cond: TimeCondition = { type: "time", window: "maintenance" };
    expect(evaluateTimeCondition(cond, makeCtx(3, 0), makeDeps(windows))).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps(windows))).toBe(false);
  });

  it("should fail for unknown named window", () => {
    const cond: TimeCondition = { type: "time", window: "nonexistent" };
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(false);
  });

  it("should handle named window with day filter", () => {
    const windows = {
      weekday_maint: { name: "Weekday Maintenance", start: "02:00", end: "04:00", days: [1, 2, 3, 4, 5] },
    };
    const cond: TimeCondition = { type: "time", window: "weekday_maint" };
    expect(evaluateTimeCondition(cond, makeCtx(3, 0, 3), makeDeps(windows))).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(3, 0, 0), makeDeps(windows))).toBe(false); // Sunday
  });

  it("should match after-only (no before)", () => {
    const cond: TimeCondition = { type: "time", after: "18:00" };
    expect(evaluateTimeCondition(cond, makeCtx(20, 0), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(10, 0), makeDeps())).toBe(false);
  });

  it("should match before-only (no after)", () => {
    const cond: TimeCondition = { type: "time", before: "06:00" };
    expect(evaluateTimeCondition(cond, makeCtx(3, 0), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(false);
  });

  it("should handle edge: start == end in window", () => {
    const cond: TimeCondition = { type: "time", after: "12:00", before: "12:00" };
    // Same start/end → nothing matches (0-width window)
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(false);
  });

  it("should match with no time constraints (only days)", () => {
    const cond: TimeCondition = { type: "time", days: [3] };
    expect(evaluateTimeCondition(cond, makeCtx(12, 0, 3), makeDeps())).toBe(true);
    expect(evaluateTimeCondition(cond, makeCtx(12, 0, 4), makeDeps())).toBe(false);
  });

  it("should return true with empty condition", () => {
    const cond: TimeCondition = { type: "time" };
    expect(evaluateTimeCondition(cond, makeCtx(12, 0), makeDeps())).toBe(true);
  });
});

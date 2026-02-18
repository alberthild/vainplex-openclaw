import { describe, expect, it } from "vitest";
import { evaluateToolCondition } from "../../src/conditions/tool.js";
import type { ConditionDeps, EvaluationContext, RiskAssessment, ToolCondition } from "../../src/types.js";

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 60, tier: "trusted" },
    toolName: "exec",
    toolParams: { command: "docker rm container-x" },
    ...overrides,
  };
}

const stubRisk: RiskAssessment = { level: "low", score: 10, factors: [] };
const stubFreq = { record: () => {}, count: () => 0, clear: () => {} };
const deps: ConditionDeps = {
  regexCache: new Map<string, RegExp>([
    ["docker rm", new RegExp("docker rm")],
    ["git push.*(main|master)", new RegExp("git push.*(main|master)")],
  ]),
  timeWindows: {},
  risk: stubRisk,
  frequencyTracker: stubFreq,
};

describe("evaluateToolCondition", () => {
  it("should match exact tool name", () => {
    const cond: ToolCondition = { type: "tool", name: "exec" };
    expect(evaluateToolCondition(cond, makeCtx(), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "read" }), deps)).toBe(false);
  });

  it("should match glob tool name", () => {
    const cond: ToolCondition = { type: "tool", name: "memory_*" };
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "memory_search" }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "exec" }), deps)).toBe(false);
  });

  it("should match array of tool names", () => {
    const cond: ToolCondition = { type: "tool", name: ["exec", "write"] };
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "exec" }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "write" }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolName: "read" }), deps)).toBe(false);
  });

  it("should match param with contains", () => {
    const cond: ToolCondition = {
      type: "tool",
      name: "exec",
      params: { command: { contains: "docker rm" } },
    };
    expect(evaluateToolCondition(cond, makeCtx(), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { command: "ls -la" } }), deps)).toBe(false);
  });

  it("should match param with equals", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { elevated: { equals: true } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { elevated: true } }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { elevated: false } }), deps)).toBe(false);
  });

  it("should match param with matches (regex)", () => {
    const cond: ToolCondition = {
      type: "tool",
      name: "exec",
      params: { command: { matches: "git push.*(main|master)" } },
    };
    const ctx = makeCtx({ toolParams: { command: "git push origin main" } });
    expect(evaluateToolCondition(cond, ctx, deps)).toBe(true);
    const ctx2 = makeCtx({ toolParams: { command: "git push origin dev" } });
    expect(evaluateToolCondition(cond, ctx2, deps)).toBe(false);
  });

  it("should match param with startsWith", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { command: { startsWith: "sudo" } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { command: "sudo rm -rf" } }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { command: "ls -la" } }), deps)).toBe(false);
  });

  it("should match param with in", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { host: { in: ["sandbox", "gateway"] } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { host: "sandbox" } }), deps)).toBe(true);
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { host: "node" } }), deps)).toBe(false);
  });

  it("should match when no name specified (any tool)", () => {
    const cond: ToolCondition = { type: "tool" };
    expect(evaluateToolCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail if toolName is missing", () => {
    const cond: ToolCondition = { type: "tool", name: "exec" };
    expect(evaluateToolCondition(cond, makeCtx({ toolName: undefined }), deps)).toBe(false);
  });

  it("should fail if toolParams is missing when params required", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { command: { contains: "test" } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: undefined }), deps)).toBe(false);
  });

  it("should handle regex matches with uncached pattern", () => {
    const emptyDeps = { ...deps, regexCache: new Map<string, RegExp>() };
    const cond: ToolCondition = {
      type: "tool",
      params: { command: { matches: "docker.*" } },
    };
    expect(evaluateToolCondition(cond, makeCtx(), emptyDeps)).toBe(true);
  });

  it("should handle invalid regex in matches gracefully", () => {
    const emptyDeps = { ...deps, regexCache: new Map<string, RegExp>() };
    const cond: ToolCondition = {
      type: "tool",
      params: { command: { matches: "[invalid" } },
    };
    expect(evaluateToolCondition(cond, makeCtx(), emptyDeps)).toBe(false);
  });

  it("should handle non-string value with matches", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { count: { matches: "\\d+" } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { count: 42 } }), deps)).toBe(false);
  });

  it("should handle non-string value with contains", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { count: { contains: "42" } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { count: 42 } }), deps)).toBe(false);
  });

  it("should handle non-string value with startsWith", () => {
    const cond: ToolCondition = {
      type: "tool",
      params: { count: { startsWith: "4" } },
    };
    expect(evaluateToolCondition(cond, makeCtx({ toolParams: { count: 42 } }), deps)).toBe(false);
  });
});

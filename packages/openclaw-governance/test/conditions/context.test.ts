import { describe, expect, it } from "vitest";
import { evaluateContextCondition } from "../../src/conditions/context.js";
import type { ConditionDeps, ContextCondition, EvaluationContext } from "../../src/types.js";

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    timestamp: Date.now(),
    time: { hour: 12, minute: 0, dayOfWeek: 3, date: "2026-02-18", timezone: "UTC" },
    trust: { score: 60, tier: "trusted" },
    channel: "matrix",
    conversationContext: ["User said: fix JIRA-1234", "Agent: looking into it"],
    messageContent: "Hello world",
    metadata: { ticketId: "JIRA-1234", priority: "high" },
    ...overrides,
  };
}

const stubFreq = { record: () => {}, count: () => 0, clear: () => {} };
const deps: ConditionDeps = {
  regexCache: new Map<string, RegExp>([
    ["JIRA-\\d+", new RegExp("JIRA-\\d+")],
  ]),
  timeWindows: {},
  risk: { level: "low", score: 10, factors: [] },
  frequencyTracker: stubFreq,
};

describe("evaluateContextCondition", () => {
  it("should match conversationContains with regex", () => {
    const cond: ContextCondition = { type: "context", conversationContains: "JIRA-\\d+" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail conversationContains when not found", () => {
    const cond: ContextCondition = { type: "context", conversationContains: "TICKET-\\d+" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(false);
  });

  it("should fail conversationContains with empty context", () => {
    const cond: ContextCondition = { type: "context", conversationContains: "JIRA" };
    expect(evaluateContextCondition(cond, makeCtx({ conversationContext: [] }), deps)).toBe(false);
  });

  it("should match messageContains", () => {
    const cond: ContextCondition = { type: "context", messageContains: "Hello" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail messageContains when not found", () => {
    const cond: ContextCondition = { type: "context", messageContains: "goodbye" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(false);
  });

  it("should fail messageContains with no content", () => {
    const cond: ContextCondition = { type: "context", messageContains: "test" };
    expect(evaluateContextCondition(cond, makeCtx({ messageContent: undefined }), deps)).toBe(false);
  });

  it("should match hasMetadata", () => {
    const cond: ContextCondition = { type: "context", hasMetadata: "ticketId" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should match hasMetadata array (all must exist)", () => {
    const cond: ContextCondition = { type: "context", hasMetadata: ["ticketId", "priority"] };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail hasMetadata when key missing", () => {
    const cond: ContextCondition = { type: "context", hasMetadata: "nonexistent" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(false);
  });

  it("should match channel", () => {
    const cond: ContextCondition = { type: "context", channel: "matrix" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should match channel array", () => {
    const cond: ContextCondition = { type: "context", channel: ["matrix", "telegram"] };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail channel when not matching", () => {
    const cond: ContextCondition = { type: "context", channel: "telegram" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(false);
  });

  it("should match sessionKey glob", () => {
    const cond: ContextCondition = { type: "context", sessionKey: "agent:*" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should fail sessionKey when not matching", () => {
    const cond: ContextCondition = { type: "context", sessionKey: "other:*" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(false);
  });

  it("should match empty condition (no constraints)", () => {
    const cond: ContextCondition = { type: "context" };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });

  it("should match conversationContains array", () => {
    const cond: ContextCondition = { type: "context", conversationContains: ["NOPE", "JIRA-\\d+"] };
    expect(evaluateContextCondition(cond, makeCtx(), deps)).toBe(true);
  });
});

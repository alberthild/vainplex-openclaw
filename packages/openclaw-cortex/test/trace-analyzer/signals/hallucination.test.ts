import { describe, it, expect, beforeEach } from "vitest";
import { detectHallucinations } from "../../../src/trace-analyzer/signals/hallucination.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../../src/trace-analyzer/chain-reconstructor.js";
import { SignalPatternRegistry } from "../../../src/trace-analyzer/signals/lang/index.js";
import type { SignalPatternSet } from "../../../src/trace-analyzer/signals/lang/index.js";

const registry = new SignalPatternRegistry();
registry.loadSync(["en", "de"]);
const patterns: SignalPatternSet = registry.getPatterns();

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000;
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

function makeChain(
  events: NormalizedEvent[],
  overrides: Partial<ConversationChain> = {},
): ConversationChain {
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    id: `chain-${events[0]?.seq ?? 0}`,
    agent: events[0]?.agent ?? "main",
    session: events[0]?.session ?? "test-session",
    startTs: events[0]?.ts ?? 0,
    endTs: events[events.length - 1]?.ts ?? 0,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

beforeEach(() => resetCounters());

// ---- Tests ----

describe("SIG-HALLUCINATION detector", () => {
  // ---- Positive detection (3+) ----

  it("detects 'Done ✅' after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy to prod" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "scp app prod:/deploy/" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Done ✅ — app deployed to production." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-HALLUCINATION");
  });

  it("detects 'erledigt' after tool failure", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "restart nginx" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "systemctl restart nginx" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Unit not found" }),
      makeEvent("msg.out", { content: "Erledigt, nginx läuft wieder." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(1);
  });

  it("detects 'Successfully deployed' after connection failure", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy.sh" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "ETIMEDOUT" }),
      makeEvent("msg.out", { content: "Successfully deployed the new version." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(1);
  });

  it("handles multiple msg.out — only flags ones following failures", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "do two things" }),
      // First task succeeds
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "task1" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Task 1 done." }),
      // Second task fails
      makeEvent("msg.in", { content: "now task 2" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "task2" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Failed" }),
      makeEvent("msg.out", { content: "Task 2 completed successfully." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    // Only the second msg.out should be flagged
    expect(signals.length).toBe(1);
    expect(signals[0].evidence.agentClaim).toContain("Task 2");
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect 'Done' after successful tool result", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy.sh" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Done — deployed successfully." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect question 'Is it done?' after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check status" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "status" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error" }),
      makeEvent("msg.out", { content: "Is it done? I'm not sure the command worked." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases ----

  it("does NOT detect claims in chains without tool results", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "what time is it?" }),
      makeEvent("msg.out", { content: "Done, I've checked the time." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(0);
  });

  it("handles chain with no tool calls (no signal)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "hello" }),
      makeEvent("msg.out", { content: "Hi there! Finished setting up." }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(0);
  });

  // ---- Severity ----

  it("severity is 'critical'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "fix bug" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "patch apply" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Patch failed" }),
      makeEvent("msg.out", { content: "Fixed the bug ✓" }),
    ]);

    const signals = detectHallucinations(chain, patterns);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("critical");
  });
});

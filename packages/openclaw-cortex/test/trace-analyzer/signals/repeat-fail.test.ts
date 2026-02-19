import { describe, it, expect, beforeEach } from "vitest";
import {
  detectRepeatFails,
  createRepeatFailState,
  type RepeatFailState,
} from "../../../src/trace-analyzer/signals/repeat-fail.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../../src/trace-analyzer/chain-reconstructor.js";

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

describe("SIG-REPEAT-FAIL detector", () => {
  // ---- Positive detection (3+) ----

  it("detects same tool+params+error across two different sessions", () => {
    const state = createRepeatFailState();
    const params = { command: "ssh backup df -h" };

    // Session 1: failure recorded
    const chain1 = makeChain([
      makeEvent("msg.in", { content: "check disk" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Could not connect." }),
    ], { session: "session-A" });

    const signals1 = detectRepeatFails(chain1, state);
    expect(signals1.length).toBe(0); // First occurrence — no repeat yet

    // Session 2: same failure → repeat detected
    resetCounters();
    const chain2 = makeChain([
      makeEvent("msg.in", { content: "check disk on backup" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Failed again." }),
    ], { session: "session-B" });

    const signals2 = detectRepeatFails(chain2, state);
    expect(signals2.length).toBe(1);
    expect(signals2[0].signal).toBe("SIG-REPEAT-FAIL");
    expect(signals2[0].evidence.count).toBe(2);
  });

  it("increments count for 3rd session → severity 'critical'", () => {
    const state = createRepeatFailState();
    const params = { command: "ssh backup" };

    // Session 1
    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "sess-1" });
    detectRepeatFails(chain1, state);

    // Session 2
    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "sess-2" });
    detectRepeatFails(chain2, state);

    // Session 3
    resetCounters();
    const chain3 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "sess-3" });
    const signals3 = detectRepeatFails(chain3, state);
    expect(signals3.length).toBe(1);
    expect(signals3[0].severity).toBe("critical");
    expect(signals3[0].evidence.count).toBe(3);
  });

  it("normalizes timestamps in error messages before fingerprinting", () => {
    const state = createRepeatFailState();
    const params = { command: "curl http://api" };

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error at 2026-02-19T14:30:00Z: connection timed out" }),
    ], { session: "sess-A" });
    detectRepeatFails(chain1, state);

    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error at 2026-02-20T08:15:00Z: connection timed out" }),
    ], { session: "sess-B" });

    const signals = detectRepeatFails(chain2, state);
    expect(signals.length).toBe(1); // Different timestamps normalized → same fingerprint
  });

  // ---- Negative detection (2+) ----

  it("does NOT flag within same session (that's doom-loop territory)", () => {
    const state = createRepeatFailState();
    const params = { command: "ssh backup" };

    const chain = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "same-session" });

    const signals = detectRepeatFails(chain, state);
    expect(signals.length).toBe(0);
  });

  it("different params → different fingerprint (no false match)", () => {
    const state = createRepeatFailState();

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh server-A" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "sess-1" });
    detectRepeatFails(chain1, state);

    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh server-B" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
    ], { session: "sess-2" });

    const signals = detectRepeatFails(chain2, state);
    expect(signals.length).toBe(0); // Different params → no repeat
  });

  // ---- Edge cases ----

  it("state persists fingerprints across calls", () => {
    const state = createRepeatFailState();
    const params = { command: "test" };

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "err" }),
    ], { session: "s1" });
    detectRepeatFails(chain1, state);

    expect(state.fingerprints.size).toBe(1);
  });

  it("returns empty on first-ever run (no previous state)", () => {
    const state = createRepeatFailState();

    const chain = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ls" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "not found" }),
    ], { session: "first-session" });

    const signals = detectRepeatFails(chain, state);
    expect(signals.length).toBe(0);
  });

  it("normalizes PIDs in error messages", () => {
    const state = createRepeatFailState();
    const params = { command: "service start" };

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Failed: pid=12345 crashed" }),
    ], { session: "s1" });
    detectRepeatFails(chain1, state);

    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Failed: pid=67890 crashed" }),
    ], { session: "s2" });

    const signals = detectRepeatFails(chain2, state);
    expect(signals.length).toBe(1); // PID normalized → same fingerprint
  });

  // ---- Severity ----

  it("severity is 'high' for 2 sessions, 'critical' for 3+", () => {
    const state = createRepeatFailState();
    const params = { command: "deploy" };

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Fail" }),
    ], { session: "s1" });
    detectRepeatFails(chain1, state);

    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Fail" }),
    ], { session: "s2" });
    const sig2 = detectRepeatFails(chain2, state);
    expect(sig2[0].severity).toBe("high");

    resetCounters();
    const chain3 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Fail" }),
    ], { session: "s3" });
    const sig3 = detectRepeatFails(chain3, state);
    expect(sig3[0].severity).toBe("critical");
  });
});

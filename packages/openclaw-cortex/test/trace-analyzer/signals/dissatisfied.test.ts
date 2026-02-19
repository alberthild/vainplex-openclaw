import { describe, it, expect, beforeEach } from "vitest";
import { detectDissatisfied } from "../../../src/trace-analyzer/signals/dissatisfied.js";
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

describe("SIG-DISSATISFIED detector", () => {
  // ---- Positive detection (3+) ----

  it("detects 'vergiss es' as last user message", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "fix the deployment" }),
      makeEvent("msg.out", { content: "I tried but got errors." }),
      makeEvent("msg.in", { content: "vergiss es" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-DISSATISFIED");
  });

  it("detects 'forget it' as last user message", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy to prod" }),
      makeEvent("msg.out", { content: "Failed again." }),
      makeEvent("msg.in", { content: "forget it, I'll handle this manually" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(1);
  });

  it("detects 'ich mach's selbst'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "update the config" }),
      makeEvent("msg.out", { content: "I don't know how." }),
      makeEvent("msg.in", { content: "ich mach's selbst" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(1);
  });

  it("detects 'this is useless'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "help me debug" }),
      makeEvent("msg.out", { content: "Try restarting." }),
      makeEvent("msg.in", { content: "this is useless" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(1);
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect 'danke, passt' (satisfaction)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("msg.out", { content: "Done." }),
      makeEvent("msg.in", { content: "danke, passt!" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect dissatisfaction in middle of chain (not session end)", () => {
    // "vergiss es" is in the middle, chain continues with more conversation
    const chain = makeChain([
      makeEvent("msg.in", { content: "fix bug" }),
      makeEvent("msg.out", { content: "Error." }),
      makeEvent("msg.in", { content: "vergiss es" }),
      makeEvent("msg.out", { content: "Okay, trying another approach." }),
      makeEvent("msg.in", { content: "yes, try that" }),
      makeEvent("msg.out", { content: "Fixed!" }),
      makeEvent("msg.in", { content: "danke" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases: recovery ----

  it("does NOT detect if agent resolves after dissatisfaction with apology", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "help me" }),
      makeEvent("msg.out", { content: "I can't do that." }),
      makeEvent("msg.in", { content: "this is useless" }),
      makeEvent("msg.out", { content: "Sorry, let me try a different approach." }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT flag 'thanks' as dissatisfaction", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("msg.out", { content: "Deployed!" }),
      makeEvent("msg.in", { content: "thanks, great job!" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Boundary ----

  it("handles chain with no user messages", () => {
    const chain = makeChain([
      makeEvent("msg.out", { content: "Hello?" }),
      makeEvent("msg.out", { content: "Anyone there?" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Severity ----

  it("severity is 'high'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "do something" }),
      makeEvent("msg.out", { content: "Failed." }),
      makeEvent("msg.in", { content: "forget it" }),
    ]);

    const signals = detectDissatisfied(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("high");
  });
});

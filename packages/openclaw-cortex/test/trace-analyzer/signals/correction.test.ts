import { describe, it, expect, beforeEach } from "vitest";
import { detectCorrections } from "../../../src/trace-analyzer/signals/correction.js";
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

describe("SIG-CORRECTION detector", () => {
  // ---- Positive detection (3+) ----

  it("detects 'nein, das ist falsch' after agent assertion", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Was ist 2+2?" }),
      makeEvent("msg.out", { content: "2 + 2 ergibt 5." }),
      makeEvent("msg.in", { content: "Nein, das ist falsch." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-CORRECTION");
  });

  it("detects 'that's not right' after agent assertion", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "What's the capital of France?" }),
      makeEvent("msg.out", { content: "The capital of France is Berlin." }),
      makeEvent("msg.in", { content: "That's not right, it's Paris." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-CORRECTION");
  });

  it("detects correction with German keywords like 'du hast dich geirrt'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Zeig mir die Logs" }),
      makeEvent("msg.out", { content: "Die Logs zeigen keine Fehler." }),
      makeEvent("msg.in", { content: "Du hast dich geirrt, da sind viele Fehler." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
  });

  it("detects 'wrong' after agent assertion", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy to staging" }),
      makeEvent("msg.out", { content: "Deployed to production." }),
      makeEvent("msg.in", { content: "Wrong — I said staging, not production!" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect 'nein' after agent question", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "help me with the config" }),
      makeEvent("msg.out", { content: "Soll ich die Datei überschreiben?" }),
      makeEvent("msg.in", { content: "nein" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(0);
  });

  it("returns empty for clean chain without corrections", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "hello" }),
      makeEvent("msg.out", { content: "Hi! How can I help?" }),
      makeEvent("msg.in", { content: "deploy the app" }),
      makeEvent("msg.out", { content: "Done, app is deployed." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect 'no' as standalone response to 'Should I do X?'", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check the logs" }),
      makeEvent("msg.out", { content: "Should I also restart the service?" }),
      makeEvent("msg.in", { content: "no" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases: recovery ----

  it("multiple corrections in same chain → multiple signals", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "q1" }),
      makeEvent("msg.out", { content: "Answer 1." }),
      makeEvent("msg.in", { content: "That's wrong." }),
      makeEvent("msg.out", { content: "Answer 2." }),
      makeEvent("msg.in", { content: "Still wrong, fix that." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(2);
  });

  it("does NOT detect correction in non-adjacent messages (msg.out → tool.call → msg.in)", () => {
    const chain = makeChain([
      makeEvent("msg.out", { content: "I deployed it." }),
      makeEvent("tool.call", { toolName: "exec" }),
      makeEvent("tool.result", { toolName: "exec", toolResult: "ok" }),
      makeEvent("msg.in", { content: "That's wrong." }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Boundary / edge cases ----

  it("handles empty content gracefully", () => {
    const chain = makeChain([
      makeEvent("msg.out", { content: "" }),
      makeEvent("msg.in", { content: "" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(0);
  });

  it("detects 'nein, ich meine etwas anderes' as correction (longer sentence with nein)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "do X" }),
      makeEvent("msg.out", { content: "I did Y." }),
      makeEvent("msg.in", { content: "nein, das meine ich nicht — ich wollte X" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
  });

  // ---- Severity ----

  it("severity is 'medium' for a correction", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check logs" }),
      makeEvent("msg.out", { content: "All clear." }),
      makeEvent("msg.in", { content: "Falsch, es gibt Fehler!" }),
    ]);

    const signals = detectCorrections(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("medium");
  });
});

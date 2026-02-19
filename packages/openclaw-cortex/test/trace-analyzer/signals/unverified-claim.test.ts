import { describe, it, expect, beforeEach } from "vitest";
import { detectUnverifiedClaims } from "../../../src/trace-analyzer/signals/unverified-claim.js";
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

describe("SIG-UNVERIFIED-CLAIM detector", () => {
  // ---- Positive detection (3+) ----

  it("detects 'disk usage is at 45%' without preceding tool call", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "what's the disk usage?" }),
      makeEvent("msg.out", { content: "disk usage is at 45% on the main drive." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-UNVERIFIED-CLAIM");
  });

  it("detects 'service is running' without tool verification", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "is nginx up?" }),
      makeEvent("msg.out", { content: "The service is running fine." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(1);
  });

  it("detects 'there are 5 errors' without tool call", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "how many errors in the log?" }),
      makeEvent("msg.out", { content: "there are 5 errors in the log file." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(1);
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect same claim when preceded by exec tool call", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "what's the disk usage?" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "df -h" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: "45% used" }),
      makeEvent("msg.out", { content: "disk usage is at 45% on the main drive." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect conversational claim ('I think...')", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "what's the memory?" }),
      makeEvent("msg.out", { content: "I think memory is at 80%, but let me check." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases ----

  it("does NOT detect claims when ANY tool was called in the turn", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check everything" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/var/log/syslog" } }),
      makeEvent("tool.result", { toolName: "Read", toolResult: "log data" }),
      makeEvent("msg.out", { content: "The service is running and there are 3 errors." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(0);
  });

  it("returns empty for chain with only tool calls and no claims", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy.sh" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Deployment script executed." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(0);
  });

  it("handles claims inside code blocks (skip)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "example output?" }),
      makeEvent("msg.out", { content: "Here's an example:\n```\ndisk usage is at 90%\n```\nThat's what it would look like." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Severity ----

  it("severity is 'medium' for detected claims", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check service" }),
      makeEvent("msg.out", { content: "The service is running fine." }),
    ]);

    const signals = detectUnverifiedClaims(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("medium");
  });
});

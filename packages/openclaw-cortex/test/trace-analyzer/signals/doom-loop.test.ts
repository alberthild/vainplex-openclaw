import { describe, it, expect, beforeEach } from "vitest";
import { detectDoomLoops, paramSimilarity } from "../../../src/trace-analyzer/signals/doom-loop.js";
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

describe("SIG-DOOM-LOOP detector", () => {
  // ---- Positive detection (3+) ----

  it("detects 3× identical exec failures as doom loop", () => {
    const params = { command: "ssh backup df -h" };
    const chain = makeChain([
      makeEvent("msg.in", { content: "check disk" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Disk looks fine." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-DOOM-LOOP");
    expect(signals[0].evidence.loopSize).toBe(3);
  });

  it("detects 5× failures as critical severity", () => {
    const params = { command: "curl http://service:8080" };
    const events = [makeEvent("msg.in", { content: "check service" })];
    for (let i = 0; i < 5; i++) {
      events.push(makeEvent("tool.call", { toolName: "exec", toolParams: params }));
      events.push(makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }));
    }
    events.push(makeEvent("msg.out", { content: "Service is up." }));

    const chain = makeChain(events);
    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("critical");
    expect(signals[0].evidence.loopSize).toBe(5);
  });

  it("detects loop with similar but not identical params (similarity > 0.8)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh prod deploy v1.0.0" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh prod deploy v1.0.1" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh prod deploy v1.0.2" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Deployed." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(1);
  });

  it("detects loop for non-exec tools (generic Jaccard similarity)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "read files" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/etc/config.json" } }),
      makeEvent("tool.result", { toolName: "Read", toolError: "EACCES: permission denied" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/etc/config.json" } }),
      makeEvent("tool.result", { toolName: "Read", toolError: "EACCES: permission denied" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/etc/config.json" } }),
      makeEvent("tool.result", { toolName: "Read", toolError: "EACCES: permission denied" }),
      makeEvent("msg.out", { content: "Here's the config." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(1);
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect loop when agent varies approach (different commands)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "connect" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh backup" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ping backup" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Host unreachable" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "nslookup backup" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Server not found" }),
      makeEvent("msg.out", { content: "Server is down." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect loop when 2nd attempt succeeds", () => {
    const params = { command: "ssh server df -h" };
    const chain = makeChain([
      makeEvent("msg.in", { content: "check disk" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Disk is at 45%." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases ----

  it("returns empty for chain with no tool calls", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "hello" }),
      makeEvent("msg.out", { content: "hi" }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect loop with dissimilar params (similarity < 0.8)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "do things" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "apt install nginx" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Package not found" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "systemctl restart postgresql" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Unit not found" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "docker-compose up -d" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "File not found" }),
      makeEvent("msg.out", { content: "All done." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Boundary ----

  it("loop of exactly 3 → severity 'high'", () => {
    const params = { command: "ssh backup" };
    const chain = makeChain([
      makeEvent("msg.in", { content: "connect" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("msg.out", { content: "Done." }),
    ]);

    const signals = detectDoomLoops(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("high");
  });

  // ---- paramSimilarity unit tests ----

  it("paramSimilarity: identical exec commands → 1.0", () => {
    expect(paramSimilarity(
      { command: "ssh backup df -h" },
      { command: "ssh backup df -h" },
    )).toBe(1.0);
  });

  it("paramSimilarity: completely different commands → low similarity", () => {
    const sim = paramSimilarity(
      { command: "apt install nginx" },
      { command: "docker-compose up -d production" },
    );
    expect(sim).toBeLessThan(0.5);
  });
});

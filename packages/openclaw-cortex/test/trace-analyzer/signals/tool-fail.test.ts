import { describe, it, expect, beforeEach } from "vitest";
import { detectToolFails } from "../../../src/trace-analyzer/signals/tool-fail.js";
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

describe("SIG-TOOL-FAIL detector", () => {
  // ---- Positive detection (3+) ----

  it("detects unrecovered tool failure → agent responds without recovery", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check disk" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "df -h" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Permission denied" }),
      makeEvent("msg.out", { content: "Disk looks fine." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-TOOL-FAIL");
    expect(signals[0].evidence.toolName).toBe("exec");
  });

  it("detects failure when retry with same params also fails", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "connect" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh server" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh server" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("msg.out", { content: "Connected successfully." }),
    ]);

    const signals = detectToolFails(chain);
    // Both failures are unrecovered (retries with same params don't count as recovery)
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  it("handles tool.result with toolIsError=true (Schema B)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "read file" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/etc/missing" } }),
      makeEvent("tool.result", { toolName: "Read", toolIsError: true, toolError: "ENOENT" }),
      makeEvent("msg.out", { content: "Here is the file content." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(1);
  });

  it("multiple unrecovered failures → multiple signals", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "do stuff" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "cmd1" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error 1" }),
      makeEvent("tool.call", { toolName: "Read", toolParams: { path: "/x" } }),
      makeEvent("tool.result", { toolName: "Read", toolError: "Not found" }),
      makeEvent("msg.out", { content: "Everything is fine." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(2);
  });

  // ---- Negative detection (2+) ----

  it("does NOT detect failure when agent recovers (different tool succeeds)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "scp file prod:/app/" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Permission denied (publickey)" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh-add ~/.ssh/prod_key" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Deployed successfully." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(0);
  });

  it("returns empty for chain with only successful tool calls", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "list files" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ls" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Here are the files." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Edge cases ----

  it("does NOT detect failure at chain end (no msg.out follows)", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "run test" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "npm test" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Test failed" }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(0);
  });

  it("does NOT flag if agent recovers with same tool but different params that succeed", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "connect" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh backup-server" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Connection refused" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ssh backup-server-alt" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Connected via alt host." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(0);
  });

  // ---- Severity ----

  it("severity is 'low' for single occurrence", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "whoami" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Command not found" }),
      makeEvent("msg.out", { content: "Done." }),
    ]);

    const signals = detectToolFails(chain);
    expect(signals.length).toBe(1);
    expect(signals[0].severity).toBe("low");
  });
});

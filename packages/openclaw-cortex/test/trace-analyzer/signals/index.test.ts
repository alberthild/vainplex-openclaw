import { describe, it, expect, beforeEach } from "vitest";
import { detectAllSignals, createRepeatFailState } from "../../../src/trace-analyzer/signals/index.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../../src/trace-analyzer/chain-reconstructor.js";
import type { TraceAnalyzerConfig } from "../../../src/trace-analyzer/config.js";
import { TRACE_ANALYZER_DEFAULTS } from "../../../src/trace-analyzer/config.js";

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

describe("Signal Registry — detectAllSignals", () => {
  it("runs all enabled detectors and returns findings", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy.sh" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Permission denied" }),
      makeEvent("msg.out", { content: "Successfully deployed ✅" }),
      makeEvent("msg.in", { content: "That's wrong, it failed!" }),
    ]);

    const findings = detectAllSignals([chain], TRACE_ANALYZER_DEFAULTS.signals);
    // Should detect: SIG-TOOL-FAIL, SIG-HALLUCINATION, SIG-CORRECTION
    const signalTypes = findings.map(f => f.signal.signal);
    expect(signalTypes).toContain("SIG-TOOL-FAIL");
    expect(signalTypes).toContain("SIG-HALLUCINATION");
    expect(signalTypes).toContain("SIG-CORRECTION");
  });

  it("returns empty for clean chain", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "hello" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "echo hi" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: { exitCode: 0 } }),
      makeEvent("msg.out", { content: "Hi there!" }),
    ]);

    const findings = detectAllSignals([chain], TRACE_ANALYZER_DEFAULTS.signals);
    expect(findings.length).toBe(0);
  });

  it("respects disabled signal config", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "check" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error" }),
      makeEvent("msg.out", { content: "Done." }),
    ]);

    const config: TraceAnalyzerConfig["signals"] = {
      ...TRACE_ANALYZER_DEFAULTS.signals,
      "SIG-TOOL-FAIL": { enabled: false },
      "SIG-HALLUCINATION": { enabled: false },
    };

    const findings = detectAllSignals([chain], config);
    const signalTypes = findings.map(f => f.signal.signal);
    expect(signalTypes).not.toContain("SIG-TOOL-FAIL");
    expect(signalTypes).not.toContain("SIG-HALLUCINATION");
  });

  it("applies severity override from config", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "check" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error" }),
      makeEvent("msg.out", { content: "All good." }),
    ]);

    const config: TraceAnalyzerConfig["signals"] = {
      ...TRACE_ANALYZER_DEFAULTS.signals,
      "SIG-TOOL-FAIL": { enabled: true, severity: "critical" },
    };

    const findings = detectAllSignals([chain], config);
    const toolFail = findings.find(f => f.signal.signal === "SIG-TOOL-FAIL");
    expect(toolFail).toBeDefined();
    expect(toolFail!.signal.severity).toBe("critical");
  });

  it("each finding has required fields", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "fix it" }),
      makeEvent("msg.out", { content: "I fixed it." }),
      makeEvent("msg.in", { content: "That's wrong!" }),
    ]);

    const findings = detectAllSignals([chain], TRACE_ANALYZER_DEFAULTS.signals);
    expect(findings.length).toBeGreaterThan(0);

    for (const finding of findings) {
      expect(finding.id).toBeTruthy();
      expect(finding.chainId).toBeTruthy();
      expect(finding.agent).toBe("main");
      expect(finding.session).toBe("test-session");
      expect(finding.signal).toBeDefined();
      expect(finding.signal.signal).toBeTruthy();
      expect(finding.signal.severity).toBeTruthy();
      expect(finding.signal.eventRange).toBeDefined();
      expect(finding.signal.summary).toBeTruthy();
      expect(finding.classification).toBeNull();
      expect(finding.detectedAt).toBeGreaterThan(0);
      expect(finding.occurredAt).toBeGreaterThan(0);
    }
  });

  it("handles multiple chains", () => {
    const chain1 = makeChain([
      makeEvent("msg.in", { content: "q1" }),
      makeEvent("msg.out", { content: "a1" }),
      makeEvent("msg.in", { content: "That's wrong" }),
    ], { id: "chain-1", session: "s1" });

    resetCounters();
    const chain2 = makeChain([
      makeEvent("msg.in", { content: "q2" }),
      makeEvent("msg.out", { content: "a2" }),
      makeEvent("msg.in", { content: "Falsch!" }),
    ], { id: "chain-2", session: "s2" });

    const findings = detectAllSignals([chain1, chain2], TRACE_ANALYZER_DEFAULTS.signals);
    const chainIds = new Set(findings.map(f => f.chainId));
    expect(chainIds.size).toBe(2);
  });

  it("runs SIG-REPEAT-FAIL cross-session detector with provided state", () => {
    const state = createRepeatFailState();
    const params = { command: "ssh backup" };

    const chain1 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("msg.out", { content: "Could not connect." }),
    ], { session: "session-1" });

    // First chain — seed the state
    detectAllSignals([chain1], TRACE_ANALYZER_DEFAULTS.signals, state);

    resetCounters();
    const chain2 = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: params }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("msg.out", { content: "Failed again." }),
    ], { session: "session-2" });

    // Second chain — should detect repeat
    const findings = detectAllSignals([chain2], TRACE_ANALYZER_DEFAULTS.signals, state);
    const repeatFails = findings.filter(f => f.signal.signal === "SIG-REPEAT-FAIL");
    expect(repeatFails.length).toBe(1);
  });

  it("SIG-UNVERIFIED-CLAIM is disabled by default", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check service" }),
      makeEvent("msg.out", { content: "The service is running fine." }),
    ]);

    const findings = detectAllSignals([chain], TRACE_ANALYZER_DEFAULTS.signals);
    const unverified = findings.filter(f => f.signal.signal === "SIG-UNVERIFIED-CLAIM");
    expect(unverified.length).toBe(0);
  });

  it("SIG-UNVERIFIED-CLAIM fires when explicitly enabled", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "check service" }),
      makeEvent("msg.out", { content: "The service is running fine." }),
    ]);

    const config: TraceAnalyzerConfig["signals"] = {
      ...TRACE_ANALYZER_DEFAULTS.signals,
      "SIG-UNVERIFIED-CLAIM": { enabled: true },
    };

    const findings = detectAllSignals([chain], config);
    const unverified = findings.filter(f => f.signal.signal === "SIG-UNVERIFIED-CLAIM");
    expect(unverified.length).toBe(1);
  });
});

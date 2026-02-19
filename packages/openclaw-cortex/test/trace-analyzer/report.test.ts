import { describe, it, expect } from "vitest";
import { assembleReport } from "../../src/trace-analyzer/report.js";
import type { ProcessingState } from "../../src/trace-analyzer/report.js";
import type { Finding } from "../../src/trace-analyzer/signals/types.js";
import type { ConversationChain } from "../../src/trace-analyzer/chain-reconstructor.js";
import type { GeneratedOutput } from "../../src/trace-analyzer/output-generator.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
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
  };
}

function makeChain(events: NormalizedEvent[], overrides: Partial<ConversationChain> = {}): ConversationChain {
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `finding-${Math.random().toString(36).slice(2, 10)}`,
    chainId: "chain-1",
    agent: "main",
    session: "test-session",
    signal: {
      signal: "SIG-TOOL-FAIL",
      severity: "medium",
      eventRange: { start: 0, end: 1 },
      summary: "Tool failed",
      evidence: {},
    },
    detectedAt: Date.now(),
    occurredAt: 1700000000000,
    classification: null,
    ...overrides,
  };
}

function makeOutput(overrides: Partial<GeneratedOutput> = {}): GeneratedOutput {
  return {
    id: "output-1",
    type: "soul_rule",
    content: "NIEMALS X",
    sourceFindings: ["finding-1"],
    observationCount: 1,
    confidence: 0.8,
    ...overrides,
  };
}

// ---- Tests ----

describe("assembleReport()", () => {
  it("assembles report with correct version field", () => {
    const report = assembleReport({
      startedAt: 1700000000000,
      completedAt: 1700000010000,
      eventsProcessed: 100,
      chains: [],
      findings: [],
      generatedOutputs: [],
    });

    expect(report.version).toBe(1);
  });

  it("generatedAt is ISO timestamp", () => {
    const report = assembleReport({
      startedAt: 1700000000000,
      completedAt: 1700000010000,
      eventsProcessed: 0,
      chains: [],
      findings: [],
      generatedOutputs: [],
    });

    // Check ISO format: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("stats computed correctly (events, chains, findings)", () => {
    seqCounter = 1;
    tsBase = 1700000000000;

    const events = [makeEvent("msg.in", { content: "hello" }), makeEvent("msg.out", { content: "hi" })];
    const chain = makeChain(events);
    const finding = makeFinding();

    const report = assembleReport({
      startedAt: 1700000000000,
      completedAt: 1700000010000,
      eventsProcessed: 500,
      chains: [chain],
      findings: [finding],
      generatedOutputs: [makeOutput()],
    });

    expect(report.stats.eventsProcessed).toBe(500);
    expect(report.stats.chainsReconstructed).toBe(1);
    expect(report.stats.findingsDetected).toBe(1);
    expect(report.stats.outputsGenerated).toBe(1);
  });

  it("stats.findingsClassified counts only classified findings", () => {
    const classified = makeFinding({
      classification: {
        rootCause: "test",
        actionType: "soul_rule",
        actionText: "rule",
        confidence: 0.8,
        model: "test",
      },
    });
    const unclassified = makeFinding({ classification: null });

    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings: [classified, unclassified],
      generatedOutputs: [],
    });

    expect(report.stats.findingsDetected).toBe(2);
    expect(report.stats.findingsClassified).toBe(1);
  });

  it("signal stats aggregated by signal type", () => {
    const findings = [
      makeFinding({ signal: { signal: "SIG-TOOL-FAIL", severity: "medium", eventRange: { start: 0, end: 1 }, summary: "fail 1", evidence: {} } }),
      makeFinding({ signal: { signal: "SIG-TOOL-FAIL", severity: "high", eventRange: { start: 0, end: 1 }, summary: "fail 2", evidence: {} } }),
      makeFinding({ signal: { signal: "SIG-DOOM-LOOP", severity: "high", eventRange: { start: 0, end: 3 }, summary: "loop", evidence: {} } }),
    ];

    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings,
      generatedOutputs: [],
    });

    expect(report.signalStats).toHaveLength(2);
    const toolFailStats = report.signalStats.find(s => s.signal === "SIG-TOOL-FAIL");
    expect(toolFailStats!.count).toBe(2);
    expect(toolFailStats!.bySeverity.medium).toBe(1);
    expect(toolFailStats!.bySeverity.high).toBe(1);

    const doomStats = report.signalStats.find(s => s.signal === "SIG-DOOM-LOOP");
    expect(doomStats!.count).toBe(1);
  });

  it("top agents computed per signal", () => {
    const findings = [
      makeFinding({ agent: "main", signal: { signal: "SIG-TOOL-FAIL", severity: "medium", eventRange: { start: 0, end: 1 }, summary: "f", evidence: {} } }),
      makeFinding({ agent: "main", signal: { signal: "SIG-TOOL-FAIL", severity: "medium", eventRange: { start: 0, end: 1 }, summary: "f", evidence: {} } }),
      makeFinding({ agent: "forge", signal: { signal: "SIG-TOOL-FAIL", severity: "medium", eventRange: { start: 0, end: 1 }, summary: "f", evidence: {} } }),
    ];

    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings,
      generatedOutputs: [],
    });

    const stats = report.signalStats.find(s => s.signal === "SIG-TOOL-FAIL")!;
    expect(stats.topAgents[0].agent).toBe("main");
    expect(stats.topAgents[0].count).toBe(2);
    expect(stats.topAgents[1].agent).toBe("forge");
    expect(stats.topAgents[1].count).toBe(1);
  });

  it("time range extracted from chains", () => {
    seqCounter = 1;
    tsBase = 1700000000000;

    const events1 = [makeEvent("msg.in"), makeEvent("msg.out")];
    const chain1 = makeChain(events1);
    tsBase = 1700000050000;
    const events2 = [makeEvent("msg.in"), makeEvent("msg.out")];
    const chain2 = makeChain(events2);

    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [chain1, chain2],
      findings: [],
      generatedOutputs: [],
    });

    expect(report.stats.timeRange.startMs).toBe(chain1.startTs);
    expect(report.stats.timeRange.endMs).toBe(chain2.endTs);
  });

  it("processing state updated correctly", () => {
    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 100,
      chains: [],
      findings: [makeFinding(), makeFinding()],
      generatedOutputs: [],
    });

    expect(report.processingState.totalEventsProcessed).toBe(100);
    expect(report.processingState.totalFindings).toBe(2);
    expect(report.processingState.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("incremental totals accumulate across runs", () => {
    const previousState: Partial<ProcessingState> = {
      totalEventsProcessed: 500,
      totalFindings: 10,
      lastProcessedTs: 1700000000000,
      lastProcessedSeq: 100,
    };

    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 200,
      chains: [],
      findings: [makeFinding(), makeFinding(), makeFinding()],
      generatedOutputs: [],
      previousState,
    });

    expect(report.processingState.totalEventsProcessed).toBe(700); // 500 + 200
    expect(report.processingState.totalFindings).toBe(13); // 10 + 3
  });

  it("handles empty findings", () => {
    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings: [],
      generatedOutputs: [],
    });

    expect(report.findings).toEqual([]);
    expect(report.signalStats).toEqual([]);
    expect(report.stats.findingsDetected).toBe(0);
    expect(report.stats.findingsClassified).toBe(0);
  });

  it("handles empty chains", () => {
    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings: [],
      generatedOutputs: [],
    });

    expect(report.stats.chainsReconstructed).toBe(0);
    expect(report.stats.timeRange.startMs).toBe(0);
    expect(report.stats.timeRange.endMs).toBe(0);
  });

  it("includes ruleEffectiveness when provided", () => {
    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings: [],
      generatedOutputs: [],
      ruleEffectiveness: [{
        ruleId: "rule-1",
        ruleText: "NIEMALS X",
        deployedAt: 1700000000000,
        failuresBefore: 10,
        failuresAfter: 2,
        effectivenessPercent: 80,
        status: "effective",
      }],
    });

    expect(report.ruleEffectiveness).toHaveLength(1);
    expect(report.ruleEffectiveness[0].status).toBe("effective");
  });

  it("defaults ruleEffectiveness to empty array", () => {
    const report = assembleReport({
      startedAt: 0,
      completedAt: 0,
      eventsProcessed: 0,
      chains: [],
      findings: [],
      generatedOutputs: [],
    });

    expect(report.ruleEffectiveness).toEqual([]);
  });
});

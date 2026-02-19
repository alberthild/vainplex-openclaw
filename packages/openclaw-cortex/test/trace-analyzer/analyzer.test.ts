import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TraceAnalyzer } from "../../src/trace-analyzer/analyzer.js";
import type { TraceAnalyzerConfig } from "../../src/trace-analyzer/config.js";
import { TRACE_ANALYZER_DEFAULTS } from "../../src/trace-analyzer/config.js";
import type { AnalysisReport, ProcessingState } from "../../src/trace-analyzer/report.js";
import type { LlmConfig } from "../../src/llm-enhance.js";
import { MockTraceSource, makeEvent, resetCounters, createMockLogger } from "./helpers.js";

// ---- Fixtures ----

const LLM_DEFAULTS: LlmConfig = {
  enabled: false,
  endpoint: "http://localhost:11434/v1",
  model: "mistral:7b",
  apiKey: "",
  timeoutMs: 15000,
  batchSize: 3,
};

let workspace: string;
let logger: ReturnType<typeof createMockLogger>;

function enabledConfig(overrides?: Partial<TraceAnalyzerConfig>): TraceAnalyzerConfig {
  return {
    ...TRACE_ANALYZER_DEFAULTS,
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  resetCounters();
  workspace = join(tmpdir(), `cortex-analyzer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workspace, "memory", "reboot"), { recursive: true });
  logger = createMockLogger();
});

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("TraceAnalyzer", () => {
  describe("run() — full pipeline", () => {
    it("runs the full pipeline with a MockTraceSource and returns an AnalysisReport", async () => {
      const events = [
        makeEvent("msg.in", { content: "deploy to production" }),
        makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy.sh" } }),
        makeEvent("tool.result", { toolName: "exec", toolError: "Permission denied" }),
        makeEvent("msg.out", { content: "I deployed it successfully ✅" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();

      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      const report = await analyzer.run();

      expect(report.version).toBe(1);
      expect(report.stats.eventsProcessed).toBe(4);
      expect(report.stats.chainsReconstructed).toBeGreaterThanOrEqual(1);
      // Should detect hallucination (claims success after tool failure)
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeTruthy();
      expect(source.closed).toBe(true);
    });

    it("closes the TraceSource even when pipeline throws", async () => {
      const source = new MockTraceSource({ events: [] });
      const originalFetch = source.fetchByTimeRange.bind(source);
      // Override fetchByTimeRange to throw during iteration
      source.fetchByTimeRange = async function* () {
        throw new Error("NATS stream corrupted");
      };

      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await expect(analyzer.run()).rejects.toThrow("NATS stream corrupted");
      expect(source.closed).toBe(true);
    });

    it("returns empty report with zero findings when events have no failure patterns", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi there!" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      const report = await analyzer.run();

      expect(report.stats.eventsProcessed).toBe(2);
      expect(report.findings.length).toBe(0);
      expect(report.generatedOutputs.length).toBe(0);
    });
  });

  describe("incremental processing", () => {
    it("resumes from last processed timestamp on subsequent runs", async () => {
      const firstBatchEvents = [
        makeEvent("msg.in", { content: "first batch" }),
        makeEvent("msg.out", { content: "ok" }),
      ];

      const source1 = new MockTraceSource({ events: firstBatchEvents });
      const config = enabledConfig();

      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source1,
      });

      // First run
      const report1 = await analyzer.run();
      expect(report1.stats.eventsProcessed).toBe(2);

      // Verify state was persisted
      const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
      expect(existsSync(statePath)).toBe(true);

      const savedState = JSON.parse(readFileSync(statePath, "utf-8")) as ProcessingState;
      expect(savedState.lastProcessedTs).toBeGreaterThan(0);
      expect(savedState.totalEventsProcessed).toBe(2);
    });

    it("uses full range when no previous state exists", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi" }),
      ];

      const source = new MockTraceSource({ events });
      let capturedStartMs = -1;

      // Instrument the source to capture the time range
      const originalFetch = source.fetchByTimeRange.bind(source);
      source.fetchByTimeRange = async function* (startMs: number, endMs: number, opts) {
        capturedStartMs = startMs;
        yield* originalFetch(startMs, endMs, opts);
      };

      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();
      expect(capturedStartMs).toBe(0); // Full range — no previous state
    });

    it("uses incremental range when previous state exists", async () => {
      // Write a previous state
      const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
      const previousState: ProcessingState = {
        lastProcessedTs: 1700000005000,
        lastProcessedSeq: 5,
        totalEventsProcessed: 5,
        totalFindings: 0,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(statePath, JSON.stringify(previousState), "utf-8");

      const events = [
        makeEvent("msg.in", { content: "new event" }),
        makeEvent("msg.out", { content: "ok" }),
      ];

      const source = new MockTraceSource({ events });
      let capturedStartMs = -1;

      const originalFetch = source.fetchByTimeRange.bind(source);
      source.fetchByTimeRange = async function* (startMs: number, endMs: number, opts) {
        capturedStartMs = startMs;
        yield* originalFetch(startMs, endMs, opts);
      };

      const config = enabledConfig({ incrementalContextWindow: 10 }); // 10 minutes context
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();

      // Should start from lastProcessedTs minus context window
      const expectedStart = 1700000005000 - (10 * 60_000);
      expect(capturedStartMs).toBe(expectedStart);
    });
  });

  describe("full reprocess mode", () => {
    it("ignores previous state when opts.full is true", async () => {
      // Write a previous state
      const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
      const previousState: ProcessingState = {
        lastProcessedTs: 1700000005000,
        lastProcessedSeq: 5,
        totalEventsProcessed: 5,
        totalFindings: 0,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(statePath, JSON.stringify(previousState), "utf-8");

      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi" }),
      ];

      const source = new MockTraceSource({ events });
      let capturedStartMs = -1;

      const originalFetch = source.fetchByTimeRange.bind(source);
      source.fetchByTimeRange = async function* (startMs: number, endMs: number, opts) {
        capturedStartMs = startMs;
        yield* originalFetch(startMs, endMs, opts);
      };

      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run({ full: true });

      // Should start from 0 despite having previous state
      expect(capturedStartMs).toBe(0);
    });

    it("accumulates totalEventsProcessed across runs", async () => {
      // First run state
      const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
      const previousState: ProcessingState = {
        lastProcessedTs: 1700000005000,
        lastProcessedSeq: 5,
        totalEventsProcessed: 100,
        totalFindings: 3,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(statePath, JSON.stringify(previousState), "utf-8");

      const events = [
        makeEvent("msg.in", { content: "new" }),
        makeEvent("msg.out", { content: "ok" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      const report = await analyzer.run({ full: true });

      expect(report.processingState.totalEventsProcessed).toBe(102); // 100 + 2
    });
  });

  describe("LLM disabled", () => {
    it("skips classification when llm.enabled is false", async () => {
      const events = [
        makeEvent("msg.in", { content: "check disk" }),
        makeEvent("msg.out", { content: "Disk usage is at 45%" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig({ llm: { enabled: false } });
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      const report = await analyzer.run();

      // All findings should have classification=null
      for (const finding of report.findings) {
        expect(finding.classification).toBeNull();
      }
      expect(report.stats.findingsClassified).toBe(0);
    });
  });

  describe("TraceSource unavailable", () => {
    it("returns empty report when createSource returns null", async () => {
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => null,
      });

      const report = await analyzer.run();

      expect(report.stats.eventsProcessed).toBe(0);
      expect(report.stats.chainsReconstructed).toBe(0);
      expect(report.findings.length).toBe(0);
      expect(logger.messages.some(m => m.level === "warn" && m.msg.includes("No TraceSource"))).toBe(true);
    });

    it("returns empty report when createSource throws", async () => {
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => { throw new Error("NATS connection refused"); },
      });

      const report = await analyzer.run();

      expect(report.stats.eventsProcessed).toBe(0);
      expect(report.findings.length).toBe(0);
      expect(logger.messages.some(m => m.level === "warn" && m.msg.includes("connection failed"))).toBe(true);
    });

    it("returns empty report when no createSource is provided", async () => {
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
      });

      const report = await analyzer.run();

      expect(report.stats.eventsProcessed).toBe(0);
    });
  });

  describe("report persistence", () => {
    it("persists report to workspace/memory/reboot/trace-analysis-report.json", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();

      const reportPath = join(workspace, "memory", "reboot", "trace-analysis-report.json");
      expect(existsSync(reportPath)).toBe(true);

      const saved = JSON.parse(readFileSync(reportPath, "utf-8")) as AnalysisReport;
      expect(saved.version).toBe(1);
      expect(saved.stats.eventsProcessed).toBe(2);
    });

    it("persists report to custom path when configured", async () => {
      const customPath = join(workspace, "custom-report.json");
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig({ output: { maxFindings: 200, reportPath: customPath } });
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();

      expect(existsSync(customPath)).toBe(true);
      const saved = JSON.parse(readFileSync(customPath, "utf-8")) as AnalysisReport;
      expect(saved.version).toBe(1);
    });
  });

  describe("processing state persistence and reload", () => {
    it("persists state to trace-analyzer-state.json", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "hi" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();

      const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
      expect(existsSync(statePath)).toBe(true);

      const state = JSON.parse(readFileSync(statePath, "utf-8")) as ProcessingState;
      expect(state.lastProcessedTs).toBeGreaterThan(0);
      expect(state.totalEventsProcessed).toBe(2);
      expect(state.updatedAt).toBeTruthy();
    });

    it("reloads state on subsequent analyzer instantiation", async () => {
      // First run persists state
      const events1 = [
        makeEvent("msg.in", { content: "first" }),
        makeEvent("msg.out", { content: "ok" }),
      ];
      const source1 = new MockTraceSource({ events: events1 });
      const config = enabledConfig();

      const analyzer1 = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source1,
      });
      await analyzer1.run();

      // Second analyzer instance reads the persisted state
      const events2 = [
        makeEvent("msg.in", { content: "second" }),
        makeEvent("msg.out", { content: "ok" }),
      ];
      const source2 = new MockTraceSource({ events: events2 });

      const analyzer2 = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source2,
      });
      const report2 = await analyzer2.run();

      // Total should accumulate
      expect(report2.processingState.totalEventsProcessed).toBe(4); // 2 + 2
    });
  });

  describe("findings limit", () => {
    it("limits findings to config.output.maxFindings sorted by severity", async () => {
      // Create events that produce many findings
      // Multiple tool failures without recovery
      const events = [];
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent("msg.in", { content: `task ${i}` }));
        events.push(makeEvent("tool.call", { toolName: "exec", toolParams: { command: `cmd-${i}` } }));
        events.push(makeEvent("tool.result", { toolName: "exec", toolError: `Error ${i}` }));
        events.push(makeEvent("msg.out", { content: `I completed task ${i} successfully ✅` }));
      }

      const source = new MockTraceSource({ events });
      const config = enabledConfig({ output: { maxFindings: 3 } });
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      const report = await analyzer.run();

      expect(report.findings.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getStatus()", () => {
    it("returns status with null lastRun when no state exists", async () => {
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
      });

      const status = await analyzer.getStatus();
      expect(status.lastRun).toBeNull();
      expect(status.findings).toBe(0);
    });

    it("returns status with data after a run", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ls" } }),
        makeEvent("tool.result", { toolName: "exec", toolError: "not found" }),
        makeEvent("msg.out", { content: "done" }),
      ];

      const source = new MockTraceSource({ events });
      const config = enabledConfig();
      const analyzer = new TraceAnalyzer({
        config,
        logger,
        workspace,
        topLevelLlm: LLM_DEFAULTS,
        createSource: async () => source,
      });

      await analyzer.run();
      const status = await analyzer.getStatus();

      expect(status.lastRun).toBeTruthy();
      expect(status.state.totalEventsProcessed).toBe(4);
    });
  });
});

// ============================================================
// Trace Analyzer — Orchestrator (Stage 1 → 2 → 3)
// ============================================================
//
// The TraceAnalyzer class orchestrates the full analysis pipeline:
//   1. Connect to TraceSource
//   2. Fetch events (incremental or full)
//   3. Reconstruct chains
//   4. Detect signals (Stage 1)
//   5. Classify via LLM (Stage 2, optional)
//   6. Generate outputs (Stage 3)
//   7. Assemble report
//   8. Persist report + processing state
//   9. Close TraceSource
//
// Implements R-010, R-012, R-015, R-019, R-020, R-043–R-045.
// ============================================================

import { join } from "node:path";
import type { PluginLogger } from "../types.js";
import type { LlmConfig } from "../llm-enhance.js";
import type { TraceSource } from "./trace-source.js";
import type { TraceAnalyzerConfig, Severity } from "./config.js";
import type { NormalizedEvent } from "./events.js";
import type { ConversationChain } from "./chain-reconstructor.js";
import type { Finding } from "./signals/types.js";
import type { AnalysisReport, ProcessingState } from "./report.js";
import type { GeneratedOutput } from "./output-generator.js";
import { reconstructChains } from "./chain-reconstructor.js";
import { detectAllSignals, createRepeatFailState, SignalPatternRegistry } from "./signals/index.js";
import type { SignalPatternSet } from "./signals/index.js";
import { classifyFindings } from "./classifier.js";
import { generateOutputs } from "./output-generator.js";
import { assembleReport } from "./report.js";
import { loadJson, saveJson } from "../storage.js";

// ---- Severity ranking for sorting ----

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ---- Processing state path ----

function statePath(workspace: string): string {
  return join(workspace, "memory", "reboot", "trace-analyzer-state.json");
}

function reportPath(workspace: string, config: TraceAnalyzerConfig): string {
  return config.output.reportPath
    ?? join(workspace, "memory", "reboot", "trace-analysis-report.json");
}

// ---- Empty report factory ----

function emptyReport(startedAt: number, previousState: Partial<ProcessingState>): AnalysisReport {
  return assembleReport({
    startedAt,
    completedAt: Date.now(),
    eventsProcessed: 0,
    chains: [],
    findings: [],
    generatedOutputs: [],
    previousState,
  });
}

// ---- Main Orchestrator ----

export type TraceAnalyzerRunOpts = {
  /** If true, reprocesses all events from the beginning. */
  full?: boolean;
};

export type TraceAnalyzerStatus = {
  lastRun: string | null;
  findings: number;
  state: Partial<ProcessingState>;
};

/**
 * TraceAnalyzer — orchestrates the 3-stage analysis pipeline.
 *
 * Create via constructor, then call `run()` for a full analysis.
 * The analyzer manages its own processing state for incremental runs.
 */
export class TraceAnalyzer {
  private readonly config: TraceAnalyzerConfig;
  private readonly topLevelLlm: LlmConfig;
  private readonly workspace: string;
  private readonly logger: PluginLogger;
  private readonly createSource: (() => Promise<TraceSource | null>) | null;
  /** Pre-loaded signal patterns (if provided). */
  private signalPatterns: SignalPatternSet | undefined;

  constructor(params: {
    config: TraceAnalyzerConfig;
    logger: PluginLogger;
    workspace: string;
    topLevelLlm: LlmConfig;
    createSource?: () => Promise<TraceSource | null>;
    /** Pre-loaded signal patterns. If not provided, falls back to EN+DE. */
    signalPatterns?: SignalPatternSet;
  }) {
    this.config = params.config;
    this.logger = params.logger;
    this.workspace = params.workspace;
    this.topLevelLlm = params.topLevelLlm;
    this.createSource = params.createSource ?? null;
    this.signalPatterns = params.signalPatterns;
  }

  /**
   * Execute the full analysis pipeline.
   *
   * @param opts.full — If true, reprocess all events from the beginning.
   * @returns The analysis report.
   */
  async run(opts?: TraceAnalyzerRunOpts): Promise<AnalysisReport> {
    const startedAt = Date.now();
    const previousState = this.loadState();

    // 1. Connect to TraceSource
    let source: TraceSource | null = null;
    try {
      source = this.createSource ? await this.createSource() : null;
    } catch (err) {
      this.logger.warn(
        `[trace-analyzer] TraceSource connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!source) {
      this.logger.warn("[trace-analyzer] No TraceSource available — returning empty report");
      return emptyReport(startedAt, previousState);
    }

    try {
      return await this.executePipeline(source, startedAt, previousState, opts);
    } finally {
      // 9. Close TraceSource
      try {
        await source.close();
      } catch (err) {
        this.logger.warn(
          `[trace-analyzer] Failed to close TraceSource: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Get the current analyzer status.
   */
  async getStatus(): Promise<TraceAnalyzerStatus> {
    const state = this.loadState();
    return {
      lastRun: state.updatedAt || null,
      findings: state.totalFindings ?? 0,
      state,
    };
  }

  // ---- Private Pipeline Steps ----

  private async executePipeline(
    source: TraceSource,
    startedAt: number,
    previousState: Partial<ProcessingState>,
    opts?: TraceAnalyzerRunOpts,
  ): Promise<AnalysisReport> {
    // 2. Determine time range
    const isFullRun = opts?.full === true || !previousState.lastProcessedTs;
    const startMs = isFullRun
      ? 0
      : (previousState.lastProcessedTs ?? 0) - (this.config.incrementalContextWindow * 60_000);
    const endMs = Date.now();

    // Fetch events
    const events = source.fetchByTimeRange(Math.max(0, startMs), endMs, {
      batchSize: this.config.fetchBatchSize,
    });

    // 3. Reconstruct chains
    const chains = await reconstructChains(events, {
      gapMinutes: this.config.chainGapMinutes,
      maxEventsPerChain: 1000,
    });

    const eventsProcessed = chains.reduce((sum, c) => sum + c.events.length, 0);

    // 4. Stage 1 — Structural detection
    const repeatFailState = createRepeatFailState();
    let findings = detectAllSignals(chains, this.config.signals, repeatFailState, this.signalPatterns);

    // 5. Limit findings by severity priority
    if (findings.length > this.config.output.maxFindings) {
      findings = findings
        .sort((a, b) => SEVERITY_RANK[b.signal.severity] - SEVERITY_RANK[a.signal.severity])
        .slice(0, this.config.output.maxFindings);
    }

    // 6. Stage 2 — LLM classification (optional)
    if (this.config.llm.enabled) {
      const chainMap = new Map<string, ConversationChain>(chains.map(c => [c.id, c]));
      findings = await classifyFindings(
        findings,
        chainMap,
        this.config,
        this.topLevelLlm,
        this.logger,
      );
    }

    // 7. Stage 3 — Output generation
    const generatedOutputs: GeneratedOutput[] = generateOutputs(findings);

    // 8. Assemble report
    const report = assembleReport({
      startedAt,
      completedAt: Date.now(),
      eventsProcessed,
      chains,
      findings,
      generatedOutputs,
      previousState,
    });

    // Persist report
    const rPath = reportPath(this.workspace, this.config);
    saveJson(rPath, report, this.logger);

    // Persist processing state
    const sPath = statePath(this.workspace);
    saveJson(sPath, report.processingState, this.logger);

    this.logger.info(
      `[trace-analyzer] Analysis complete: ${eventsProcessed} events, ${chains.length} chains, ${findings.length} findings`,
    );

    return report;
  }

  private loadState(): Partial<ProcessingState> {
    const path = statePath(this.workspace);
    const raw = loadJson<Partial<ProcessingState>>(path);
    // loadJson returns {} on failure, which satisfies Partial<ProcessingState>
    return raw;
  }
}

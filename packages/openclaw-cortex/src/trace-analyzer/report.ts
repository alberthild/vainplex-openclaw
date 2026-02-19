// ============================================================
// Trace Analyzer — Report Assembly
// ============================================================
//
// Types for the analysis report and the assembleReport()
// function that combines all pipeline outputs into a final
// structured report. Implements R-019, R-020, R-040–R-042.
// ============================================================

import type { Finding, SignalId, Severity } from "./signals/types.js";
import type { ConversationChain } from "./chain-reconstructor.js";
import type { GeneratedOutput } from "./output-generator.js";

// ---- Types ----

/** Summary statistics for an analysis run. */
export type RunStats = {
  /** Run start timestamp (ms). */
  startedAt: number;
  /** Run end timestamp (ms). */
  completedAt: number;
  /** Total events fetched from trace source. */
  eventsProcessed: number;
  /** Conversation chains reconstructed. */
  chainsReconstructed: number;
  /** Findings produced (stage 1). */
  findingsDetected: number;
  /** Findings classified by LLM (stage 2). */
  findingsClassified: number;
  /** Rules/policies/patterns generated (stage 3). */
  outputsGenerated: number;
  /** Time range of analyzed events. */
  timeRange: { startMs: number; endMs: number };
};

/** Per-signal breakdown. */
export type SignalStats = {
  signal: SignalId;
  count: number;
  bySeverity: Partial<Record<Severity, number>>;
  topAgents: Array<{ agent: string; count: number }>;
};

/** Rule effectiveness tracking (feedback loop). */
export type RuleEffectiveness = {
  ruleId: string;
  ruleText: string;
  deployedAt: number;
  failuresBefore: number;
  failuresAfter: number;
  effectivenessPercent: number;
  status: "effective" | "marginal" | "ineffective" | "pending";
};

/** Processing state for incremental runs. */
export type ProcessingState = {
  /** Last processed event timestamp (ms). */
  lastProcessedTs: number;
  /** Last processed NATS sequence (if applicable). */
  lastProcessedSeq: number;
  /** Total events processed across all runs. */
  totalEventsProcessed: number;
  /** Total findings across all runs. */
  totalFindings: number;
  /** ISO timestamp of this state update. */
  updatedAt: string;
};

/** The complete analysis report. */
export type AnalysisReport = {
  /** Schema version. */
  version: 1;
  /** ISO timestamp of report generation. */
  generatedAt: string;
  /** Run statistics. */
  stats: RunStats;
  /** Per-signal breakdown. */
  signalStats: SignalStats[];
  /** All findings (limited by config.traceAnalyzer.output.maxFindings). */
  findings: Finding[];
  /** Generated outputs (rules, policies, patterns). */
  generatedOutputs: GeneratedOutput[];
  /** Rule effectiveness (feedback loop). */
  ruleEffectiveness: RuleEffectiveness[];
  /** Processing state for incremental runs. */
  processingState: ProcessingState;
};

// ---- Assembly ----

/** Parameters for assembleReport(). */
export type AssembleReportParams = {
  startedAt: number;
  completedAt: number;
  eventsProcessed: number;
  chains: ConversationChain[];
  findings: Finding[];
  generatedOutputs: GeneratedOutput[];
  previousState?: Partial<ProcessingState>;
  ruleEffectiveness?: RuleEffectiveness[];
};

/**
 * Build the top-N agents list from a count map, sorted by count descending.
 */
function buildTopAgents(
  agentCounts: Map<string, number>,
  limit = 5,
): Array<{ agent: string; count: number }> {
  return [...agentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([agent, count]) => ({ agent, count }));
}

/**
 * Compute per-signal statistics from findings.
 */
function computeSignalStats(findings: Finding[]): SignalStats[] {
  const statsMap = new Map<SignalId, {
    count: number;
    bySeverity: Partial<Record<Severity, number>>;
    agentCounts: Map<string, number>;
  }>();

  for (const finding of findings) {
    const sid = finding.signal.signal;
    let entry = statsMap.get(sid);
    if (!entry) {
      entry = { count: 0, bySeverity: {}, agentCounts: new Map() };
      statsMap.set(sid, entry);
    }

    entry.count++;
    entry.bySeverity[finding.signal.severity] =
      (entry.bySeverity[finding.signal.severity] ?? 0) + 1;
    entry.agentCounts.set(
      finding.agent,
      (entry.agentCounts.get(finding.agent) ?? 0) + 1,
    );
  }

  const result: SignalStats[] = [];
  for (const [signal, entry] of statsMap) {
    result.push({
      signal,
      count: entry.count,
      bySeverity: entry.bySeverity,
      topAgents: buildTopAgents(entry.agentCounts),
    });
  }

  // Sort by count descending for readability
  result.sort((a, b) => b.count - a.count);
  return result;
}

/**
 * Compute the time range from a set of chains.
 */
function computeTimeRange(chains: ConversationChain[]): { startMs: number; endMs: number } {
  if (chains.length === 0) return { startMs: 0, endMs: 0 };

  let startMs = Infinity;
  let endMs = -Infinity;

  for (const chain of chains) {
    if (chain.startTs < startMs) startMs = chain.startTs;
    if (chain.endTs > endMs) endMs = chain.endTs;
  }

  return {
    startMs: startMs === Infinity ? 0 : startMs,
    endMs: endMs === -Infinity ? 0 : endMs,
  };
}

/**
 * Build the processing state for incremental runs.
 */
function buildProcessingState(
  chains: ConversationChain[],
  eventsProcessed: number,
  findingsCount: number,
  previousState?: Partial<ProcessingState>,
): ProcessingState {
  const lastEvent = chains.reduce((max, c) => (c.endTs > max ? c.endTs : max), 0);
  return {
    lastProcessedTs: lastEvent || (previousState?.lastProcessedTs ?? 0),
    lastProcessedSeq: previousState?.lastProcessedSeq ?? 0,
    totalEventsProcessed: (previousState?.totalEventsProcessed ?? 0) + eventsProcessed,
    totalFindings: (previousState?.totalFindings ?? 0) + findingsCount,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Assemble the final AnalysisReport from all pipeline outputs.
 */
export function assembleReport(params: AssembleReportParams): AnalysisReport {
  const {
    startedAt,
    completedAt,
    eventsProcessed,
    chains,
    findings,
    generatedOutputs,
    previousState,
    ruleEffectiveness,
  } = params;

  const signalStats = computeSignalStats(findings);
  const timeRange = computeTimeRange(chains);
  const processingState = buildProcessingState(chains, eventsProcessed, findings.length, previousState);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    stats: {
      startedAt,
      completedAt,
      eventsProcessed,
      chainsReconstructed: chains.length,
      findingsDetected: findings.length,
      findingsClassified: findings.filter(f => f.classification !== null).length,
      outputsGenerated: generatedOutputs.length,
      timeRange,
    },
    signalStats,
    findings,
    generatedOutputs,
    ruleEffectiveness: ruleEffectiveness ?? [],
    processingState,
  };
}

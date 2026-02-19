// ============================================================
// Signal Registry — Runs All Enabled Detectors
// ============================================================
//
// Central registry that invokes each detector on each chain
// and collects FailureSignal[] into Finding[].
// ============================================================

import { randomUUID } from "node:crypto";
import type { ConversationChain } from "../chain-reconstructor.js";
import type { PluginLogger } from "../../types.js";
import type { TraceAnalyzerConfig, SignalId } from "../config.js";
import type { FailureSignal, Finding } from "./types.js";
import { detectCorrections } from "./correction.js";
import { detectToolFails } from "./tool-fail.js";
import { detectDoomLoops } from "./doom-loop.js";
import { detectDissatisfied } from "./dissatisfied.js";
import { detectRepeatFails, type RepeatFailState, createRepeatFailState } from "./repeat-fail.js";
import { detectHallucinations } from "./hallucination.js";
import { detectUnverifiedClaims } from "./unverified-claim.js";
import { SignalPatternRegistry, type SignalPatternSet } from "./lang/index.js";

export type { RepeatFailState } from "./repeat-fail.js";
export { createRepeatFailState } from "./repeat-fail.js";
export { SignalPatternRegistry } from "./lang/index.js";
export type { SignalPatternSet } from "./lang/index.js";

/** Lazily-created default EN+DE patterns for backward compat. */
let _defaultPatterns: SignalPatternSet | null = null;

function getDefaultPatterns(): SignalPatternSet {
  if (_defaultPatterns) return _defaultPatterns;
  const registry = new SignalPatternRegistry();
  registry.loadSync(["en", "de"]);
  _defaultPatterns = registry.getPatterns();
  return _defaultPatterns;
}

/** Minimal no-op logger for backward compatibility when no logger is provided. */
const NOOP_LOGGER: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Detector registry entry — signal ID + detection function. */
type DetectorEntry = {
  signal: SignalId;
  detect: (chain: ConversationChain, patterns: SignalPatternSet, rfState: RepeatFailState) => FailureSignal[];
};

/** All registered signal detectors in execution order. */
const DETECTOR_REGISTRY: DetectorEntry[] = [
  { signal: "SIG-CORRECTION",      detect: (c, p) => detectCorrections(c, p) },
  { signal: "SIG-DISSATISFIED",    detect: (c, p) => detectDissatisfied(c, p) },
  { signal: "SIG-HALLUCINATION",   detect: (c, p) => detectHallucinations(c, p) },
  { signal: "SIG-UNVERIFIED-CLAIM", detect: (c, p) => detectUnverifiedClaims(c, p) },
  { signal: "SIG-TOOL-FAIL",       detect: (c) => detectToolFails(c) },
  { signal: "SIG-DOOM-LOOP",       detect: (c) => detectDoomLoops(c) },
  { signal: "SIG-REPEAT-FAIL",     detect: (c, _p, rf) => detectRepeatFails(c, rf) },
];

/** Run one detector on a chain, collecting findings. */
function runDetector(
  entry: DetectorEntry,
  chain: ConversationChain,
  signalConfig: TraceAnalyzerConfig["signals"],
  patterns: SignalPatternSet,
  rfState: RepeatFailState,
  log: PluginLogger,
): Finding[] {
  const cfg = signalConfig[entry.signal];
  if (cfg?.enabled === false) return [];

  try {
    const signals = entry.detect(chain, patterns, rfState);
    return signals.map(s => {
      if (cfg?.severity) s.severity = cfg.severity;
      return makeFinding(chain, s);
    });
  } catch (err) {
    log.warn(`[trace-analyzer] ${entry.signal} detector error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Run all enabled signal detectors across all chains.
 * Returns Finding[] (unclassified — classification is null).
 */
export function detectAllSignals(
  chains: ConversationChain[],
  signalConfig: TraceAnalyzerConfig["signals"],
  repeatFailState?: RepeatFailState,
  signalPatterns?: SignalPatternSet,
  logger?: PluginLogger,
): Finding[] {
  const findings: Finding[] = [];
  const rfState = repeatFailState ?? createRepeatFailState();
  const patterns = signalPatterns ?? getDefaultPatterns();
  const log = logger ?? NOOP_LOGGER;

  for (const chain of chains) {
    for (const entry of DETECTOR_REGISTRY) {
      findings.push(...runDetector(entry, chain, signalConfig, patterns, rfState, log));
    }
  }

  return findings;
}

function makeFinding(chain: ConversationChain, signal: FailureSignal): Finding {
  return {
    id: randomUUID(),
    chainId: chain.id,
    agent: chain.agent,
    session: chain.session,
    signal,
    detectedAt: Date.now(),
    occurredAt: chain.events[signal.eventRange.start]?.ts ?? chain.startTs,
    classification: null,
  };
}

// ============================================================
// Signal Registry — Runs All Enabled Detectors
// ============================================================
//
// Central registry that invokes each detector on each chain
// and collects FailureSignal[] into Finding[].
// ============================================================

import { randomUUID } from "node:crypto";
import type { ConversationChain } from "../chain-reconstructor.js";
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

/**
 * Run all enabled signal detectors across all chains.
 * Returns Finding[] (unclassified — classification is null).
 *
 * @param chains — Conversation chains to analyze
 * @param signalConfig — Per-signal enable/severity config
 * @param repeatFailState — Optional cross-session state for SIG-REPEAT-FAIL.
 *   If not provided, a fresh state is created (no cross-session correlation).
 * @param signalPatterns — Optional merged signal patterns from SignalPatternRegistry.
 *   If not provided, falls back to EN+DE (backward compat).
 */
export function detectAllSignals(
  chains: ConversationChain[],
  signalConfig: TraceAnalyzerConfig["signals"],
  repeatFailState?: RepeatFailState,
  signalPatterns?: SignalPatternSet,
): Finding[] {
  const findings: Finding[] = [];
  const rfState = repeatFailState ?? createRepeatFailState();
  const patterns = signalPatterns ?? getDefaultPatterns();

  for (const chain of chains) {
    // ---- Language-sensitive detectors (receive patterns) ----

    const correctionConfig = signalConfig["SIG-CORRECTION"];
    if (correctionConfig?.enabled !== false) {
      try {
        const signals = detectCorrections(chain, patterns);
        for (const signal of signals) {
          if (correctionConfig?.severity) signal.severity = correctionConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    const dissatisfiedConfig = signalConfig["SIG-DISSATISFIED"];
    if (dissatisfiedConfig?.enabled !== false) {
      try {
        const signals = detectDissatisfied(chain, patterns);
        for (const signal of signals) {
          if (dissatisfiedConfig?.severity) signal.severity = dissatisfiedConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    const hallucinationConfig = signalConfig["SIG-HALLUCINATION"];
    if (hallucinationConfig?.enabled !== false) {
      try {
        const signals = detectHallucinations(chain, patterns);
        for (const signal of signals) {
          if (hallucinationConfig?.severity) signal.severity = hallucinationConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    const unverifiedConfig = signalConfig["SIG-UNVERIFIED-CLAIM"];
    if (unverifiedConfig?.enabled !== false) {
      try {
        const signals = detectUnverifiedClaims(chain, patterns);
        for (const signal of signals) {
          if (unverifiedConfig?.severity) signal.severity = unverifiedConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    // ---- Language-independent detectors (no patterns needed) ----

    const toolFailConfig = signalConfig["SIG-TOOL-FAIL"];
    if (toolFailConfig?.enabled !== false) {
      try {
        const signals = detectToolFails(chain);
        for (const signal of signals) {
          if (toolFailConfig?.severity) signal.severity = toolFailConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    const doomLoopConfig = signalConfig["SIG-DOOM-LOOP"];
    if (doomLoopConfig?.enabled !== false) {
      try {
        const signals = detectDoomLoops(chain);
        for (const signal of signals) {
          if (doomLoopConfig?.severity) signal.severity = doomLoopConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
    }

    // Cross-session detector: SIG-REPEAT-FAIL
    const repeatConfig = signalConfig["SIG-REPEAT-FAIL"];
    if (repeatConfig?.enabled !== false) {
      try {
        const repeatSignals = detectRepeatFails(chain, rfState);
        for (const signal of repeatSignals) {
          if (repeatConfig?.severity) signal.severity = repeatConfig.severity;
          findings.push(makeFinding(chain, signal));
        }
      } catch { /* skip */ }
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

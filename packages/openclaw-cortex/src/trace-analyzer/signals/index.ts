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
import type { FailureSignal, Finding, SignalDetector } from "./types.js";
import { detectCorrections } from "./correction.js";
import { detectToolFails } from "./tool-fail.js";
import { detectDoomLoops } from "./doom-loop.js";
import { detectDissatisfied } from "./dissatisfied.js";
import { detectRepeatFails, type RepeatFailState, createRepeatFailState } from "./repeat-fail.js";
import { detectHallucinations } from "./hallucination.js";
import { detectUnverifiedClaims } from "./unverified-claim.js";

export type { RepeatFailState } from "./repeat-fail.js";
export { createRepeatFailState } from "./repeat-fail.js";

type DetectorEntry = {
  id: SignalId;
  fn: SignalDetector;
};

const DETECTORS: DetectorEntry[] = [
  { id: "SIG-CORRECTION", fn: detectCorrections },
  { id: "SIG-TOOL-FAIL", fn: detectToolFails },
  { id: "SIG-DOOM-LOOP", fn: detectDoomLoops },
  { id: "SIG-DISSATISFIED", fn: detectDissatisfied },
  { id: "SIG-HALLUCINATION", fn: detectHallucinations },
  { id: "SIG-UNVERIFIED-CLAIM", fn: detectUnverifiedClaims },
];

/**
 * Run all enabled signal detectors across all chains.
 * Returns Finding[] (unclassified — classification is null).
 *
 * @param chains — Conversation chains to analyze
 * @param signalConfig — Per-signal enable/severity config
 * @param repeatFailState — Optional cross-session state for SIG-REPEAT-FAIL.
 *   If not provided, a fresh state is created (no cross-session correlation).
 */
export function detectAllSignals(
  chains: ConversationChain[],
  signalConfig: TraceAnalyzerConfig["signals"],
  repeatFailState?: RepeatFailState,
): Finding[] {
  const findings: Finding[] = [];
  const rfState = repeatFailState ?? createRepeatFailState();

  for (const chain of chains) {
    // Run per-chain detectors
    for (const detector of DETECTORS) {
      const config = signalConfig[detector.id];
      if (config && config.enabled === false) continue;

      let signals: FailureSignal[];
      try {
        signals = detector.fn(chain);
      } catch {
        // Detector threw — skip, don't break other detectors
        continue;
      }

      for (const signal of signals) {
        // Apply severity override from config
        if (config?.severity) {
          signal.severity = config.severity;
        }

        findings.push({
          id: randomUUID(),
          chainId: chain.id,
          agent: chain.agent,
          session: chain.session,
          signal,
          detectedAt: Date.now(),
          occurredAt: chain.events[signal.eventRange.start]?.ts ?? chain.startTs,
          classification: null,
        });
      }
    }

    // Cross-session detector: SIG-REPEAT-FAIL
    const repeatConfig = signalConfig["SIG-REPEAT-FAIL"];
    if (repeatConfig?.enabled !== false) {
      let repeatSignals: FailureSignal[];
      try {
        repeatSignals = detectRepeatFails(chain, rfState);
      } catch {
        repeatSignals = [];
      }

      for (const signal of repeatSignals) {
        if (repeatConfig?.severity) {
          signal.severity = repeatConfig.severity;
        }

        findings.push({
          id: randomUUID(),
          chainId: chain.id,
          agent: chain.agent,
          session: chain.session,
          signal,
          detectedAt: Date.now(),
          occurredAt: chain.events[signal.eventRange.start]?.ts ?? chain.startTs,
          classification: null,
        });
      }
    }
  }

  return findings;
}

// ============================================================
// SIG-CORRECTION — User Corrects Agent
// ============================================================
//
// Detects when a user corrects the agent after an agent response.
// Key: distinguishes corrections from valid "nein" answers
// (checks if preceding agent msg was a question).
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import type { SignalPatternSet } from "./lang/registry.js";
import { truncate, isQuestion } from "../util.js";

function isShortNegative(text: string, patterns: SignalPatternSet): boolean {
  return patterns.correction.shortNegatives.some(p => p.test(text));
}

function matchesCorrection(text: string, patterns: SignalPatternSet): boolean {
  return patterns.correction.indicators.some(p => p.test(text));
}

/**
 * Detect user corrections in a conversation chain.
 *
 * Pattern: msg.out (agent assertion) → msg.in (user correction)
 * Exclusion: agent asked a question + user gave short negative → valid answer, not correction.
 */
export function detectCorrections(chain: ConversationChain, patterns: SignalPatternSet): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];

    // Must be agent response followed by user message
    if (prev.type !== "msg.out" || curr.type !== "msg.in") continue;

    const agentText = prev.payload.content ?? "";
    const userText = curr.payload.content ?? "";

    if (!userText) continue;

    if (!matchesCorrection(userText, patterns)) continue;

    // Exclusion: if agent asked a question and user gave a short negative,
    // it's a valid answer, not a correction.
    if (isQuestion(agentText, patterns) && isShortNegative(userText, patterns)) continue;

    signals.push({
      signal: "SIG-CORRECTION",
      severity: "medium",
      eventRange: { start: i - 1, end: i },
      summary: `User corrected agent after: '${truncate(agentText, 80)}'`,
      evidence: {
        agentMessage: truncate(agentText, 500),
        userCorrection: truncate(userText, 500),
      },
    });
  }

  return signals;
}

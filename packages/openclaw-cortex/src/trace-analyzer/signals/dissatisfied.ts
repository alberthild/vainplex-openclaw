// ============================================================
// SIG-DISSATISFIED — Session Ends with User Frustration
// ============================================================
//
// Detects when the last user message in a chain expresses
// frustration or giving up, and the agent did not resolve it.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import type { SignalPatternSet } from "./lang/registry.js";
import { truncate } from "../util.js";

function matchesDissatisfaction(text: string, patterns: SignalPatternSet): boolean {
  // Satisfaction overrides dissatisfaction
  if (patterns.dissatisfaction.satisfactionOverrides.some(p => p.test(text))) return false;
  return patterns.dissatisfaction.indicators.some(p => p.test(text));
}

/**
 * Detect dissatisfied session endings.
 *
 * Pattern: last user message matches dissatisfaction, no resolution follows,
 * message is near the end of the chain (last 3 events).
 */
export function detectDissatisfied(chain: ConversationChain, patterns: SignalPatternSet): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  // Find the last user message
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "msg.in") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx < 0) return signals;

  const userText = events[lastUserIdx].payload.content ?? "";
  if (!userText) return signals;

  if (!matchesDissatisfaction(userText, patterns)) return signals;

  // Check: is this near the chain end? (within last 3 events)
  if (lastUserIdx < events.length - 3) return signals;

  // Check: did the agent resolve after the dissatisfaction?
  let hasResolution = false;
  for (let j = lastUserIdx + 1; j < events.length; j++) {
    if (events[j].type === "msg.out") {
      const responseText = events[j].payload.content ?? "";
      if (patterns.dissatisfaction.resolutionIndicators.some(p => p.test(responseText))) {
        hasResolution = true;
        break;
      }
    }
  }

  if (hasResolution) return signals;

  signals.push({
    signal: "SIG-DISSATISFIED",
    severity: "high",
    eventRange: { start: lastUserIdx, end: events.length - 1 },
    summary: `Session ended with user dissatisfaction: '${truncate(userText, 80)}'`,
    evidence: {
      userMessage: truncate(userText, 300),
    },
  });

  return signals;
}

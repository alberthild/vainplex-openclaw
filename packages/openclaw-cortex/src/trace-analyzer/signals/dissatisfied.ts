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

/** Find the last msg.in index in a chain. Returns -1 if none. */
function findLastUserMessage(events: ConversationChain["events"]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "msg.in") return i;
  }
  return -1;
}

/** Check if the agent resolved dissatisfaction after the given index. */
function hasResolutionAfter(
  events: ConversationChain["events"],
  startIdx: number,
  patterns: SignalPatternSet,
): boolean {
  for (let j = startIdx + 1; j < events.length; j++) {
    if (events[j].type === "msg.out") {
      const responseText = events[j].payload.content ?? "";
      if (patterns.dissatisfaction.resolutionIndicators.some(p => p.test(responseText))) return true;
    }
  }
  return false;
}

/**
 * Detect dissatisfied session endings.
 *
 * Pattern: last user message matches dissatisfaction, no resolution follows,
 * message is near the end of the chain (last 3 events).
 */
export function detectDissatisfied(chain: ConversationChain, patterns: SignalPatternSet): FailureSignal[] {
  const { events } = chain;
  const lastUserIdx = findLastUserMessage(events);
  if (lastUserIdx < 0) return [];

  const userText = events[lastUserIdx].payload.content ?? "";
  if (!userText || !matchesDissatisfaction(userText, patterns)) return [];
  if (lastUserIdx < events.length - 3) return [];
  if (hasResolutionAfter(events, lastUserIdx, patterns)) return [];

  return [{
    signal: "SIG-DISSATISFIED",
    severity: "high",
    eventRange: { start: lastUserIdx, end: events.length - 1 },
    summary: `Session ended with user dissatisfaction: '${truncate(userText, 80)}'`,
    evidence: { userMessage: truncate(userText, 300) },
  }];
}

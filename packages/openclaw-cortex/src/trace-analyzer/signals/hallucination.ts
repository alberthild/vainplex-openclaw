// ============================================================
// SIG-HALLUCINATION — Agent Claims Completion Despite Failure
// ============================================================
//
// Detects when the agent claims task completion ("done", "erledigt",
// "deployed", "✅") but the last tool result was an error or
// no tool was called at all.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import type { SignalPatternSet } from "./lang/registry.js";
import { truncate, isToolError, isQuestion } from "../util.js";

function matchesCompletion(text: string, patterns: SignalPatternSet): boolean {
  return patterns.completion.claims.some(p => p.test(text));
}

/**
 * Find the last tool.result index before `msgOutIdx` within the same turn.
 * Returns -1 if none found.
 */
function findLastToolResultInTurn(
  events: ConversationChain["events"],
  msgOutIdx: number,
): number {
  for (let j = msgOutIdx - 1; j >= 0; j--) {
    if (events[j].type === "tool.result") return j;
    if (events[j].type === "msg.in") break;
  }
  return -1;
}

/**
 * Build a hallucination signal from the given event indices.
 */
function buildHallucinationSignal(
  events: ConversationChain["events"],
  toolResultIdx: number,
  msgOutIdx: number,
  content: string,
): FailureSignal {
  const toolResult = events[toolResultIdx];
  const toolCallIdx = toolResultIdx > 0 && events[toolResultIdx - 1].type === "tool.call"
    ? toolResultIdx - 1 : toolResultIdx;
  return {
    signal: "SIG-HALLUCINATION",
    severity: "critical",
    eventRange: { start: toolCallIdx, end: msgOutIdx },
    summary: `Agent claimed completion despite tool failure: '${truncate(content, 100)}'`,
    evidence: {
      agentClaim: truncate(content, 300),
      precedingError: truncate(toolResult.payload.toolError ?? "unknown", 200),
      toolName: toolResult.payload.toolName ?? "unknown",
    },
  };
}

/**
 * Detect hallucinated completions.
 *
 * Pattern: agent claims completion in msg.out, but the last tool.result
 * before that msg.out was an error.
 */
export function detectHallucinations(chain: ConversationChain, patterns: SignalPatternSet): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "msg.out") continue;
    const content = events[i].payload.content ?? "";
    if (!content || !matchesCompletion(content, patterns) || isQuestion(content, patterns)) continue;

    const lastToolResultIdx = findLastToolResultInTurn(events, i);
    if (lastToolResultIdx >= 0 && isToolError(events[lastToolResultIdx].payload)) {
      signals.push(buildHallucinationSignal(events, lastToolResultIdx, i, content));
    }
  }

  return signals;
}

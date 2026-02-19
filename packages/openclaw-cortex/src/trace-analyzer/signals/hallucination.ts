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

/**
 * Completion claim patterns — agent says the task is done.
 * Bilingual DE/EN.
 */
const COMPLETION_CLAIMS: RegExp[] = [
  // German
  /\b(?:erledigt|erfolg(?:reich)?|fertig|gemacht|deployed|gefixt|gelöst|abgeschlossen)\b/i,
  /\bhabe ich (?:jetzt |nun )?(?:gemacht|erledigt|deployed|gefixt)/i,
  // English
  /\b(?:done|completed|fixed|resolved|deployed|finished)\b/i,
  /\bi(?:'ve| have) (?:just |now )?(?:done|completed|deployed|fixed|resolved)\b/i,
  /\bit(?:'s| is| has been) (?:now )?(?:done|deployed|fixed|live|running)\b/i,
  // Symbols
  /[✅✓☑]/,
];

/**
 * Question patterns — exclude questions like "Is it done?"
 */
const QUESTION_EXCLUSION: RegExp[] = [
  /\?\s*$/m,
  /\b(?:shall i|should i|soll ich|is it|ist es)\b/i,
];

/**
 * "Success" words that might appear in a tool result we should
 * NOT match as completion — these are for the tool result check.
 */
function isToolError(payload: { toolError?: string; toolIsError?: boolean }): boolean {
  return Boolean(payload.toolError) || payload.toolIsError === true;
}

function matchesCompletion(text: string): boolean {
  return COMPLETION_CLAIMS.some(p => p.test(text));
}

function isQuestion(text: string): boolean {
  return QUESTION_EXCLUSION.some(p => p.test(text));
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}

/**
 * Detect hallucinated completions.
 *
 * Pattern: agent claims completion in msg.out, but the last tool.result
 * before that msg.out was an error.
 */
export function detectHallucinations(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "msg.out") continue;

    const content = events[i].payload.content ?? "";
    if (!content) continue;

    // Must claim completion
    if (!matchesCompletion(content)) continue;

    // Exclude questions
    if (isQuestion(content)) continue;

    // Find the last tool.result before this msg.out
    let lastToolResultIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].type === "tool.result") {
        lastToolResultIdx = j;
        break;
      }
      // Stop at a previous msg.in — we only look within this turn
      if (events[j].type === "msg.in") break;
    }

    // If there's a tool result and it was an error → hallucination
    if (lastToolResultIdx >= 0 && isToolError(events[lastToolResultIdx].payload)) {
      const toolResult = events[lastToolResultIdx];
      // Find the matching tool.call
      const toolCallIdx = lastToolResultIdx > 0 && events[lastToolResultIdx - 1].type === "tool.call"
        ? lastToolResultIdx - 1
        : lastToolResultIdx;

      signals.push({
        signal: "SIG-HALLUCINATION",
        severity: "critical",
        eventRange: { start: toolCallIdx, end: i },
        summary: `Agent claimed completion despite tool failure: '${truncate(content, 100)}'`,
        evidence: {
          agentClaim: truncate(content, 300),
          precedingError: truncate(toolResult.payload.toolError ?? "unknown", 200),
          toolName: toolResult.payload.toolName ?? "unknown",
        },
      });
    }
  }

  return signals;
}

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

/**
 * Correction patterns — bilingual DE/EN.
 * Matches user messages that indicate the agent was wrong.
 */
const CORRECTION_PATTERNS: RegExp[] = [
  // German
  /\b(?:falsch|das ist falsch|so nicht|das stimmt nicht|du hast dich geirrt)\b/i,
  /\b(?:stopp|vergiss das|das war falsch|korrektur|nochmal|das meine ich nicht)\b/i,
  // English
  /\b(?:wrong|that's not right|incorrect|no that's|you're wrong|that's wrong|fix that|undo)\b/i,
  /\b(?:actually no|wait no|not what i asked|not what i meant)\b/i,
  // Short negations (only counted as correction when NOT answering a question)
  /^(?:nein|no|stop|halt|nicht das)\b/i,
];

/**
 * Question patterns — detect if the agent was asking a question.
 * If so, a short negative response is NOT a correction.
 */
const QUESTION_PATTERNS: RegExp[] = [
  /\?\s*$/m,
  /\b(?:soll ich|shall i|should i|möchtest du|do you want|willst du|darf ich)\b/i,
  /\b(?:ist das ok|is that ok|okay so|passt das|right\?|oder\?)\b/i,
];

/**
 * Short negative — user response that is just a brief "no".
 * Only suppressed when agent asked a question.
 */
const SHORT_NEGATIVE = /^\s*(?:nein|no|nope|stop|halt|nö)\s*[.!]?\s*$/i;

function isQuestion(text: string): boolean {
  return QUESTION_PATTERNS.some(p => p.test(text));
}

function isShortNegative(text: string): boolean {
  return SHORT_NEGATIVE.test(text);
}

function matchesCorrection(text: string): boolean {
  return CORRECTION_PATTERNS.some(p => p.test(text));
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}

/**
 * Detect user corrections in a conversation chain.
 *
 * Pattern: msg.out (agent assertion) → msg.in (user correction)
 * Exclusion: agent asked a question + user gave short negative → valid answer, not correction.
 */
export function detectCorrections(chain: ConversationChain): FailureSignal[] {
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

    if (!matchesCorrection(userText)) continue;

    // Exclusion: if agent asked a question and user gave a short negative,
    // it's a valid answer, not a correction.
    if (isQuestion(agentText) && isShortNegative(userText)) continue;

    signals.push({
      signal: "SIG-CORRECTION",
      severity: "medium",
      eventRange: { start: i - 1, end: i },
      summary: `User corrected agent after: '${truncate(agentText, 80)}'`,
      evidence: {
        agentMessage: truncate(agentText, 300),
        userCorrection: truncate(userText, 300),
      },
    });
  }

  return signals;
}

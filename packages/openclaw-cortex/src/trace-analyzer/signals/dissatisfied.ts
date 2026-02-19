// ============================================================
// SIG-DISSATISFIED — Session Ends with User Frustration
// ============================================================
//
// Detects when the last user message in a chain expresses
// frustration or giving up, and the agent did not resolve it.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";

/**
 * Dissatisfaction patterns — bilingual DE/EN.
 * User is frustrated, giving up, or dismissing the agent.
 */
const DISSATISFACTION_PATTERNS: RegExp[] = [
  // German
  /\b(?:vergiss es|lass gut sein|lassen wir das|ich mach.s selbst|schon gut|nicht hilfreich)\b/i,
  /\b(?:das bringt nichts|hoffnungslos|sinnlos|unmöglich|du kannst das nicht)\b/i,
  // English
  /\b(?:forget it|never mind|nevermind|i'?ll do it myself|this is useless|pointless|hopeless)\b/i,
  /\b(?:you can't do this|not helpful|waste of time|give up|doesn't work)\b/i,
];

/**
 * Satisfaction patterns — these mean the user is happy, NOT dissatisfied.
 * Used as exclusion filter.
 */
const SATISFACTION_PATTERNS: RegExp[] = [
  /\b(?:danke|vielen dank|super|perfekt|prima|passt|gut gemacht|wunderbar)\b/i,
  /\b(?:thanks|thank you|perfect|great|good job|excellent|awesome|nice)\b/i,
  /\b(?:👍|🎉|💯|❤️)/,
];

/**
 * Resolution patterns — agent tries to resolve after dissatisfaction.
 */
const RESOLUTION_PATTERNS: RegExp[] = [
  /\b(?:entschuldigung|sorry|i apologize|lass mich|let me try|here'?s another|versuch ich)\b/i,
  /\b(?:tut mir leid|ich versuche|let me fix|i'?ll try again)\b/i,
];

function matchesDissatisfaction(text: string): boolean {
  // Satisfaction overrides dissatisfaction
  if (SATISFACTION_PATTERNS.some(p => p.test(text))) return false;
  return DISSATISFACTION_PATTERNS.some(p => p.test(text));
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}

/**
 * Detect dissatisfied session endings.
 *
 * Pattern: last user message matches dissatisfaction, no resolution follows,
 * message is near the end of the chain (last 3 events).
 */
export function detectDissatisfied(chain: ConversationChain): FailureSignal[] {
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

  if (!matchesDissatisfaction(userText)) return signals;

  // Check: is this near the chain end? (within last 3 events)
  if (lastUserIdx < events.length - 3) return signals;

  // Check: did the agent resolve after the dissatisfaction?
  let hasResolution = false;
  for (let j = lastUserIdx + 1; j < events.length; j++) {
    if (events[j].type === "msg.out") {
      const responseText = events[j].payload.content ?? "";
      if (RESOLUTION_PATTERNS.some(p => p.test(responseText))) {
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

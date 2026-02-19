// ============================================================
// SIG-UNVERIFIED-CLAIM — Agent Claims Without Tool Verification
// ============================================================
//
// Detects when the agent makes a factual claim about system state
// without having called any verification tool in the preceding
// conversation turn.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";

/**
 * Factual claim patterns — system state assertions that require
 * tool verification.
 */
const FACTUAL_CLAIM_PATTERNS: RegExp[] = [
  // Disk/memory/resource claims
  /\b(?:disk usage|speicherplatz|memory|cpu|load) (?:is|ist|beträgt|liegt bei) (?:at )?\d+/i,
  // Service status claims
  /\b(?:service|server|daemon|process) (?:is|ist) (?:running|stopped|active|down|inactive)\b/i,
  // File existence claims
  /\b(?:file|datei|config) (?:exists|existiert|is present|ist vorhanden)\b/i,
  // Quantitative claims about systems
  /\bthere (?:are|is) \d+ (?:errors?|warnings?|connections?|processes|files)\b/i,
  /\bes gibt \d+ (?:fehler|warnungen|verbindungen|prozesse|dateien)\b/i,
  // Port/network claims
  /\b(?:port|listening on) \d+\b.*(?:is|ist) (?:open|closed|in use)\b/i,
];

/**
 * Conversational claim exclusions — opinions, not facts.
 */
const OPINION_EXCLUSIONS: RegExp[] = [
  /\b(?:i think|ich glaube|ich denke|probably|wahrscheinlich|maybe|vielleicht)\b/i,
  /\b(?:it seems|es scheint|looks like|sieht aus)\b/i,
];

/**
 * Code block detection — claims inside code blocks are analysis output.
 */
function isInsideCodeBlock(text: string, matchIndex: number): boolean {
  // Count backtick fences before the match
  const before = text.slice(0, matchIndex);
  const fenceCount = (before.match(/```/g) || []).length;
  // Odd count means we're inside a code block
  return fenceCount % 2 === 1;
}

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen) + "…";
}

/**
 * Check if text contains a factual claim about system state.
 * Returns the matched claim text or null.
 */
function findFactualClaim(text: string): string | null {
  // Exclude opinions
  if (OPINION_EXCLUSIONS.some(p => p.test(text))) return null;

  for (const pattern of FACTUAL_CLAIM_PATTERNS) {
    const match = pattern.exec(text);
    if (match && !isInsideCodeBlock(text, match.index)) {
      return match[0];
    }
  }

  return null;
}

/**
 * Detect unverified claims about system state.
 *
 * Pattern: agent msg.out contains factual system state claim,
 * but no tool.call was made between the preceding msg.in and this msg.out.
 */
export function detectUnverifiedClaims(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "msg.out") continue;

    const content = events[i].payload.content ?? "";
    if (!content) continue;

    const claim = findFactualClaim(content);
    if (!claim) continue;

    // Scan backward: was there any tool.call between preceding msg.in and this msg.out?
    let hasToolCall = false;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].type === "msg.in") break; // Reached user request
      if (events[j].type === "tool.call") {
        hasToolCall = true;
        break;
      }
    }

    if (hasToolCall) continue;

    const startIdx = Math.max(0, i - 2);

    signals.push({
      signal: "SIG-UNVERIFIED-CLAIM",
      severity: "medium",
      eventRange: { start: startIdx, end: i },
      summary: `Agent made factual claim without tool verification: '${truncate(claim, 100)}'`,
      evidence: {
        agentClaim: truncate(content, 300),
        matchedClaim: claim,
      },
    });
  }

  return signals;
}

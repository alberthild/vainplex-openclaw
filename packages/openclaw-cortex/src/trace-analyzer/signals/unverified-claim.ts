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
import type { SignalPatternSet } from "./lang/registry.js";

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
function findFactualClaim(text: string, patterns: SignalPatternSet): string | null {
  // Exclude opinions
  if (patterns.systemState.opinionExclusions.some(p => p.test(text))) return null;

  for (const pattern of patterns.systemState.claims) {
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
export function detectUnverifiedClaims(chain: ConversationChain, patterns: SignalPatternSet): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "msg.out") continue;

    const content = events[i].payload.content ?? "";
    if (!content) continue;

    const claim = findFactualClaim(content, patterns);
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

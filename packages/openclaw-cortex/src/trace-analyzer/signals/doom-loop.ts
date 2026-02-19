// ============================================================
// SIG-DOOM-LOOP — Repeated Failed Tool Calls
// ============================================================
//
// Detects 3+ consecutive similar tool calls with similar params
// all failing. Uses Jaccard similarity for generic params and
// Levenshtein for exec command strings.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import { truncate } from "../util.js";

/** A tool attempt: call + result pair with their indices. */
type ToolAttempt = {
  callIdx: number;
  resultIdx: number;
  toolName: string;
  params: Record<string, unknown>;
  error: string;
  isError: boolean;
};

/**
 * Extract all (tool.call, tool.result) pairs from a chain.
 */
function extractAttempts(chain: ConversationChain): ToolAttempt[] {
  const attempts: ToolAttempt[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].type === "tool.call" && events[i + 1].type === "tool.result") {
      const call = events[i];
      const result = events[i + 1];
      attempts.push({
        callIdx: i,
        resultIdx: i + 1,
        toolName: call.payload.toolName ?? "",
        params: (call.payload.toolParams ?? {}) as Record<string, unknown>,
        error: result.payload.toolError ?? "",
        isError: Boolean(result.payload.toolError) || result.payload.toolIsError === true,
      });
    }
  }

  return attempts;
}

/**
 * Jaccard similarity on stringified key-value pairs.
 * Ignores volatile fields like `timeout`.
 */
function jaccardSimilarity(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const volatileKeys = new Set(["timeout", "timestamp", "ts"]);

  const aEntries = new Set(
    Object.entries(a)
      .filter(([k]) => !volatileKeys.has(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`),
  );
  const bEntries = new Set(
    Object.entries(b)
      .filter(([k]) => !volatileKeys.has(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`),
  );

  const intersection = [...aEntries].filter(x => bEntries.has(x)).length;
  const union = new Set([...aEntries, ...bEntries]).size;

  return union === 0 ? 1.0 : intersection / union;
}

/**
 * Levenshtein distance between two strings.
 * Capped at 500 chars to keep O(n²) bounded.
 */
function levenshteinDistance(a: string, b: string): number {
  const sa = a.slice(0, 500);
  const sb = b.slice(0, 500);

  if (sa === sb) return 0;
  if (sa.length === 0) return sb.length;
  if (sb.length === 0) return sa.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= sb.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= sa.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= sb.length; i++) {
    for (let j = 1; j <= sa.length; j++) {
      const cost = sb[i - 1] === sa[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[sb.length][sa.length];
}

/**
 * Levenshtein ratio: 1.0 = identical, 0.0 = completely different.
 */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.slice(0, 500).length, b.slice(0, 500).length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Compute parameter similarity between two tool calls.
 * Uses Levenshtein for exec commands, Jaccard for everything else.
 */
export function paramSimilarity(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  // Special case for `exec` tool: compare command strings
  const aCmd = typeof a.command === "string" ? a.command : "";
  const bCmd = typeof b.command === "string" ? b.command : "";
  if (aCmd && bCmd) {
    return levenshteinRatio(aCmd, bCmd);
  }

  return jaccardSimilarity(a, b);
}

/**
 * Detect doom loops: 3+ consecutive similar tool calls with similar
 * params all failing.
 */
export function detectDoomLoops(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const attempts = extractAttempts(chain);

  let i = 0;
  while (i < attempts.length) {
    const anchor = attempts[i];

    // Only start a loop from a failed attempt
    if (!anchor.isError) {
      i++;
      continue;
    }

    // Count consecutive similar failures
    let count = 1;
    let lastIdx = i;

    for (let j = i + 1; j < attempts.length; j++) {
      const candidate = attempts[j];

      // Must be same tool
      if (candidate.toolName !== anchor.toolName) break;

      // Must have similar params
      if (paramSimilarity(candidate.params, anchor.params) < 0.8) break;

      // Must also be a failure
      if (!candidate.isError) break;

      count++;
      lastIdx = j;
    }

    if (count >= 3) {
      const lastAttempt = attempts[lastIdx];
      signals.push({
        signal: "SIG-DOOM-LOOP",
        severity: count >= 5 ? "critical" : "high",
        eventRange: { start: anchor.callIdx, end: lastAttempt.resultIdx },
        summary: `Doom loop: ${count}× ${anchor.toolName} with similar params, all failing`,
        evidence: {
          toolName: anchor.toolName,
          loopSize: count,
          firstError: truncate(anchor.error, 200),
          params: anchor.params,
        },
      });

      // Skip past the loop
      i = lastIdx + 1;
    } else {
      i++;
    }
  }

  return signals;
}

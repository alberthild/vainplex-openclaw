// ============================================================
// SIG-TOOL-FAIL — Unrecovered Tool Failure
// ============================================================
//
// Detects tool errors where the agent does NOT attempt recovery
// before responding to the user.
// ============================================================

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import { truncate, isToolError } from "../util.js";

/**
 * Rough param similarity check.
 * Returns true if the params are "basically the same" (not a recovery attempt).
 * Returns false if the params are different enough to count as recovery.
 */
function paramsSimilar(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const aStr = JSON.stringify(a);
  const bStr = JSON.stringify(b);

  // Exact match = definitely similar
  if (aStr === bStr) return true;

  // For exec commands, compare command strings directly
  const aCmd = typeof a.command === "string" ? a.command : "";
  const bCmd = typeof b.command === "string" ? b.command : "";
  if (aCmd && bCmd) {
    // If commands share the same words (after splitting), they're similar
    const aWords = new Set(aCmd.split(/\s+/));
    const bWords = new Set(bCmd.split(/\s+/));
    const intersection = [...aWords].filter(w => bWords.has(w)).length;
    const union = new Set([...aWords, ...bWords]).size;
    // Jaccard > 0.7 → similar (not a recovery)
    return union === 0 ? true : intersection / union > 0.7;
  }

  // Generic: Jaccard on key-value pairs
  const aEntries = new Set(Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const bEntries = new Set(Object.entries(b).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const intersection = [...aEntries].filter(x => bEntries.has(x)).length;
  const union = new Set([...aEntries, ...bEntries]).size;
  return union === 0 ? true : intersection / union > 0.7;
}

/**
 * Check if there is a successful recovery attempt between index `start`
 * and the next msg.out in `events`. Returns { recovered, reachedMsgOut }.
 */
function hasRecoveryAfter(
  events: ConversationChain["events"],
  start: number,
  failedToolName: string | undefined,
  failedParams: Record<string, unknown> | undefined,
): { recovered: boolean; reachedMsgOut: boolean } {
  for (let j = start; j < events.length; j++) {
    if (events[j].type === "msg.out") return { recovered: false, reachedMsgOut: true };

    if (events[j].type === "tool.call") {
      const isDifferentTool = events[j].payload.toolName !== failedToolName;
      const isDifferentParams = !paramsSimilar(events[j].payload.toolParams, failedParams);
      if (isDifferentTool || isDifferentParams) {
        const nextResult = events[j + 1];
        if (nextResult?.type === "tool.result" && !isToolError(nextResult.payload)) {
          return { recovered: true, reachedMsgOut: false };
        }
      }
    }
  }
  return { recovered: false, reachedMsgOut: false };
}

/**
 * Detect unrecovered tool failures in a conversation chain.
 *
 * Pattern: tool.call → tool.result(error) → ... → msg.out (no recovery in between)
 * Recovery = a different tool call or same tool with different params that succeeds.
 */
export function detectToolFails(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length - 1; i++) {
    const call = events[i];
    const result = events[i + 1];

    if (call.type !== "tool.call" || result.type !== "tool.result") continue;
    if (!isToolError(result.payload)) continue;

    const { recovered, reachedMsgOut } = hasRecoveryAfter(
      events, i + 2, call.payload.toolName, call.payload.toolParams,
    );

    if (!reachedMsgOut || recovered) continue;

    const toolName = call.payload.toolName ?? "unknown";
    const error = result.payload.toolError ?? "unknown error";

    signals.push({
      signal: "SIG-TOOL-FAIL",
      severity: "low",
      eventRange: { start: i, end: i + 1 },
      summary: `Unrecovered tool failure: ${toolName} — ${truncate(error, 100)}`,
      evidence: {
        toolName,
        params: call.payload.toolParams,
        error: truncate(error, 200),
      },
    });
  }

  return signals;
}

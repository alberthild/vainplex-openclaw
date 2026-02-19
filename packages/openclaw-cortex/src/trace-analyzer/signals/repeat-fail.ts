// ============================================================
// SIG-REPEAT-FAIL — Same Failure Across Sessions
// ============================================================
//
// Detects when the same tool+params combination fails with
// the same error across 2+ different sessions.
// Uses fingerprinting with normalization.
// ============================================================

import { createHash } from "node:crypto";
import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal } from "./types.js";
import { truncate } from "../util.js";

/** Persistent state for cross-session correlation. */
export type RepeatFailState = {
  /** fingerprint → failure metadata */
  fingerprints: Map<string, RepeatFailEntry>;
};

export type RepeatFailEntry = {
  count: number;
  lastSeenTs: number;
  sessions: string[];
  toolName: string;
  errorPreview: string;
};

/** Maximum entries in the fingerprint map. */
const MAX_FINGERPRINTS = 10_000;

/** Create a fresh RepeatFailState. */
export function createRepeatFailState(): RepeatFailState {
  return { fingerprints: new Map() };
}

/**
 * Normalize an error string for fingerprinting.
 * Strips timestamps, PIDs, sequence numbers, and temp paths.
 */
function normalizeError(error: string): string {
  return error
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, "<TIMESTAMP>")
    .replace(/\bpid[= ]\d+/gi, "pid=<PID>")
    .replace(/\bseq[= ]\d+/gi, "seq=<SEQ>")
    .replace(/\/tmp\/[^\s]+/g, "/tmp/<PATH>")
    .trim()
    .slice(0, 200);
}

/**
 * Compute a fingerprint for a tool failure.
 * Same tool + similar params + similar error = same fingerprint.
 */
function computeToolFailFingerprint(
  toolName: string,
  params: Record<string, unknown>,
  error: string,
): string {
  const normalizedError = normalizeError(error);

  // Normalize params: remove volatile fields
  const stableParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "timeout" || k === "timestamp" || k === "ts") continue;
    stableParams[k] = v;
  }

  const input = `${toolName}|${JSON.stringify(stableParams)}|${normalizedError}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Evict oldest entries when map exceeds max size.
 */
function evictOldest(state: RepeatFailState): void {
  if (state.fingerprints.size <= MAX_FINGERPRINTS) return;

  // Sort by lastSeenTs, remove oldest
  const entries = [...state.fingerprints.entries()]
    .sort((a, b) => a[1].lastSeenTs - b[1].lastSeenTs);

  const toRemove = entries.length - MAX_FINGERPRINTS;
  for (let i = 0; i < toRemove; i++) {
    state.fingerprints.delete(entries[i][0]);
  }
}

/** Record a new fingerprint or update existing state. Returns a signal if threshold crossed. */
function recordFailure(
  state: RepeatFailState,
  fingerprint: string,
  session: string,
  toolName: string,
  error: string,
  callTs: number,
  eventIdx: number,
): FailureSignal | null {
  const existing = state.fingerprints.get(fingerprint);
  if (!existing) {
    state.fingerprints.set(fingerprint, {
      count: 1, lastSeenTs: callTs, sessions: [session],
      toolName, errorPreview: truncate(error, 200),
    });
    return null;
  }
  if (existing.sessions.includes(session)) return null;

  existing.count++;
  existing.lastSeenTs = Math.max(existing.lastSeenTs, callTs);
  existing.sessions.push(session);

  if (existing.count < 2) return null;
  return {
    signal: "SIG-REPEAT-FAIL",
    severity: existing.count >= 3 ? "critical" : "high",
    eventRange: { start: eventIdx, end: eventIdx + 1 },
    summary: `Same failure repeated across ${existing.count} sessions: ${toolName} — ${truncate(error, 200)}`,
    evidence: {
      toolName, fingerprint, count: existing.count,
      sessions: [...existing.sessions],
      errorPreview: truncate(error, 500),
    },
  };
}

/**
 * Detect repeated failures across sessions.
 *
 * Cross-session detector: uses persistent state to track tool failure
 * fingerprints across multiple chains/sessions.
 */
export function detectRepeatFails(
  chain: ConversationChain,
  state: RepeatFailState,
): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const { events } = chain;

  for (let i = 0; i < events.length - 1; i++) {
    const call = events[i];
    const result = events[i + 1];
    if (call.type !== "tool.call" || result.type !== "tool.result") continue;
    if (!result.payload.toolError && result.payload.toolIsError !== true) continue;

    const toolName = call.payload.toolName ?? "";
    const params = (call.payload.toolParams ?? {}) as Record<string, unknown>;
    const error = result.payload.toolError ?? "unknown";
    const fp = computeToolFailFingerprint(toolName, params, error);
    const signal = recordFailure(state, fp, chain.session, toolName, error, call.ts, i);
    if (signal) signals.push(signal);
  }

  evictOldest(state);
  return signals;
}

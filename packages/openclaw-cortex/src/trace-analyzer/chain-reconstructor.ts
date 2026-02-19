// ============================================================
// Trace Analyzer — Chain Reconstructor
// ============================================================
//
// Reconstructs conversation chains from a stream of NormalizedEvents.
// Groups by (session, agent), splits on lifecycle boundaries and
// inactivity gaps, deduplicates across Schema A/B events, and
// uses a sliding window for memory management.
// ============================================================

import { createHash } from "node:crypto";
import type { NormalizedEvent, AnalyzerEventType } from "./events.js";

/** A reconstructed conversation chain. */
export type ConversationChain = {
  /** Deterministic chain ID: first 16 hex chars of SHA-256("session:agent:firstTs"). */
  id: string;
  /** Agent ID (e.g., "main", "forge", "viola"). */
  agent: string;
  /** Normalized session key. */
  session: string;
  /** Timestamp of first event (ms). */
  startTs: number;
  /** Timestamp of last event (ms). */
  endTs: number;
  /** Ordered events in this chain. */
  events: NormalizedEvent[];
  /** Event count per type (for quick filtering). */
  typeCounts: Partial<Record<AnalyzerEventType, number>>;
  /** How the chain boundary was determined. */
  boundaryType: "lifecycle" | "gap" | "time_range" | "memory_cap";
};

/** Configuration for chain reconstruction. */
export type ChainReconstructorOpts = {
  /** Inactivity gap in minutes that triggers a chain split. Default: 30. */
  gapMinutes: number;
  /** Maximum events per chain before forced split. Default: 1000. */
  maxEventsPerChain: number;
};

const DEFAULT_OPTS: ChainReconstructorOpts = {
  gapMinutes: 30,
  maxEventsPerChain: 1000,
};

/** Phase 1: Bucket events by (session, agent). */
async function bucketEvents(
  events: AsyncIterable<NormalizedEvent>,
): Promise<Map<string, NormalizedEvent[]>> {
  const buckets = new Map<string, NormalizedEvent[]>();
  for await (const event of events) {
    const key = `${event.session}::${event.agent}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(event);
  }
  return buckets;
}

/** Convert a segment of events into a ConversationChain. */
function segmentToChain(segment: NormalizedEvent[]): ConversationChain {
  const first = segment[0];
  const last = segment[segment.length - 1];
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of segment) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    id: computeChainId(first.session, first.agent, first.ts),
    agent: first.agent,
    session: first.session,
    startTs: first.ts,
    endTs: last.ts,
    events: segment,
    typeCounts,
    boundaryType: determineBoundaryType(segment),
  };
}

/**
 * Reconstruct conversation chains from a stream of normalized events.
 *
 * Two-pass algorithm:
 * 1. Accumulate events into (session, agent) buckets
 * 2. Split each bucket into chains by boundaries, deduplicate, emit
 */
export async function reconstructChains(
  events: AsyncIterable<NormalizedEvent>,
  opts?: Partial<ChainReconstructorOpts>,
): Promise<ConversationChain[]> {
  const config = { ...DEFAULT_OPTS, ...opts };
  const buckets = await bucketEvents(events);
  const chains: ConversationChain[] = [];

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.ts - b.ts);
    const deduped = deduplicateEvents(bucket);
    const segments = splitOnBoundaries(deduped, config);
    for (const segment of segments) {
      if (segment.length >= 2) chains.push(segmentToChain(segment));
    }
  }

  return chains;
}

/**
 * Determine if a chain boundary should be inserted between prev and curr.
 * Checks lifecycle events and inactivity gaps.
 */
function isBoundary(
  prev: NormalizedEvent,
  curr: NormalizedEvent,
  gapMs: number,
): boolean {
  if (curr.type === "session.start") return true;
  if (prev.type === "session.end") return true;
  if (prev.type === "run.end" && curr.type === "run.start" && curr.ts - prev.ts > 5 * 60 * 1000) return true;
  if (curr.ts - prev.ts > gapMs) return true;
  return false;
}

/**
 * Split a sorted, deduplicated event list into chain segments based on
 * lifecycle boundaries, inactivity gaps, and memory caps.
 */
function splitOnBoundaries(
  events: NormalizedEvent[],
  opts: ChainReconstructorOpts,
): NormalizedEvent[][] {
  if (events.length === 0) return [];

  const gapMs = opts.gapMinutes * 60 * 1000;
  const chains: NormalizedEvent[][] = [];
  let current: NormalizedEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    if (isBoundary(events[i - 1], events[i], gapMs)) {
      if (current.length > 0) chains.push(current);
      current = [events[i]];
    } else {
      current.push(events[i]);
      if (current.length >= opts.maxEventsPerChain) {
        chains.push(current);
        current = [];
      }
    }
  }

  if (current.length > 0) chains.push(current);
  return chains;
}

/**
 * Deduplicate events within a sorted event list.
 * When two events share the same fingerprint (same type, agent, time window,
 * and content/params), keep the one with the higher sequence number.
 */
export function deduplicateEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Map<string, NormalizedEvent>();

  for (const event of events) {
    const fp = eventFingerprint(event);
    const existing = seen.get(fp);

    if (!existing) {
      seen.set(fp, event);
    } else {
      // Keep the event with the higher sequence number (prefer Schema A)
      if (event.seq > existing.seq) {
        seen.set(fp, event);
      }
    }
  }

  // Return in timestamp order
  return [...seen.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Compute a fingerprint for deduplication.
 * Uses a 1-second time window to match events from both schemas
 * that represent the same underlying action.
 */
export function eventFingerprint(event: NormalizedEvent): string {
  const tsWindow = Math.floor(event.ts / 1000); // 1-second window

  switch (event.type) {
    case "msg.in":
    case "msg.out": {
      const contentHash = simpleHash(event.payload.content ?? "");
      return `${event.type}:${event.agent}:${tsWindow}:${contentHash}`;
    }
    case "tool.call": {
      const paramsHash = simpleHash(JSON.stringify(event.payload.toolParams ?? {}));
      return `${event.type}:${event.agent}:${event.payload.toolName ?? ""}:${tsWindow}:${paramsHash}`;
    }
    case "tool.result": {
      const toolName = event.payload.toolName ?? "";
      return `tool.result:${event.agent}:${toolName}:${tsWindow}`;
    }
    default:
      // Session/run lifecycle events — use exact type + timestamp
      return `${event.type}:${event.agent}:${event.ts}`;
  }
}

/** Fast non-crypto hash for dedup fingerprinting. */
export function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < Math.min(str.length, 200); i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** Compute a deterministic chain ID. */
export function computeChainId(session: string, agent: string, firstTs: number): string {
  const input = `${session}:${agent}:${firstTs}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Determine the boundary type of a chain segment based on its events. */
function determineBoundaryType(events: NormalizedEvent[]): ConversationChain["boundaryType"] {
  if (events.length === 0) return "gap";

  const first = events[0];
  const last = events[events.length - 1];

  // If the chain starts with a lifecycle event, it's lifecycle-bounded
  if (
    first.type === "session.start" ||
    first.type === "run.start" ||
    last.type === "session.end" ||
    last.type === "run.end"
  ) {
    return "lifecycle";
  }

  return "gap";
}

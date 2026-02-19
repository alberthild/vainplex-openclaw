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

  // Phase 1: Bucket events by (session, agent)
  const buckets = new Map<string, NormalizedEvent[]>();

  for await (const event of events) {
    const key = `${event.session}::${event.agent}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(event);
  }

  // Phase 2: For each bucket, sort → dedup → split → emit chains
  const chains: ConversationChain[] = [];

  for (const bucket of buckets.values()) {
    // Sort by timestamp (should already be ordered, but defensive)
    bucket.sort((a, b) => a.ts - b.ts);

    // Deduplicate events (handles Schema A/B overlap)
    const deduped = deduplicateEvents(bucket);

    // Split on boundaries
    const segments = splitOnBoundaries(deduped, config);

    for (const segment of segments) {
      if (segment.length < 2) continue; // Skip trivially short chains

      const first = segment[0];
      const last = segment[segment.length - 1];

      // Compute deterministic chain ID
      const chainId = computeChainId(first.session, first.agent, first.ts);

      // Count events by type
      const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
      for (const e of segment) {
        typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
      }

      chains.push({
        id: chainId,
        agent: first.agent,
        session: first.session,
        startTs: first.ts,
        endTs: last.ts,
        events: segment,
        typeCounts,
        boundaryType: determineBoundaryType(segment),
      });
    }
  }

  return chains;
}

/**
 * Split a sorted, deduplicated event list into chain segments based on:
 * (a) session.start → new chain
 * (b) session.end → close current chain
 * (c) run.end → run.start with >5 min gap
 * (d) inactivity gap exceeding configured threshold
 * (e) memory cap exceeded
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
    const prev = events[i - 1];
    const curr = events[i];
    let split = false;

    // Boundary (a): session.start begins a new chain
    if (curr.type === "session.start") {
      split = true;
    }

    // Boundary (b): session.end closes current chain
    if (prev.type === "session.end") {
      split = true;
    }

    // Boundary (c): run.end → run.start with >5 min gap
    if (prev.type === "run.end" && curr.type === "run.start") {
      if (curr.ts - prev.ts > 5 * 60 * 1000) {
        split = true;
      }
    }

    // Boundary (d): inactivity gap exceeds configured threshold
    if (curr.ts - prev.ts > gapMs) {
      split = true;
    }

    if (split) {
      if (current.length > 0) chains.push(current);
      current = [curr];
    } else {
      current.push(curr);
      // Boundary (e): memory cap — force split at max events
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

// ============================================================
// Trace Analyzer — TraceSource Interface
// ============================================================

import type { NormalizedEvent, AnalyzerEventType } from "./events.js";

/** Options for fetching events from a trace source. */
export type FetchOpts = {
  /** Filter by event types (default: all). */
  eventTypes?: AnalyzerEventType[];
  /** Filter by agent IDs (default: all). */
  agents?: string[];
  /** Batch size hint for the underlying transport (default: 500). */
  batchSize?: number;
  /** Maximum number of events to yield (default: unlimited). */
  maxEvents?: number;
};

/**
 * Abstract interface for fetching agent events from any event store backend.
 *
 * Implementations MUST:
 * - Return events ordered by timestamp (ascending).
 * - Support `AsyncIterable` for streaming/backpressure.
 * - Be safe to call `close()` multiple times.
 */
export interface TraceSource {
  /** Fetch events within a time range (inclusive start, exclusive end). */
  fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent>;

  /** Fetch events for a specific agent within a time range. */
  fetchByAgent(
    agent: string,
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent>;

  /** Get the sequence number of the last event in the store. */
  getLastSequence(): Promise<number>;

  /** Get the total event count in the store (or -1 if unavailable). */
  getEventCount(): Promise<number>;

  /** Release resources (close connections). Idempotent. */
  close(): Promise<void>;
}

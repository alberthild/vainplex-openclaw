// ============================================================
// Test Helpers — MockTraceSource + Event/Chain Factories
// ============================================================

import { createHash } from "node:crypto";
import type { TraceSource, FetchOpts } from "../../src/trace-analyzer/trace-source.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../src/trace-analyzer/chain-reconstructor.js";
import type { PluginLogger } from "../../src/types.js";

// ---- Counters ----

let seqCounter = 1;
let tsBase = 1700000000000;

export function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

// ---- Event Factory ----

export function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000; // 1 second between events
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

// ---- Chain Factory ----

export function makeChain(
  events: NormalizedEvent[],
  overrides: Partial<ConversationChain> = {},
): ConversationChain {
  if (events.length === 0) {
    throw new Error("makeChain requires at least one event");
  }

  const first = events[0];
  const last = events[events.length - 1];
  const agent = first.agent;
  const session = first.session;

  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }

  const input = `${session}:${agent}:${first.ts}`;
  const id = createHash("sha256").update(input).digest("hex").slice(0, 16);

  return {
    id,
    agent,
    session,
    startTs: first.ts,
    endTs: last.ts,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

// ---- MockTraceSource ----

export type MockTraceSourceOpts = {
  events?: NormalizedEvent[];
  lastSequence?: number;
  eventCount?: number;
  /** If true, throw on connect (simulate unavailable source). */
  failOnConnect?: boolean;
};

export class MockTraceSource implements TraceSource {
  readonly events: NormalizedEvent[];
  readonly lastSequenceNum: number;
  readonly totalEventCount: number;
  closed = false;
  fetchCallCount = 0;

  constructor(opts: MockTraceSourceOpts = {}) {
    this.events = opts.events ?? [];
    this.lastSequenceNum = opts.lastSequence ?? (this.events.length > 0 ? this.events[this.events.length - 1].seq : 0);
    this.totalEventCount = opts.eventCount ?? this.events.length;
  }

  async *fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    this.fetchCallCount++;

    for (const event of this.events) {
      if (event.ts < startMs) continue;
      if (event.ts >= endMs) continue;

      if (opts?.eventTypes && !opts.eventTypes.includes(event.type)) continue;
      if (opts?.agents && !opts.agents.includes(event.agent)) continue;

      yield event;
    }
  }

  async *fetchByAgent(
    agent: string,
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    yield* this.fetchByTimeRange(startMs, endMs, {
      ...opts,
      agents: [agent],
    });
  }

  async getLastSequence(): Promise<number> {
    return this.lastSequenceNum;
  }

  async getEventCount(): Promise<number> {
    return this.totalEventCount;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

// ---- MockLogger ----

export function createMockLogger(): PluginLogger & { messages: Array<{ level: string; msg: string }> } {
  const messages: Array<{ level: string; msg: string }> = [];
  return {
    messages,
    info: (msg: string) => messages.push({ level: "info", msg }),
    warn: (msg: string) => messages.push({ level: "warn", msg }),
    error: (msg: string) => messages.push({ level: "error", msg }),
    debug: (msg: string) => messages.push({ level: "debug", msg }),
  };
}

// ---- Async Iterable Helper ----

export async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

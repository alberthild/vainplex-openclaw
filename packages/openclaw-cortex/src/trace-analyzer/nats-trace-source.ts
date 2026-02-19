// ============================================================
// Trace Analyzer — NatsTraceSource Implementation
// ============================================================
//
// Reads events from a NATS JetStream stream, normalizing both
// Schema A (nats-eventstore) and Schema B (session-sync) events
// into NormalizedEvent format.
//
// The `nats` package is dynamically imported — if not installed,
// createNatsTraceSource() returns null gracefully (R-004).
// ============================================================

import type { PluginLogger } from "../types.js";
import type { TraceSource, FetchOpts } from "./trace-source.js";
import type { NormalizedEvent } from "./events.js";
import type { TraceAnalyzerConfig } from "./config.js";
import { normalizeEvent } from "./events.js";

/**
 * Minimal type definitions for the nats.js API surface we use.
 * These avoid importing the nats package at the type level.
 */
interface NatsConnection {
  jetstream(): JetStreamClient;
  jetstreamManager(): Promise<JetStreamManager>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

interface JetStreamClient {
  consumers: {
    get(stream: string): Promise<JetStreamConsumer>;
  };
}

interface JetStreamConsumer {
  consume(opts?: { max_messages?: number; idle_heartbeat?: number }): Promise<ConsumerMessages>;
}

interface ConsumerMessages extends AsyncIterable<JetStreamMsg> {
  stop(): void;
}

interface JetStreamMsg {
  seq: number;
  data: Uint8Array;
  ack(): void;
}

interface JetStreamManager {
  streams: {
    info(name: string): Promise<{ state: { first_seq: number; last_seq: number; messages: number } }>;
    getMessage(name: string, query: { seq: number }): Promise<StoredMsg>;
  };
}

interface StoredMsg {
  seq: number;
  data: Uint8Array;
}

interface NatsModule {
  connect(opts: Record<string, unknown>): Promise<NatsConnection>;
  StringCodec(): { decode(data: Uint8Array): string };
}

/**
 * Dynamically import the nats module, returning null if not installed.
 * Uses `new Function()` to prevent bundler static resolution (R-004).
 */
async function loadNatsModule(logger: PluginLogger): Promise<NatsModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return await (new Function("specifier", "return import(specifier)")("nats") as Promise<NatsModule>);
  } catch {
    logger.info("[trace-analyzer] `nats` package not installed — NATS trace source unavailable");
    return null;
  }
}

/** Connect to NATS and return an implementation, or null on failure. */
async function connectNats(
  nats: NatsModule,
  natsConfig: TraceAnalyzerConfig["nats"],
  logger: PluginLogger,
): Promise<TraceSource | null> {
  try {
    const nc = await nats.connect({
      servers: natsConfig.url.replace(/^nats:\/\//, ""),
      user: natsConfig.user, pass: natsConfig.password,
      reconnect: true, maxReconnectAttempts: 10, timeout: 10_000,
    });
    logger.info(`[trace-analyzer] Connected to NATS at ${natsConfig.url}`);
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();
    return new NatsTraceSourceImpl(nc, js, jsm, natsConfig, nats, logger);
  } catch (err) {
    logger.warn(`[trace-analyzer] NATS connection failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Attempt to create a NatsTraceSource. Returns null if:
 * - `nats` npm package is not installed (R-004)
 * - NATS connection fails
 */
export async function createNatsTraceSource(
  natsConfig: TraceAnalyzerConfig["nats"],
  logger: PluginLogger,
): Promise<TraceSource | null> {
  const nats = await loadNatsModule(logger);
  if (!nats) return null;
  return connectNats(nats, natsConfig, logger);
}

/** Result of processing a single NATS message. */
type MessageResult = { event: NormalizedEvent } | "skip" | "past-end";

/** Decode, normalize and filter a single NATS message. */
function processMessage(
  msg: JetStreamMsg,
  sc: { decode(data: Uint8Array): string },
  startMs: number,
  endMs: number,
  opts?: FetchOpts,
): MessageResult {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(sc.decode(msg.data)) as Record<string, unknown>;
  } catch { return "skip"; }

  const event = normalizeEvent(raw, msg.seq);
  if (!event) return "skip";
  if (event.ts < startMs) return "skip";
  if (event.ts > endMs) return "past-end";
  if (opts?.eventTypes && !opts.eventTypes.includes(event.type)) return "skip";
  if (opts?.agents && !opts.agents.includes(event.agent)) return "skip";

  return { event };
}

class NatsTraceSourceImpl implements TraceSource {
  private closed = false;

  constructor(
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly config: TraceAnalyzerConfig["nats"],
    private readonly natsModule: NatsModule,
    private readonly logger: PluginLogger,
  ) {}

  async *fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    const sc = this.natsModule.StringCodec();
    const info = await this.jsm.streams.info(this.config.stream);
    const firstSeq = info.state.first_seq;
    const lastSeq = info.state.last_seq;

    // Binary search for approximate start sequence to avoid scanning from seq 1.
    const startSeq = await this.findStartSequence(sc, firstSeq, lastSeq, startMs);
    this.logger.info(
      `[trace-analyzer] Scanning seq ${startSeq}–${lastSeq} (skipped ${startSeq - firstSeq} of ${lastSeq - firstSeq + 1} events)`,
    );

    let yieldedCount = 0;
    let missCount = 0;
    const maxConsecutiveMisses = 50;
    const maxEvents = opts?.maxEvents ?? Infinity;

    for (let seq = startSeq; seq <= lastSeq; seq++) {
      if (yieldedCount >= maxEvents) break;

      let raw: Record<string, unknown>;
      try {
        const stored = await this.jsm.streams.getMessage(this.config.stream, { seq });
        raw = JSON.parse(sc.decode(stored.data)) as Record<string, unknown>;
        missCount = 0;
      } catch {
        missCount++;
        if (missCount > maxConsecutiveMisses) break;
        continue;
      }

      const event = normalizeEvent(raw, seq);
      if (!event) continue;
      if (event.ts < startMs) continue;
      if (event.ts > endMs) break;
      if (opts?.eventTypes && !opts.eventTypes.includes(event.type)) continue;
      if (opts?.agents && !opts.agents.includes(event.agent)) continue;

      yieldedCount++;
      yield event;
    }

    const limitNote = yieldedCount >= maxEvents ? ` (capped at ${maxEvents})` : "";
    this.logger.info(`[trace-analyzer] Fetched ${yieldedCount} events in time range${limitNote}`);
  }

  /**
   * Binary search for the first sequence whose timestamp is >= targetMs.
   * Falls back to firstSeq if all events are after targetMs.
   */
  private async findStartSequence(
    sc: { decode(data: Uint8Array): string },
    firstSeq: number,
    lastSeq: number,
    targetMs: number,
  ): Promise<number> {
    let lo = firstSeq;
    let hi = lastSeq;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const ts = await this.getEventTimestamp(sc, mid);
      if (ts === null || ts < targetMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }

  /** Read the timestamp of a single event by sequence, returning null on failure. */
  private async getEventTimestamp(
    sc: { decode(data: Uint8Array): string },
    seq: number,
  ): Promise<number | null> {
    try {
      const stored = await this.jsm.streams.getMessage(this.config.stream, { seq });
      const raw = JSON.parse(sc.decode(stored.data)) as Record<string, unknown>;
      const ts = (raw.ts ?? raw.timestamp) as number | undefined;
      return typeof ts === "number" ? ts : null;
    } catch {
      return null;
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
    const info = await this.jsm.streams.info(this.config.stream);
    return info.state.last_seq;
  }

  async getEventCount(): Promise<number> {
    const info = await this.jsm.streams.info(this.config.stream);
    return info.state.messages;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.nc.drain().catch(() => {});
    await this.nc.close().catch(() => {});
  }
}

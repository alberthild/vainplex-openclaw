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
    info(name: string): Promise<{ state: { last_seq: number; messages: number } }>;
  };
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
    const batchSize = opts?.batchSize ?? 500;
    let yieldedCount = 0;
    let exhausted = false;

    while (!exhausted) {
      const consumer = await this.js.consumers.get(this.config.stream);
      const messages = await consumer.consume({ max_messages: batchSize, idle_heartbeat: 5_000 });
      let batchCount = 0;
      let pastEnd = false;

      try {
        for await (const msg of messages) {
          batchCount++;
          const result = processMessage(msg, sc, startMs, endMs, opts);
          msg.ack();
          if (result === "skip") continue;
          if (result === "past-end") { messages.stop(); pastEnd = true; break; }
          yieldedCount++;
          yield result.event;
        }
      } catch (err) {
        this.logger.warn(
          `[trace-analyzer] Error during NATS fetch: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }

      if (pastEnd || batchCount < batchSize) exhausted = true;
    }

    this.logger.info(`[trace-analyzer] Fetched ${yieldedCount} events in time range`);
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

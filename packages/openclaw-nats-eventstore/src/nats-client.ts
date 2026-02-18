import type { NatsEventStoreConfig } from "./config.js";

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

export type NatsClient = {
  publish(subject: string, data: string): Promise<void>;
  isConnected(): boolean;
  getStatus(): NatsClientStatus;
  drain(): Promise<void>;
  close(): Promise<void>;
};

export type NatsClientStatus = {
  connected: boolean;
  stream: string | null;
  disconnectCount: number;
  publishFailures: number;
};

const MAX_PUBLISH_FAILURES_BEFORE_WARN = 10;

/**
 * Parse a NATS URL, extracting user/pass and returning a safe URL for logging.
 *
 * Example: "nats://user:pass@host:4222" → { servers: "host:4222", user: "user", pass: "pass", safeUrl: "nats://host:4222" }
 */
export function parseNatsUrl(url: string): {
  servers: string;
  user?: string;
  pass?: string;
  safeUrl: string;
} {
  try {
    const parsed = new URL(url);
    const user = parsed.username || undefined;
    const pass = parsed.password || undefined;
    const host = parsed.hostname;
    const port = parsed.port || "4222";
    const servers = `${host}:${port}`;
    const safeUrl = `${parsed.protocol}//${host}:${port}`;
    return { servers, user, pass, safeUrl };
  } catch {
    // If URL parsing fails, return as-is
    return { servers: url, safeUrl: url };
  }
}

async function ensureStream(
  nc: any,
  config: NatsEventStoreConfig,
  logger: PluginLogger,
): Promise<void> {
  const jsm = await nc.jetstreamManager();

  try {
    await jsm.streams.info(config.streamName);
    logger.debug(`[nats-eventstore] Stream "${config.streamName}" exists`);
  } catch (err: any) {
    // Stream doesn't exist — create it
    // nats.js v2+: JetStream API errors use err.api_error?.code (numeric)
    const apiCode = (err as any)?.api_error?.code;
    const errCode = (err as any)?.code;
    const isNotFound =
      apiCode === 404 ||
      errCode === 404 ||
      errCode === "404" ||
      err?.message?.includes("not found") ||
      err?.message?.includes("stream not found");
    if (isNotFound) {
      const streamConfig: Record<string, unknown> = {
        name: config.streamName,
        subjects: [`${config.subjectPrefix}.>`],
        retention: "limits" as const,
        max_msgs: config.retention.maxMessages,
        max_bytes: config.retention.maxBytes,
        max_age: config.retention.maxAgeHours > 0
          ? config.retention.maxAgeHours * 60 * 60 * 1_000_000_000 // nanoseconds
          : 0,
      };
      await jsm.streams.add(streamConfig);
      logger.info(`[nats-eventstore] Created stream "${config.streamName}"`);
    } else {
      throw err;
    }
  }
}

function monitorConnection(
  nc: any,
  counters: { disconnects: number; publishFailures: number },
  logger: PluginLogger,
): void {
  (async () => {
    for await (const status of nc.status()) {
      switch (status.type) {
        case "disconnect":
          counters.disconnects++;
          logger.warn(`[nats-eventstore] Disconnected (${counters.disconnects} total)`);
          break;
        case "reconnect":
          logger.info("[nats-eventstore] Reconnected");
          break;
        case "error":
          logger.error(`[nats-eventstore] Connection error: ${status.data}`);
          break;
      }
    }
  })().catch(() => {
    // Iterator ends when connection closes — expected
  });
}

export async function createNatsClient(
  config: NatsEventStoreConfig,
  logger: PluginLogger,
): Promise<NatsClient> {
  const nats = await import("nats");

  const parsed = parseNatsUrl(config.natsUrl);
  const nc = await nats.connect({
    servers: parsed.servers,
    user: parsed.user,
    pass: parsed.pass,
    reconnect: true,
    maxReconnectAttempts: -1,
    timeout: config.connectTimeoutMs,
  });

  logger.info(`[nats-eventstore] Connected to ${parsed.safeUrl}`);

  const js = nc.jetstream();
  const sc = nats.StringCodec();

  // Ensure stream exists
  await ensureStream(nc, config, logger);

  // Monitor connection status
  const counters = { disconnects: 0, publishFailures: 0 };
  monitorConnection(nc, counters, logger);

  return {
    async publish(subject: string, data: string): Promise<void> {
      try {
        const publishPromise = js.publish(subject, sc.encode(data));
        if (config.publishTimeoutMs > 0) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            publishPromise,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Publish timeout after ${config.publishTimeoutMs}ms`)),
                config.publishTimeoutMs,
              );
            }),
          ]).finally(() => clearTimeout(timer!));
        } else {
          await publishPromise;
        }
        counters.publishFailures = 0;
      } catch (err) {
        counters.publishFailures++;
        if (
          counters.publishFailures === 1 ||
          counters.publishFailures % MAX_PUBLISH_FAILURES_BEFORE_WARN === 0
        ) {
          logger.warn(
            `[nats-eventstore] Publish failed (${counters.publishFailures} consecutive): ${err}`,
          );
        }
        // Non-fatal: do not throw. Agent operations must never be blocked by event store.
      }
    },
    isConnected: () => !nc.isClosed(),
    getStatus: () => ({
      connected: !nc.isClosed(),
      stream: config.streamName,
      disconnectCount: counters.disconnects,
      publishFailures: counters.publishFailures,
    }),
    async drain() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          nc.drain(),
          new Promise<void>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Drain timeout")),
              config.drainTimeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer!));
      } catch {
        logger.warn("[nats-eventstore] Drain timed out, forcing close");
        await nc.close().catch(() => {});
      }
    },
    async close() {
      await nc.close().catch(() => {});
    },
  };
}

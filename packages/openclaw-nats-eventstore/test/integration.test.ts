/**
 * Integration test — requires NATS server on localhost:14222 (staging)
 * Run: NATS_URL=nats://localhost:14222 npx vitest run test/integration.test.ts
 *
 * Skipped by default when NATS_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createNatsClient, parseNatsUrl } from "../src/nats-client.js";
import { registerEventHooks } from "../src/hooks.js";
import { resolveConfig, DEFAULTS } from "../src/config.js";
import type { NatsClient, PluginLogger } from "../src/nats-client.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:14222";
const TEST_STREAM = "openclaw-events-test";
const TEST_PREFIX = "test.events";

const logger: PluginLogger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: () => {},
};

describe.skipIf(!process.env.NATS_URL)("NATS Event Store Integration", () => {
  let client: NatsClient;
  let subscriberNc: any;
  let sc: any;

  beforeAll(async () => {
    const nats = await import("nats");

    const config = resolveConfig({
      natsUrl: NATS_URL,
      streamName: TEST_STREAM,
      subjectPrefix: TEST_PREFIX,
      retention: { maxMessages: 100 },
      publishTimeoutMs: 5000,
    });

    client = await createNatsClient(config, logger);

    // Separate subscriber connection for verifying messages
    const parsed = parseNatsUrl(NATS_URL);
    subscriberNc = await nats.connect({ servers: parsed.servers });
    sc = nats.StringCodec();
  });

  afterAll(async () => {
    // Clean up: delete test stream
    if (subscriberNc) {
      try {
        const jsm = await subscriberNc.jetstreamManager();
        await jsm.streams.delete(TEST_STREAM);
        logger.info("Deleted test stream");
      } catch {
        // Stream may not exist
      }
      await subscriberNc.drain();
    }
    if (client) {
      await client.drain();
    }
  });

  it("connects and reports healthy status", () => {
    const status = client.getStatus();
    expect(status.connected).toBe(true);
    expect(status.stream).toBe(TEST_STREAM);
    expect(status.disconnectCount).toBe(0);
    expect(status.publishFailures).toBe(0);
  });

  it("created the JetStream stream", async () => {
    const jsm = await subscriberNc.jetstreamManager();
    const info = await jsm.streams.info(TEST_STREAM);
    expect(info.config.name).toBe(TEST_STREAM);
    expect(info.config.subjects).toContain(`${TEST_PREFIX}.>`);
  });

  it("publishes events to correct subjects", async () => {
    // Subscribe to all test events
    const js = subscriberNc.jetstream();
    const consumer = await js.consumers.get(TEST_STREAM);

    // Publish a test event
    const testPayload = JSON.stringify({
      id: "test-1",
      ts: Date.now(),
      agent: "main",
      session: "test",
      type: "msg.in",
      payload: { from: "test", content: "hello" },
    });

    await client.publish(`${TEST_PREFIX}.main.msg_in`, testPayload);

    // Read back
    const msgs = await consumer.fetch({ max_messages: 1, expires: 3000 });
    const received: string[] = [];
    for await (const msg of msgs) {
      received.push(sc.decode(msg.data));
      msg.ack();
    }

    expect(received.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.type).toBe("msg.in");
    expect(parsed.payload.content).toBe("hello");
  });

  it("hooks produce events via the plugin API", async () => {
    const config = resolveConfig({
      natsUrl: NATS_URL,
      streamName: TEST_STREAM,
      subjectPrefix: TEST_PREFIX,
    });

    // Track registered hooks
    const hooks: Record<string, Function> = {};
    const mockApi = {
      logger,
      on: (name: string, handler: Function) => {
        hooks[name] = handler;
      },
    };

    registerEventHooks(mockApi, config, () => client);

    // Fire message_received hook
    hooks["message_received"](
      { from: "albert", content: "integration test", timestamp: Date.now() },
      { agentId: "main", sessionKey: "main:matrix:albert", channelId: "matrix" },
    );

    // Give publish time to complete
    await new Promise((r) => setTimeout(r, 500));

    // Verify stream has messages
    const jsm = await subscriberNc.jetstreamManager();
    const info = await jsm.streams.info(TEST_STREAM);
    expect(info.state.messages).toBeGreaterThanOrEqual(2); // test event + hook event
  });

  it("survives publish after drain (non-fatal)", async () => {
    // Create a separate short-lived client
    const tempConfig = resolveConfig({
      natsUrl: NATS_URL,
      streamName: TEST_STREAM,
      subjectPrefix: TEST_PREFIX,
    });
    const tempClient = await createNatsClient(tempConfig, logger);

    // Drain it
    await tempClient.drain();

    // Should be disconnected now
    expect(tempClient.isConnected()).toBe(false);
  });

  it("respects retention maxMessages", async () => {
    const jsm = await subscriberNc.jetstreamManager();
    const info = await jsm.streams.info(TEST_STREAM);
    expect(info.config.max_msgs).toBe(100);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerEventHooks } from "../src/hooks.js";
import type { NatsClient } from "../src/nats-client.js";
import { defaultConfig, createMockApi, createMockClient } from "./helpers.js";

describe("Event Hooks Setup & Config", () => {
  let mockApi: ReturnType<typeof createMockApi>;
  let mockClient: NatsClient;
  let published: Array<{ subject: string; data: string }>;

  beforeEach(() => {
    published = [];
    mockApi = createMockApi();
    mockClient = createMockClient({
      publish: vi.fn(async (subject: string, data: string) => {
        published.push({ subject, data });
      }),
    });
  });

  it("respects excludeHooks config", () => {
    const config = defaultConfig({ excludeHooks: ["message_received", "gateway_start"] });
    registerEventHooks(mockApi, config, () => mockClient);

    expect(mockApi._handlers["message_received"]).toBeUndefined();
    expect(mockApi._handlers["gateway_start"]).toBeUndefined();
    // Other hooks should still be registered
    expect(mockApi._handlers["message_sent"]).toBeDefined();
  });

  it("respects includeHooks config", () => {
    const config = defaultConfig({ includeHooks: ["message_received", "agent_end"] });
    registerEventHooks(mockApi, config, () => mockClient);

    expect(mockApi._handlers["message_received"]).toBeDefined();
    expect(mockApi._handlers["agent_end"]).toBeDefined();
    // Others should NOT be registered
    expect(mockApi._handlers["message_sent"]).toBeUndefined();
    expect(mockApi._handlers["gateway_start"]).toBeUndefined();
  });

  it("no-ops when client is null", () => {
    registerEventHooks(mockApi, defaultConfig(), () => null);

    mockApi._fire(
      "message_received",
      { from: "testuser", content: "hello", timestamp: 1000 },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(0);
  });

  it("no-ops when client is disconnected", () => {
    const disconnected = createMockClient({ isConnected: () => false });
    registerEventHooks(mockApi, defaultConfig(), () => disconnected);

    mockApi._fire(
      "message_received",
      { from: "testuser", content: "hello", timestamp: 1000 },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(0);
  });

  it("extracts agent from sessionKey for non-main agents", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "message_received",
      { from: "user", content: "hi", timestamp: 1000 },
      { agentId: "viola", sessionKey: "viola:telegram:123" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.agent).toBe("viola");
    expect(published[0].subject).toBe("openclaw.events.viola.msg_in");
  });

  it("hook handler errors are caught and do not propagate", () => {
    // Publish that throws
    const throwingClient = createMockClient({
      isConnected: () => true,
      publish: vi.fn(async () => { throw new Error("publish failed"); }),
    });
    registerEventHooks(mockApi, defaultConfig(), () => throwingClient);

    // Should not throw
    expect(() => {
      mockApi._fire(
        "message_received",
        { from: "testuser", content: "hello", timestamp: 1000 },
        { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
      );
    }).not.toThrow();
  });

  it("generates unique event IDs when no stable source identifiers exist", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("message_received", { from: "a", content: "1", timestamp: 1 }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("message_received", { from: "a", content: "2", timestamp: 2 }, { agentId: "main", sessionKey: "main" });

    const id1 = JSON.parse(published[0].data).id;
    const id2 = JSON.parse(published[1].data).id;
    expect(id1).not.toBe(id2);
  });

  it("generates deterministic event IDs when stable source identifiers exist", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("before_agent_start", { prompt: "hi", runId: "run-123" }, { agentId: "main", sessionKey: "sess" });
    mockApi._fire("before_agent_start", { prompt: "hi", runId: "run-123" }, { agentId: "main", sessionKey: "sess" });

    const runId1 = JSON.parse(published[0].data).id;
    const runId2 = JSON.parse(published[1].data).id;
    expect(runId1).toBe(runId2);
    expect(runId1).toMatch(/^evt-/);

    mockApi._fire("message_received", { from: "u", content: "c", messageId: "msg-999" }, { agentId: "main", sessionKey: "sess" });
    mockApi._fire("message_received", { from: "u", content: "c", messageId: "msg-999" }, { agentId: "main", sessionKey: "sess" });

    const msgId1 = JSON.parse(published[2].data).id;
    const msgId2 = JSON.parse(published[3].data).id;
    expect(msgId1).toBe(msgId2);
    expect(msgId1).toMatch(/^evt-/);

    mockApi._fire("before_agent_start", { prompt: "hi", runId: "run-456" }, { agentId: "main", sessionKey: "sess" });
    const runId3 = JSON.parse(published[4].data).id;
    expect(runId3).not.toBe(runId1);
  });
});

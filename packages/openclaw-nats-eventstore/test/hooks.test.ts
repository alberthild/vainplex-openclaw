import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerEventHooks } from "../src/hooks.js";
import { DEFAULTS } from "../src/config.js";
import type { NatsEventStoreConfig } from "../src/config.js";
import type { NatsClient } from "../src/nats-client.js";

function defaultConfig(overrides?: Partial<NatsEventStoreConfig>): NatsEventStoreConfig {
  return { ...DEFAULTS, ...overrides };
}

function createMockClient(overrides?: Partial<NatsClient>): NatsClient {
  return {
    publish: vi.fn(async () => {}),
    isConnected: () => true,
    getStatus: () => ({ connected: true, stream: "test", disconnectCount: 0, publishFailures: 0 }),
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

function createMockApi() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    on: vi.fn((name: string, handler: (...args: any[]) => void) => {
      (handlers[name] ??= []).push(handler);
    }),
    _fire(name: string, ...args: any[]) {
      for (const h of handlers[name] ?? []) {
        h(...args);
      }
    },
    _handlers: handlers,
  };
}

describe("registerEventHooks", () => {
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

  it("registers handlers for all 16 hooks", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    const expectedHooks = [
      "message_received", "message_sending", "message_sent",
      "before_tool_call", "after_tool_call",
      "before_agent_start", "agent_end",
      "llm_input", "llm_output",
      "before_compaction", "after_compaction",
      "before_reset",
      "session_start", "session_end",
      "gateway_start", "gateway_stop",
    ];

    for (const hook of expectedHooks) {
      expect(mockApi._handlers[hook], `Handler for ${hook} should be registered`).toBeDefined();
      expect(mockApi._handlers[hook]!.length).toBeGreaterThan(0);
    }
  });

  it("maps message_received to msg.in", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "message_received",
      { from: "albert", content: "hello", timestamp: 1000, metadata: { key: "val" } },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    expect(published[0].subject).toBe("openclaw.events.main.msg_in");
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.in");
    expect(event.agent).toBe("main");
    expect(event.session).toBe("main:matrix:albert");
    expect(event.payload.from).toBe("albert");
    expect(event.payload.content).toBe("hello");
    expect(event.payload.channel).toBe("matrix");
    expect(event.payload.metadata).toEqual({ key: "val" });
    expect(event.id).toBeDefined();
    expect(event.ts).toBeGreaterThan(0);
  });

  it("maps message_sending to msg.sending", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "message_sending",
      { to: "albert", content: "Hi!" },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.sending");
    expect(event.payload.to).toBe("albert");
    expect(event.payload.content).toBe("Hi!");
  });

  it("maps message_sent to msg.out", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "message_sent",
      { to: "albert", content: "Hi!", success: true, error: null },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.out");
    expect(event.payload.success).toBe(true);
  });

  it("maps before_tool_call to tool.call", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "before_tool_call",
      { toolName: "web_search", params: { query: "weather" } },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("tool.call");
    expect(event.payload.toolName).toBe("web_search");
    expect(event.payload.params).toEqual({ query: "weather" });
  });

  it("maps after_tool_call to tool.result", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "after_tool_call",
      { toolName: "web_search", params: { query: "weather" }, result: "sunny", error: null, durationMs: 500 },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("tool.result");
    expect(event.payload.durationMs).toBe(500);
  });

  it("maps before_agent_start to run.start", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "before_agent_start",
      { prompt: "Hello Claudia" },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("run.start");
    expect(event.payload.prompt).toBe("Hello Claudia");
  });

  it("emits both run.end and run.error on failure", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "agent_end",
      { success: false, error: "Provider timeout", durationMs: 30000, messages: [1, 2] },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(2);
    const runEnd = JSON.parse(published[0].data);
    const runError = JSON.parse(published[1].data);

    expect(runEnd.type).toBe("run.end");
    expect(runEnd.payload.success).toBe(false);
    expect(runEnd.payload.messageCount).toBe(2);

    expect(runError.type).toBe("run.error");
    expect(runError.payload.error).toBe("Provider timeout");
  });

  it("emits only run.end on success (no run.error)", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "agent_end",
      { success: true, error: null, durationMs: 5000, messages: [1, 2, 3] },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("run.end");
    expect(event.payload.success).toBe(true);
    expect(event.payload.messageCount).toBe(3);
  });

  it("maps llm_input to llm.input with privacy (lengths, not content)", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "llm_input",
      {
        runId: "run-1",
        sessionId: "sess-1",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        systemPrompt: "You are a helpful assistant",
        prompt: "What's the weather?",
        historyMessages: [1, 2, 3],
        imagesCount: 0,
      },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("llm.input");
    expect(event.payload.systemPromptLength).toBe("You are a helpful assistant".length);
    expect(event.payload.promptLength).toBe("What's the weather?".length);
    expect(event.payload.historyMessageCount).toBe(3);
    // Should NOT include content
    expect(event.payload.systemPrompt).toBeUndefined();
    expect(event.payload.prompt).toBeUndefined();
  });

  it("maps llm_output to llm.output", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "llm_output",
      {
        runId: "run-1",
        sessionId: "sess-1",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        assistantTexts: ["Hello!", "How can I help?"],
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      },
      { agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("llm.output");
    expect(event.payload.assistantTextCount).toBe(2);
    expect(event.payload.assistantTextTotalLength).toBe("Hello!".length + "How can I help?".length);
    expect(event.payload.usage).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 });
  });

  it("handles llm_output with undefined/null assistantTexts gracefully", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    // undefined assistantTexts
    mockApi._fire(
      "llm_output",
      {
        runId: "run-2",
        sessionId: "sess-2",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        // assistantTexts intentionally omitted
        usage: { input: 10, output: 0, total: 10 },
      },
      { agentId: "main", sessionKey: "main" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.payload.assistantTextCount).toBe(0);
    expect(event.payload.assistantTextTotalLength).toBe(0);
  });

  it("maps gateway_start and gateway_stop with system agent", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("gateway_start", { port: 3000 });
    mockApi._fire("gateway_stop", { reason: "SIGTERM" });

    expect(published).toHaveLength(2);
    const start = JSON.parse(published[0].data);
    const stop = JSON.parse(published[1].data);

    expect(start.type).toBe("gateway.start");
    expect(start.agent).toBe("system");
    expect(start.session).toBe("system");
    expect(start.payload.port).toBe(3000);

    expect(stop.type).toBe("gateway.stop");
    expect(stop.agent).toBe("system");
    expect(stop.payload.reason).toBe("SIGTERM");
  });

  it("maps session hooks correctly", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("session_start", { sessionId: "s1", resumedFrom: null }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("session_end", { sessionId: "s1", messageCount: 42, durationMs: 5000 }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(2);
    expect(JSON.parse(published[0].data).type).toBe("session.start");
    expect(JSON.parse(published[1].data).type).toBe("session.end");
  });

  it("maps compaction hooks correctly", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("before_compaction", { messageCount: 200, compactingCount: 150, tokenCount: 45000 }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("after_compaction", { messageCount: 200, compactedCount: 5, tokenCount: 8000 }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(2);
    expect(JSON.parse(published[0].data).type).toBe("session.compaction_start");
    expect(JSON.parse(published[1].data).type).toBe("session.compaction_end");
  });

  it("maps before_reset to session.reset", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("before_reset", { reason: "/new" }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("session.reset");
    expect(event.payload.reason).toBe("/new");
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
      { from: "albert", content: "hello", timestamp: 1000 },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
    );

    expect(published).toHaveLength(0);
  });

  it("no-ops when client is disconnected", () => {
    const disconnected = createMockClient({ isConnected: () => false });
    registerEventHooks(mockApi, defaultConfig(), () => disconnected);

    mockApi._fire(
      "message_received",
      { from: "albert", content: "hello", timestamp: 1000 },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
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
        { from: "albert", content: "hello", timestamp: 1000 },
        { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:albert" },
      );
    }).not.toThrow();
  });

  it("generates unique event IDs", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("message_received", { from: "a", content: "1", timestamp: 1 }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("message_received", { from: "a", content: "2", timestamp: 2 }, { agentId: "main", sessionKey: "main" });

    const id1 = JSON.parse(published[0].data).id;
    const id2 = JSON.parse(published[1].data).id;
    expect(id1).not.toBe(id2);
  });
});

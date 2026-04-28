import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerEventHooks } from "../src/hooks.js";
import type { NatsClient } from "../src/nats-client.js";
import { defaultConfig, createMockApi, createMockClient } from "./helpers.js";

describe("Event Hook Mappings", () => {
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
      { from: "testuser", content: "hello", timestamp: 1000, metadata: { key: "val" } },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    expect(published[0].subject).toBe("openclaw.events.main.msg_in");
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.in");
    expect(event.canonicalType).toBe("message.in.received");
    expect(event.legacyType).toBe("msg.in");
    expect(event.schemaVersion).toBe(1);
    expect(event.source.plugin).toBe("nats-eventstore");
    expect(event.actor.agentId).toBe("main");
    expect(event.actor.channel).toBe("matrix");
    expect(event.scope.sessionKey).toBe("main:matrix:testuser");
    expect(event.visibility).toBe("confidential");
    expect(event.agent).toBe("main");
    expect(event.session).toBe("main:matrix:testuser");
    expect(event.payload.from).toBe("testuser");
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
      { to: "testuser", content: "Hi!" },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.sending");
    expect(event.canonicalType).toBe("message.out.sending");
    expect(event.legacyType).toBe("msg.sending");
    expect(event.payload.to).toBe("testuser");
    expect(event.payload.content).toBe("Hi!");
  });

  it("maps message_sent to msg.out", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "message_sent",
      { to: "testuser", content: "Hi!", success: true, error: null },
      { channelId: "matrix", agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("msg.out");
    expect(event.canonicalType).toBe("message.out.sent");
    expect(event.legacyType).toBe("msg.out");
    expect(event.payload.success).toBe(true);
  });

  it("maps before_tool_call to tool.call", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "before_tool_call",
      { toolName: "web_search", params: { query: "weather" } },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("tool.call");
    expect(event.canonicalType).toBe("tool.call.requested");
    expect(event.legacyType).toBe("tool.call");
    expect(event.payload.toolName).toBe("web_search");
    expect(event.payload.params).toEqual({ query: "weather" });
  });

  it("maps after_tool_call to tool.result and canonicalType tool.call.executed on success", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "after_tool_call",
      { toolName: "web_search", params: { query: "weather" }, result: "sunny", error: null, durationMs: 500 },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("tool.result");
    expect(event.canonicalType).toBe("tool.call.executed");
    expect(event.legacyType).toBe("tool.result");
    expect(event.payload.durationMs).toBe(500);
  });

  it("maps after_tool_call to tool.result and canonicalType tool.call.failed on error", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "after_tool_call",
      { toolName: "web_search", params: { query: "weather" }, result: null, error: "Network Error", durationMs: 500 },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("tool.result");
    expect(event.canonicalType).toBe("tool.call.failed");
    expect(event.legacyType).toBe("tool.result");
    expect(event.payload.error).toBe("Network Error");
  });

  it("maps before_agent_start to run.start", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "before_agent_start",
      { prompt: "Hello Claudia" },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("run.start");
    expect(event.canonicalType).toBe("run.started");
    expect(event.legacyType).toBe("run.start");
    expect(event.payload.prompt).toBe("Hello Claudia");
  });

  it("emits both run.end and run.error on failure", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "agent_end",
      { success: false, error: "Provider timeout", durationMs: 30000, messages: [1, 2] },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(2);
    const runEnd = JSON.parse(published[0].data);
    const runError = JSON.parse(published[1].data);

    expect(runEnd.type).toBe("run.end");
    expect(runEnd.canonicalType).toBe("run.ended");
    expect(runEnd.legacyType).toBe("run.end");
    expect(runEnd.payload.success).toBe(false);
    expect(runEnd.payload.messageCount).toBe(2);

    expect(runError.type).toBe("run.error");
    expect(runError.canonicalType).toBe("run.failed");
    expect(runError.legacyType).toBe("run.error");
    expect(runError.payload.error).toBe("Provider timeout");
  });

  it("emits only run.end on success (no run.error)", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "agent_end",
      { success: true, error: null, durationMs: 5000, messages: [1, 2, 3] },
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("run.end");
    expect(event.canonicalType).toBe("run.ended");
    expect(event.legacyType).toBe("run.end");
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
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("llm.input");
    expect(event.canonicalType).toBe("model.input.observed");
    expect(event.legacyType).toBe("llm.input");
    expect(event.redaction).toEqual({ applied: true, omittedFields: ["systemPrompt", "prompt", "historyMessages"] });
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
      { agentId: "main", sessionKey: "main:matrix:testuser" },
    );

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("llm.output");
    expect(event.canonicalType).toBe("model.output.observed");
    expect(event.legacyType).toBe("llm.output");
    expect(event.payload.assistantTextCount).toBe(2);
    expect(event.payload.assistantTextTotalLength).toBe("Hello!".length + "How can I help?".length);
    expect(event.payload.usage).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 });
  });

  it("handles llm_output with undefined/null assistantTexts gracefully", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire(
      "llm_output",
      {
        runId: "run-2",
        sessionId: "sess-2",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
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
    expect(start.canonicalType).toBe("gateway.started");
    expect(start.legacyType).toBe("gateway.start");
    expect(start.agent).toBe("system");
    expect(start.session).toBe("system");
    expect(start.payload.port).toBe(3000);

    expect(stop.type).toBe("gateway.stop");
    expect(stop.canonicalType).toBe("gateway.stopped");
    expect(stop.legacyType).toBe("gateway.stop");
    expect(stop.agent).toBe("system");
    expect(stop.payload.reason).toBe("SIGTERM");
  });

  it("maps session hooks correctly", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("session_start", { sessionId: "s1", resumedFrom: null }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("session_end", { sessionId: "s1", messageCount: 42, durationMs: 5000 }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(2);
    expect(JSON.parse(published[0].data).type).toBe("session.start");
    expect(JSON.parse(published[0].data).canonicalType).toBe("session.started");
    expect(JSON.parse(published[1].data).type).toBe("session.end");
    expect(JSON.parse(published[1].data).canonicalType).toBe("session.ended");
  });

  it("maps compaction hooks correctly", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("before_compaction", { messageCount: 200, compactingCount: 150, tokenCount: 45000 }, { agentId: "main", sessionKey: "main" });
    mockApi._fire("after_compaction", { messageCount: 200, compactedCount: 5, tokenCount: 8000 }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(2);
    expect(JSON.parse(published[0].data).type).toBe("session.compaction_start");
    expect(JSON.parse(published[0].data).canonicalType).toBe("session.compaction.started");
    expect(JSON.parse(published[1].data).type).toBe("session.compaction_end");
    expect(JSON.parse(published[1].data).canonicalType).toBe("session.compaction.ended");
  });

  it("maps before_reset to session.reset", () => {
    registerEventHooks(mockApi, defaultConfig(), () => mockClient);

    mockApi._fire("before_reset", { reason: "/new" }, { agentId: "main", sessionKey: "main" });

    expect(published).toHaveLength(1);
    const event = JSON.parse(published[0].data);
    expect(event.type).toBe("session.reset");
    expect(event.payload.reason).toBe("/new");
  });
});

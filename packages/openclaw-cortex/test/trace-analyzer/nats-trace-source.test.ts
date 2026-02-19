import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNatsTraceSource } from "../../src/trace-analyzer/nats-trace-source.js";
import { normalizeEvent } from "../../src/trace-analyzer/events.js";
import type { TraceAnalyzerConfig } from "../../src/trace-analyzer/config.js";
import type { PluginLogger } from "../../src/types.js";

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const defaultNatsConfig: TraceAnalyzerConfig["nats"] = {
  url: "nats://localhost:4222",
  stream: "openclaw-events",
  subjectPrefix: "openclaw.events",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NatsTraceSource", () => {
  it("returns null when nats package is not installed", async () => {
    // Since nats is not actually installed in this project,
    // the dynamic import should fail gracefully
    const source = await createNatsTraceSource(defaultNatsConfig, logger);
    expect(source).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("nats"),
    );
  });

  it("logs info message about nats unavailability", async () => {
    await createNatsTraceSource(defaultNatsConfig, logger);
    expect(logger.info).toHaveBeenCalledWith(
      "[trace-analyzer] `nats` package not installed — NATS trace source unavailable",
    );
  });

  it("does not throw when nats is not available", async () => {
    await expect(
      createNatsTraceSource(defaultNatsConfig, logger),
    ).resolves.not.toThrow();
  });

  it("accepts config with credentials", async () => {
    const config: TraceAnalyzerConfig["nats"] = {
      ...defaultNatsConfig,
      credentials: "/path/to/creds.nk",
      user: "testuser",
      password: "testpass",
    };
    // Still returns null because nats is not installed,
    // but doesn't throw on config shape
    const source = await createNatsTraceSource(config, logger);
    expect(source).toBeNull();
  });
});

describe("NatsTraceSource — normalization (unit tests via normalizeEvent)", () => {

  it("normalizes Schema A msg.in correctly", () => {
    const event = normalizeEvent({
      id: "uuid-1",
      ts: 1700000000000,
      agent: "main",
      session: "main",
      type: "msg.in",
      payload: {
        from: "matrix:@albert:vainplex.dev",
        content: "und nu?",
        timestamp: 1771504212206,
        channel: "matrix",
        metadata: { to: "room:!abc" },
      },
    }, 584);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("msg.in");
    expect(event!.payload.content).toBe("und nu?");
    expect(event!.payload.from).toBe("matrix:@albert:vainplex.dev");
    expect(event!.payload.channel).toBe("matrix");
    expect(event!.seq).toBe(584);
  });

  it("normalizes Schema A tool.result with error", () => {
    const event = normalizeEvent({
      id: "uuid-2",
      ts: 1700000001000,
      agent: "main",
      session: "main",
      type: "tool.result",
      payload: {
        toolName: "exec",
        params: { command: "ssh backup df -h" },
        error: "Connection refused",
        durationMs: 5893,
      },
    }, 8393);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool.result");
    expect(event!.payload.toolName).toBe("exec");
    expect(event!.payload.toolError).toBe("Connection refused");
    expect(event!.payload.toolIsError).toBe(true);
    expect(event!.payload.toolDurationMs).toBe(5893);
  });

  it("normalizes Schema B conversation.message.in", () => {
    const event = normalizeEvent({
      id: "short-abc",
      timestamp: 1700000002000,
      agent: "main",
      session: "agent:main:8ae7c1b0-uuid",
      type: "conversation.message.in",
      visibility: "internal",
      payload: {
        role: "user",
        text_preview: [{ type: "text", text: "deploy the config" }],
        content_length: 17,
        sessionId: "8ae7c1b0-uuid",
      },
      meta: { source: "session-sync" },
    }, 20448);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("msg.in");
    expect(event!.session).toBe("8ae7c1b0-uuid");
    expect(event!.payload.content).toBe("deploy the config");
    expect(event!.payload.role).toBe("user");
  });

  it("normalizes Schema B conversation.tool_call", () => {
    const event = normalizeEvent({
      id: "short-def",
      timestamp: 1700000003000,
      agent: "main",
      session: "agent:main:uuid-123",
      type: "conversation.tool_call",
      payload: {
        runId: "run-1",
        stream: "openclaw-events",
        data: {
          phase: "start",
          name: "exec",
          toolCallId: "tc-1",
          args: { command: "ls -la" },
        },
      },
      meta: { source: "session-sync" },
    }, 4162);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool.call");
    expect(event!.payload.toolName).toBe("exec");
    expect(event!.payload.toolParams).toEqual({ command: "ls -la" });
  });

  it("normalizes Schema B conversation.tool_result with error", () => {
    const event = normalizeEvent({
      id: "short-ghi",
      timestamp: 1700000004000,
      agent: "main",
      session: "agent:main:uuid-456",
      type: "conversation.tool_result",
      payload: {
        data: {
          phase: "result",
          name: "exec",
          toolCallId: "tc-1",
          isError: true,
          result: "Permission denied (publickey)",
          meta: {},
        },
      },
      meta: { source: "session-sync" },
    }, 1997);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool.result");
    expect(event!.payload.toolName).toBe("exec");
    expect(event!.payload.toolIsError).toBe(true);
    expect(event!.payload.toolError).toBe("Permission denied (publickey)");
  });

  it("normalizes Schema B conversation.tool_result success", () => {
    const event = normalizeEvent({
      id: "short-jkl",
      timestamp: 1700000005000,
      agent: "forge",
      session: "agent:forge:uuid-789",
      type: "conversation.tool_result",
      payload: {
        data: {
          phase: "result",
          name: "Read",
          isError: false,
          result: { content: [{ type: "text", text: "file contents" }] },
        },
      },
    }, 500);

    expect(event).not.toBeNull();
    expect(event!.agent).toBe("forge");
    expect(event!.session).toBe("uuid-789");
    expect(event!.payload.toolIsError).toBe(false);
    expect(event!.payload.toolError).toBeUndefined();
    expect(event!.payload.toolResult).toEqual({
      content: [{ type: "text", text: "file contents" }],
    });
  });

  it("maps Schema A msg.out correctly", () => {
    const event = normalizeEvent({
      id: "uuid-3",
      ts: 1700000006000,
      agent: "main",
      session: "main",
      type: "msg.out",
      payload: {
        to: "room:!Wgox",
        content: "Gateway restart ok",
        success: true,
        channel: "matrix",
      },
    }, 722);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("msg.out");
    expect(event!.payload.content).toBe("Gateway restart ok");
    expect(event!.payload.success).toBe(true);
    expect(event!.payload.to).toBe("room:!Wgox");
    expect(event!.payload.role).toBe("assistant");
  });

  it("skips events with no timestamp", () => {
    expect(normalizeEvent({
      id: "x",
      type: "msg.in",
      agent: "main",
      payload: { content: "test" },
    }, 1)).toBeNull();
  });

  it("skips events with unknown types", () => {
    expect(normalizeEvent({
      id: "x",
      ts: 1700000000000,
      type: "session.compaction_start",
      agent: "main",
    }, 1)).toBeNull();
  });
});

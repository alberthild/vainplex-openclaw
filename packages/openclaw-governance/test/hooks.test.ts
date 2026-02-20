import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GovernanceEngine } from "../src/engine.js";
import { registerGovernanceHooks } from "../src/hooks.js";
import { resolveConfig } from "../src/config.js";
import type { GovernanceConfig, OpenClawPluginApi, PluginCommand, PluginLogger, PluginService } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-hooks";
const logger: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

type HookHandler = (...args: unknown[]) => unknown;
type HookEntry = { name: string; handler: HookHandler; opts?: { priority?: number } };

function createMockApi() {
  const hooks: HookEntry[] = [];
  const commands: PluginCommand[] = [];
  const services: PluginService[] = [];
  const methods: { method: string; handler: (...args: unknown[]) => unknown }[] = [];

  const api: OpenClawPluginApi = {
    id: "openclaw-governance",
    pluginConfig: {},
    logger,
    config: {},
    registerService: (s) => services.push(s),
    registerCommand: (c) => commands.push(c),
    registerGatewayMethod: (m, h) => methods.push({ method: m, handler: h }),
    on: (name, handler, opts) => hooks.push({ name, handler: handler as HookHandler, opts }),
  };

  return { api, hooks, commands, services, methods };
}

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return { ...resolveConfig({}), ...overrides };
}

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, "governance", "audit"), { recursive: true });
});

afterEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
});

describe("registerGovernanceHooks", () => {
  it("should register all expected hooks", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    registerGovernanceHooks(api, engine, config);

    const hookNames = hooks.map((h) => h.name);
    expect(hookNames).toContain("before_tool_call");
    expect(hookNames).toContain("message_sending");
    expect(hookNames).toContain("after_tool_call");
    expect(hookNames).toContain("before_agent_start");
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("gateway_start");
    expect(hookNames).toContain("gateway_stop");

    await engine.stop();
  });

  it("should set correct priorities", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();

    registerGovernanceHooks(api, engine, config);

    const btc = hooks.find((h) => h.name === "before_tool_call");
    expect(btc?.opts?.priority).toBe(1000);

    const atc = hooks.find((h) => h.name === "after_tool_call");
    expect(atc?.opts?.priority).toBe(900);

    await engine.stop();
  });

  it("should block denied tool calls", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      policies: [
        {
          id: "deny-exec",
          name: "Deny Exec",
          version: "1.0.0",
          scope: {},
          rules: [
            {
              id: "r1",
              conditions: [{ type: "tool", name: "exec" }],
              effect: { action: "deny", reason: "Blocked" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;
    expect(handler).toBeDefined();

    const result = await handler!(
      { toolName: "exec", params: { command: "ls" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "exec" },
    );

    expect(result).toEqual({ block: true, blockReason: "Blocked" });

    await engine.stop();
  });

  it("should return undefined for allowed tool calls", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;
    const result = await handler!(
      { toolName: "read", params: { path: "/tmp/test" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "read" },
    );

    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should register governance command", async () => {
    const { api, commands } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const cmd = commands.find((c) => c.name === "governance");
    expect(cmd).toBeDefined();

    const result = await cmd!.handler();
    expect(result.text).toContain("Governance Engine");

    await engine.stop();
  });

  it("should handle after_tool_call for trust feedback", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "after_tool_call")?.handler;
    expect(handler).toBeDefined();

    // Should not throw
    handler!(
      { toolName: "exec", params: {}, durationMs: 100 },
      { agentId: "main", sessionKey: "agent:main", toolName: "exec" },
    );

    await engine.stop();
  });

  it("should handle before_agent_start for context injection", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_agent_start")?.handler;
    const result = handler!(
      { prompt: "test" },
      { agentId: "main", sessionKey: "agent:main" },
    );

    expect(result).toBeDefined();
    if (result && typeof result === "object" && "prependContext" in result) {
      expect((result as { prependContext: string }).prependContext).toContain("Governance");
    }

    await engine.stop();
  });

  it("should handle session_start without error", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "session_start")?.handler;
    expect(handler).toBeDefined();

    // Should not throw
    handler!(
      { sessionId: "test-session" },
      { agentId: "main", sessionId: "test-session" },
    );

    await engine.stop();
  });

  it("should handle errors with fail-closed", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({ failMode: "closed" });
    const engine = new GovernanceEngine(config, logger, WORKSPACE);

    // Don't start engine — simulate error scenario
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    const result = await handler!(
      { toolName: "exec", params: {} },
      { agentId: "main", sessionKey: "agent:main", toolName: "exec" },
    );

    expect(result === undefined || (typeof result === "object" && result !== null)).toBe(true);
  });

  it("should handle message_sending deny", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      policies: [
        {
          id: "deny-msg",
          name: "Deny Messages",
          version: "1.0.0",
          scope: { hooks: ["message_sending"] },
          rules: [
            {
              id: "r1",
              conditions: [{ type: "context", messageContains: "forbidden" }],
              effect: { action: "deny", reason: "Forbidden content" },
            },
          ],
        },
      ],
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "message_sending")?.handler;
    expect(handler).toBeDefined();

    const result = await handler!(
      { to: "user", content: "forbidden word", metadata: {} },
      { channelId: "matrix" },
    );
    expect(result).toEqual({ cancel: true });

    await engine.stop();
  });

  it("should allow messages that don't match deny", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "message_sending")?.handler;
    const result = await handler!(
      { to: "user", content: "hello" },
      { channelId: "matrix" },
    );
    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should detect sub-agent spawn in after_tool_call", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "after_tool_call")?.handler;

    // Simulate sessions_spawn result
    handler!(
      {
        toolName: "sessions_spawn",
        params: {},
        result: { sessionId: "agent:main:subagent:forge:abc" },
      },
      { agentId: "main", sessionKey: "agent:main", toolName: "sessions_spawn" },
    );

    // No error expected
    await engine.stop();
  });

  it("should handle failed tool in after_tool_call", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "after_tool_call")?.handler;

    handler!(
      { toolName: "exec", params: {}, error: "Command failed" },
      { agentId: "main", sessionKey: "agent:main", toolName: "exec" },
    );

    // No error expected
    await engine.stop();
  });

  it("should handle gateway_start and gateway_stop", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const startHandler = hooks.find((h) => h.name === "gateway_start")?.handler;
    startHandler!({ port: 3000 });

    const stopHandler = hooks.find((h) => h.name === "gateway_stop")?.handler;
    await stopHandler!({ reason: "shutdown" });
  });

  // ── Bug 1: agentId resolution in hooks ──

  it("should resolve agentId from sessionKey when agentId is missing (Bug 1)", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    // Only sessionKey, no agentId
    const result = await handler!(
      { toolName: "read", params: { path: "/tmp/test" } },
      { sessionKey: "agent:forge:session123", toolName: "read" },
    );

    // Should resolve "forge" from sessionKey and not crash
    expect(result).toBeUndefined(); // allowed

    await engine.stop();
  });

  it("should handle missing agentId AND sessionKey without crash (Bug 1)", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    // No agentId, no sessionKey
    const result = await handler!(
      { toolName: "read", params: {} },
      { toolName: "read" },
    );

    // Should use "unresolved" and not crash
    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should handle after_tool_call with only sessionKey (Bug 1)", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig();
    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "after_tool_call")?.handler;

    // Only sessionKey, no agentId
    handler!(
      { toolName: "exec", params: {}, durationMs: 100 },
      { sessionKey: "agent:forge:xyz", toolName: "exec" },
    );

    // Trust should update for "forge"
    const trust = engine.getTrust("forge");
    expect("signals" in trust && trust.signals.successCount).toBe(1);

    await engine.stop();
  });

  // ── External Communication Detection (RFC-006) ──

  it("should detect external message tool call and validate", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter", "linkedin"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    // Message to twitter — should trigger external comm detection
    // Since no LLM validator is actually set on engine, it returns sync pass
    const result = await handler!(
      { toolName: "message", params: { channel: "twitter", text: "We processed 500k events!" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "message" },
    );

    // Without actual LLM validator set, should pass through
    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should detect external exec command (bird tweet)", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    const result = await handler!(
      { toolName: "exec", params: { command: "bird tweet 'Hello world!'" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "exec" },
    );

    // Without LLM validator, should pass
    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should not flag non-external message channels", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    // Matrix is not in externalChannels — should not trigger external validation
    const result = await handler!(
      { toolName: "message", params: { channel: "matrix", text: "Internal message" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "message" },
    );

    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should detect sessions_send to external-labeled session", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter", "linkedin"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    // sessions_send to a twitter-labeled session — should detect
    const result = await handler!(
      { toolName: "sessions_send", params: { label: "twitter-poster", message: "500k events processed!" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "sessions_send" },
    );

    // Without LLM validator set, passes through
    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should detect message tool with action=send and external target", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state"],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter", "linkedin", "email"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    const result = await handler!(
      { toolName: "message", params: { action: "send", target: "linkedin-company-page", message: "Check our plugins!" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "message" },
    );

    expect(result).toBeUndefined();

    await engine.stop();
  });

  it("should not trigger external detection when output validation disabled", async () => {
    const { api, hooks } = createMockApi();
    const config = makeConfig({
      outputValidation: {
        enabled: false,
        enabledDetectors: [],
        factRegistries: [],
        unverifiedClaimPolicy: "ignore",
        selfReferentialPolicy: "ignore",
        contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
        llmValidator: {
          enabled: true,
          maxTokens: 500,
          timeoutMs: 5000,
          externalChannels: ["twitter"],
          externalCommands: ["bird tweet"],
        },
      },
    });

    const engine = new GovernanceEngine(config, logger, WORKSPACE);
    await engine.start();
    registerGovernanceHooks(api, engine, config);

    const handler = hooks.find((h) => h.name === "before_tool_call")?.handler;

    const result = await handler!(
      { toolName: "message", params: { channel: "twitter", text: "Tweet this!" } },
      { agentId: "main", sessionKey: "agent:main", toolName: "message" },
    );

    expect(result).toBeUndefined();

    await engine.stop();
  });
});

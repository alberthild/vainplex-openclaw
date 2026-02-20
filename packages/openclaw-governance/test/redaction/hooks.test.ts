import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HookAfterToolCallEvent,
  HookBeforeToolCallEvent,
  HookMessageSendingEvent,
  OpenClawPluginApi,
  PluginLogger,
  RedactionConfig,
} from "../../src/types.js";
import {
  DEFAULT_REDACTION_CONFIG,
  initRedaction,
  parseRedactionConfig,
  registerRedactionHooks,
  stopRedaction,
  type RedactionState,
} from "../../src/redaction/hooks.js";

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfig(overrides?: Partial<RedactionConfig>): RedactionConfig {
  return {
    ...DEFAULT_REDACTION_CONFIG,
    enabled: true,
    categories: ["credential", "pii", "financial"],
    ...overrides,
  };
}

type HandlerFn = (...args: unknown[]) => unknown;

function mockApi(): OpenClawPluginApi & { handlers: Map<string, HandlerFn[]> } {
  const handlers = new Map<string, HandlerFn[]>();

  return {
    id: "test",
    logger,
    config: {},
    handlers,
    registerService: vi.fn(),
    registerCommand: vi.fn(),
    registerGatewayMethod: vi.fn(),
    on: (hookName: string, handler: (...args: unknown[]) => unknown, _opts?: { priority?: number }) => {
      const list = handlers.get(hookName) ?? [];
      list.push(handler as HandlerFn);
      handlers.set(hookName, list);
    },
  };
}

function getHandler(api: ReturnType<typeof mockApi>, hookName: string): HandlerFn {
  const handlers = api.handlers.get(hookName);
  if (!handlers || handlers.length === 0) {
    throw new Error(`No handler registered for ${hookName}`);
  }
  return handlers[0]!;
}

describe("Redaction Hooks", () => {
  let state: RedactionState;

  afterEach(() => {
    if (state) {
      stopRedaction(state);
    }
    vi.restoreAllMocks();
  });

  // ── initRedaction ──

  describe("initRedaction", () => {
    it("creates registry, vault, and engine", () => {
      state = initRedaction(makeConfig(), logger);
      expect(state.registry).toBeDefined();
      expect(state.vault).toBeDefined();
      expect(state.engine).toBeDefined();
      expect(state.config).toBeDefined();
    });
  });

  // ── registerRedactionHooks ──

  describe("registerRedactionHooks", () => {
    it("registers all 4 hooks", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();

      registerRedactionHooks(api, state);

      expect(api.handlers.has("after_tool_call")).toBe(true);
      expect(api.handlers.has("before_tool_call")).toBe(true);
      expect(api.handlers.has("message_sending")).toBe(true);
      expect(api.handlers.has("before_message_write")).toBe(true);
    });
  });

  // ── Layer 1: after_tool_call ──

  describe("Layer 1: after_tool_call", () => {
    it("redacts credentials in tool output", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "exec",
        params: { command: "env" },
        result: "PASSWORD=MyS3cretP4ss!",
      };

      handler(event, { toolName: "exec", sessionKey: "agent:main" });

      expect(event.result).toMatch(/\[REDACTED:credential/);
      expect(String(event.result)).not.toContain("MyS3cretP4ss!");
    });

    it("redacts nested object results", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "read",
        params: { path: ".env" },
        result: {
          config: { apiKey: "password=secret_api_key_12345" },
        },
      };

      handler(event, { toolName: "read" });

      const result = event.result as Record<string, Record<string, string>>;
      expect(result["config"]!["apiKey"]).toMatch(/\[REDACTED:credential/);
    });

    it("skips null/undefined results", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "exec",
        params: {},
        result: undefined,
      };

      handler(event, { toolName: "exec" });
      expect(event.result).toBeUndefined();
    });

    it("stores redacted values in vault for later resolution", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "exec",
        params: {},
        result: "password=MyS3cretP4ss!",
      };

      handler(event, { toolName: "exec" });

      // The vault should have the original value stored
      const placeholder = String(event.result);
      const resolved = state.vault.resolve(placeholder);
      expect(resolved).toContain("MyS3cretP4ss!");
    });

    it("skips exempt tools but still redacts credentials", () => {
      state = initRedaction(
        makeConfig({
          allowlist: {
            ...DEFAULT_REDACTION_CONFIG.allowlist,
            exemptTools: ["session_status"],
          },
        }),
        logger,
      );
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");

      // PII should not be redacted in exempt tool output
      // But credentials should still be redacted
      const event: HookAfterToolCallEvent = {
        toolName: "session_status",
        params: {},
        result: "password=ExemptToolSecret123",
      };

      handler(event, { toolName: "session_status" });

      // Credential should still be redacted even in exempt tool
      expect(String(event.result)).toMatch(/\[REDACTED:credential/);
    });

    it("suppresses result on error in fail-closed mode", () => {
      state = initRedaction(makeConfig({ failMode: "closed" }), logger);

      // Force an error by breaking the engine
      const origScan = state.engine.scan.bind(state.engine);
      state.engine.scan = () => {
        throw new Error("Test error");
      };

      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "exec",
        params: {},
        result: "sensitive data",
      };

      handler(event, { toolName: "exec" });

      expect(String(event.result)).toContain("REDACTION ERROR");

      // Restore
      state.engine.scan = origScan;
    });
  });

  // ── Vault Resolution: before_tool_call ──

  describe("Vault Resolution: before_tool_call", () => {
    it("resolves placeholders in tool params", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      // First store a secret via after_tool_call
      const afterHandler = getHandler(api, "after_tool_call");
      const afterEvent: HookAfterToolCallEvent = {
        toolName: "read",
        params: {},
        result: "password=MyS3cretP4ss!",
      };
      afterHandler(afterEvent, { toolName: "read" });

      const placeholder = String(afterEvent.result);

      // Now resolve it via before_tool_call
      const beforeHandler = getHandler(api, "before_tool_call");
      const beforeEvent: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: { command: `echo ${placeholder}` },
      };

      const result = beforeHandler(beforeEvent, { toolName: "exec" }) as {
        params?: Record<string, unknown>;
        block?: boolean;
      } | undefined;

      expect(result?.params?.["command"]).toContain("MyS3cretP4ss!");
      expect(result?.block).toBeUndefined();
    });

    it("blocks tool call with unresolvable placeholder", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_tool_call");
      const event: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: { command: "echo [REDACTED:credential:deadbeef]" },
      };

      const result = handler(event, { toolName: "exec" }) as {
        block?: boolean;
        blockReason?: string;
      } | undefined;

      expect(result?.block).toBe(true);
      expect(result?.blockReason).toContain("Unresolvable");
    });

    it("passes through params without placeholders", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_tool_call");
      const event: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: { command: "echo hello" },
      };

      const result = handler(event, { toolName: "exec" });
      expect(result).toBeUndefined();
    });

    it("resolves nested placeholders in params", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      // Store a secret
      const afterHandler = getHandler(api, "after_tool_call");
      const afterEvent: HookAfterToolCallEvent = {
        toolName: "read",
        params: {},
        result: "token=my_api_token_value_here_1234",
      };
      afterHandler(afterEvent, { toolName: "read" });

      const placeholder = String(afterEvent.result);
      const match = /\[REDACTED:credential:[a-f0-9]+\]/.exec(placeholder);
      expect(match).not.toBeNull();

      // Now try to resolve in nested params
      const beforeHandler = getHandler(api, "before_tool_call");
      const beforeEvent: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: {
          config: {
            auth: match![0],
          },
        },
      };

      const result = beforeHandler(beforeEvent, { toolName: "exec" }) as {
        params?: Record<string, unknown>;
      } | undefined;

      const config = result?.params?.["config"] as Record<string, string>;
      expect(config?.["auth"]).toContain("my_api_token_value_here_1234");
    });

    it("blocks on expired vault entry", () => {
      state = initRedaction(makeConfig({ vaultExpirySeconds: 1 }), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      // Store a secret
      const afterHandler = getHandler(api, "after_tool_call");
      const afterEvent: HookAfterToolCallEvent = {
        toolName: "read",
        params: {},
        result: "password=ExpiringSecret123!",
      };
      afterHandler(afterEvent, { toolName: "read" });

      const placeholder = String(afterEvent.result);
      const match = /\[REDACTED:credential:[a-f0-9]+\]/.exec(placeholder);

      // Expire the vault
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      const beforeHandler = getHandler(api, "before_tool_call");
      const beforeEvent: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: { command: `use ${match![0]}` },
      };

      const result = beforeHandler(beforeEvent, { toolName: "exec" }) as {
        block?: boolean;
        blockReason?: string;
      } | undefined;

      expect(result?.block).toBe(true);
      expect(result?.blockReason).toContain("Unresolvable");

      vi.useRealTimers();
    });
  });

  // ── Layer 2: message_sending ──

  describe("Layer 2: message_sending", () => {
    it("redacts credentials in outbound messages", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Your password is: password=MyS3cret123!",
      };

      const result = handler(event, {
        channelId: "matrix",
        accountId: "test",
      }) as { content?: string } | undefined;

      expect(result?.content).toMatch(/\[REDACTED:credential/);
      expect(result?.content).not.toContain("MyS3cret123!");
    });

    it("allows PII on allowlisted channels", () => {
      state = initRedaction(
        makeConfig({
          allowlist: {
            ...DEFAULT_REDACTION_CONFIG.allowlist,
            piiAllowedChannels: ["matrix"],
          },
        }),
        logger,
      );
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Contact: albert@vainplex.de",
      };

      const result = handler(event, {
        channelId: "matrix",
        accountId: "test",
      }) as { content?: string } | undefined;

      // PII allowed on matrix → no redaction
      expect(result).toBeUndefined();
    });

    it("redacts PII on non-allowlisted channels", () => {
      state = initRedaction(
        makeConfig({
          allowlist: {
            ...DEFAULT_REDACTION_CONFIG.allowlist,
            piiAllowedChannels: ["matrix"],
          },
        }),
        logger,
      );
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Contact: albert@vainplex.de",
      };

      const result = handler(event, {
        channelId: "twitter",
        accountId: "test",
      }) as { content?: string } | undefined;

      expect(result?.content).toMatch(/\[REDACTED:pii/);
      expect(result?.content).not.toContain("albert@vainplex.de");
    });

    it("always redacts credentials regardless of allowlist", () => {
      state = initRedaction(
        makeConfig({
          allowlist: {
            piiAllowedChannels: ["matrix"],
            financialAllowedChannels: ["matrix"],
            exemptTools: [],
            exemptAgents: ["admin-bot"],
          },
        }),
        logger,
      );
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Here is your key: password=MyS3cret123!",
      };

      const result = handler(event, {
        channelId: "matrix",
        accountId: "test",
      }) as { content?: string } | undefined;

      expect(result?.content).toMatch(/\[REDACTED:credential/);
    });

    it("passes through clean messages", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Hello, how are you?",
      };

      const result = handler(event, { channelId: "matrix" });
      expect(result).toBeUndefined();
    });

    it("handles empty content", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "",
      };

      const result = handler(event, { channelId: "matrix" });
      expect(result).toBeUndefined();
    });
  });

  // ── Layer 2 (sync): before_message_write ──

  describe("Layer 2 sync: before_message_write", () => {
    it("redacts credentials in message writes", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_message_write");
      const event = {
        content: "password=WriteSecret12345!",
      };

      const result = handler(event, {}) as {
        content?: string;
        block?: boolean;
      } | undefined;

      expect(result?.content).toMatch(/\[REDACTED:credential/);
    });

    it("redacts financial data in message writes", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_message_write");
      const event = {
        content: "Card: 4111 1111 1111 1111",
      };

      const result = handler(event, {}) as {
        content?: string;
      } | undefined;

      expect(result?.content).toMatch(/\[REDACTED:financial/);
    });

    it("does NOT redact PII-only content (per RFC-007 §5.4)", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_message_write");
      const event = {
        content: "Email user@example.com for help",
      };

      const result = handler(event, {}) as {
        content?: string;
      } | undefined;

      // PII-only should not trigger before_message_write redaction
      expect(result).toBeUndefined();
    });

    it("handles empty content", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_message_write");
      const result = handler({ content: "" }, {});
      expect(result).toBeUndefined();
    });

    it("handles no content", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      const handler = getHandler(api, "before_message_write");
      const result = handler({}, {});
      expect(result).toBeUndefined();
    });
  });

  // ── parseRedactionConfig ──

  describe("parseRedactionConfig", () => {
    it("returns default config for undefined input", () => {
      const config = parseRedactionConfig(undefined);
      expect(config).toEqual(DEFAULT_REDACTION_CONFIG);
    });

    it("returns default config for empty object", () => {
      const config = parseRedactionConfig({});
      expect(config).toEqual(DEFAULT_REDACTION_CONFIG);
    });

    it("parses a full config", () => {
      const config = parseRedactionConfig({
        redaction: {
          enabled: true,
          categories: ["credential", "pii"],
          vaultExpirySeconds: 1800,
          failMode: "open",
          customPatterns: [
            { name: "nats_url", regex: "nats://[^\\s]+", category: "credential" },
          ],
          allowlist: {
            piiAllowedChannels: ["matrix"],
            financialAllowedChannels: [],
            exemptTools: ["session_status"],
            exemptAgents: [],
          },
          performanceBudgetMs: 10,
        },
      });

      expect(config.enabled).toBe(true);
      expect(config.categories).toEqual(["credential", "pii"]);
      expect(config.vaultExpirySeconds).toBe(1800);
      expect(config.failMode).toBe("open");
      expect(config.customPatterns.length).toBe(1);
      expect(config.allowlist.piiAllowedChannels).toEqual(["matrix"]);
      expect(config.performanceBudgetMs).toBe(10);
    });

    it("handles partial config with defaults", () => {
      const config = parseRedactionConfig({
        redaction: {
          enabled: true,
        },
      });

      expect(config.enabled).toBe(true);
      expect(config.categories).toEqual(DEFAULT_REDACTION_CONFIG.categories);
      expect(config.failMode).toBe(DEFAULT_REDACTION_CONFIG.failMode);
    });

    it("filters invalid categories", () => {
      const config = parseRedactionConfig({
        redaction: {
          categories: ["credential", "invalid", "pii"],
        },
      });

      expect(config.categories).toEqual(["credential", "pii"]);
    });
  });

  // ── End-to-End Integration ──

  describe("end-to-end integration", () => {
    it("tool output → LLM → vault resolution flow", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      // Step 1: Tool returns a secret
      const afterHandler = getHandler(api, "after_tool_call");
      const toolResult: HookAfterToolCallEvent = {
        toolName: "exec",
        params: { command: "cat .env" },
        result: "API_KEY=password=sk-proj-abcdefghijklmnopqrstuvwxyz",
      };
      afterHandler(toolResult, { toolName: "exec", sessionKey: "agent:main" });

      // Verify LLM sees placeholder
      const llmSees = String(toolResult.result);
      expect(llmSees).toContain("[REDACTED:");
      expect(llmSees).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");

      // Step 2: LLM uses the placeholder in a tool call
      const beforeHandler = getHandler(api, "before_tool_call");
      const match = /\[REDACTED:credential:[a-f0-9]+\]/.exec(llmSees);
      expect(match).not.toBeNull();

      const toolCall: HookBeforeToolCallEvent = {
        toolName: "exec",
        params: { command: `curl -H "Authorization: ${match![0]}"` },
      };

      const resolved = beforeHandler(toolCall, { toolName: "exec" }) as {
        params?: Record<string, unknown>;
      } | undefined;

      // Tool receives the real value
      expect(String(resolved?.params?.["command"])).toContain(
        "sk-proj-abcdefghijklmnopqrstuvwxyz",
      );
    });

    it("credential in outbound message is always redacted", () => {
      state = initRedaction(
        makeConfig({
          allowlist: {
            piiAllowedChannels: ["matrix"],
            financialAllowedChannels: ["matrix"],
            exemptTools: [],
            exemptAgents: [],
          },
        }),
        logger,
      );
      const api = mockApi();
      registerRedactionHooks(api, state);

      // Agent tries to send a credential
      const handler = getHandler(api, "message_sending");
      const event: HookMessageSendingEvent = {
        to: "user",
        content: "Here's the key: password=TopSecretKey123!",
      };

      const result = handler(event, {
        channelId: "matrix",
        accountId: "test",
      }) as { content?: string } | undefined;

      expect(result?.content).not.toContain("TopSecretKey123!");
      expect(result?.content).toMatch(/\[REDACTED:credential/);
    });

    it("vault contents never appear in audit logs", () => {
      state = initRedaction(makeConfig(), logger);
      const api = mockApi();
      registerRedactionHooks(api, state);

      // Store a secret
      const handler = getHandler(api, "after_tool_call");
      const event: HookAfterToolCallEvent = {
        toolName: "exec",
        params: {},
        result: "password=AuditTestSecret!1234",
      };
      handler(event, { toolName: "exec" });

      // Check that logger was called but never with the secret
      const allCalls = [
        ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls,
      ];

      for (const call of allCalls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain("AuditTestSecret!1234");
        }
      }
    });
  });
});

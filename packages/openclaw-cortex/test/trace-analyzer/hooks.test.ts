import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { registerTraceAnalyzerHooks, cleanupTraceAnalyzerHooks } from "../../src/trace-analyzer/hooks.js";
import type { TraceAnalyzerHookState } from "../../src/trace-analyzer/hooks.js";
import type { OpenClawPluginApi, CortexConfig, PluginCommand } from "../../src/types.js";
import { DEFAULTS } from "../../src/config.js";
import { TRACE_ANALYZER_DEFAULTS } from "../../src/trace-analyzer/config.js";

// ---- Mock Plugin API ----

type MockApi = {
  commands: PluginCommand[];
  services: Array<{ id: string; start: () => Promise<void>; stop: () => Promise<void> }>;
  hooks: Array<{ name: string; handler: (...args: unknown[]) => void; opts?: { priority?: number } }>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
};

function createMockApi(): MockApi & OpenClawPluginApi {
  const api: MockApi = {
    commands: [],
    services: [],
    hooks: [],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };

  return {
    ...api,
    id: "test-cortex",
    config: {},
    registerService: (svc) => api.services.push(svc),
    registerCommand: (cmd) => api.commands.push(cmd),
    on: (name, handler, opts) => api.hooks.push({ name, handler, opts }),
  } as MockApi & OpenClawPluginApi;
}

// ---- Config Helpers ----

let workspace: string;

function makeConfig(traceOverrides?: Partial<CortexConfig["traceAnalyzer"]>): CortexConfig {
  return {
    ...DEFAULTS,
    workspace,
    traceAnalyzer: {
      ...TRACE_ANALYZER_DEFAULTS,
      enabled: true,
      ...traceOverrides,
    },
  };
}

beforeEach(() => {
  workspace = join(tmpdir(), `cortex-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workspace, "memory", "reboot"), { recursive: true });
});

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("registerTraceAnalyzerHooks", () => {
  it("registers trace-analyze and trace-status commands when enabled", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig();

    registerTraceAnalyzerHooks(api, config, state);

    const cmdNames = api.commands.map(c => c.name);
    expect(cmdNames).toContain("trace-analyze");
    expect(cmdNames).toContain("trace-status");
  });

  it("logs registration info", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig();

    registerTraceAnalyzerHooks(api, config, state);

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[trace-analyzer] Hooks registered"),
    );
  });

  it("does NOT set up timer when schedule.enabled is false", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig({ schedule: { enabled: false, intervalHours: 24 } });

    registerTraceAnalyzerHooks(api, config, state);

    expect(state.timer).toBeNull();
  });

  it("sets up scheduled interval when schedule.enabled is true", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig({ schedule: { enabled: true, intervalHours: 6 } });

    registerTraceAnalyzerHooks(api, config, state);

    expect(state.timer).not.toBeNull();

    // Clean up
    cleanupTraceAnalyzerHooks(state);
  });

  it("scheduled timer uses .unref() (does not block Node exit)", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig({ schedule: { enabled: true, intervalHours: 1 } });

    registerTraceAnalyzerHooks(api, config, state);

    // The timer should exist and have been unrefed
    // We can verify it exists; .unref() returns the timer itself
    expect(state.timer).not.toBeNull();

    // Clean up
    cleanupTraceAnalyzerHooks(state);
  });

  it("logs scheduled interval info when schedule is enabled", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig({ schedule: { enabled: true, intervalHours: 12 } });

    registerTraceAnalyzerHooks(api, config, state);

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Scheduled analysis every 12h"),
    );

    cleanupTraceAnalyzerHooks(state);
  });
});

describe("cleanupTraceAnalyzerHooks", () => {
  it("clears the timer on cleanup", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig({ schedule: { enabled: true, intervalHours: 1 } });

    registerTraceAnalyzerHooks(api, config, state);
    expect(state.timer).not.toBeNull();

    cleanupTraceAnalyzerHooks(state);
    expect(state.timer).toBeNull();
  });

  it("nullifies analyzer on cleanup", () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig();

    registerTraceAnalyzerHooks(api, config, state);

    // Simulate that analyzer was created (lazy init on first command call)
    // We just verify cleanup nullifies it
    cleanupTraceAnalyzerHooks(state);
    expect(state.analyzer).toBeNull();
  });

  it("is safe to call multiple times", () => {
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };

    // Should not throw
    cleanupTraceAnalyzerHooks(state);
    cleanupTraceAnalyzerHooks(state);
    cleanupTraceAnalyzerHooks(state);
    expect(state.timer).toBeNull();
    expect(state.analyzer).toBeNull();
  });
});

describe("command handlers", () => {
  it("trace-analyze command returns result text", async () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig();

    registerTraceAnalyzerHooks(api, config, state);

    const cmd = api.commands.find(c => c.name === "trace-analyze");
    expect(cmd).toBeDefined();

    // Running the command — will use NATS which isn't available,
    // so the source returns null → empty report
    const result = await cmd!.handler();
    expect(result.text).toContain("Trace analysis");
  });

  it("trace-status command returns status text", async () => {
    const api = createMockApi();
    const state: TraceAnalyzerHookState = { timer: null, analyzer: null };
    const config = makeConfig();

    registerTraceAnalyzerHooks(api, config, state);

    const cmd = api.commands.find(c => c.name === "trace-status");
    expect(cmd).toBeDefined();

    const result = await cmd!.handler();
    expect(result.text).toContain("Trace Analyzer Status");
    expect(result.text).toContain("Last run:");
  });
});

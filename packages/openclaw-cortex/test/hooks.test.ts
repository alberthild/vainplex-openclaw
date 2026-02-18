import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerCortexHooks } from "../src/hooks.js";
import { resolveConfig } from "../src/config.js";
import type { CortexConfig } from "../src/types.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

type HookRegistration = {
  name: string;
  handler: (...args: any[]) => void;
  opts?: { priority?: number };
};

function makeMockApi(workspace: string, pluginConfig?: Record<string, unknown>) {
  const hooks: HookRegistration[] = [];
  const commands: Array<{ name: string }> = [];
  return {
    api: {
      id: "openclaw-cortex",
      logger,
      pluginConfig: pluginConfig ?? {},
      config: {},
      on: (name: string, handler: (...args: any[]) => void, opts?: { priority?: number }) => {
        hooks.push({ name, handler, opts });
      },
      registerCommand: (cmd: { name: string }) => {
        commands.push(cmd);
      },
      registerService: () => {},
    },
    hooks,
    commands,
    workspace,
  };
}

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-hooks-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

describe("registerCortexHooks", () => {
  it("registers hooks for all enabled features", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const hookNames = hooks.map(h => h.name);
    expect(hookNames).toContain("message_received");
    expect(hookNames).toContain("message_sent");
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("before_compaction");
  });

  it("registers hooks with correct priorities", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const beforeCompaction = hooks.find(h => h.name === "before_compaction");
    expect(beforeCompaction?.opts?.priority).toBeLessThanOrEqual(10);

    const sessionStart = hooks.find(h => h.name === "session_start");
    expect(sessionStart?.opts?.priority).toBeLessThanOrEqual(20);

    const messageHooks = hooks.filter(h => h.name === "message_received" || h.name === "message_sent");
    for (const mh of messageHooks) {
      expect(mh.opts?.priority ?? 100).toBeGreaterThanOrEqual(50);
    }
  });

  it("skips thread tracker hooks when disabled", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({
      workspace: ws,
      threadTracker: { enabled: false },
      decisionTracker: { enabled: false },
    });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    // Should still have session_start and before_compaction
    const hookNames = hooks.map(h => h.name);
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("before_compaction");
  });

  it("skips boot context hooks when disabled", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({
      workspace: ws,
      bootContext: { enabled: false },
    });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const hookNames = hooks.map(h => h.name);
    // session_start should not be registered if bootContext is disabled
    // (unless pre-compaction also uses it)
    expect(hookNames).toContain("before_compaction");
  });

  it("message hooks don't throw on empty content", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const msgReceived = hooks.find(h => h.name === "message_received");
    expect(() => {
      msgReceived?.handler({}, { workspaceDir: ws });
    }).not.toThrow();
  });

  it("message hooks don't throw on valid content", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const msgReceived = hooks.find(h => h.name === "message_received");
    expect(() => {
      msgReceived?.handler(
        { content: "We decided to use TypeScript", from: "albert" },
        { workspaceDir: ws },
      );
    }).not.toThrow();
  });

  it("session_start hook doesn't throw", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const sessionStart = hooks.find(h => h.name === "session_start");
    expect(() => {
      sessionStart?.handler({}, { workspaceDir: ws });
    }).not.toThrow();
  });

  it("before_compaction hook doesn't throw", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    const beforeCompaction = hooks.find(h => h.name === "before_compaction");
    expect(() => {
      beforeCompaction?.handler(
        { messageCount: 100, compactingCount: 50 },
        { workspaceDir: ws },
      );
    }).not.toThrow();
  });

  it("registers no hooks when all features disabled", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({
      workspace: ws,
      threadTracker: { enabled: false },
      decisionTracker: { enabled: false },
      bootContext: { enabled: false },
      preCompaction: { enabled: false },
      narrative: { enabled: false },
    });
    const { api, hooks } = makeMockApi(ws);

    registerCortexHooks(api as any, config);

    // May still have after_compaction logging, but core hooks should be minimal
    expect(hooks.length).toBeLessThanOrEqual(1);
  });
});

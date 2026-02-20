import { describe, it, expect, vi, afterEach } from "vitest";
import { registerSitrepHooks } from "../src/hooks.js";
import { createMockLogger } from "./helpers.js";
import { DEFAULTS } from "../src/config.js";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import type { OpenClawPluginApi, SitrepConfig, SitrepReport } from "../src/types.js";

const testDir = "/tmp/sitrep-test-hooks";
const outputPath = `${testDir}/sitrep.json`;

function makeConfig(overrides?: Partial<SitrepConfig>): SitrepConfig {
  return { ...DEFAULTS, outputPath, ...overrides };
}

function makeReport(overrides?: Partial<SitrepReport>): SitrepReport {
  return {
    version: 1,
    generated: new Date().toISOString(),
    summary: "test summary",
    health: { overall: "ok", details: {} },
    items: [],
    categories: { needs_owner: [], auto_fixable: [], delegatable: [], informational: [] },
    delta: { new_items: 0, resolved_items: 0, previous_generated: null },
    collectors: { systemd_timers: { status: "ok", duration_ms: 10 } },
    ...overrides,
  };
}

function createMockApi(): { api: OpenClawPluginApi; commands: Map<string, (params?: Record<string, unknown>) => { text: string }> } {
  const commands = new Map<string, (params?: Record<string, unknown>) => { text: string }>();
  const api: OpenClawPluginApi = {
    pluginConfig: {},
    logger: createMockLogger(),
    config: {},
    on: vi.fn(),
    registerCommand: vi.fn((cmd) => {
      commands.set(cmd.name as string, cmd.handler as (params?: Record<string, unknown>) => { text: string });
    }),
    registerService: vi.fn(),
  };
  return { api, commands };
}

afterEach(() => {
  if (existsSync(outputPath)) unlinkSync(outputPath);
});

describe("registerSitrepHooks", () => {
  it("registers /sitrep command", () => {
    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    expect(commands.has("sitrep")).toBe(true);
  });

  it("/sitrep shows 'no sitrep' when file missing", () => {
    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!();
    expect(result.text).toContain("No sitrep available");
  });

  it("/sitrep shows report when file exists", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(makeReport()));

    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!();
    expect(result.text).toContain("Situation Report");
    expect(result.text).toContain("🟢");
  });

  it("/sitrep collectors shows collector status", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(makeReport()));

    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!({ sub: "collectors" });
    expect(result.text).toContain("systemd_timers");
  });

  it("/sitrep refresh returns ack", () => {
    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!({ sub: "refresh" });
    expect(result.text).toContain("refresh started");
  });

  it("/sitrep shows warn icon for warn status", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(makeReport({ health: { overall: "warn", details: {} } })));

    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!();
    expect(result.text).toContain("🟡");
  });

  it("/sitrep shows top items", () => {
    mkdirSync(testDir, { recursive: true });
    const report = makeReport({
      items: [{ id: "t1", source: "test", severity: "critical", category: "needs_owner", title: "Something broke", score: 100 }],
      categories: {
        needs_owner: [{ id: "t1", source: "test", severity: "critical", category: "needs_owner", title: "Something broke", score: 100 }],
        auto_fixable: [],
        delegatable: [],
        informational: [],
      },
    });
    writeFileSync(outputPath, JSON.stringify(report));

    const { api, commands } = createMockApi();
    registerSitrepHooks(api, makeConfig());
    const result = commands.get("sitrep")!();
    expect(result.text).toContain("Something broke");
    expect(result.text).toContain("🔴");
  });
});

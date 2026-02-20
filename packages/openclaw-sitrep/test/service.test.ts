import { describe, it, expect, vi, afterEach } from "vitest";
import { createSitrepService } from "../src/service.js";
import { createMockLogger } from "./helpers.js";
import { DEFAULTS } from "../src/config.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import type { SitrepConfig, ServiceContext } from "../src/types.js";

const testDir = "/tmp/sitrep-test-service";
const outputPath = `${testDir}/sitrep.json`;
const previousPath = `${testDir}/sitrep-prev.json`;

function makeConfig(overrides?: Partial<SitrepConfig>): SitrepConfig {
  return {
    ...DEFAULTS,
    outputPath,
    previousPath,
    intervalMinutes: 0, // Disable periodic for tests
    collectors: {
      systemd_timers: { enabled: false },
      nats: { enabled: false },
      goals: { enabled: false },
      threads: { enabled: false },
      errors: { enabled: false },
      calendar: { enabled: false },
    },
    customCollectors: [],
    ...overrides,
  };
}

function makeServiceContext(configOverrides?: Partial<SitrepConfig>): ServiceContext {
  return {
    config: {},
    logger: createMockLogger(),
  };
}

afterEach(() => {
  for (const f of [outputPath, previousPath]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("createSitrepService", () => {
  it("creates a service with correct id", () => {
    const svc = createSitrepService(makeConfig());
    expect(svc.id).toBe("sitrep-generator");
  });

  it("start() generates initial report", async () => {
    mkdirSync(testDir, { recursive: true });
    const svc = createSitrepService(makeConfig());
    await svc.start(makeServiceContext());
    expect(existsSync(outputPath)).toBe(true);
  });

  it("start() does nothing when disabled", async () => {
    const svc = createSitrepService(makeConfig({ enabled: false }));
    await svc.start(makeServiceContext());
    expect(existsSync(outputPath)).toBe(false);
  });

  it("stop() cleans up timer", async () => {
    const svc = createSitrepService(makeConfig({ intervalMinutes: 1 }));
    mkdirSync(testDir, { recursive: true });
    await svc.start(makeServiceContext());
    await svc.stop(makeServiceContext());
    // No assertion needed — just verify no crash
  });

  it("generates valid JSON output", async () => {
    mkdirSync(testDir, { recursive: true });
    const svc = createSitrepService(makeConfig());
    await svc.start(makeServiceContext());

    const { readFileSync } = await import("node:fs");
    const report = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(report.version).toBe(1);
    expect(report.health.overall).toBe("ok");
  });
});

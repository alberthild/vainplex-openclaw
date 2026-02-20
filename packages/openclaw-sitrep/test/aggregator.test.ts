import { describe, it, expect } from "vitest";
import { generateSitrep } from "../src/aggregator.js";
import { createMockLogger } from "./helpers.js";
import type { SitrepConfig } from "../src/types.js";
import { DEFAULTS } from "../src/config.js";

const mockLogger = createMockLogger();

function minimalConfig(overrides?: Partial<SitrepConfig>): SitrepConfig {
  return {
    ...DEFAULTS,
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

describe("generateSitrep", () => {
  it("generates valid report with all disabled", async () => {
    const report = await generateSitrep(minimalConfig(), mockLogger);
    expect(report.version).toBe(1);
    expect(report.health.overall).toBe("ok");
    expect(report.items).toEqual([]);
    expect(report.summary).toContain("nominal");
  });

  it("includes collector metadata", async () => {
    const report = await generateSitrep(minimalConfig(), mockLogger);
    expect(report.collectors["systemd_timers"]).toBeDefined();
  });

  it("runs enabled collectors", async () => {
    const config = minimalConfig({
      collectors: { ...minimalConfig().collectors, calendar: { enabled: true, command: 'echo "Test"' } },
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.items.length).toBeGreaterThan(0);
  });

  it("categorizes items", async () => {
    const config = minimalConfig({
      collectors: { ...minimalConfig().collectors, calendar: { enabled: true, command: 'echo "X"' } },
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.categories.informational.length).toBeGreaterThan(0);
  });

  it("sorts by score descending", async () => {
    const config = minimalConfig({
      customCollectors: [
        { id: "high", command: "echo 99", warnThreshold: "50", criticalThreshold: "95" },
        { id: "low", command: "echo ok" },
      ],
    });
    const report = await generateSitrep(config, mockLogger);
    if (report.items.length >= 2) {
      expect(report.items[0]!.score).toBeGreaterThanOrEqual(report.items[1]!.score);
    }
  });

  it("computes delta with no previous", async () => {
    const config = minimalConfig({ previousPath: "/tmp/nope.json" });
    const report = await generateSitrep(config, mockLogger);
    expect(report.delta.previous_generated).toBeNull();
  });

  it("handles custom collectors", async () => {
    const config = minimalConfig({ customCollectors: [{ id: "uptime", command: "echo 42" }] });
    const report = await generateSitrep(config, mockLogger);
    expect(report.collectors["custom:uptime"]).toBeDefined();
  });

  it("marks critical when items are critical", async () => {
    const config = minimalConfig({
      customCollectors: [{ id: "disk", command: "echo 99", warnThreshold: "80", criticalThreshold: "95" }],
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.health.overall).toBe("critical");
  });
});

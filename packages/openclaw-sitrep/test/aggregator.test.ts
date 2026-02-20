import { describe, it, expect, vi } from "vitest";
import { generateSitrep } from "../src/aggregator.js";
import type { SitrepConfig, PluginLogger } from "../src/types.js";
import { DEFAULTS } from "../src/config.js";

const mockLogger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function minimalConfig(overrides?: Partial<SitrepConfig>): SitrepConfig {
  return {
    ...DEFAULTS,
    // Disable all collectors by default for unit tests
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
  it("generates a valid report with all collectors disabled", async () => {
    const report = await generateSitrep(minimalConfig(), mockLogger);
    expect(report.version).toBe(1);
    expect(report.generated).toBeDefined();
    expect(report.health.overall).toBe("ok");
    expect(report.items).toEqual([]);
    expect(report.summary).toContain("nominal");
  });

  it("includes collector metadata", async () => {
    const report = await generateSitrep(minimalConfig(), mockLogger);
    // Disabled collectors should still appear in metadata
    expect(report.collectors["systemd_timers"]).toBeDefined();
    expect(report.collectors["systemd_timers"]!.status).toBe("ok");
  });

  it("runs enabled collectors", async () => {
    const config = minimalConfig({
      collectors: {
        ...minimalConfig().collectors,
        calendar: { enabled: true, command: 'echo "Test event"' },
      },
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.items.length).toBeGreaterThan(0);
    expect(report.items[0]!.source).toBe("calendar");
  });

  it("categorizes items correctly", async () => {
    const config = minimalConfig({
      collectors: {
        ...minimalConfig().collectors,
        calendar: { enabled: true, command: 'echo "Meeting at 10"' },
      },
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.categories.informational.length).toBeGreaterThan(0);
    expect(report.categories.needs_owner).toEqual([]);
  });

  it("sorts items by score descending", async () => {
    const config = minimalConfig({
      customCollectors: [
        { id: "low", command: "echo ok" },
        { id: "high", command: "echo 99", warnThreshold: "50", criticalThreshold: "95" },
      ],
    });
    const report = await generateSitrep(config, mockLogger);
    if (report.items.length >= 2) {
      expect(report.items[0]!.score).toBeGreaterThanOrEqual(report.items[1]!.score);
    }
  });

  it("computes delta with no previous report", async () => {
    const config = minimalConfig({
      previousPath: "/tmp/sitrep-definitely-not-exists.json",
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.delta.previous_generated).toBeNull();
    expect(report.delta.new_items).toBe(report.items.length);
    expect(report.delta.resolved_items).toBe(0);
  });

  it("handles custom collectors", async () => {
    const config = minimalConfig({
      customCollectors: [
        { id: "uptime", command: "echo 42", warnThreshold: "50" },
      ],
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.collectors["custom:uptime"]).toBeDefined();
    expect(report.collectors["custom:uptime"]!.status).toBe("ok");
  });

  it("marks overall health as critical when items are critical", async () => {
    const config = minimalConfig({
      customCollectors: [
        { id: "disk", command: "echo 99", warnThreshold: "80", criticalThreshold: "95" },
      ],
    });
    const report = await generateSitrep(config, mockLogger);
    expect(report.health.overall).toBe("critical");
  });
});

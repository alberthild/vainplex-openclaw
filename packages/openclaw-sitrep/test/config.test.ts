import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULTS } from "../src/config.js";

describe("resolveConfig", () => {
  it("returns defaults for undefined input", () => {
    const config = resolveConfig(undefined);
    expect(config.enabled).toBe(true);
    expect(config.intervalMinutes).toBe(120);
    expect(config.scoring.criticalWeight).toBe(100);
  });

  it("returns defaults for empty object", () => {
    const config = resolveConfig({});
    expect(config.enabled).toBe(true);
    expect(config.outputPath).toContain("sitrep.json");
  });

  it("overrides enabled", () => {
    expect(resolveConfig({ enabled: false }).enabled).toBe(false);
    expect(resolveConfig({ enabled: true }).enabled).toBe(true);
  });

  it("overrides outputPath", () => {
    const config = resolveConfig({ outputPath: "/tmp/my-sitrep.json" });
    expect(config.outputPath).toBe("/tmp/my-sitrep.json");
  });

  it("overrides intervalMinutes", () => {
    const config = resolveConfig({ intervalMinutes: 30 });
    expect(config.intervalMinutes).toBe(30);
  });

  it("merges collector configs", () => {
    const config = resolveConfig({
      collectors: {
        nats: { enabled: true, natsUrl: "nats://custom:4222" },
      },
    });
    expect(config.collectors["nats"]!.enabled).toBe(true);
    expect((config.collectors["nats"] as Record<string, unknown>)["natsUrl"]).toBe("nats://custom:4222");
    // Other collectors keep defaults
    expect(config.collectors["systemd_timers"]!.enabled).toBe(true);
  });

  it("preserves default collectors when not overridden", () => {
    const config = resolveConfig({});
    expect(Object.keys(config.collectors).length).toBeGreaterThanOrEqual(6);
    expect(config.collectors["systemd_timers"]!.enabled).toBe(true);
  });

  it("handles scoring overrides", () => {
    const config = resolveConfig({
      scoring: { criticalWeight: 200, warnWeight: 75 },
    });
    expect(config.scoring.criticalWeight).toBe(200);
    expect(config.scoring.warnWeight).toBe(75);
    expect(config.scoring.infoWeight).toBe(DEFAULTS.scoring.infoWeight);
  });

  it("handles customCollectors array", () => {
    const config = resolveConfig({
      customCollectors: [
        { id: "disk", command: "df -h /", warnThreshold: "80%" },
      ],
    });
    expect(config.customCollectors).toHaveLength(1);
    expect(config.customCollectors[0]!.id).toBe("disk");
  });

  it("ignores non-object collector values", () => {
    const config = resolveConfig({
      collectors: {
        nats: "broken" as unknown,
      } as Record<string, unknown>,
    });
    // Should keep the default nats config
    expect(config.collectors["nats"]!.enabled).toBe(false); // default is false for nats
  });
});

import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("should return full defaults when called with undefined", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.enabled).toBe(true);
    expect(cfg.timezone).toBe("UTC");
    expect(cfg.failMode).toBe("open");
    expect(cfg.policies).toEqual([]);
    expect(cfg.timeWindows).toEqual({});
    expect(cfg.toolRiskOverrides).toEqual({});
    expect(cfg.builtinPolicies).toEqual({});
  });

  it("should return full defaults when called with empty object", () => {
    const cfg = resolveConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.timezone).toBe("UTC");
  });

  it("should apply trust defaults", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.trust.enabled).toBe(true);
    expect(cfg.trust.defaults).toEqual({ main: 60, "*": 10 });
    expect(cfg.trust.persistIntervalSeconds).toBe(60);
    expect(cfg.trust.decay.enabled).toBe(true);
    expect(cfg.trust.decay.inactivityDays).toBe(30);
    expect(cfg.trust.decay.rate).toBe(0.95);
    expect(cfg.trust.maxHistoryPerAgent).toBe(100);
  });

  it("should apply audit defaults", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.audit.enabled).toBe(true);
    expect(cfg.audit.retentionDays).toBe(90);
    expect(cfg.audit.redactPatterns).toEqual([]);
    expect(cfg.audit.level).toBe("standard");
  });

  it("should apply performance defaults", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.performance.maxEvalUs).toBe(5000);
    expect(cfg.performance.maxContextMessages).toBe(10);
    expect(cfg.performance.frequencyBufferSize).toBe(1000);
  });

  it("should override with partial config", () => {
    const cfg = resolveConfig({
      enabled: false,
      timezone: "Europe/Berlin",
      failMode: "closed",
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.timezone).toBe("Europe/Berlin");
    expect(cfg.failMode).toBe("closed");
  });

  it("should override nested trust config", () => {
    const cfg = resolveConfig({
      trust: {
        enabled: false,
        defaults: { forge: 45 },
        persistIntervalSeconds: 120,
      },
    });
    expect(cfg.trust.enabled).toBe(false);
    expect(cfg.trust.defaults).toEqual({ forge: 45 });
    expect(cfg.trust.persistIntervalSeconds).toBe(120);
    // Decay defaults still apply
    expect(cfg.trust.decay.enabled).toBe(true);
  });

  it("should override nested audit config", () => {
    const cfg = resolveConfig({
      audit: { retentionDays: 30, level: "verbose" },
    });
    expect(cfg.audit.retentionDays).toBe(30);
    expect(cfg.audit.level).toBe("verbose");
    expect(cfg.audit.enabled).toBe(true);
  });

  it("should reject invalid failMode", () => {
    const cfg = resolveConfig({ failMode: "invalid" });
    expect(cfg.failMode).toBe("open");
  });

  it("should reject invalid audit level", () => {
    const cfg = resolveConfig({ audit: { level: "invalid" } });
    expect(cfg.audit.level).toBe("standard");
  });

  it("should handle toolRiskOverrides", () => {
    const cfg = resolveConfig({
      toolRiskOverrides: { exec: 80, read: 5, invalid: "nope" },
    });
    expect(cfg.toolRiskOverrides).toEqual({ exec: 80, read: 5 });
  });

  it("should handle non-record inputs gracefully", () => {
    const cfg = resolveConfig({
      trust: "not-a-record" as unknown as Record<string, unknown>,
      audit: 42 as unknown as Record<string, unknown>,
      performance: null as unknown as Record<string, unknown>,
    });
    expect(cfg.trust.enabled).toBe(true);
    expect(cfg.audit.enabled).toBe(true);
    expect(cfg.performance.maxEvalUs).toBe(5000);
  });

  it("should override trust decay settings", () => {
    const cfg = resolveConfig({
      trust: {
        decay: { enabled: false, inactivityDays: 60, rate: 0.99 },
      },
    });
    expect(cfg.trust.decay.enabled).toBe(false);
    expect(cfg.trust.decay.inactivityDays).toBe(60);
    expect(cfg.trust.decay.rate).toBe(0.99);
  });

  it("should handle trust.defaults with mixed types", () => {
    const cfg = resolveConfig({
      trust: { defaults: { main: 60, invalid: "nope" } },
    });
    expect(cfg.trust.defaults).toEqual({ main: 60 });
  });

  it("should handle audit.redactPatterns with mixed types", () => {
    const cfg = resolveConfig({
      audit: { redactPatterns: ["valid", 42, "also-valid"] },
    });
    expect(cfg.audit.redactPatterns).toEqual(["valid", "also-valid"]);
  });

  it("should handle audit level minimal", () => {
    const cfg = resolveConfig({ audit: { level: "minimal" } });
    expect(cfg.audit.level).toBe("minimal");
  });

  it("should handle non-boolean enabled", () => {
    const cfg = resolveConfig({ enabled: "yes" as unknown as boolean });
    expect(cfg.enabled).toBe(true); // default since not actually boolean
  });

  it("should handle non-string timezone", () => {
    const cfg = resolveConfig({ timezone: 42 as unknown as string });
    expect(cfg.timezone).toBe("UTC");
  });

  it("should handle trust weights", () => {
    const cfg = resolveConfig({
      trust: { weights: { agePerDay: 1.0 } },
    });
    expect(cfg.trust.weights).toEqual({ agePerDay: 1.0 });
  });

  it("should handle array as policies", () => {
    const cfg = resolveConfig({
      policies: [{ id: "test", name: "Test", version: "1.0.0", scope: {}, rules: [] }],
    });
    expect(cfg.policies).toHaveLength(1);
  });
});

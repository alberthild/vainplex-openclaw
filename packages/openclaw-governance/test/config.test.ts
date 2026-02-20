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

  // ── Output Validation Config (v0.2.0) ──

  it("should apply output validation defaults", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.outputValidation.enabled).toBe(false);
    expect(cfg.outputValidation.unverifiedClaimPolicy).toBe("ignore");
    expect(cfg.outputValidation.selfReferentialPolicy).toBe("ignore");
    expect(cfg.outputValidation.enabledDetectors).toHaveLength(5);
    expect(cfg.outputValidation.factRegistries).toEqual([]);
    expect(cfg.outputValidation.contradictionThresholds.flagAbove).toBe(60);
    expect(cfg.outputValidation.contradictionThresholds.blockBelow).toBe(40);
  });

  it("should resolve custom output validation config", () => {
    const cfg = resolveConfig({
      outputValidation: {
        enabled: true,
        enabledDetectors: ["system_state", "existence"],
        unverifiedClaimPolicy: "flag",
        selfReferentialPolicy: "block",
        factRegistries: [
          { id: "sys", facts: [{ subject: "nginx", predicate: "state", value: "running" }] },
        ],
        contradictionThresholds: { flagAbove: 70, blockBelow: 30 },
      },
    });
    expect(cfg.outputValidation.enabled).toBe(true);
    expect(cfg.outputValidation.enabledDetectors).toEqual(["system_state", "existence"]);
    expect(cfg.outputValidation.unverifiedClaimPolicy).toBe("flag");
    expect(cfg.outputValidation.selfReferentialPolicy).toBe("block");
    expect(cfg.outputValidation.factRegistries).toHaveLength(1);
    expect(cfg.outputValidation.contradictionThresholds.flagAbove).toBe(70);
    expect(cfg.outputValidation.contradictionThresholds.blockBelow).toBe(30);
  });

  it("should filter invalid detector IDs", () => {
    const cfg = resolveConfig({
      outputValidation: {
        enabledDetectors: ["system_state", "invalid_detector", "existence"],
      },
    });
    expect(cfg.outputValidation.enabledDetectors).toEqual(["system_state", "existence"]);
  });

  it("should default invalid unverifiedClaimPolicy to ignore", () => {
    const cfg = resolveConfig({
      outputValidation: { unverifiedClaimPolicy: "invalid" as "ignore" },
    });
    expect(cfg.outputValidation.unverifiedClaimPolicy).toBe("ignore");
  });

  // ── LLM Validator Config (RFC-006) ──

  it("should resolve llmValidator with defaults", () => {
    const cfg = resolveConfig({
      outputValidation: {
        llmValidator: { enabled: true },
      },
    });
    expect(cfg.outputValidation.llmValidator).toBeDefined();
    expect(cfg.outputValidation.llmValidator!.enabled).toBe(true);
    expect(cfg.outputValidation.llmValidator!.maxTokens).toBe(500);
    expect(cfg.outputValidation.llmValidator!.timeoutMs).toBe(5000);
    expect(cfg.outputValidation.llmValidator!.externalChannels).toContain("twitter");
    expect(cfg.outputValidation.llmValidator!.externalCommands).toContain("bird tweet");
  });

  it("should resolve llmValidator with custom values", () => {
    const cfg = resolveConfig({
      outputValidation: {
        llmValidator: {
          enabled: true,
          model: "gpt-4",
          maxTokens: 1000,
          timeoutMs: 10000,
          externalChannels: ["slack", "email"],
          externalCommands: ["send-email"],
        },
      },
    });
    const llm = cfg.outputValidation.llmValidator!;
    expect(llm.model).toBe("gpt-4");
    expect(llm.maxTokens).toBe(1000);
    expect(llm.timeoutMs).toBe(10000);
    expect(llm.externalChannels).toEqual(["slack", "email"]);
    expect(llm.externalCommands).toEqual(["send-email"]);
  });

  it("should leave llmValidator undefined when not configured", () => {
    const cfg = resolveConfig({
      outputValidation: { enabled: true },
    });
    expect(cfg.outputValidation.llmValidator).toBeUndefined();
  });
});

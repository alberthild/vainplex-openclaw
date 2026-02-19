import { describe, it, expect } from "vitest";
import { OutputValidator, DEFAULT_OUTPUT_VALIDATION_CONFIG } from "../src/output-validator.js";
import type { OutputValidationConfig, PluginLogger } from "../src/types.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeConfig(overrides: Partial<OutputValidationConfig> = {}): OutputValidationConfig {
  return {
    ...DEFAULT_OUTPUT_VALIDATION_CONFIG,
    enabled: true,
    ...overrides,
  };
}

describe("OutputValidator", () => {
  describe("disabled / empty", () => {
    it("returns pass when disabled", () => {
      const v = new OutputValidator({ ...DEFAULT_OUTPUT_VALIDATION_CONFIG, enabled: false }, logger);
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("pass");
    });

    it("returns pass for empty text", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("", 50);
      expect(result.verdict).toBe("pass");
    });

    it("returns pass when no claims detected", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("Hello, how are you?", 50);
      expect(result.verdict).toBe("pass");
      expect(result.claims).toHaveLength(0);
    });
  });

  describe("no facts configured", () => {
    it("returns pass when claims found but no facts to check against (ignore policy)", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("pass");
      expect(result.claims.length).toBeGreaterThan(0);
      expect(result.factCheckResults.length).toBeGreaterThan(0);
      expect(result.contradictions).toHaveLength(0);
    });
  });

  describe("contradiction detection", () => {
    const configWithFacts = makeConfig({
      factRegistries: [
        {
          id: "system",
          facts: [
            { subject: "nginx", predicate: "state", value: "stopped" },
            { subject: "redis", predicate: "state", value: "running" },
          ],
        },
      ],
    });

    it("passes contradiction for trust >= flagAbove (default 60)", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 65);
      expect(result.verdict).toBe("pass");
      expect(result.contradictions).toHaveLength(1);
      expect(result.reason).toContain("Contradiction");
      expect(result.reason).toContain("nginx");
    });

    it("detects contradiction and blocks for trust < 40", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 30);
      expect(result.verdict).toBe("block");
      expect(result.contradictions).toHaveLength(1);
      expect(result.reason).toContain("Contradiction");
    });

    it("flags for trust between 40 and 60", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("flag");
    });

    it("passes when claim matches fact (verified)", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("redis is running", 50);
      expect(result.verdict).toBe("pass");
      expect(result.factCheckResults.some((r) => r.status === "verified")).toBe(true);
    });

    it("handles multiple contradictions", () => {
      const config = makeConfig({
        factRegistries: [
          {
            id: "system",
            facts: [
              { subject: "nginx", predicate: "state", value: "stopped" },
              { subject: "redis", predicate: "state", value: "stopped" },
            ],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      const result = v.validate("nginx is running and redis is running", 50);
      expect(result.verdict).toBe("flag");
      expect(result.contradictions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("trust-proportional thresholds", () => {
    const configWithFacts = makeConfig({
      factRegistries: [
        {
          id: "system",
          facts: [{ subject: "nginx", predicate: "state", value: "stopped" }],
        },
      ],
    });

    it("blocks at trust 0", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 0);
      expect(result.verdict).toBe("block");
    });

    it("blocks at trust 39", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 39);
      expect(result.verdict).toBe("block");
    });

    it("flags at trust 40", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 40);
      expect(result.verdict).toBe("flag");
    });

    it("passes at trust 60 (== flagAbove)", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 60);
      expect(result.verdict).toBe("pass");
    });

    it("passes at trust 100 (> flagAbove)", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nginx is running", 100);
      expect(result.verdict).toBe("pass");
    });

    it("uses custom thresholds", () => {
      const config = makeConfig({
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "stopped" }],
          },
        ],
        contradictionThresholds: { flagAbove: 80, blockBelow: 20 },
      });
      const v = new OutputValidator(config, logger);

      // Trust 15 < blockBelow 20 → block
      expect(v.validate("nginx is running", 15).verdict).toBe("block");
      // Trust 50 between 20 and 80 → flag
      expect(v.validate("nginx is running", 50).verdict).toBe("flag");
      // Trust 85 >= flagAbove 80 → pass (trusted, contradiction tolerated)
      expect(v.validate("nginx is running", 85).verdict).toBe("pass");
    });
  });

  describe("unverifiedClaimPolicy", () => {
    it("ignores unverified claims by default", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("pass");
    });

    it("flags unverified claims when policy is 'flag'", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "flag" }),
        logger,
      );
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("flag");
      expect(result.reason).toContain("Unverified");
    });

    it("blocks unverified claims when policy is 'block'", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "block" }),
        logger,
      );
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("block");
    });

    it("does not flag unverified when all claims are verified", () => {
      const config = makeConfig({
        unverifiedClaimPolicy: "flag",
        factRegistries: [
          {
            id: "system",
            facts: [{ subject: "nginx", predicate: "state", value: "running" }],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      const result = v.validate("nginx is running", 50);
      expect(result.verdict).toBe("pass");
    });
  });

  describe("selfReferentialPolicy", () => {
    it("ignores self-referential claims by default", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "flag" }),
        logger,
      );
      const result = v.validate("I am the governance engine.", 50);
      // self_referential claims won't be flagged since selfReferentialPolicy is "ignore"
      // but unverifiedClaimPolicy might catch non-self-referential ones
      const selfRef = result.claims.filter((c) => c.type === "self_referential");
      expect(selfRef.length).toBeGreaterThan(0);
    });
  });

  describe("getConfig and getFactCount", () => {
    it("returns config", () => {
      const config = makeConfig();
      const v = new OutputValidator(config, logger);
      expect(v.getConfig()).toEqual(config);
    });

    it("returns fact count", () => {
      const config = makeConfig({
        factRegistries: [
          {
            id: "system",
            facts: [
              { subject: "a", predicate: "x", value: "1" },
              { subject: "b", predicate: "y", value: "2" },
            ],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      expect(v.getFactCount()).toBe(2);
    });
  });

  describe("DEFAULT_OUTPUT_VALIDATION_CONFIG", () => {
    it("has correct defaults", () => {
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.enabled).toBe(false);
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.unverifiedClaimPolicy).toBe("ignore");
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.selfReferentialPolicy).toBe("ignore");
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.enabledDetectors).toHaveLength(5);
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.contradictionThresholds.flagAbove).toBe(60);
      expect(DEFAULT_OUTPUT_VALIDATION_CONFIG.contradictionThresholds.blockBelow).toBe(40);
    });
  });

  describe("result structure", () => {
    it("includes evaluationUs", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("nginx is running", 50);
      expect(typeof result.evaluationUs).toBe("number");
      expect(result.evaluationUs).toBeGreaterThanOrEqual(0);
    });

    it("includes claims array", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("nginx is running", 50);
      expect(Array.isArray(result.claims)).toBe(true);
    });

    it("includes factCheckResults array", () => {
      const v = new OutputValidator(makeConfig(), logger);
      const result = v.validate("nginx is running", 50);
      expect(Array.isArray(result.factCheckResults)).toBe(true);
    });
  });

  describe("performance", () => {
    it("validates text in under 10ms", () => {
      const config = makeConfig({
        factRegistries: [
          {
            id: "system",
            facts: Array.from({ length: 100 }, (_, i) => ({
              subject: `service-${i}`,
              predicate: "state",
              value: i % 2 === 0 ? "running" : "stopped",
            })),
          },
        ],
      });
      const v = new OutputValidator(config, logger);

      const text = "service-0 is stopped. service-1 is running. " +
        "service-2 is online. service-3 is offline. " +
        "The server prod-01 exists. CPU is at 90%.";

      const start = performance.now();
      v.validate(text, 50);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });
  });
});

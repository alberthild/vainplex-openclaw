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

describe("Unverified Claim Detection (anti-hallucination)", () => {
  describe("numeric claims without fact registry", () => {
    it("flags 'has N items' when no fact exists and policy is flag", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "flag" }),
        logger,
      );
      const result = v.validate("The event store has 92000 events.", 60);
      expect(result.claims.length).toBeGreaterThan(0);
      expect(result.verdict).toBe("flag");
      expect(result.reason).toContain("Unverified");
    });

    it("blocks numeric claims when policy is block", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "block" }),
        logger,
      );
      const result = v.validate("The system has 255000 events.", 60);
      expect(result.verdict).toBe("block");
    });

    it("passes numeric claims when policy is ignore", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "ignore" }),
        logger,
      );
      const result = v.validate("The system has 255000 events.", 60);
      expect(result.verdict).toBe("pass");
    });
  });

  describe("numeric claims with fact registry (contradiction detection)", () => {
    const configWithFacts = makeConfig({
      unverifiedClaimPolicy: "flag",
      factRegistries: [
        {
          id: "system-live",
          facts: [
            { subject: "nats-events", predicate: "count", value: "255908" },
            { subject: "governance-tests", predicate: "count", value: "404" },
          ],
        },
      ],
    });

    it("passes when claimed number matches fact", () => {
      const v = new OutputValidator(configWithFacts, logger);
      // operational_status detector catches "X has N items"
      const result = v.validate("nats-events has 255908 items.", 60);
      expect(result.verdict).toBe("pass");
    });

    it("detects contradiction when claimed number differs from fact", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nats-events has 92000 items.", 60);
      // Trust 60 >= flagAbove 60 → pass (trusted agents tolerate contradictions)
      // But the contradiction should be detected
      expect(result.contradictions.length).toBeGreaterThan(0);
    });

    it("flags contradiction for trust between blockBelow and flagAbove", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nats-events has 92000 items.", 50);
      expect(result.verdict).toBe("flag");
      expect(result.contradictions.length).toBeGreaterThan(0);
    });

    it("blocks contradiction for trust below blockBelow", () => {
      const v = new OutputValidator(configWithFacts, logger);
      const result = v.validate("nats-events has 92000 items.", 30);
      expect(result.verdict).toBe("block");
    });
  });

  describe("real-world hallucination scenarios", () => {
    const realConfig = makeConfig({
      unverifiedClaimPolicy: "flag",
      factRegistries: [
        {
          id: "system-live",
          facts: [
            { subject: "nats-events", predicate: "count", value: "255908" },
            { subject: "event-store", predicate: "count", value: "255908" },
            { subject: "governance-tests", predicate: "count", value: "404" },
            { subject: "vainplex-plugins", predicate: "count", value: "4" },
          ],
        },
      ],
    });

    it("flags system state claims about unknown services", () => {
      const v = new OutputValidator(realConfig, logger);
      const result = v.validate("kubernetes is running on the cluster.", 60);
      // system_state claim with no matching fact → unverified → flag
      expect(result.claims.length).toBeGreaterThan(0);
      expect(result.verdict).toBe("flag");
    });

    it("passes when no detectable claims in casual text", () => {
      const v = new OutputValidator(realConfig, logger);
      const result = v.validate("That Jeff Tang article was really interesting.", 60);
      expect(result.verdict).toBe("pass");
    });

    it("detects percentage claims", () => {
      const v = new OutputValidator(
        makeConfig({ unverifiedClaimPolicy: "flag" }),
        logger,
      );
      const result = v.validate("CPU is at 90%.", 60);
      expect(result.claims.some((c) => c.type === "operational_status")).toBe(true);
      expect(result.verdict).toBe("flag");
    });

    it("flags existence claims about unknown entities", () => {
      const v = new OutputValidator(realConfig, logger);
      const result = v.validate("The TypeDB container exists and is ready.", 60);
      const claims = result.claims.filter((c) => c.type === "existence" || c.type === "system_state");
      expect(claims.length).toBeGreaterThan(0);
      expect(result.verdict).toBe("flag");
    });
  });

  describe("self-referential claims", () => {
    it("ignores self-referential when policy is ignore", () => {
      const v = new OutputValidator(
        makeConfig({
          unverifiedClaimPolicy: "flag",
          selfReferentialPolicy: "ignore",
        }),
        logger,
      );
      const result = v.validate("I am Claudia.", 60);
      const selfClaims = result.claims.filter((c) => c.type === "self_referential");
      expect(selfClaims.length).toBeGreaterThan(0);
      // self_referential claims are excluded from unverified flagging when selfReferentialPolicy is ignore
      // Only non-self-referential unverified claims trigger the flag
    });

    it("flags self-referential when policy is flag", () => {
      const v = new OutputValidator(
        makeConfig({
          unverifiedClaimPolicy: "flag",
          selfReferentialPolicy: "flag",
        }),
        logger,
      );
      const result = v.validate("I am Claudia.", 60);
      expect(result.verdict).toBe("flag");
      expect(result.reason).toContain("Self-referential");
    });
  });

  describe("mixed claims (some verified, some not)", () => {
    it("flags when at least one claim is unverified", () => {
      const config = makeConfig({
        unverifiedClaimPolicy: "flag",
        factRegistries: [
          {
            id: "system-live",
            facts: [
              { subject: "nginx", predicate: "state", value: "running" },
            ],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      // nginx is running → verified, redis is running → unverified
      const result = v.validate("nginx is running and redis is running on port 6379.", 60);
      expect(result.verdict).toBe("flag");
    });

    it("passes when all claims are verified", () => {
      const config = makeConfig({
        unverifiedClaimPolicy: "flag",
        factRegistries: [
          {
            id: "system-live",
            facts: [
              { subject: "nginx", predicate: "state", value: "running" },
              { subject: "redis", predicate: "state", value: "running" },
            ],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      const result = v.validate("nginx is running and redis is running.", 60);
      expect(result.verdict).toBe("pass");
    });

    it("contradiction takes priority over unverified", () => {
      const config = makeConfig({
        unverifiedClaimPolicy: "flag",
        factRegistries: [
          {
            id: "system-live",
            facts: [
              { subject: "nginx", predicate: "state", value: "stopped" },
            ],
          },
        ],
      });
      const v = new OutputValidator(config, logger);
      // nginx claimed running, fact says stopped → contradiction
      // redis is unknown → unverified
      const result = v.validate("nginx is running and redis is active.", 50);
      expect(result.verdict).toBe("flag");
      expect(result.contradictions.length).toBeGreaterThan(0);
      expect(result.reason).toContain("Contradiction");
    });
  });
});

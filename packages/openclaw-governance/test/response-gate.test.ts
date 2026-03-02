import { describe, it, expect } from "vitest";
import { ResponseGate, resolveResponseGate } from "../src/response-gate.js";
import type { ResponseGateConfig } from "../src/types.js";

const makeConfig = (overrides: Partial<ResponseGateConfig> = {}): ResponseGateConfig => ({
  enabled: true,
  rules: [],
  ...overrides,
});

describe("ResponseGate", () => {
  describe("disabled gate", () => {
    it("always passes when disabled", () => {
      const gate = new ResponseGate(makeConfig({ enabled: false, rules: [
        { validators: [{ type: "mustNotMatch", pattern: ".*" }] },
      ]}));
      const result = gate.validate("anything", "main", []);
      expect(result.passed).toBe(true);
      expect(result.failedValidators).toHaveLength(0);
    });
  });

  describe("requiredTools validator", () => {
    it("passes when required tool was called", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      }));
      const result = gate.validate("answer", "main", [
        { toolName: "web_search", output: "results" },
      ]);
      expect(result.passed).toBe(true);
    });

    it("blocks when required tool is missing", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      }));
      const result = gate.validate("answer", "main", []);
      expect(result.passed).toBe(false);
      expect(result.failedValidators[0]).toContain("requiredTools");
      expect(result.reasons[0]).toContain("web_search");
    });

    it("blocks when only some required tools were called", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "requiredTools", tools: ["web_search", "read"] }] }],
      }));
      const result = gate.validate("answer", "main", [
        { toolName: "web_search", output: "ok" },
      ]);
      expect(result.passed).toBe(false);
      expect(result.reasons[0]).toContain("read");
    });

    it("uses custom message when provided", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{
          type: "requiredTools",
          tools: ["fact_check"],
          message: "Must verify facts first!",
        }] }],
      }));
      const result = gate.validate("claim", "main", []);
      expect(result.reasons[0]).toBe("Must verify facts first!");
    });
  });

  describe("mustMatch validator", () => {
    it("passes when content matches pattern", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustMatch", pattern: "\\d+" }] }],
      }));
      expect(gate.validate("result: 42", "main", []).passed).toBe(true);
    });

    it("blocks when content does not match", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustMatch", pattern: "^VERIFIED:" }] }],
      }));
      const result = gate.validate("just a normal response", "main", []);
      expect(result.passed).toBe(false);
      expect(result.failedValidators[0]).toContain("mustMatch");
    });
  });

  describe("mustNotMatch validator", () => {
    it("passes when content does not match forbidden pattern", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustNotMatch", pattern: "password:\\s*\\S+" }] }],
      }));
      expect(gate.validate("safe content", "main", []).passed).toBe(true);
    });

    it("blocks when content matches forbidden pattern", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustNotMatch", pattern: "I don't know" }] }],
      }));
      const result = gate.validate("I don't know the answer", "main", []);
      expect(result.passed).toBe(false);
      expect(result.failedValidators[0]).toContain("mustNotMatch");
    });
  });

  describe("agent targeting", () => {
    it("applies rule only to matching agentId", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ agentId: "cerberus", validators: [{ type: "mustNotMatch", pattern: ".*" }] }],
      }));
      // Should pass for "main" agent (rule targets cerberus)
      expect(gate.validate("anything", "main", []).passed).toBe(true);
      // Should block for cerberus
      expect(gate.validate("anything", "cerberus", []).passed).toBe(false);
    });

    it("supports array of agentIds", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ agentId: ["forge", "atlas"], validators: [{ type: "mustMatch", pattern: "^OK" }] }],
      }));
      expect(gate.validate("OK done", "forge", []).passed).toBe(true);
      expect(gate.validate("nope", "forge", []).passed).toBe(false);
      expect(gate.validate("nope", "main", []).passed).toBe(true); // not targeted
    });

    it("wildcard rule (no agentId) applies to all", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustNotMatch", pattern: "BLOCKED" }] }],
      }));
      expect(gate.validate("BLOCKED", "main", []).passed).toBe(false);
      expect(gate.validate("BLOCKED", "forge", []).passed).toBe(false);
      expect(gate.validate("BLOCKED", "cerberus", []).passed).toBe(false);
    });
  });

  describe("multiple validators", () => {
    it("all must pass — fails on first failure", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{
          validators: [
            { type: "requiredTools", tools: ["web_search"] },
            { type: "mustNotMatch", pattern: "placeholder" },
          ],
        }],
      }));
      // Missing tool
      const r1 = gate.validate("real answer", "main", []);
      expect(r1.passed).toBe(false);
      // Tool present but forbidden pattern
      const r2 = gate.validate("placeholder text", "main", [
        { toolName: "web_search", output: "ok" },
      ]);
      expect(r2.passed).toBe(false);
      // Both pass
      const r3 = gate.validate("real answer", "main", [
        { toolName: "web_search", output: "ok" },
      ]);
      expect(r3.passed).toBe(true);
    });
  });

  describe("invalid regex (fail-closed)", () => {
    it("blocks on invalid mustMatch pattern", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustMatch", pattern: "[" }] }],
      }));
      const result = gate.validate("anything", "main", []);
      expect(result.passed).toBe(false);
      expect(result.reasons[0]).toContain("invalid regex");
    });

    it("blocks on invalid mustNotMatch pattern", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustNotMatch", pattern: "(?P<bad)" }] }],
      }));
      const result = gate.validate("anything", "main", []);
      expect(result.passed).toBe(false);
      expect(result.reasons[0]).toContain("invalid regex");
    });
  });

  describe("regex caching", () => {
    it("reuses compiled regex across calls", () => {
      const gate = new ResponseGate(makeConfig({
        rules: [{ validators: [{ type: "mustMatch", pattern: "ok" }] }],
      }));
      gate.validate("ok", "main", []);
      gate.validate("ok", "main", []);
      // No crash, same result — cache works
      expect(gate.validate("ok", "main", []).passed).toBe(true);
    });
  });
});

describe("resolveResponseGate", () => {
  it("returns disabled by default", () => {
    const config = resolveResponseGate(undefined);
    expect(config.enabled).toBe(false);
    expect(config.rules).toEqual([]);
  });

  it("resolves valid config", () => {
    const config = resolveResponseGate({
      enabled: true,
      rules: [{ validators: [{ type: "mustMatch", pattern: "test" }] }],
    });
    expect(config.enabled).toBe(true);
    expect(config.rules).toHaveLength(1);
  });

  it("handles garbage input gracefully", () => {
    const config = resolveResponseGate("not an object");
    expect(config.enabled).toBe(false);
    expect(config.rules).toEqual([]);
  });
});

describe("ResponseGate fallback messages", () => {
  it("returns no fallbackMessage when not configured", () => {
    const gate = new ResponseGate(makeConfig({
      rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
    }));
    const result = gate.validate("answer", "main", []);
    expect(result.passed).toBe(false);
    expect(result.fallbackMessage).toBeUndefined();
  });

  it("returns static fallbackMessage when configured", () => {
    const gate = new ResponseGate(makeConfig({
      rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      fallbackMessage: "I need to verify this first. One moment...",
    }));
    const result = gate.validate("answer", "main", []);
    expect(result.passed).toBe(false);
    expect(result.fallbackMessage).toBe("I need to verify this first. One moment...");
  });

  it("renders template variables in fallbackTemplate", () => {
    const gate = new ResponseGate(makeConfig({
      rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      fallbackTemplate: "Agent {agent} blocked. Reasons: {reasons}",
    }));
    const result = gate.validate("answer", "main", []);
    expect(result.passed).toBe(false);
    expect(result.fallbackMessage).toContain("Agent main blocked");
    expect(result.fallbackMessage).toContain("web_search");
  });

  it("fallbackMessage takes precedence over fallbackTemplate", () => {
    const gate = new ResponseGate(makeConfig({
      rules: [{ validators: [{ type: "requiredTools", tools: ["x"] }] }],
      fallbackMessage: "static message",
      fallbackTemplate: "template with {reasons}",
    }));
    const result = gate.validate("answer", "main", []);
    expect(result.fallbackMessage).toBe("static message");
  });

  it("no fallbackMessage when gate passes", () => {
    const gate = new ResponseGate(makeConfig({
      rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      fallbackMessage: "blocked!",
    }));
    const result = gate.validate("answer", "main", [
      { toolName: "web_search", output: "ok" },
    ]);
    expect(result.passed).toBe(true);
    expect(result.fallbackMessage).toBeUndefined();
  });
});

describe("resolveResponseGate preserves fallback config", () => {
  it("preserves fallbackMessage through resolver", () => {
    const config = resolveResponseGate({
      enabled: true,
      rules: [{ validators: [{ type: "requiredTools", tools: ["web_search"] }] }],
      fallbackMessage: "Please wait while I verify...",
    });
    expect(config.fallbackMessage).toBe("Please wait while I verify...");

    // Now test that ResponseGate actually uses it
    const gate = new ResponseGate(config);
    const result = gate.validate("answer", "main", []);
    expect(result.passed).toBe(false);
    expect(result.fallbackMessage).toBe("Please wait while I verify...");
  });

  it("preserves fallbackTemplate through resolver", () => {
    const config = resolveResponseGate({
      enabled: true,
      rules: [{ validators: [{ type: "requiredTools", tools: ["verify"] }] }],
      fallbackTemplate: "Agent {agent} needs to {reasons}",
    });
    expect(config.fallbackTemplate).toBe("Agent {agent} needs to {reasons}");

    const gate = new ResponseGate(config);
    const result = gate.validate("answer", "main", []);
    expect(result.passed).toBe(false);
    expect(result.fallbackMessage).toContain("Agent main needs to");
  });

  it("resolver drops non-string fallback values", () => {
    const config = resolveResponseGate({
      enabled: true,
      rules: [],
      fallbackMessage: 42,
      fallbackTemplate: { bad: true },
    });
    expect(config.fallbackMessage).toBeUndefined();
    expect(config.fallbackTemplate).toBeUndefined();
  });
});

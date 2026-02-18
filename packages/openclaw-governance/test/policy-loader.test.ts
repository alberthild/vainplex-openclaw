import { describe, expect, it } from "vitest";
import { buildPolicyIndex, loadPolicies, validateRegex } from "../src/policy-loader.js";
import type { PluginLogger, Policy } from "../src/types.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "test-policy",
    name: "Test Policy",
    version: "1.0.0",
    scope: {},
    rules: [],
    ...overrides,
  };
}

describe("validateRegex", () => {
  it("should accept valid patterns", () => {
    expect(validateRegex("docker rm.*")).toEqual({ valid: true });
    expect(validateRegex("^test$")).toEqual({ valid: true });
  });

  it("should reject nested quantifiers", () => {
    const result = validateRegex("(a+)+");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Nested quantifiers");
  });

  it("should reject patterns exceeding max length", () => {
    const long = "a".repeat(501);
    const result = validateRegex(long);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("should reject invalid regex syntax", () => {
    const result = validateRegex("[invalid");
    expect(result.valid).toBe(false);
  });
});

describe("loadPolicies", () => {
  it("should load user policies", () => {
    const policies = [makePolicy({ id: "p1" }), makePolicy({ id: "p2" })];
    const loaded = loadPolicies(policies, {}, logger);
    expect(loaded.length).toBeGreaterThanOrEqual(2);
  });

  it("should filter disabled policies", () => {
    const policies = [
      makePolicy({ id: "p1", enabled: true }),
      makePolicy({ id: "p2", enabled: false }),
    ];
    const loaded = loadPolicies(policies, {}, logger);
    expect(loaded.find((p) => p.id === "p2")).toBeUndefined();
  });

  it("should load builtin policies when configured", () => {
    const loaded = loadPolicies([], { nightMode: true }, logger);
    expect(loaded.some((p) => p.id.includes("night"))).toBe(true);
  });

  it("should merge builtins and user policies", () => {
    const policies = [makePolicy({ id: "user-p1" })];
    const loaded = loadPolicies(policies, { credentialGuard: true }, logger);
    expect(loaded.some((p) => p.id === "user-p1")).toBe(true);
    expect(loaded.some((p) => p.id.includes("credential"))).toBe(true);
  });
});

describe("buildPolicyIndex", () => {
  it("should index policies by hook", () => {
    const policies = [
      makePolicy({
        id: "p1",
        scope: { hooks: ["before_tool_call"] },
      }),
    ];
    const index = buildPolicyIndex(policies);
    expect(index.byHook.get("before_tool_call")).toHaveLength(1);
    expect(index.byHook.get("message_sending")).toBeUndefined();
  });

  it("should index globally scoped policies under all hooks", () => {
    const policies = [makePolicy({ id: "p1" })];
    const index = buildPolicyIndex(policies);
    expect(index.byHook.get("before_tool_call")).toHaveLength(1);
    expect(index.byHook.get("message_sending")).toHaveLength(1);
  });

  it("should index by agent", () => {
    const policies = [
      makePolicy({ id: "p1", scope: { agents: ["forge"] } }),
    ];
    const index = buildPolicyIndex(policies);
    expect(index.byAgent.get("forge")).toHaveLength(1);
    expect(index.byAgent.get("*")).toBeUndefined();
  });

  it("should index global policies under '*'", () => {
    const policies = [makePolicy({ id: "p1", scope: {} })];
    const index = buildPolicyIndex(policies);
    expect(index.byAgent.get("*")).toHaveLength(1);
  });

  it("should compile regex patterns into cache", () => {
    const policies = [
      makePolicy({
        id: "p1",
        rules: [
          {
            id: "r1",
            conditions: [
              {
                type: "tool",
                name: "exec",
                params: { command: { matches: "docker rm.*" } },
              },
            ],
            effect: { action: "deny", reason: "no docker rm" },
          },
        ],
      }),
    ];
    const index = buildPolicyIndex(policies);
    expect(index.regexCache.has("docker rm.*")).toBe(true);
    expect(index.regexCache.get("docker rm.*")).toBeInstanceOf(RegExp);
  });

  it("should not crash on invalid regex in policy", () => {
    const policies = [
      makePolicy({
        id: "p1",
        rules: [
          {
            id: "r1",
            conditions: [
              {
                type: "tool",
                params: { command: { matches: "[invalid" } },
              },
            ],
            effect: { action: "deny", reason: "test" },
          },
        ],
      }),
    ];
    // Should not throw
    const index = buildPolicyIndex(policies);
    expect(index.regexCache.has("[invalid")).toBe(false);
  });
});

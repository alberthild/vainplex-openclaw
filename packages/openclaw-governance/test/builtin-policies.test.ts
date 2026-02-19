import { describe, expect, it } from "vitest";
import { getBuiltinPolicies } from "../src/builtin-policies.js";

describe("getBuiltinPolicies", () => {
  it("should return empty array when nothing enabled", () => {
    const policies = getBuiltinPolicies({});
    expect(policies).toHaveLength(0);
  });

  it("should generate night mode policy with defaults", () => {
    const policies = getBuiltinPolicies({ nightMode: true });
    expect(policies).toHaveLength(1);
    const nm = policies[0]!;
    expect(nm.id).toBe("builtin-night-mode");
    expect(nm.rules.length).toBeGreaterThanOrEqual(2);
  });

  it("should generate night mode with custom times", () => {
    const policies = getBuiltinPolicies({
      nightMode: { after: "22:00", before: "07:00" },
    });
    expect(policies).toHaveLength(1);
    const nm = policies[0]!;
    expect(nm.description).toContain("22:00");
    expect(nm.description).toContain("07:00");
  });

  it("should generate credential guard policy", () => {
    const policies = getBuiltinPolicies({ credentialGuard: true });
    expect(policies).toHaveLength(1);
    expect(policies[0]!.id).toBe("builtin-credential-guard");
  });

  it("should generate production safeguard policy", () => {
    const policies = getBuiltinPolicies({ productionSafeguard: true });
    expect(policies).toHaveLength(1);
    expect(policies[0]!.id).toBe("builtin-production-safeguard");
  });

  it("should generate rate limiter with defaults", () => {
    const policies = getBuiltinPolicies({ rateLimiter: true });
    expect(policies).toHaveLength(1);
    expect(policies[0]!.id).toBe("builtin-rate-limiter");
  });

  it("should generate rate limiter with custom maxPerMinute", () => {
    const policies = getBuiltinPolicies({
      rateLimiter: { maxPerMinute: 30 },
    });
    expect(policies).toHaveLength(1);
    const rl = policies[0]!;
    expect(rl.description).toContain("30");
  });

  it("should generate all policies when all enabled", () => {
    const policies = getBuiltinPolicies({
      nightMode: true,
      credentialGuard: true,
      productionSafeguard: true,
      rateLimiter: true,
    });
    expect(policies).toHaveLength(4);
  });

  it("should set correct priorities", () => {
    const policies = getBuiltinPolicies({
      nightMode: true,
      credentialGuard: true,
      productionSafeguard: true,
      rateLimiter: true,
    });
    const credGuard = policies.find((p) => p.id === "builtin-credential-guard")!;
    const nightMode = policies.find((p) => p.id === "builtin-night-mode")!;
    expect(credGuard.priority!).toBeGreaterThan(nightMode.priority!);
  });

  it("should not generate policy when set to false", () => {
    const policies = getBuiltinPolicies({
      nightMode: false,
      credentialGuard: false,
    });
    expect(policies).toHaveLength(0);
  });

  // ── Bug 4: Controls on builtin policies ──

  it("should set Night Mode controls (Bug 4)", () => {
    const policies = getBuiltinPolicies({ nightMode: true });
    const nm = policies.find((p) => p.id === "builtin-night-mode")!;
    expect(nm.controls).toEqual(["A.7.1", "A.6.2"]);
  });

  it("should set Credential Guard controls (Bug 4)", () => {
    const policies = getBuiltinPolicies({ credentialGuard: true });
    const cg = policies.find((p) => p.id === "builtin-credential-guard")!;
    expect(cg.controls).toEqual(["A.8.11", "A.8.4", "A.5.33"]);
  });

  it("should set Production Safeguard controls (Bug 4)", () => {
    const policies = getBuiltinPolicies({ productionSafeguard: true });
    const ps = policies.find((p) => p.id === "builtin-production-safeguard")!;
    expect(ps.controls).toEqual(["A.8.31", "A.8.32", "A.8.9"]);
  });

  it("should set Rate Limiter controls (Bug 4)", () => {
    const policies = getBuiltinPolicies({ rateLimiter: true });
    const rl = policies.find((p) => p.id === "builtin-rate-limiter")!;
    expect(rl.controls).toEqual(["A.8.6"]);
  });
});

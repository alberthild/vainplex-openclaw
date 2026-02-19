import { describe, it, expect } from "vitest";
import { FactRegistry, checkClaim, checkClaims } from "../src/fact-checker.js";
import type { Claim, Fact, FactRegistryConfig } from "../src/types.js";

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    type: "system_state",
    subject: "nginx",
    predicate: "state",
    value: "running",
    source: "nginx is running",
    offset: 0,
    ...overrides,
  };
}

function makeRegistry(facts: Fact[]): FactRegistry {
  return new FactRegistry([{ id: "test", facts }]);
}

describe("FactRegistry", () => {
  it("creates empty registry", () => {
    const reg = new FactRegistry([]);
    expect(reg.size).toBe(0);
  });

  it("indexes facts from multiple configs", () => {
    const reg = new FactRegistry([
      { id: "a", facts: [{ subject: "nginx", predicate: "state", value: "running" }] },
      { id: "b", facts: [{ subject: "redis", predicate: "state", value: "stopped" }] },
    ]);
    expect(reg.size).toBe(2);
  });

  it("lookup is case-insensitive on subject", () => {
    const reg = makeRegistry([
      { subject: "Nginx", predicate: "state", value: "running" },
    ]);
    const fact = reg.lookup("nginx", "state");
    expect(fact).not.toBeNull();
    expect(fact!.value).toBe("running");
  });

  it("lookup is case-insensitive on predicate", () => {
    const reg = makeRegistry([
      { subject: "nginx", predicate: "State", value: "running" },
    ]);
    const fact = reg.lookup("nginx", "state");
    expect(fact).not.toBeNull();
  });

  it("returns null for unknown subject", () => {
    const reg = makeRegistry([
      { subject: "nginx", predicate: "state", value: "running" },
    ]);
    expect(reg.lookup("apache", "state")).toBeNull();
  });

  it("returns null for unknown predicate", () => {
    const reg = makeRegistry([
      { subject: "nginx", predicate: "state", value: "running" },
    ]);
    expect(reg.lookup("nginx", "version")).toBeNull();
  });

  it("later configs override earlier ones for same key", () => {
    const reg = new FactRegistry([
      { id: "a", facts: [{ subject: "nginx", predicate: "state", value: "stopped" }] },
      { id: "b", facts: [{ subject: "nginx", predicate: "state", value: "running" }] },
    ]);
    const fact = reg.lookup("nginx", "state");
    expect(fact!.value).toBe("running");
  });

  it("lookupBySubject returns all facts for a subject", () => {
    const reg = makeRegistry([
      { subject: "nginx", predicate: "state", value: "running" },
      { subject: "nginx", predicate: "version", value: "1.24" },
      { subject: "redis", predicate: "state", value: "stopped" },
    ]);
    const facts = reg.lookupBySubject("nginx");
    expect(facts).toHaveLength(2);
  });

  it("lookupBySubject returns empty array for unknown subject", () => {
    const reg = makeRegistry([]);
    expect(reg.lookupBySubject("nginx")).toEqual([]);
  });
});

describe("checkClaim", () => {
  describe("system_state claims", () => {
    it("returns 'verified' when claim matches fact", () => {
      const reg = makeRegistry([{ subject: "nginx", predicate: "state", value: "running" }]);
      const result = checkClaim(makeClaim(), reg);
      expect(result.status).toBe("verified");
      expect(result.fact).not.toBeNull();
    });

    it("returns 'contradicted' when claim differs from fact", () => {
      const reg = makeRegistry([{ subject: "nginx", predicate: "state", value: "stopped" }]);
      const result = checkClaim(makeClaim({ value: "running" }), reg);
      expect(result.status).toBe("contradicted");
      expect(result.fact!.value).toBe("stopped");
    });

    it("returns 'unverified' when no fact exists", () => {
      const reg = makeRegistry([]);
      const result = checkClaim(makeClaim(), reg);
      expect(result.status).toBe("unverified");
      expect(result.fact).toBeNull();
    });
  });

  describe("existence claims", () => {
    it("verifies positive existence claim", () => {
      const reg = makeRegistry([{ subject: "config.yaml", predicate: "exists", value: "true" }]);
      const claim = makeClaim({ type: "existence", subject: "config.yaml", predicate: "exists", value: "true" });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("verified");
    });

    it("contradicts when claim says exists but fact says doesn't", () => {
      const reg = makeRegistry([{ subject: "config.yaml", predicate: "exists", value: "false" }]);
      const claim = makeClaim({ type: "existence", subject: "config.yaml", predicate: "exists", value: "true" });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("contradicted");
    });
  });

  describe("self_referential claims", () => {
    it("checks 'self' as subject for self-referential claims", () => {
      const reg = makeRegistry([{ subject: "self", predicate: "name", value: "Forge" }]);
      const claim = makeClaim({
        type: "self_referential",
        subject: "self",
        predicate: "name",
        value: "Forge",
      });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("verified");
    });

    it("contradicts when agent claims wrong name", () => {
      const reg = makeRegistry([{ subject: "self", predicate: "name", value: "Forge" }]);
      const claim = makeClaim({
        type: "self_referential",
        subject: "self",
        predicate: "name",
        value: "Atlas",
      });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("contradicted");
    });
  });

  describe("value normalization", () => {
    it("case-insensitive value comparison", () => {
      const reg = makeRegistry([{ subject: "nginx", predicate: "state", value: "Running" }]);
      const result = checkClaim(makeClaim({ value: "running" }), reg);
      expect(result.status).toBe("verified");
    });

    it("trims whitespace in values", () => {
      const reg = makeRegistry([{ subject: "nginx", predicate: "state", value: " running " }]);
      const result = checkClaim(makeClaim({ value: "running" }), reg);
      expect(result.status).toBe("verified");
    });

    it("normalizes yes/no to true/false", () => {
      const reg = makeRegistry([{ subject: "config.yaml", predicate: "exists", value: "yes" }]);
      const claim = makeClaim({ type: "existence", subject: "config.yaml", predicate: "exists", value: "true" });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("verified");
    });
  });

  describe("claim predicate fallback", () => {
    it("falls back to claim's own predicate when no type-specific mapping", () => {
      const reg = makeRegistry([{ subject: "queue", predicate: "metric", value: "150 items" }]);
      const claim = makeClaim({
        type: "operational_status",
        subject: "queue",
        predicate: "metric",
        value: "150 items",
      });
      const result = checkClaim(claim, reg);
      expect(result.status).toBe("verified");
    });
  });
});

describe("checkClaims", () => {
  it("checks multiple claims at once", () => {
    const reg = makeRegistry([
      { subject: "nginx", predicate: "state", value: "running" },
      { subject: "redis", predicate: "state", value: "stopped" },
    ]);

    const claims = [
      makeClaim({ subject: "nginx", value: "running" }),
      makeClaim({ subject: "redis", value: "running" }), // contradicts
      makeClaim({ subject: "mysql", value: "running" }), // unverified
    ];

    const results = checkClaims(claims, reg);
    expect(results).toHaveLength(3);
    expect(results[0]!.status).toBe("verified");
    expect(results[1]!.status).toBe("contradicted");
    expect(results[2]!.status).toBe("unverified");
  });

  it("returns empty array for empty claims", () => {
    const reg = makeRegistry([]);
    expect(checkClaims([], reg)).toEqual([]);
  });
});

describe("performance", () => {
  it("looks up 1000 facts in under 2ms", () => {
    const facts: Fact[] = [];
    for (let i = 0; i < 1000; i++) {
      facts.push({ subject: `service-${i}`, predicate: "state", value: "running" });
    }
    const reg = new FactRegistry([{ id: "perf", facts }]);

    const claims = Array.from({ length: 100 }, (_, i) =>
      makeClaim({ subject: `service-${i}` }),
    );

    const start = performance.now();
    checkClaims(claims, reg);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2);
  });
});

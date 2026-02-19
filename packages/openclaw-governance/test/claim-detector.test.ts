import { describe, it, expect } from "vitest";
import { detectClaims, getBuiltinDetectorIds } from "../src/claim-detector.js";

describe("claim-detector", () => {
  describe("getBuiltinDetectorIds", () => {
    it("returns all 5 built-in detector IDs", () => {
      const ids = getBuiltinDetectorIds();
      expect(ids).toHaveLength(5);
      expect(ids).toContain("system_state");
      expect(ids).toContain("entity_name");
      expect(ids).toContain("existence");
      expect(ids).toContain("operational_status");
      expect(ids).toContain("self_referential");
    });
  });

  describe("empty / no-match cases", () => {
    it("returns empty array for empty string", () => {
      expect(detectClaims("")).toEqual([]);
    });

    it("returns empty array for casual text with no claims", () => {
      expect(detectClaims("Hello, how are you today?")).toEqual([]);
    });

    it("returns empty array for undefined-like input", () => {
      expect(detectClaims("")).toEqual([]);
    });
  });

  describe("system_state detector", () => {
    it("detects 'X is running'", () => {
      const claims = detectClaims("nginx is running on port 80");
      expect(claims.length).toBeGreaterThanOrEqual(1);
      const c = claims.find((c) => c.type === "system_state" && c.subject === "nginx");
      expect(c).toBeDefined();
      expect(c!.value).toBe("running");
    });

    it("detects 'X is stopped'", () => {
      const claims = detectClaims("redis is stopped");
      const c = claims.find((c) => c.type === "system_state");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("redis");
      expect(c!.value).toBe("stopped");
    });

    it("detects 'X is online'", () => {
      const claims = detectClaims("gateway-prod is online");
      const c = claims.find((c) => c.type === "system_state");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("gateway-prod");
      expect(c!.value).toBe("online");
    });

    it("detects 'X is healthy'", () => {
      const claims = detectClaims("api-server is healthy");
      const c = claims.find((c) => c.type === "system_state");
      expect(c).toBeDefined();
      expect(c!.value).toBe("healthy");
    });

    it("filters common words like 'it is running'", () => {
      const claims = detectClaims("it is running fine");
      const sys = claims.filter((c) => c.type === "system_state");
      expect(sys).toHaveLength(0);
    });

    it("detects multiple system states", () => {
      const claims = detectClaims("nginx is running and redis is stopped");
      const sys = claims.filter((c) => c.type === "system_state");
      expect(sys.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("entity_name detector", () => {
    it("detects 'the agent named X'", () => {
      const claims = detectClaims("the agent named forge is responsible");
      const c = claims.find((c) => c.type === "entity_name");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("forge");
      expect(c!.value).toBe("agent");
    });

    it("detects 'the service called X'", () => {
      const claims = detectClaims("the service called auth-proxy handles login");
      const c = claims.find((c) => c.type === "entity_name");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("auth-proxy");
      expect(c!.value).toBe("service");
    });

    it("detects 'the server X'", () => {
      const claims = detectClaims("the server prod-01 is in the us-east datacenter");
      const c = claims.find((c) => c.type === "entity_name");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("prod-01");
    });

    it("detects various entity types", () => {
      const claims = detectClaims("the container web-app and the database postgres-main");
      const entities = claims.filter((c) => c.type === "entity_name");
      expect(entities.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("existence detector", () => {
    it("detects 'X exists'", () => {
      const claims = detectClaims("config.yaml exists in the directory");
      const c = claims.find((c) => c.type === "existence");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("config.yaml");
      expect(c!.value).toBe("true");
    });

    it("detects 'X does not exist'", () => {
      const claims = detectClaims("backup.tar does not exist");
      const c = claims.find((c) => c.type === "existence");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("backup.tar");
      expect(c!.value).toBe("false");
    });

    it("detects 'X doesn't exist'", () => {
      const claims = detectClaims("output.log doesn't exist");
      const c = claims.find((c) => c.type === "existence");
      expect(c).toBeDefined();
      expect(c!.value).toBe("false");
    });

    it("detects 'there is no X'", () => {
      const claims = detectClaims("there is no backup");
      const c = claims.find((c) => c.type === "existence");
      expect(c).toBeDefined();
      expect(c!.value).toBe("false");
    });

    it("detects 'X is deployed'", () => {
      const claims = detectClaims("v2.0 is deployed to production");
      const c = claims.find((c) => c.type === "existence");
      expect(c).toBeDefined();
      expect(c!.value).toBe("true");
    });
  });

  describe("operational_status detector", () => {
    it("detects 'X has N items'", () => {
      const claims = detectClaims("queue has 150 items waiting");
      const c = claims.find((c) => c.type === "operational_status");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("queue");
      expect(c!.value).toContain("150");
    });

    it("detects 'X is at N%'", () => {
      const claims = detectClaims("CPU is at 85%");
      const c = claims.find((c) => c.type === "operational_status");
      expect(c).toBeDefined();
      expect(c!.subject).toBe("CPU");
      expect(c!.value).toBe("85%");
    });

    it("detects 'X count is N'", () => {
      const claims = detectClaims("error count is 42");
      const c = claims.find((c) => c.type === "operational_status");
      expect(c).toBeDefined();
      expect(c!.predicate).toBe("count");
      expect(c!.value).toBe("42");
    });

    it("detects 'X uses N GB'", () => {
      const claims = detectClaims("disk uses 120 GB of storage");
      const c = claims.find((c) => c.type === "operational_status");
      expect(c).toBeDefined();
      expect(c!.value).toContain("120");
    });
  });

  describe("self_referential detector", () => {
    it("detects 'I am X.'", () => {
      const claims = detectClaims("I am the governance engine.");
      const c = claims.find((c) => c.type === "self_referential");
      expect(c).toBeDefined();
      expect(c!.predicate).toBe("identity");
      expect(c!.value).toBe("the governance engine");
    });

    it("detects 'My name is X.'", () => {
      const claims = detectClaims("My name is Forge.");
      const c = claims.find((c) => c.type === "self_referential");
      expect(c).toBeDefined();
      expect(c!.predicate).toBe("name");
      expect(c!.value).toBe("Forge");
    });

    it("detects 'I have X.'", () => {
      const claims = detectClaims("I have access to all files.");
      const c = claims.find((c) => c.type === "self_referential");
      expect(c).toBeDefined();
      expect(c!.predicate).toBe("capability");
      expect(c!.value).toBe("access to all files");
    });
  });

  describe("selective detectors", () => {
    it("only runs specified detectors", () => {
      const text = "nginx is running. I am the admin.";
      const claims = detectClaims(text, ["system_state"]);
      const types = new Set(claims.map((c) => c.type));
      expect(types.has("system_state")).toBe(true);
      expect(types.has("self_referential")).toBe(false);
    });

    it("returns empty for unknown detector", () => {
      const claims = detectClaims("nginx is running", ["fake_detector" as "system_state"]);
      expect(claims).toEqual([]);
    });
  });

  describe("deduplication", () => {
    it("deduplicates claims with same offset and type", () => {
      const text = "nginx is running";
      const claims = detectClaims(text);
      const nginx = claims.filter(
        (c) => c.type === "system_state" && c.subject === "nginx",
      );
      expect(nginx).toHaveLength(1);
    });
  });

  describe("performance", () => {
    it("processes 1KB of text in under 5ms", () => {
      const text = "nginx is running. redis is stopped. MySQL is online. " +
        "The service called auth-proxy exists. CPU is at 90%. " +
        "queue has 500 items. I am the governance engine. ";
      const largeText = text.repeat(10);

      const start = performance.now();
      detectClaims(largeText);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });
});

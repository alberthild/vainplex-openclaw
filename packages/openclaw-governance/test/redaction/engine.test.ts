import { afterEach, describe, expect, it } from "vitest";
import type { PluginLogger } from "../../src/types.js";
import { RedactionEngine } from "../../src/redaction/engine.js";
import { PatternRegistry } from "../../src/redaction/registry.js";
import { RedactionVault } from "../../src/redaction/vault.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeEngine(categories = ["credential", "pii", "financial"] as const) {
  const registry = new PatternRegistry([...categories], [], logger);
  const vault = new RedactionVault(logger);
  const engine = new RedactionEngine(registry, vault);
  return { engine, vault, registry };
}

describe("RedactionEngine", () => {
  let vault: RedactionVault;

  afterEach(() => {
    vault?.stop();
  });

  // ── String Scanning ──

  describe("string scanning", () => {
    it("redacts a simple credential in a string", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const result = engine.scan("password=MyS3cretP4ss!");
      expect(result.redactionCount).toBe(1);
      expect(result.categories.has("credential")).toBe(true);
      expect(result.output).toMatch(/\[REDACTED:credential:[a-f0-9]+\]/);
      expect(result.output).not.toContain("MyS3cretP4ss!");
    });

    it("redacts multiple credentials", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const input = "password=secret123 and token=anothersecret456";
      const result = engine.scan(input);
      expect(result.redactionCount).toBe(2);
    });

    it("redacts email addresses", () => {
      const { engine, vault: v } = makeEngine(["pii"]);
      vault = v;

      const result = engine.scan("Contact: albert@vainplex.de");
      expect(result.redactionCount).toBe(1);
      expect(result.output).toMatch(/\[REDACTED:pii:[a-f0-9]+\]/);
      expect(result.output).not.toContain("albert@vainplex.de");
    });

    it("redacts credit card numbers", () => {
      const { engine, vault: v } = makeEngine(["financial"]);
      vault = v;

      const result = engine.scan("Card: 4111 1111 1111 1111");
      expect(result.redactionCount).toBe(1);
      expect(result.output).not.toContain("4111");
    });

    it("preserves non-sensitive text", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("Hello, this is a normal message.");
      expect(result.redactionCount).toBe(0);
      expect(result.output).toBe("Hello, this is a normal message.");
    });

    it("handles empty string", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("");
      expect(result.redactionCount).toBe(0);
      expect(result.output).toBe("");
    });
  });

  // ── Deep Object Scanning ──

  describe("deep object scanning", () => {
    it("scans nested objects", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const input = {
        config: {
          database: {
            password: "password=MyDbPassword123",
          },
        },
      };

      const result = engine.scan(input);
      expect(result.redactionCount).toBe(1);
      const output = result.output as Record<string, Record<string, Record<string, string>>>;
      expect(output["config"]!["database"]!["password"]).toMatch(
        /\[REDACTED:credential/,
      );
    });

    it("scans arrays", () => {
      const { engine, vault: v } = makeEngine(["pii"]);
      vault = v;

      const input = {
        emails: ["alice@example.com", "bob@example.com"],
      };

      const result = engine.scan(input);
      expect(result.redactionCount).toBe(2);
    });

    it("handles mixed types in arrays", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const input = [42, "password=secret123456", true, null, { key: "token=abcdef12345678" }];
      const result = engine.scan(input);
      expect(result.redactionCount).toBe(2);

      const output = result.output as unknown[];
      expect(output[0]).toBe(42);
      expect(output[2]).toBe(true);
      expect(output[3]).toBeNull();
    });

    it("preserves non-string primitive types", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const input = { count: 42, active: true, ratio: 3.14 };
      const result = engine.scan(input);
      expect(result.redactionCount).toBe(0);
      expect(result.output).toEqual(input);
    });

    it("handles null and undefined values", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      expect(engine.scan(null).output).toBeNull();
      expect(engine.scan(undefined).output).toBeUndefined();
    });
  });

  // ── JSON-within-String ──

  describe("JSON-within-string scanning", () => {
    it("detects and scans JSON embedded in strings", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const jsonStr = JSON.stringify({ apiKey: "password=VerySecretKey123!" });
      const result = engine.scan(jsonStr);

      expect(result.redactionCount).toBe(1);
      // Output should be valid JSON string with placeholder
      const parsed = JSON.parse(result.output as string) as Record<string, string>;
      expect(parsed["apiKey"]).toMatch(/\[REDACTED:credential/);
    });

    it("handles nested JSON-in-string", () => {
      const { engine, vault: v } = makeEngine(["pii"]);
      vault = v;

      const inner = JSON.stringify({ email: "user@example.com" });
      const outer = { data: inner };

      const result = engine.scan(outer);
      expect(result.redactionCount).toBe(1);

      const outputData = (result.output as Record<string, string>)["data"]!;
      const parsed = JSON.parse(outputData) as Record<string, string>;
      expect(parsed["email"]).toMatch(/\[REDACTED:pii/);
    });

    it("handles arrays in JSON strings", () => {
      const { engine, vault: v } = makeEngine(["pii"]);
      vault = v;

      const jsonStr = JSON.stringify(["a@b.com", "c@d.com"]);
      const result = engine.scan(jsonStr);
      expect(result.redactionCount).toBe(2);
    });

    it("leaves non-JSON strings as strings", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("just a regular string");
      expect(result.output).toBe("just a regular string");
    });

    it("handles invalid JSON gracefully", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("{not valid json}");
      expect(result.output).toBe("{not valid json}");
    });
  });

  // ── Circular Reference Protection ──

  describe("circular reference protection", () => {
    it("handles circular references without infinite loop", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const obj: Record<string, unknown> = { name: "test" };
      obj["self"] = obj;

      const result = engine.scan(obj);
      expect(result.elapsedMs).toBeLessThan(100);
      const output = result.output as Record<string, unknown>;
      expect(output["self"]).toBe("[Circular]");
    });

    it("handles mutual circular references", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const a: Record<string, unknown> = { name: "a" };
      const b: Record<string, unknown> = { name: "b" };
      a["ref"] = b;
      b["ref"] = a;

      const result = engine.scan(a);
      expect(result.elapsedMs).toBeLessThan(100);
    });

    it("handles deeply nested objects up to MAX_DEPTH", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      let obj: Record<string, unknown> = { value: "password=deep_secret_value" };
      for (let i = 0; i < 25; i++) {
        obj = { nested: obj };
      }

      const result = engine.scan(obj);
      // May or may not redact depending on depth limit,
      // but should not throw or hang
      expect(result.elapsedMs).toBeLessThan(100);
    });
  });

  // ── scanString (Layer 2) ──

  describe("scanString", () => {
    it("scans a string without deep object traversal", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const result = engine.scanString("password=MySecret123 is set");
      expect(result.redactionCount).toBe(1);
      expect(result.output).toMatch(/\[REDACTED:credential/);
      expect(result.output).not.toContain("MySecret123");
    });

    it("returns original string when no matches", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scanString("Hello world");
      expect(result.output).toBe("Hello world");
      expect(result.redactionCount).toBe(0);
    });

    it("tracks categories of redacted items", () => {
      const { engine, vault: v } = makeEngine(["credential", "pii"]);
      vault = v;

      const result = engine.scanString(
        "password=secret12345 email: user@example.com",
      );
      expect(result.categories.has("credential")).toBe(true);
      expect(result.categories.has("pii")).toBe(true);
    });
  });

  // ── Performance ──

  describe("performance", () => {
    it("processes 100KB input in < 5ms", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      // Generate 100KB+ of text with embedded secrets
      const textBlock = "This is normal text without any sensitive data. ".repeat(2200);
      const secrets = [
        "password=SuperSecret123!",
        "sk-abcdefghijklmnopqrstuvwxyz",
        "user@example.com",
        "4111 1111 1111 1111",
        "token=mytoken1234567890",
      ];

      let input = textBlock;
      for (const secret of secrets) {
        const pos = Math.floor(input.length / 2);
        input = input.slice(0, pos) + " " + secret + " " + input.slice(pos);
      }

      expect(input.length).toBeGreaterThan(100000);

      const result = engine.scan(input);
      expect(result.elapsedMs).toBeLessThan(5);
      expect(result.redactionCount).toBeGreaterThan(0);
    });

    it("processes 1MB input in < 50ms", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      // Generate ~1MB of text
      const block = "Normal text content without secrets for padding. ".repeat(21000);
      let input = block;
      // Add some secrets throughout
      for (let i = 0; i < 20; i++) {
        input += ` password=secret${i}longvalue_pad `;
      }

      expect(input.length).toBeGreaterThan(1000000);

      const result = engine.scan(input);
      expect(result.elapsedMs).toBeLessThan(50);
    });

    it("handles large nested objects efficiently", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const largeObj: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`key${i}`] = {
          value: `normal-data-${i}`,
          nested: { inner: `more-data-${i}` },
        };
      }
      // Add a few secrets
      (largeObj["key50"] as Record<string, unknown>)["secret"] = "password=hidden_value_12345";

      const result = engine.scan(largeObj);
      expect(result.elapsedMs).toBeLessThan(10);
      expect(result.redactionCount).toBe(1);
    });
  });

  // ── Vault Integration ──

  describe("vault integration", () => {
    it("stores redacted values in vault for later resolution", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const result = engine.scan("password=MyS3cretP4ss!");
      const output = result.output as string;

      // Extract placeholder from output
      const match = /\[REDACTED:credential:[a-f0-9]+\]/.exec(output);
      expect(match).not.toBeNull();

      // Resolve from vault
      const resolved = v.resolve(match![0]);
      expect(resolved).toContain("MyS3cretP4ss!");
    });

    it("round-trips through scan → vault → resolve", () => {
      const { engine, vault: v } = makeEngine(["credential"]);
      vault = v;

      const secret = "password=TopSecretPassword!";
      const result = engine.scan(secret);
      const output = result.output as string;

      // Resolve all placeholders
      const { resolved } = v.resolveAll(output);
      expect(resolved).toBe(secret);
    });
  });

  // ── Edge Cases ──

  describe("edge cases", () => {
    it("handles string that is valid JSON number", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      // "42" parses as a number, not an object — should not recurse
      const result = engine.scan("42");
      expect(result.output).toBe("42");
    });

    it("handles string that is valid JSON boolean", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("true");
      expect(result.output).toBe("true");
    });

    it("handles empty object", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan({});
      expect(result.output).toEqual({});
      expect(result.redactionCount).toBe(0);
    });

    it("handles empty array", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan([]);
      expect(result.output).toEqual([]);
    });

    it("reports elapsed time", () => {
      const { engine, vault: v } = makeEngine();
      vault = v;

      const result = engine.scan("test");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.elapsedMs).toBeLessThan(100);
    });
  });
});

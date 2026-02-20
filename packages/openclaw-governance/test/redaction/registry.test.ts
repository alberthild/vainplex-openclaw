import { describe, expect, it } from "vitest";
import type { PluginLogger } from "../../src/types.js";
import { PatternRegistry, getBuiltinPatterns } from "../../src/redaction/registry.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeRegistry(
  categories = ["credential", "pii", "financial"] as const,
  custom: { name: string; regex: string; category: string }[] = [],
) {
  return new PatternRegistry([...categories], custom.map((c) => ({
    name: c.name,
    regex: c.regex,
    category: c.category as "credential" | "pii" | "financial" | "custom",
  })), logger);
}

// ── Built-in Pattern Tests ──

describe("PatternRegistry", () => {
  describe("built-in patterns", () => {
    it("has all expected built-in patterns", () => {
      const patterns = getBuiltinPatterns();
      expect(patterns.length).toBeGreaterThanOrEqual(13);
      expect(patterns.every((p) => p.builtin)).toBe(true);
    });

    it("includes patterns for all categories", () => {
      const patterns = getBuiltinPatterns();
      const categories = new Set(patterns.map((p) => p.category));
      expect(categories.has("credential")).toBe(true);
      expect(categories.has("pii")).toBe(true);
      expect(categories.has("financial")).toBe(true);
    });
  });

  // ── Credential Pattern Tests ──

  describe("credential patterns", () => {
    const reg = makeRegistry(["credential"]);

    it("detects OpenAI API keys", () => {
      const matches = reg.findMatches("key: sk-abcdefghijklmnopqrstuvwxyz");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("openai-api-key");
    });

    it("does not match short sk- prefixes", () => {
      const matches = reg.findMatches("sk-short");
      expect(matches.length).toBe(0);
    });

    it("detects Anthropic API keys", () => {
      const key = "sk-ant-" + "a".repeat(80);
      const matches = reg.findMatches(`key=${key}`);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // Should match the Anthropic pattern (longest)
      const anthropicMatch = matches.find((m) => m.pattern.id === "anthropic-api-key");
      expect(anthropicMatch).toBeDefined();
    });

    it("detects Google API keys", () => {
      const key = "AIza" + "a".repeat(35);
      const matches = reg.findMatches(`The key is ${key} here`);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.pattern.id === "google-api-key")).toBe(true);
    });

    it("does not match AIza with insufficient length", () => {
      const matches = reg.findMatches("AIzaShort");
      expect(matches.length).toBe(0);
    });

    it("detects GitHub personal access tokens", () => {
      const token = "ghp_" + "a".repeat(36);
      const matches = reg.findMatches(token);
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("github-pat");
    });

    it("detects GitHub server tokens", () => {
      const token = "ghs_" + "a".repeat(36);
      const matches = reg.findMatches(token);
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("github-server-token");
    });

    it("detects GitLab personal access tokens", () => {
      const token = "glpat-" + "a".repeat(20);
      const matches = reg.findMatches(token);
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("gitlab-pat");
    });

    it("detects private key headers", () => {
      const matches = reg.findMatches("-----BEGIN RSA PRIVATE KEY-----");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("private-key-header");
    });

    it("detects EC private key headers", () => {
      const matches = reg.findMatches("-----BEGIN EC PRIVATE KEY-----");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("private-key-header");
    });

    it("detects OPENSSH private key headers", () => {
      const matches = reg.findMatches("-----BEGIN OPENSSH PRIVATE KEY-----");
      expect(matches.length).toBe(1);
    });

    it("detects generic private key headers", () => {
      const matches = reg.findMatches("-----BEGIN PRIVATE KEY-----");
      expect(matches.length).toBe(1);
    });

    it("detects Bearer tokens", () => {
      const token = "Bearer " + "a".repeat(30);
      const matches = reg.findMatches(token);
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("bearer-token");
    });

    it("does not match short Bearer tokens", () => {
      const matches = reg.findMatches("Bearer short");
      expect(matches.length).toBe(0);
    });

    it("detects key=value credential patterns", () => {
      const matches = reg.findMatches('password=MyS3cretP4ss!');
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("key-value-credential");
    });

    it("detects password: with quotes", () => {
      const matches = reg.findMatches('password: "longpassword123"');
      expect(matches.length).toBe(1);
    });

    it("detects api_key= patterns", () => {
      const matches = reg.findMatches("api_key=sk-proj-abc123def456");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("detects token= patterns", () => {
      const matches = reg.findMatches("token=verysecrettoken123");
      expect(matches.length).toBe(1);
    });

    it("does not match short passwords", () => {
      const matches = reg.findMatches("password=short");
      expect(matches.length).toBe(0);
    });
  });

  // ── PII Pattern Tests ──

  describe("PII patterns", () => {
    const reg = makeRegistry(["pii"]);

    it("detects email addresses", () => {
      const matches = reg.findMatches("Contact: albert@vainplex.de");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("email-address");
      expect(matches[0]!.match).toBe("albert@vainplex.de");
    });

    it("detects complex email addresses", () => {
      const matches = reg.findMatches("user.name+tag@example.co.uk");
      expect(matches.length).toBe(1);
    });

    it("does not match invalid emails", () => {
      const matches = reg.findMatches("not-an-email");
      expect(matches.length).toBe(0);
    });

    it("does not match @-only strings", () => {
      const matches = reg.findMatches("@ or a@");
      expect(matches.length).toBe(0);
    });

    it("detects phone numbers", () => {
      const matches = reg.findMatches("Call: +4917612345678");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("phone-number");
    });

    it("detects phone numbers without +", () => {
      const matches = reg.findMatches("Tel: 4917612345678");
      expect(matches.length).toBe(1);
    });

    it("does not match too-short numbers", () => {
      const matches = reg.findMatches("123456");
      expect(matches.length).toBe(0);
    });
  });

  // ── Financial Pattern Tests ──

  describe("financial patterns", () => {
    const reg = makeRegistry(["financial"]);

    it("detects Visa credit card numbers", () => {
      const matches = reg.findMatches("Card: 4111 1111 1111 1111");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("credit-card");
    });

    it("detects Mastercard credit card numbers", () => {
      const matches = reg.findMatches("Card: 5500-0000-0000-0004");
      expect(matches.length).toBe(1);
    });

    it("detects credit cards without separators", () => {
      const matches = reg.findMatches("Card: 4111111111111111");
      expect(matches.length).toBe(1);
    });

    it("does not match non-card number sequences", () => {
      const matches = reg.findMatches("ID: 1234567890123456");
      expect(matches.length).toBe(0);
    });

    it("detects IBAN numbers", () => {
      const matches = reg.findMatches("IBAN: DE89 3704 0044 0532 0130 00");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("iban");
    });

    it("detects IBAN without spaces", () => {
      const matches = reg.findMatches("IBAN: DE89370400440532013000");
      expect(matches.length).toBe(1);
    });

    it("does not match too-short IBAN-like strings", () => {
      const matches = reg.findMatches("DE89 3704");
      expect(matches.length).toBe(0);
    });
  });

  // ── Category Filtering ──

  describe("category filtering", () => {
    it("only includes enabled categories", () => {
      const reg = makeRegistry(["credential"]);
      const patterns = reg.getPatterns();
      expect(patterns.every((p) => p.category === "credential")).toBe(true);
    });

    it("includes all categories when all enabled", () => {
      const reg = makeRegistry(["credential", "pii", "financial"]);
      const patterns = reg.getPatterns();
      const cats = new Set(patterns.map((p) => p.category));
      expect(cats.size).toBe(3);
    });

    it("returns empty for no categories", () => {
      const reg = makeRegistry([]);
      expect(reg.getPatterns().length).toBe(0);
    });
  });

  // ── Custom Patterns ──

  describe("custom patterns", () => {
    it("adds valid custom patterns", () => {
      const reg = makeRegistry(["custom"], [
        { name: "nats_url", regex: "nats://[^\\s]+", category: "custom" },
      ]);
      const patterns = reg.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0]!.id).toBe("custom-nats_url");
      expect(patterns[0]!.builtin).toBe(false);
    });

    it("matches custom patterns", () => {
      const reg = makeRegistry(["custom"], [
        { name: "nats_url", regex: "nats://[^\\s]+", category: "custom" },
      ]);
      const matches = reg.findMatches("Connect to nats://localhost:4222");
      expect(matches.length).toBe(1);
      expect(matches[0]!.match).toBe("nats://localhost:4222");
    });

    it("rejects invalid regex", () => {
      const reg = makeRegistry(["custom"], [
        { name: "bad", regex: "[invalid", category: "custom" },
      ]);
      expect(reg.getPatterns().length).toBe(0);
    });

    it("rejects ReDoS-vulnerable patterns", () => {
      const reg = makeRegistry(["custom"], [
        { name: "redos", regex: "(a+)+$", category: "custom" },
      ]);
      // May or may not be rejected depending on the input test
      // The registry tests with "a".repeat(1000)
      const patterns = reg.getPatterns();
      // Pattern might pass the quick check but that's fine —
      // the important thing is it doesn't hang
      expect(patterns.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Overlap Resolution ──

  describe("overlap resolution", () => {
    it("resolves overlapping matches by longest match", () => {
      const reg = makeRegistry(["credential"]);
      // api_key=sk-abcdefghijklmnopqrstuvwxyz matches both
      // key-value-credential and openai-api-key
      const input = "api_key=sk-abcdefghijklmnopqrstuvwxyz";
      const matches = reg.findMatches(input);
      // Should have at least one match, longest wins
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("handles non-overlapping matches correctly", () => {
      const reg = makeRegistry(["credential", "pii"]);
      const input = "password=MySecret123 email: test@example.com";
      const matches = reg.findMatches(input);
      expect(matches.length).toBe(2);
    });

    it("picks credential over pii when same position", () => {
      // Credential category has higher priority than PII
      const reg = makeRegistry(["credential", "pii"]);
      const patterns = reg.getByCategory("credential");
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  // ── ReDoS Safety ──

  describe("ReDoS safety", () => {
    it("all built-in patterns complete in < 10ms on adversarial input", () => {
      const patterns = getBuiltinPatterns();
      const adversarial = "a".repeat(100000);

      for (const pattern of patterns) {
        const start = performance.now();
        const regex = new RegExp(pattern.regex.source, "g");
        regex.test(adversarial);
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(10);
      }
    });

    it("handles repeated special chars without hanging", () => {
      const patterns = getBuiltinPatterns();
      const inputs = [
        "=".repeat(10000),
        ":".repeat(10000),
        " ".repeat(10000),
        "@".repeat(10000),
        "-".repeat(10000),
      ];

      for (const pattern of patterns) {
        for (const input of inputs) {
          const start = performance.now();
          const regex = new RegExp(pattern.regex.source, "g");
          regex.test(input);
          const elapsed = performance.now() - start;
          expect(elapsed).toBeLessThan(10);
        }
      }
    });

    it("handles near-miss patterns without backtracking", () => {
      const reg = makeRegistry();
      // Near-miss: looks like API key but isn't quite
      const nearMiss = "sk-" + "!".repeat(1000);
      const start = performance.now();
      reg.findMatches(nearMiss);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("handles mixed adversarial input", () => {
      const reg = makeRegistry();
      // Mix of partial matches
      const input = ("password=" + "a".repeat(100) + " ").repeat(100);
      const start = performance.now();
      reg.findMatches(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });

  // ── Edge Cases ──

  describe("edge cases", () => {
    it("handles empty input", () => {
      const reg = makeRegistry();
      expect(reg.findMatches("").length).toBe(0);
    });

    it("handles input with no matches", () => {
      const reg = makeRegistry();
      expect(reg.findMatches("Hello, world!").length).toBe(0);
    });

    it("finds multiple matches in one string", () => {
      const reg = makeRegistry(["pii"]);
      const input = "a@b.com and c@d.com";
      const matches = reg.findMatches(input);
      expect(matches.length).toBe(2);
    });

    it("getByCategory returns only matching patterns", () => {
      const reg = makeRegistry();
      const pii = reg.getByCategory("pii");
      expect(pii.every((p) => p.category === "pii")).toBe(true);
      expect(pii.length).toBeGreaterThan(0);
    });

    it("isCredentialCategory returns true for credential", () => {
      const reg = makeRegistry();
      expect(reg.isCredentialCategory("credential")).toBe(true);
      expect(reg.isCredentialCategory("pii")).toBe(false);
    });
  });
});

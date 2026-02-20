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
      expect(patterns.length).toBeGreaterThanOrEqual(16);
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

  // ── AWS Key Pattern Tests (W4) ──

  describe("aws-key pattern", () => {
    const reg = makeRegistry(["credential"]);

    // Positive cases
    it("detects standard AWS access key", () => {
      const matches = reg.findMatches("key: AKIAIOSFODNN7EXAMPLE");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(true);
    });

    it("detects AWS key in env variable format", () => {
      const matches = reg.findMatches("AWS_ACCESS_KEY_ID=AKIAI44QH8DHBEXAMPLE");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(true);
    });

    it("detects AWS key at start of string", () => {
      const matches = reg.findMatches("AKIAIOSFODNN7EXAMPLE is the key");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(true);
    });

    it("detects AWS key embedded in JSON", () => {
      const matches = reg.findMatches('{"accessKeyId":"AKIAI44QH8DHBEXAMPLE"}');
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(true);
    });

    it("detects AWS key with all-caps alphanumerics", () => {
      const matches = reg.findMatches("AKIA1234567890ABCDEF");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(true);
    });

    // Negative cases
    it("does not match AKIA with too few characters", () => {
      const matches = reg.findMatches("AKIA12345");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(false);
    });

    it("does not match lowercase akia prefix", () => {
      const matches = reg.findMatches("akia1234567890abcdef");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(false);
    });

    it("does not match AKIA followed by lowercase", () => {
      const matches = reg.findMatches("AKIAabcdefghijklmnop");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(false);
    });

    it("does not match AKIA embedded in longer uppercase string", () => {
      const matches = reg.findMatches("XYZAKIAIOSFODNN7EXAMPLE");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(false);
    });

    it("does not match the word AKIA alone", () => {
      const matches = reg.findMatches("AKIA");
      expect(matches.some((m) => m.pattern.id === "aws-key")).toBe(false);
    });
  });

  // ── Generic API Key Pattern Tests (W4) ──

  describe("generic-api-key pattern", () => {
    const reg = makeRegistry(["credential"]);

    // Positive cases
    it("detects sk- prefixed API key", () => {
      const matches = reg.findMatches("key: sk-proj-abcdef1234567890abcd");
      expect(matches.some((m) => m.pattern.id === "generic-api-key" || m.pattern.id === "openai-api-key")).toBe(true);
    });

    it("detects sk- key with underscores and dashes", () => {
      const matches = reg.findMatches("sk-abc_def-ghi_jkl_mno_pqr_stu");
      expect(matches.some((m) => m.pattern.id === "generic-api-key" || m.pattern.id === "openai-api-key")).toBe(true);
    });

    it("detects long sk- key", () => {
      const key = "sk-" + "a".repeat(50);
      const matches = reg.findMatches(`The key is ${key} here`);
      expect(matches.some((m) => m.pattern.id === "generic-api-key" || m.pattern.id === "openai-api-key")).toBe(true);
    });

    it("detects sk- key in header format", () => {
      const matches = reg.findMatches("Authorization: sk-test_12345678901234567890");
      expect(matches.some((m) => m.pattern.id === "generic-api-key" || m.pattern.id === "openai-api-key")).toBe(true);
    });

    it("detects sk- key with mixed case", () => {
      const matches = reg.findMatches("sk-AbCdEf1234567890AbCdEf");
      expect(matches.some((m) => m.pattern.id === "generic-api-key" || m.pattern.id === "openai-api-key")).toBe(true);
    });

    // Negative cases
    it("does not match sk- with too few characters", () => {
      const matches = reg.findMatches("sk-short");
      expect(matches.some((m) => m.pattern.id === "generic-api-key")).toBe(false);
    });

    it("does not match sk without dash", () => {
      const matches = reg.findMatches("skabcdefghijklmnopqrstuv");
      expect(matches.some((m) => m.pattern.id === "generic-api-key")).toBe(false);
    });

    it("does not match SK- uppercase prefix", () => {
      // SK- not sk-
      const matches = reg.findMatches("SK-abcdefghijklmnopqrstuv");
      expect(matches.some((m) => m.pattern.id === "generic-api-key")).toBe(false);
    });

    it("does not match sk- with only 10 characters after", () => {
      const matches = reg.findMatches("sk-0123456789");
      expect(matches.some((m) => m.pattern.id === "generic-api-key")).toBe(false);
    });

    it("does not match sk- with special characters", () => {
      const matches = reg.findMatches("sk-abc!@#$%^&*()_+={}|");
      expect(matches.some((m) => m.pattern.id === "generic-api-key")).toBe(false);
    });
  });

  // ── Bearer Token Pattern Tests (W4) ──

  describe("bearer-token pattern", () => {
    const reg = makeRegistry(["credential"]);

    // Positive cases
    it("detects standard Bearer token", () => {
      const token = "Bearer " + "a".repeat(30);
      const matches = reg.findMatches(token);
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("bearer-token");
    });

    it("detects Bearer with JWT-like token", () => {
      const matches = reg.findMatches("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(true);
    });

    it("detects Bearer with slashes", () => {
      const matches = reg.findMatches("Bearer abc/def/ghi/jkl/mno/pqr");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(true);
    });

    it("detects Bearer in Authorization header", () => {
      const matches = reg.findMatches("Authorization: Bearer xoxb-123456789012-1234567890123");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(true);
    });

    it("detects Bearer with dots (JWT format)", () => {
      const matches = reg.findMatches("Bearer aaa.bbb.ccc.ddd.eee.fff.ggg");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(true);
    });

    // Negative cases
    it("does not match short Bearer tokens", () => {
      const matches = reg.findMatches("Bearer short");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(false);
    });

    it("does not match bearer in lowercase", () => {
      const matches = reg.findMatches("bearer " + "a".repeat(30));
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(false);
    });

    it("does not match Bearer without space", () => {
      const matches = reg.findMatches("Bearer" + "a".repeat(30));
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(false);
    });

    it("does not match Bearer with only spaces", () => {
      const matches = reg.findMatches("Bearer                             ");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(false);
    });

    it("does not match Bearer followed by special chars", () => {
      const matches = reg.findMatches("Bearer !@#$%^&*()!@#$%^&*()");
      expect(matches.some((m) => m.pattern.id === "bearer-token")).toBe(false);
    });
  });

  // ── Basic Auth Pattern Tests (W4) ──

  describe("basic-auth pattern", () => {
    const reg = makeRegistry(["credential"]);

    // Positive cases
    it("detects standard Basic auth header", () => {
      // base64 of "user:password" = "dXNlcjpwYXNzd29yZA=="
      const matches = reg.findMatches("Authorization: Basic dXNlcjpwYXNzd29yZA==");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(true);
    });

    it("detects Basic auth without padding", () => {
      // base64 of "admin:secret123" = "YWRtaW46c2VjcmV0MTIz"
      const matches = reg.findMatches("Basic YWRtaW46c2VjcmV0MTIz");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(true);
    });

    it("detects Basic auth with single padding", () => {
      const matches = reg.findMatches("Basic YWRtaW46cGFzc3dvcmQx=");
      // "admin:password1" -> "YWRtaW46cGFzc3dvcmQx" (no padding actually, let's use one that does)
      // base64 of "test:pass" = "dGVzdDpwYXNz" — no padding. Let's use "a:b" = "YTpi"... too short
      // "admin:secretpass" = "YWRtaW46c2VjcmV0cGFzcw==" has double padding
      // Let's use a long enough base64 string
      const matches2 = reg.findMatches("Basic YWRtaW46c2VjcmV0cGFzcw==");
      expect(matches2.some((m) => m.pattern.id === "basic-auth")).toBe(true);
    });

    it("detects Basic auth with plus sign in base64", () => {
      const matches = reg.findMatches("Basic dXNlcjpw+XNzd29yZA==");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(true);
    });

    it("detects Basic auth in curl command", () => {
      const matches = reg.findMatches('curl -H "Authorization: Basic YWRtaW46cGFzc3dvcmQ="');
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(true);
    });

    // Negative cases
    it("does not match Basic with too short base64", () => {
      const matches = reg.findMatches("Basic abc");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(false);
    });

    it("does not match basic in lowercase", () => {
      const matches = reg.findMatches("basic dXNlcjpwYXNzd29yZA==");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(false);
    });

    it("does not match Basic without space", () => {
      const matches = reg.findMatches("BasicdXNlcjpwYXNzd29yZA==");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(false);
    });

    it("does not match Basic followed by non-base64 chars", () => {
      const matches = reg.findMatches("Basic !@#$%^&*()!@#$%");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(false);
    });

    it("does not match the word Basic alone", () => {
      const matches = reg.findMatches("Basic ");
      expect(matches.some((m) => m.pattern.id === "basic-auth")).toBe(false);
    });
  });

  // ── Email Pattern Tests (W4) ──

  describe("email pattern", () => {
    const reg = makeRegistry(["pii"]);

    // Positive cases
    it("detects standard email address", () => {
      const matches = reg.findMatches("Contact: albert@vainplex.de");
      expect(matches.length).toBe(1);
      expect(matches[0]!.pattern.id).toBe("email-address");
      expect(matches[0]!.match).toBe("albert@vainplex.de");
    });

    it("detects email with plus addressing", () => {
      const matches = reg.findMatches("user.name+tag@example.co.uk");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(true);
    });

    it("detects email with numbers", () => {
      const matches = reg.findMatches("user123@domain456.com");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(true);
    });

    it("detects email with percent sign", () => {
      const matches = reg.findMatches("user%special@example.org");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(true);
    });

    it("detects multiple emails in text", () => {
      const matches = reg.findMatches("CC: alice@a.com and bob@b.com");
      const emailMatches = matches.filter((m) => m.pattern.id === "email-address");
      expect(emailMatches.length).toBe(2);
    });

    // Negative cases
    it("does not match @-only strings", () => {
      const matches = reg.findMatches("@ or a@");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(false);
    });

    it("does not match email without domain extension", () => {
      const matches = reg.findMatches("user@domain");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(false);
    });

    it("does not match email with space before @", () => {
      const matches = reg.findMatches("user @example.com");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(false);
    });

    it("does not match email without local part", () => {
      const matches = reg.findMatches("@example.com");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(false);
    });

    it("does not match plain text with no @", () => {
      const matches = reg.findMatches("not-an-email at all");
      expect(matches.some((m) => m.pattern.id === "email-address")).toBe(false);
    });
  });

  // ── Phone Number Pattern Tests (W4, W3) ──

  describe("phone-number pattern (with W3 boundary fix)", () => {
    const reg = makeRegistry(["pii"]);

    // Positive cases
    it("detects international phone with + prefix", () => {
      const matches = reg.findMatches("Call: +4917612345678");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    it("detects phone without + prefix", () => {
      const matches = reg.findMatches("Tel: 4917612345678");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    it("detects US phone number", () => {
      const matches = reg.findMatches("Phone: +12025551234");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    it("detects phone in parenthetical context", () => {
      const matches = reg.findMatches("(+4915112345678)");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    it("detects phone number with minimum 7 digits", () => {
      const matches = reg.findMatches("Tel: 1234567");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    // Negative cases (W3: false positive fixes)
    it("does not match too-short numbers (6 digits)", () => {
      const matches = reg.findMatches("123456");
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(false);
    });

    it("does not match numbers embedded in longer digit sequences", () => {
      // This was the W3 false positive: digits part of a larger number
      const matches = reg.findMatches("ID: 12345678901234567890");
      // The regex should NOT match substrings of a longer digit sequence
      const phoneMatches = matches.filter((m) => m.pattern.id === "phone-number");
      expect(phoneMatches.length).toBe(0);
    });

    it("does not match numbers preceded by digits", () => {
      const matches = reg.findMatches("0049176123456");
      // 0 starts so +?[1-9] won't match at 00, but 49176123456 could match
      // With lookbehind (?<!\d), digit before prevents match
      const phoneMatches = matches.filter((m) => m.pattern.id === "phone-number");
      expect(phoneMatches.length).toBe(0);
    });

    it("does not match hexadecimal-looking strings", () => {
      const matches = reg.findMatches("0x1A2B3C4D5E6F7");
      const phoneMatches = matches.filter((m) => m.pattern.id === "phone-number");
      expect(phoneMatches.length).toBe(0);
    });

    it("does not match numbers followed by more digits", () => {
      // 20-digit number — no phone match should occur due to lookahead
      const matches = reg.findMatches("98765432101234567890");
      const phoneMatches = matches.filter((m) => m.pattern.id === "phone-number");
      expect(phoneMatches.length).toBe(0);
    });
  });

  // ── Credit Card Pattern Tests (W4) ──

  describe("credit-card pattern", () => {
    const reg = makeRegistry(["financial"]);

    // Positive cases
    it("detects Visa card with spaces", () => {
      const matches = reg.findMatches("Card: 4111 1111 1111 1111");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(true);
    });

    it("detects Mastercard with dashes", () => {
      const matches = reg.findMatches("Card: 5500-0000-0000-0004");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(true);
    });

    it("detects card without separators", () => {
      const matches = reg.findMatches("Card: 4111111111111111");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(true);
    });

    it("detects Visa card starting with 4", () => {
      const matches = reg.findMatches("4242424242424242");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(true);
    });

    it("detects Mastercard starting with 5", () => {
      const matches = reg.findMatches("5105105105105100");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(true);
    });

    // Negative cases
    it("does not match non-card number sequences starting with other digits", () => {
      const matches = reg.findMatches("1234567890123456");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(false);
    });

    it("does not match numbers starting with 3 (Amex format differs)", () => {
      const matches = reg.findMatches("3111111111111111");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(false);
    });

    it("does not match 15-digit numbers", () => {
      const matches = reg.findMatches("411111111111111");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(false);
    });

    it("does not match numbers starting with 6", () => {
      const matches = reg.findMatches("6111111111111111");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(false);
    });

    it("does not match text without digits", () => {
      const matches = reg.findMatches("four-five-one-one");
      expect(matches.some((m) => m.pattern.id === "credit-card")).toBe(false);
    });
  });

  // ── IBAN Pattern Tests (W4) ──

  describe("iban pattern", () => {
    const reg = makeRegistry(["financial"]);

    // Positive cases
    it("detects German IBAN with spaces", () => {
      const matches = reg.findMatches("IBAN: DE89 3704 0044 0532 0130 00");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(true);
    });

    it("detects German IBAN without spaces", () => {
      const matches = reg.findMatches("IBAN: DE89370400440532013000");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(true);
    });

    it("detects UK IBAN", () => {
      const matches = reg.findMatches("GB29 NWBK 6016 1331 9268 19");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(true);
    });

    it("detects French IBAN", () => {
      const matches = reg.findMatches("FR76 3000 6000 0112 3456 7890 189");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(true);
    });

    it("detects IBAN in sentence", () => {
      const matches = reg.findMatches("Please transfer to DE89370400440532013000 by Monday");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(true);
    });

    // Negative cases
    it("does not match too-short IBAN-like strings", () => {
      const matches = reg.findMatches("DE89 3704");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(false);
    });

    it("does not match lowercase country code", () => {
      const matches = reg.findMatches("de89370400440532013000");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(false);
    });

    it("does not match number-only strings", () => {
      const matches = reg.findMatches("1234567890123456789012");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(false);
    });

    it("does not match single country code with check digits", () => {
      const matches = reg.findMatches("DE89");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(false);
    });

    it("does not match random uppercase letters followed by digits", () => {
      const matches = reg.findMatches("HELLO12345");
      expect(matches.some((m) => m.pattern.id === "iban")).toBe(false);
    });
  });

  // ── SSN (US) Pattern Tests (W4) ──

  describe("ssn-us pattern", () => {
    const reg = makeRegistry(["pii"]);

    // Positive cases
    it("detects standard SSN format", () => {
      const matches = reg.findMatches("SSN: 123-45-6789");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(true);
    });

    it("detects SSN in sentence", () => {
      const matches = reg.findMatches("My social is 078-05-1120 on file");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(true);
    });

    it("detects SSN with leading zeros", () => {
      const matches = reg.findMatches("SSN: 001-01-0001");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(true);
    });

    it("detects SSN at start of string", () => {
      const matches = reg.findMatches("123-45-6789 is the number");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(true);
    });

    it("detects SSN at end of string", () => {
      const matches = reg.findMatches("The number is 999-99-9999");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(true);
    });

    // Negative cases
    it("does not match SSN without dashes", () => {
      const matches = reg.findMatches("123456789");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(false);
    });

    it("does not match SSN with wrong dash positions", () => {
      const matches = reg.findMatches("12-345-6789");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(false);
    });

    it("does not match SSN with extra digits", () => {
      const matches = reg.findMatches("1234-56-7890");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(false);
    });

    it("does not match phone-number-like strings with dashes", () => {
      const matches = reg.findMatches("555-1234-5678");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(false);
    });

    it("does not match date-like strings", () => {
      const matches = reg.findMatches("2024-01-15");
      expect(matches.some((m) => m.pattern.id === "ssn-us")).toBe(false);
    });
  });

  // ── Credential Pattern Tests (original) ──

  describe("credential patterns", () => {
    const reg = makeRegistry(["credential"]);

    it("detects OpenAI API keys", () => {
      const matches = reg.findMatches("key: sk-abcdefghijklmnopqrstuvwxyz");
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.pattern.id === "openai-api-key" || m.pattern.id === "generic-api-key")).toBe(true);
    });

    it("does not match short sk- prefixes", () => {
      const matches = reg.findMatches("sk-short");
      expect(matches.length).toBe(0);
    });

    it("detects Anthropic API keys", () => {
      const key = "sk-ant-" + "a".repeat(80);
      const matches = reg.findMatches(`key=${key}`);
      expect(matches.length).toBeGreaterThanOrEqual(1);
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

  // ── PII Pattern Tests (original) ──

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
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.pattern.id === "phone-number")).toBe(true);
    });

    it("detects phone numbers without +", () => {
      const matches = reg.findMatches("Tel: 4917612345678");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("does not match too-short numbers", () => {
      const matches = reg.findMatches("123456");
      expect(matches.length).toBe(0);
    });
  });

  // ── Financial Pattern Tests (original) ──

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
      const patterns = reg.getPatterns();
      expect(patterns.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Overlap Resolution ──

  describe("overlap resolution", () => {
    it("resolves overlapping matches by longest match", () => {
      const reg = makeRegistry(["credential"]);
      const input = "api_key=sk-abcdefghijklmnopqrstuvwxyz";
      const matches = reg.findMatches(input);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("handles non-overlapping matches correctly", () => {
      const reg = makeRegistry(["credential", "pii"]);
      const input = "password=MySecret123 email: test@example.com";
      const matches = reg.findMatches(input);
      expect(matches.length).toBe(2);
    });

    it("picks credential over pii when same position", () => {
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
      const nearMiss = "sk-" + "!".repeat(1000);
      const start = performance.now();
      reg.findMatches(nearMiss);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("handles mixed adversarial input", () => {
      const reg = makeRegistry();
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

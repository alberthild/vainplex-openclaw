import { describe, it, expect, beforeEach } from "vitest";
import { redactText, redactChain } from "../../src/trace-analyzer/redactor.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../src/trace-analyzer/chain-reconstructor.js";

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000;
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

function makeChain(
  events: NormalizedEvent[],
  overrides: Partial<ConversationChain> = {},
): ConversationChain {
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    id: `chain-${events[0]?.seq ?? 0}`,
    agent: events[0]?.agent ?? "main",
    session: events[0]?.session ?? "test-session",
    startTs: events[0]?.ts ?? 0,
    endTs: events[events.length - 1]?.ts ?? 0,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

beforeEach(() => resetCounters());

// ---- Tests ----

describe("redactText()", () => {
  it("redacts OpenAI-style API keys (sk-...)", () => {
    const text = "Using key sk-abc1234567890ABCDEFGHIJKLMNOPqrstuv for the request";
    const result = redactText(text);
    expect(result).toContain("[REDACTED_API_KEY]");
    expect(result).not.toContain("sk-abc123");
  });

  it("redacts Stripe-style API keys (pk_live_...)", () => {
    const text = "Stripe key: pk_live_abc1234567890ABCDEFGHIJKLMNOPqrstuv";
    const result = redactText(text);
    expect(result).toContain("[REDACTED_API_KEY]");
    expect(result).not.toContain("pk_live_abc");
  });

  it("redacts Bearer tokens", () => {
    const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc123def456";
    const result = redactText(text);
    expect(result).toContain("Bearer [REDACTED_TOKEN]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc123def456");
  });

  it("redacts passwords in URLs", () => {
    const text = "postgres://admin:s3cretP@ssw0rd@db.example.com:5432/mydb";
    const result = redactText(text);
    expect(result).toContain("://admin:[REDACTED]@");
    expect(result).not.toContain("s3cretP@ssw0rd");
  });

  it("redacts PEM key blocks", () => {
    const text = `Here is the key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWpF9tklB5EsKRn0j1L
AnotherLineOfBase64Data
-----END RSA PRIVATE KEY-----
Done.`;
    const result = redactText(text);
    expect(result).toContain("[REDACTED_PEM_BLOCK]");
    expect(result).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("redacts environment variable values (PASSWORD=...)", () => {
    const text = "export DB_PASSWORD=mySuperSecret123 and TOKEN=abc987xyz";
    const result = redactText(text);
    expect(result).toContain("PASSWORD=[REDACTED]");
    expect(result).toContain("TOKEN=[REDACTED]");
    expect(result).not.toContain("mySuperSecret123");
    expect(result).not.toContain("abc987xyz");
  });

  it("redacts GitHub tokens (ghp_...)", () => {
    const text = "Using token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234 for auth";
    const result = redactText(text);
    expect(result).toContain("[REDACTED_GH_TOKEN]");
    expect(result).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const text = `Token: ${jwt}`;
    const result = redactText(text);
    expect(result).toContain("[REDACTED_JWT]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0");
  });

  it("does NOT redact normal text", () => {
    const text = "The server is running on port 8080 and serving 150 requests per second";
    const result = redactText(text);
    expect(result).toBe(text);
  });

  it("applies custom patterns from config", () => {
    const text = "Internal project code: PROJ-12345-SECRET and more text";
    const result = redactText(text, ["PROJ-\\d+-SECRET"]);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("PROJ-12345-SECRET");
  });

  it("skips invalid custom regex without crashing", () => {
    const text = "Some normal text here";
    const result = redactText(text, ["[invalid(regex"]);
    expect(result).toBe("Some normal text here");
  });

  it("handles empty string", () => {
    expect(redactText("")).toBe("");
  });

  it("handles text with multiple credential types", () => {
    const text = "KEY=sk-abc12345678901234567890abcdef and URL postgres://user:pass@host and TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234";
    const result = redactText(text);
    expect(result).not.toContain("sk-abc");
    expect(result).not.toContain("pass@host");
    expect(result).not.toContain("ghp_ABCDEF");
  });
});

describe("redactChain()", () => {
  it("redacts content in msg.in events", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Use key sk-abcdefghij1234567890klmnopqrs" }),
    ]);

    const redacted = redactChain(chain);
    expect(redacted.events[0].payload.content).toContain("[REDACTED_API_KEY]");
    expect(redacted.events[0].payload.content).not.toContain("sk-abcdefghij");
  });

  it("redacts toolError in tool.result events", () => {
    const chain = makeChain([
      makeEvent("tool.result", {
        toolName: "exec",
        toolError: "Failed: PASSWORD=supersecret123",
      }),
    ]);

    const redacted = redactChain(chain);
    expect(redacted.events[0].payload.toolError).toContain("PASSWORD=[REDACTED]");
    expect(redacted.events[0].payload.toolError).not.toContain("supersecret123");
  });

  it("redacts nested toolResult objects", () => {
    const chain = makeChain([
      makeEvent("tool.result", {
        toolName: "exec",
        toolResult: { output: "SECRET=abc123hidden", exitCode: 0 },
      }),
    ]);

    const redacted = redactChain(chain);
    const result = redacted.events[0].payload.toolResult as Record<string, unknown>;
    expect(JSON.stringify(result)).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("abc123hidden");
  });

  it("redacts toolParams values", () => {
    const chain = makeChain([
      makeEvent("tool.call", {
        toolName: "exec",
        toolParams: { command: "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuv123456' http://api.example.com" },
      }),
    ]);

    const redacted = redactChain(chain);
    const params = redacted.events[0].payload.toolParams!;
    expect(String(params.command)).toContain("[REDACTED_TOKEN]");
  });

  it("does NOT mutate the original chain", () => {
    const original = makeChain([
      makeEvent("msg.in", { content: "PASSWORD=mysecret" }),
    ]);

    const originalContent = original.events[0].payload.content;
    redactChain(original);
    expect(original.events[0].payload.content).toBe(originalContent);
  });

  it("applies custom patterns when provided", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Internal ID: ACME-99999" }),
    ]);

    const redacted = redactChain(chain, ["ACME-\\d+"]);
    expect(redacted.events[0].payload.content).toContain("[REDACTED]");
    expect(redacted.events[0].payload.content).not.toContain("ACME-99999");
  });
});

import { describe, expect, it } from "vitest";
import { createRedactor } from "../src/audit-redactor.js";
import type { AuditContext } from "../src/types.js";

function makeContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main",
    ...overrides,
  };
}

describe("createRedactor", () => {
  it("should redact sensitive keys in toolParams", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({
      toolParams: {
        command: "safe-value",
        password: "secret123",
        token: "abc",
        apiKey: "key123",
      },
    });
    const result = redact(ctx);
    expect(result.toolParams?.["command"]).toBe("safe-value");
    expect(result.toolParams?.["password"]).toBe("[REDACTED]");
    expect(result.toolParams?.["token"]).toBe("[REDACTED]");
    expect(result.toolParams?.["apiKey"]).toBe("[REDACTED]");
  });

  it("should redact nested objects", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({
      toolParams: {
        config: { secret: "hidden", name: "visible" },
      },
    });
    const result = redact(ctx);
    const config = result.toolParams?.["config"] as Record<string, unknown>;
    expect(config["secret"]).toBe("[REDACTED]");
    expect(config["name"]).toBe("visible");
  });

  it("should truncate long messages", () => {
    const redact = createRedactor([]);
    const longMessage = "a".repeat(600);
    const ctx = makeContext({ messageContent: longMessage });
    const result = redact(ctx);
    expect(result.messageContent?.length).toBeLessThan(600);
    expect(result.messageContent).toContain("[TRUNCATED]");
  });

  it("should not truncate short messages", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({ messageContent: "short" });
    const result = redact(ctx);
    expect(result.messageContent).toBe("short");
  });

  it("should apply custom patterns", () => {
    const redact = createRedactor(["private_.*"]);
    const ctx = makeContext({
      toolParams: {
        private_data: "should-be-redacted",
        public_data: "visible",
      },
    });
    const result = redact(ctx);
    expect(result.toolParams?.["private_data"]).toBe("[REDACTED]");
    expect(result.toolParams?.["public_data"]).toBe("visible");
  });

  it("should handle missing toolParams", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({ toolParams: undefined });
    const result = redact(ctx);
    expect(result.toolParams).toBeUndefined();
  });

  it("should handle missing messageContent", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({ messageContent: undefined });
    const result = redact(ctx);
    expect(result.messageContent).toBeUndefined();
  });

  it("should handle invalid custom regex gracefully", () => {
    const redact = createRedactor(["[invalid"]);
    const ctx = makeContext({ toolParams: { test: "value" } });
    const result = redact(ctx);
    expect(result.toolParams?.["test"]).toBe("value");
  });

  it("should be case-insensitive for sensitive keys", () => {
    const redact = createRedactor([]);
    const ctx = makeContext({
      toolParams: { Password: "hidden", TOKEN: "hidden" },
    });
    const result = redact(ctx);
    expect(result.toolParams?.["Password"]).toBe("[REDACTED]");
    expect(result.toolParams?.["TOKEN"]).toBe("[REDACTED]");
  });
});

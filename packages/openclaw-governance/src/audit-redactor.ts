import type { AuditContext } from "./types.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "credential",
  "auth",
  "authorization",
  "cookie",
  "session",
]);

const MAX_MESSAGE_LENGTH = 500;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redactValue(
  key: string,
  value: unknown,
  customPatterns: RegExp[],
): unknown {
  if (isSensitiveKey(key)) return "[REDACTED]";

  if (typeof value === "string") {
    for (const pattern of customPatterns) {
      if (pattern.test(key) || pattern.test(value)) {
        return "[REDACTED]";
      }
    }
  }

  return value;
}

function redactRecord(
  obj: Record<string, unknown>,
  customPatterns: RegExp[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactRecord(
        value as Record<string, unknown>,
        customPatterns,
      );
    } else {
      result[key] = redactValue(key, value, customPatterns);
    }
  }
  return result;
}

function truncateMessage(content: string | undefined): string | undefined {
  if (!content) return content;
  if (content.length <= MAX_MESSAGE_LENGTH) return content;
  return content.slice(0, MAX_MESSAGE_LENGTH) + " [TRUNCATED]";
}

export function createRedactor(
  customPatterns: string[],
): (ctx: AuditContext) => AuditContext {
  const compiled = customPatterns
    .map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);

  return (ctx: AuditContext): AuditContext => {
    const redacted = { ...ctx };

    if (redacted.toolParams) {
      redacted.toolParams = redactRecord(
        redacted.toolParams,
        compiled,
      );
    }

    redacted.messageContent = truncateMessage(redacted.messageContent);

    return redacted;
  };
}

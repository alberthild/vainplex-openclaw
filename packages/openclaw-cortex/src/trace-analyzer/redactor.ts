// ============================================================
// Trace Analyzer — Credential Redaction Pipeline
// ============================================================
//
// Redacts credentials, API keys, passwords, tokens, and other
// sensitive data from traces BEFORE they are sent to LLMs or
// written to disk. Implements R-011, R-035, R-036.
// ============================================================

import type { NormalizedPayload } from "./events.js";
import type { ConversationChain } from "./chain-reconstructor.js";

/** A built-in redaction rule: a pattern and its replacement. */
type RedactRule = {
  readonly pattern: RegExp;
  readonly replacement: string;
};

/**
 * Built-in redaction patterns covering common credential formats.
 * Recreated per call to avoid lastIndex state issues with global regexes.
 */
function builtinRules(): RedactRule[] {
  return [
    // API keys: OpenAI (sk-...), Stripe (pk_live_/pk_test_)
    {
      pattern: /\b(?:sk-|pk_(?:live|test)_)[A-Za-z0-9_-]{20,}/g,
      replacement: "[REDACTED_API_KEY]",
    },
    // Bearer tokens
    {
      pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g,
      replacement: "Bearer [REDACTED_TOKEN]",
    },
    // Passwords in URLs: ://user:password@host
    {
      pattern: /:\/\/([^:\s]+):([^@\s]+)@/g,
      replacement: "://$1:[REDACTED]@",
    },
    // Environment variable values with sensitive names
    {
      pattern: /((?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY)\s*=\s*)\S+/gi,
      replacement: "$1[REDACTED]",
    },
    // PEM key blocks (private keys, RSA keys, etc.)
    {
      pattern: /-----BEGIN [A-Z ]*(?:PRIVATE |RSA )?KEY-----[\s\S]*?-----END [A-Z ]*KEY-----/g,
      replacement: "[REDACTED_PEM_BLOCK]",
    },
    // GitHub tokens (ghp_, ghs_)
    {
      pattern: /\bgh[ps]_[A-Za-z0-9]{36,}/g,
      replacement: "[REDACTED_GH_TOKEN]",
    },
    // JWT tokens (three base64url segments separated by dots)
    {
      pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
      replacement: "[REDACTED_JWT]",
    },
  ];
}

/**
 * Redact sensitive data from a text string.
 *
 * Applies built-in patterns first, then custom patterns from config.
 * Invalid custom regex patterns are silently skipped.
 */
export function redactText(text: string, customPatterns: string[] = []): string {
  let result = text;

  for (const { pattern, replacement } of builtinRules()) {
    result = result.replace(pattern, replacement);
  }

  for (const patternStr of customPatterns) {
    try {
      const regex = new RegExp(patternStr, "g");
      result = result.replace(regex, "[REDACTED]");
    } catch {
      // Invalid regex — skip silently
    }
  }

  return result;
}

/**
 * Deep-redact an unknown value.
 * Strings → direct redact. Objects → JSON stringify, redact, parse back.
 * Primitives pass through unchanged.
 */
function redactUnknown(value: unknown, customPatterns: string[]): unknown {
  if (typeof value === "string") return redactText(value, customPatterns);
  if (typeof value === "object" && value !== null) {
    const str = JSON.stringify(value);
    const redacted = redactText(str, customPatterns);
    try {
      return JSON.parse(redacted) as unknown;
    } catch {
      return redacted;
    }
  }
  return value;
}

/** Redact all text fields in a NormalizedPayload. */
function redactPayload(
  payload: NormalizedPayload,
  customPatterns: string[],
): NormalizedPayload {
  const result = { ...payload };

  if (result.content !== undefined) {
    result.content = redactText(result.content, customPatterns);
  }
  if (result.toolError !== undefined) {
    result.toolError = redactText(result.toolError, customPatterns);
  }
  if (result.toolResult !== undefined) {
    result.toolResult = redactUnknown(result.toolResult, customPatterns);
  }
  if (result.toolParams !== undefined) {
    const redactedParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.toolParams)) {
      redactedParams[key] = redactUnknown(value, customPatterns);
    }
    result.toolParams = redactedParams;
  }
  if (result.from !== undefined) {
    result.from = redactText(result.from, customPatterns);
  }
  if (result.error !== undefined) {
    result.error = redactText(result.error, customPatterns);
  }
  if (result.prompt !== undefined) {
    result.prompt = redactText(result.prompt, customPatterns);
  }

  return result;
}

/**
 * Redact all text fields in a ConversationChain.
 * Returns a new chain with redacted payloads — does NOT mutate the original.
 */
export function redactChain(
  chain: ConversationChain,
  customPatterns: string[] = [],
): ConversationChain {
  return {
    ...chain,
    events: chain.events.map(event => ({
      ...event,
      payload: redactPayload(event.payload, customPatterns),
    })),
  };
}

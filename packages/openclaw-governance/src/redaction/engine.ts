/**
 * Redaction Scanning Engine (RFC-007 §2, §5.1)
 *
 * Performs recursive deep-scan of objects and strings for sensitive
 * data patterns. Handles:
 * - Deep object traversal (nested objects and arrays)
 * - JSON-within-string detection and recursive scanning
 * - Circular reference protection
 * - Performance budgets (100KB < 5ms, 1MB < 50ms)
 */

import type { RedactionCategory } from "../types.js";
import type { PatternMatch, PatternRegistry } from "./registry.js";
import type { RedactionVault } from "./vault.js";

/** Maximum depth for recursive scanning */
const MAX_DEPTH = 20;

/** Maximum string length to attempt JSON parse on */
const MAX_JSON_PARSE_LENGTH = 1_000_000;

export type ScanResult = {
  /** The redacted output (modified in-place semantics via deep clone) */
  output: unknown;
  /** Number of redactions performed */
  redactionCount: number;
  /** Categories of redacted items */
  categories: Set<RedactionCategory>;
  /** Processing time in milliseconds */
  elapsedMs: number;
};

/**
 * The scanning engine applies patterns from the registry to input data,
 * stores originals in the vault, and replaces matches with placeholders.
 */
export class RedactionEngine {
  private readonly registry: PatternRegistry;
  private readonly vault: RedactionVault;

  constructor(
    registry: PatternRegistry,
    vault: RedactionVault,
    _logger: { info: (msg: string) => void },
  ) {
    this.registry = registry;
    this.vault = vault;
  }

  /**
   * Scan and redact an arbitrary value (string, object, array).
   * Returns a new value with sensitive data replaced by placeholders.
   */
  scan(input: unknown): ScanResult {
    const start = performance.now();
    const seen = new WeakSet<object>();
    const categories = new Set<RedactionCategory>();
    let redactionCount = 0;

    const onRedaction = (category: RedactionCategory): void => {
      redactionCount++;
      categories.add(category);
    };

    const output = this.scanValue(input, seen, 0, onRedaction);
    const elapsedMs = performance.now() - start;

    return { output, redactionCount, categories, elapsedMs };
  }

  /**
   * Scan a string only (no deep object traversal).
   * Used for Layer 2 outbound message scanning.
   */
  scanString(input: string): { output: string; redactionCount: number; categories: Set<RedactionCategory> } {
    const categories = new Set<RedactionCategory>();
    let redactionCount = 0;

    const onRedaction = (category: RedactionCategory): void => {
      redactionCount++;
      categories.add(category);
    };

    const output = this.redactString(input, onRedaction);
    return { output, redactionCount, categories };
  }

  private scanValue(
    value: unknown,
    seen: WeakSet<object>,
    depth: number,
    onRedaction: (category: RedactionCategory) => void,
  ): unknown {
    if (depth > MAX_DEPTH) return value;

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      return this.scanStringValue(value, seen, depth, onRedaction);
    }

    if (typeof value !== "object") return value;

    // Circular reference protection
    const obj = value as object;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.scanValue(item, seen, depth + 1, onRedaction),
      );
    }

    // Regular object
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = this.scanValue(val, seen, depth + 1, onRedaction);
    }
    return result;
  }

  /**
   * Scan a string value. If it looks like JSON, parse and recursively scan.
   * Then apply pattern matching on the final string.
   */
  private scanStringValue(
    value: string,
    seen: WeakSet<object>,
    depth: number,
    onRedaction: (category: RedactionCategory) => void,
  ): unknown {
    // Try to detect and scan JSON-within-string
    if (value.length <= MAX_JSON_PARSE_LENGTH && looksLikeJson(value)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
          const scanned = this.scanValue(parsed, seen, depth + 1, onRedaction);
          // Return the re-serialized JSON string (with redactions applied within)
          return JSON.stringify(scanned);
        }
      } catch {
        // Not valid JSON, fall through to string scanning
      }
    }

    return this.redactString(value, onRedaction);
  }

  /**
   * Apply all patterns to a string, replacing matches with vault placeholders.
   */
  private redactString(
    input: string,
    onRedaction: (category: RedactionCategory) => void,
  ): string {
    const matches = this.registry.findMatches(input);
    if (matches.length === 0) return input;

    return this.applyReplacements(input, matches, onRedaction);
  }

  /**
   * Apply replacements from end to start to preserve positions.
   */
  private applyReplacements(
    input: string,
    matches: PatternMatch[],
    onRedaction: (category: RedactionCategory) => void,
  ): string {
    // Sort matches by start position descending (replace from end first)
    const sorted = [...matches].sort((a, b) => b.start - a.start);

    let result = input;
    for (const m of sorted) {
      const placeholder = this.vault.store(m.match, m.pattern.category);
      result = result.slice(0, m.start) + placeholder + result.slice(m.end);
      onRedaction(m.pattern.category);
    }

    return result;
  }
}

/**
 * Quick heuristic check: does this string look like it could be JSON?
 * Avoids expensive JSON.parse on obviously non-JSON strings.
 */
function looksLikeJson(s: string): boolean {
  const trimmed = s.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

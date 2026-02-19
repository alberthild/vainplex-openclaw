// ============================================================
// Trace Analyzer — Shared Utilities
// ============================================================
//
// Shared helper functions used across multiple trace-analyzer
// modules. Extracted to eliminate duplication (C12, C13, C14).
// ============================================================

import type { SignalPatternSet } from "./signals/lang/registry.js";

/**
 * Truncate a string to maxLen characters, appending "…" if truncated.
 */
export function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}

/**
 * Check if a tool result event represents an error.
 */
export function isToolError(payload: { toolError?: string; toolIsError?: boolean }): boolean {
  return Boolean(payload.toolError) || payload.toolIsError === true;
}

/**
 * Check if a text looks like a question using language-specific patterns.
 */
export function isQuestion(text: string, patterns: SignalPatternSet): boolean {
  return patterns.question.indicators.some(p => p.test(text));
}

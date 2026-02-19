/**
 * Backward-compatible shim — delegates to PatternRegistry.
 * All existing imports (getPatterns, detectMood, isNoiseTopic,
 * HIGH_IMPACT_KEYWORDS, MOOD_PATTERNS) continue to work identically.
 */

import type { Mood } from "./types.js";
import { PatternRegistry } from "./patterns/registry.js";
import type { PatternSet } from "./patterns/types.js";

export type { PatternSet };
export type PatternLanguage = "en" | "de" | "both" | string | string[];

// ── Internal helpers ─────────────────────────────────────

function resolveLanguageCodes(language: PatternLanguage): string[] {
  if (language === "both") return ["en", "de"];
  if (typeof language === "string") return [language];
  if (Array.isArray(language)) return language;
  return ["en", "de"];
}

function buildRegistry(language: PatternLanguage): PatternRegistry {
  const registry = new PatternRegistry();
  registry.loadSync(resolveLanguageCodes(language));
  return registry;
}

// Cache for "both" — the default used by detectMood, isNoiseTopic, exports
const _bothRegistry = buildRegistry("both");

// ── Public API (unchanged signatures) ────────────────────

/**
 * Get pattern set for the configured language.
 * "both" merges EN + DE patterns (backward compat).
 */
export function getPatterns(language: PatternLanguage): PatternSet {
  if (language === "both") return _bothRegistry.getPatterns();
  return buildRegistry(language).getPatterns();
}

/**
 * Detect mood from text. Scans for all mood patterns; last match position wins.
 * Returns "neutral" if no mood pattern matches.
 */
export function detectMood(text: string): Mood {
  if (!text) return "neutral";

  const patterns = _bothRegistry.getMoodPatterns();
  let lastMood: Mood = "neutral";
  let lastPos = -1;

  for (const [mood, pattern] of Object.entries(patterns)) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match.index > lastPos) {
        lastPos = match.index;
        lastMood = mood as Mood;
      }
    }
  }

  return lastMood;
}

/**
 * Check if a topic candidate is noise (too short, blacklisted, or garbage).
 */
export function isNoiseTopic(topic: string): boolean {
  const blacklist = _bothRegistry.getBlacklist();
  const trimmed = topic.trim();

  if (trimmed.length < 4) return true;

  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 1 && blacklist.has(words[0])) return true;
  if (words.every(w => blacklist.has(w) || w.length < 3)) return true;

  if (/^(ich|i|we|wir|du|er|sie|he|she|it|es|nichts|nothing|etwas|something)\s/i.test(trimmed)) {
    return true;
  }
  if (trimmed.includes("\n") || trimmed.length > 60) return true;
  return false;
}

/** High-impact keywords for decision impact inference. */
export const HIGH_IMPACT_KEYWORDS = _bothRegistry.getHighImpactKeywords();

/** Mood patterns (merged EN+DE + universal base). */
export const MOOD_PATTERNS = _bothRegistry.getMoodPatterns();

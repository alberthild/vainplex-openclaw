import type { Mood } from "../types.js";

/** A complete language pack for pattern-based detection. */
export type LanguagePack = {
  /** ISO 639-1 code (e.g., "en", "de", "fr", "zh") */
  code: string;
  /** Name in the language itself (e.g., "English", "Deutsch", "Français") */
  name: string;
  /** English name for logs (e.g., "English", "German", "French") */
  nameEn: string;

  /** Core detection patterns */
  patterns: {
    /** Patterns matching decision-indicating phrases */
    decision: RegExp[];
    /** Patterns matching thread closure phrases */
    close: RegExp[];
    /** Patterns matching blocked/waiting states */
    wait: RegExp[];
    /** Patterns matching topic shifts — MUST have capture group 1 */
    topic: RegExp[];
  };

  /** Words to filter out as noise when extracting thread titles */
  topicBlacklist: string[];

  /** Keywords indicating high-impact decisions */
  highImpactKeywords: string[];

  /**
   * Language-specific mood words (optional).
   * Merged with universal base patterns (emoji).
   */
  moodPatterns?: Partial<Record<Exclude<Mood, "neutral">, RegExp>>;

  /**
   * Pronoun/noise prefixes for topic filtering (optional).
   * These get compiled into a prefix regex for isNoiseTopic().
   */
  noisePrefixes?: string[];
};

/** Merged pattern set — result of combining multiple language packs. */
export type PatternSet = {
  decision: RegExp[];
  close: RegExp[];
  wait: RegExp[];
  topic: RegExp[];
};

/** Custom pattern config from user. */
export type CustomPatternConfig = {
  decision?: string[];
  close?: string[];
  wait?: string[];
  topic?: string[];
  topicBlacklist?: string[];
  highImpactKeywords?: string[];
  mode?: "extend" | "override";
};

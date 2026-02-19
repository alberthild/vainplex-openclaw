// ============================================================
// Signal Pattern Registry
// ============================================================
//
// Manages per-language signal pattern packs for the
// trace analyzer's language-sensitive detectors.
// Same architectural conventions as src/patterns/registry.ts:
// - EN/DE loaded synchronously (always available)
// - Other languages loaded asynchronously on demand
// - Merged patterns cached until invalidation
// ============================================================

import type { SignalLanguagePack } from "./types.js";
import { SIGNAL_LANG_EN } from "./signal-lang-en.js";
import { SIGNAL_LANG_DE } from "./signal-lang-de.js";

/** Merged signal pattern set — result of combining loaded packs. */
export type SignalPatternSet = {
  correction: { indicators: RegExp[]; shortNegatives: RegExp[] };
  question: { indicators: RegExp[] };
  dissatisfaction: {
    indicators: RegExp[];
    satisfactionOverrides: RegExp[];
    resolutionIndicators: RegExp[];
  };
  completion: { claims: RegExp[] };
  systemState: { claims: RegExp[]; opinionExclusions: RegExp[] };
};

/** Universal patterns — language-independent (emoji/symbols/punctuation). */
const UNIVERSAL_PATTERNS: {
  question: RegExp[];
  completion: RegExp[];
  satisfaction: RegExp[];
} = {
  question: [/\?\s*$/m],
  completion: [/[✅✓☑]/],
  satisfaction: [/[👍🎉💯❤️]/],
};

/** Map of built-in language packs available synchronously. */
const SYNC_PACKS: Record<string, SignalLanguagePack> = {
  en: SIGNAL_LANG_EN,
  de: SIGNAL_LANG_DE,
};

/** Lazy loaders for additional languages. */
const ASYNC_LOADERS: Record<string, () => Promise<SignalLanguagePack>> = {
  fr: async () => (await import("./signal-lang-fr.js")).default,
  es: async () => (await import("./signal-lang-es.js")).default,
  pt: async () => (await import("./signal-lang-pt.js")).default,
  it: async () => (await import("./signal-lang-it.js")).default,
  zh: async () => (await import("./signal-lang-zh.js")).default,
  ja: async () => (await import("./signal-lang-ja.js")).default,
  ko: async () => (await import("./signal-lang-ko.js")).default,
  ru: async () => (await import("./signal-lang-ru.js")).default,
};

/** All built-in signal language codes. */
export const BUILTIN_SIGNAL_LANGUAGES = [
  "en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "ru",
];

export class SignalPatternRegistry {
  private packs: SignalLanguagePack[] = [];
  private cached: SignalPatternSet | null = null;

  /** Async load — supports all 10 languages including lazy-loaded ones. */
  async load(codes: string[]): Promise<void> {
    this.packs = [];
    this.cached = null;

    for (const code of codes) {
      const lc = code.toLowerCase();
      if (SYNC_PACKS[lc]) {
        this.packs.push(SYNC_PACKS[lc]);
      } else if (ASYNC_LOADERS[lc]) {
        this.packs.push(await ASYNC_LOADERS[lc]());
      }
    }
  }

  /** Synchronous load — works for EN/DE and any runtime-registered packs. */
  loadSync(codes: string[]): void {
    this.packs = [];
    this.cached = null;

    for (const code of codes) {
      const lc = code.toLowerCase();
      if (SYNC_PACKS[lc]) {
        this.packs.push(SYNC_PACKS[lc]);
      }
    }
  }

  /** Register a custom signal language pack at runtime. */
  registerSignalLanguagePack(pack: SignalLanguagePack): void {
    this.packs = this.packs.filter(p => p.code !== pack.code);
    this.packs.push(pack);
    this.cached = null;
  }

  /** Get merged patterns (cached). Includes universal patterns. */
  getPatterns(): SignalPatternSet {
    if (this.cached) return this.cached;
    this.cached = this.merge();
    return this.cached;
  }

  /** Get loaded language codes. */
  getLoadedLanguages(): string[] {
    return this.packs.map(p => p.code);
  }

  private merge(): SignalPatternSet {
    const merged: SignalPatternSet = {
      correction: { indicators: [], shortNegatives: [] },
      question: { indicators: [...UNIVERSAL_PATTERNS.question] },
      dissatisfaction: {
        indicators: [],
        satisfactionOverrides: [...UNIVERSAL_PATTERNS.satisfaction],
        resolutionIndicators: [],
      },
      completion: { claims: [...UNIVERSAL_PATTERNS.completion] },
      systemState: { claims: [], opinionExclusions: [] },
    };

    for (const pack of this.packs) {
      merged.correction.indicators.push(...pack.correction.indicators);
      merged.correction.shortNegatives.push(...pack.correction.shortNegatives);
      merged.question.indicators.push(...pack.question.indicators);
      merged.dissatisfaction.indicators.push(...pack.dissatisfaction.indicators);
      merged.dissatisfaction.satisfactionOverrides.push(
        ...pack.dissatisfaction.satisfactionOverrides,
      );
      merged.dissatisfaction.resolutionIndicators.push(
        ...pack.dissatisfaction.resolutionIndicators,
      );
      merged.completion.claims.push(...pack.completion.claims);
      merged.systemState.claims.push(...pack.systemState.claims);
      merged.systemState.opinionExclusions.push(
        ...pack.systemState.opinionExclusions,
      );
    }

    return merged;
  }
}

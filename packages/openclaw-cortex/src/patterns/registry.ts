import type { Mood } from "../types.js";
import type { LanguagePack, PatternSet, CustomPatternConfig } from "./types.js";
import { LANG_EN } from "./lang-en.js";
import { LANG_DE } from "./lang-de.js";

/** Universal mood patterns (emoji — language-independent). */
const BASE_MOOD: Record<Exclude<Mood, "neutral">, RegExp[]> = {
  frustrated: [/(?:wtf|argh)/i],
  excited: [/(?:🎯|🚀)/],
  tense: [/(?:⚠️|‼️)/],
  productive: [/(?:✅)/],
  exploratory: [/(?:🤔|💡)/],
};

/** Map of built-in language packs available synchronously. */
const SYNC_PACKS: Record<string, LanguagePack> = {
  en: LANG_EN,
  de: LANG_DE,
};

/** Lazy loaders for additional languages. */
const ASYNC_LOADERS: Record<string, () => Promise<LanguagePack>> = {
  fr: async () => (await import("./lang-fr.js")).default,
  es: async () => (await import("./lang-es.js")).default,
  pt: async () => (await import("./lang-pt.js")).default,
  it: async () => (await import("./lang-it.js")).default,
  zh: async () => (await import("./lang-zh.js")).default,
  ja: async () => (await import("./lang-ja.js")).default,
  ko: async () => (await import("./lang-ko.js")).default,
  ru: async () => (await import("./lang-ru.js")).default,
};

/** All built-in language codes. */
export const BUILTIN_LANGUAGES = [
  "en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "ru",
];

export class PatternRegistry {
  private packs: LanguagePack[] = [];
  private customConfig: CustomPatternConfig | null = null;
  private cachedPatterns: PatternSet | null = null;
  private cachedBlacklist: Set<string> | null = null;
  private cachedKeywords: string[] | null = null;
  private cachedMoodPatterns: Record<Exclude<Mood, "neutral">, RegExp> | null = null;
  private cachedNoisePrefixPattern: RegExp | null = null;

  /** Async load — supports all languages including lazy-loaded ones. */
  async load(codes: string[], custom?: CustomPatternConfig): Promise<void> {
    this.packs = [];
    this.customConfig = custom ?? null;
    this.invalidateCache();

    for (const code of codes) {
      if (SYNC_PACKS[code]) {
        this.packs.push(SYNC_PACKS[code]);
      } else if (ASYNC_LOADERS[code]) {
        this.packs.push(await ASYNC_LOADERS[code]());
      }
    }
  }

  /** Synchronous load — works for EN/DE and any runtime-registered packs. */
  loadSync(codes: string[], custom?: CustomPatternConfig): void {
    this.packs = [];
    this.customConfig = custom ?? null;
    this.invalidateCache();

    for (const code of codes) {
      if (SYNC_PACKS[code]) {
        this.packs.push(SYNC_PACKS[code]);
      }
    }
  }

  /** Register a language pack at runtime. */
  registerLanguagePack(pack: LanguagePack): void {
    this.packs = this.packs.filter(p => p.code !== pack.code);
    this.packs.push(pack);
    this.invalidateCache();
  }

  /** Get merged pattern set (cached). */
  getPatterns(): PatternSet {
    if (this.cachedPatterns) return this.cachedPatterns;

    const merged: PatternSet = { decision: [], close: [], wait: [], topic: [] };
    for (const pack of this.packs) {
      merged.decision.push(...pack.patterns.decision);
      merged.close.push(...pack.patterns.close);
      merged.wait.push(...pack.patterns.wait);
      merged.topic.push(...pack.patterns.topic);
    }

    if (this.customConfig) {
      this.applyCustomPatterns(merged);
    }

    this.cachedPatterns = merged;
    return merged;
  }

  /** Get merged topic blacklist (cached). */
  getBlacklist(): Set<string> {
    if (this.cachedBlacklist) return this.cachedBlacklist;
    const set = new Set<string>();
    for (const pack of this.packs) {
      for (const word of pack.topicBlacklist) set.add(word);
    }
    if (this.customConfig?.topicBlacklist) {
      for (const word of this.customConfig.topicBlacklist) set.add(word);
    }
    this.cachedBlacklist = set;
    return set;
  }

  /** Get merged high-impact keywords (cached, deduplicated). */
  getHighImpactKeywords(): string[] {
    if (this.cachedKeywords) return this.cachedKeywords;
    const set = new Set<string>();
    for (const pack of this.packs) {
      for (const kw of pack.highImpactKeywords) set.add(kw);
    }
    if (this.customConfig?.highImpactKeywords) {
      for (const kw of this.customConfig.highImpactKeywords) set.add(kw);
    }
    this.cachedKeywords = [...set];
    return this.cachedKeywords;
  }

  /** Get merged mood patterns (cached). */
  getMoodPatterns(): Record<Exclude<Mood, "neutral">, RegExp> {
    if (this.cachedMoodPatterns) return this.cachedMoodPatterns;

    const sources: Record<Exclude<Mood, "neutral">, RegExp[]> = {
      frustrated: [...BASE_MOOD.frustrated],
      excited: [...BASE_MOOD.excited],
      tense: [...BASE_MOOD.tense],
      productive: [...BASE_MOOD.productive],
      exploratory: [...BASE_MOOD.exploratory],
    };

    for (const pack of this.packs) {
      if (!pack.moodPatterns) continue;
      for (const [mood, pattern] of Object.entries(pack.moodPatterns)) {
        if (pattern) {
          sources[mood as Exclude<Mood, "neutral">].push(pattern);
        }
      }
    }

    const merged = {} as Record<Exclude<Mood, "neutral">, RegExp>;
    for (const [mood, patterns] of Object.entries(sources)) {
      const combined = patterns.map(p => p.source).join("|");
      merged[mood as Exclude<Mood, "neutral">] = new RegExp(combined, "i");
    }

    this.cachedMoodPatterns = merged;
    return merged;
  }

  /** Get noise prefix regex (cached). */
  getNoisePrefixPattern(): RegExp | null {
    if (this.cachedNoisePrefixPattern !== null) {
      return this.cachedNoisePrefixPattern;
    }

    const prefixes: string[] = [];
    for (const pack of this.packs) {
      if (pack.noisePrefixes) prefixes.push(...pack.noisePrefixes);
    }

    if (prefixes.length === 0) return null;
    const deduped = [...new Set(prefixes)];
    const pattern = new RegExp(`^(${deduped.join("|")})\\s`, "i");
    this.cachedNoisePrefixPattern = pattern;
    return pattern;
  }

  /** Get loaded language codes. */
  getLoadedLanguages(): string[] {
    return this.packs.map(p => p.code);
  }

  /** Compile custom pattern strings to RegExp. */
  private compileCustomStrings(strings: string[] | undefined): RegExp[] {
    if (!strings) return [];
    return strings
      .map(s => {
        try { return new RegExp(s, "i"); }
        catch { return null; }
      })
      .filter((r): r is RegExp => r !== null);
  }

  /** Apply custom patterns to merged set. */
  private applyCustomPatterns(merged: PatternSet): void {
    if (!this.customConfig) return;
    const cfg = this.customConfig;
    const compiled = {
      decision: this.compileCustomStrings(cfg.decision),
      close: this.compileCustomStrings(cfg.close),
      wait: this.compileCustomStrings(cfg.wait),
      topic: this.compileCustomStrings(cfg.topic),
    };

    if (cfg.mode === "override") {
      if (compiled.decision.length) merged.decision = compiled.decision;
      if (compiled.close.length) merged.close = compiled.close;
      if (compiled.wait.length) merged.wait = compiled.wait;
      if (compiled.topic.length) merged.topic = compiled.topic;
    } else {
      merged.decision.push(...compiled.decision);
      merged.close.push(...compiled.close);
      merged.wait.push(...compiled.wait);
      merged.topic.push(...compiled.topic);
    }
  }

  /** Invalidate all caches. */
  private invalidateCache(): void {
    this.cachedPatterns = null;
    this.cachedBlacklist = null;
    this.cachedKeywords = null;
    this.cachedMoodPatterns = null;
    this.cachedNoisePrefixPattern = null;
  }
}

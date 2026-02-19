# RFC-004: Multi-Language Pattern Support

| Field       | Value                              |
|-------------|-------------------------------------|
| RFC         | 004                                 |
| Title       | Multi-Language Pattern Support       |
| Status      | Draft                               |
| Author      | Atlas (Architecture Agent)           |
| Date        | 2026-02-19                           |
| Affects     | `patterns.ts`, `types.ts`, `config.ts`, `thread-tracker.ts`, `decision-tracker.ts` |

---

## 1. Problem Statement

Cortex currently supports only English and German via hardcoded regex arrays in `patterns.ts`. The `patternLanguage` config accepts `"en" | "de" | "both"`. All pattern constants, the topic blacklist, and high-impact keywords are defined in a single 130-line file with no extension points.

OpenClaw has a global user base. Users operating in French, Spanish, Portuguese, Italian, Russian, Chinese, Japanese, or Korean cannot benefit from Cortex's thread tracking, decision extraction, closure detection, or topic shift identification. Adding a language today requires forking the source.

This RFC defines an architecture that scales to 10+ languages, allows community contributions, supports user-defined custom patterns, and maintains backward compatibility — all without introducing runtime dependencies or LLM requirements.

---

## 2. Goals

1. Scale from 2 to 10+ languages without architectural changes.
2. Allow community contributors to add a language by adding a single file.
3. Allow users to define custom patterns in config without forking.
4. Maintain zero runtime dependencies and zero LLM dependency for core detection.
5. Preserve existing EN/DE behavior and pass all 298 existing tests unchanged.
6. Keep performance acceptable: < 2ms per message even with 10 languages loaded.

## 3. Non-Goals

1. Machine translation of patterns (we don't auto-translate EN patterns to other languages).
2. NLP/tokenization for CJK (we use regex; languages needing segmentation get adapted patterns).
3. Auto-detection of message language (users configure which languages to load).
4. Pattern quality scoring or validation tooling (future work).

---

## 4. Design Decisions

### 4.1 One File Per Language (Language Packs)

**Decision:** Each language is a self-contained TypeScript file exporting a `LanguagePack` object.

**Rationale:** A single-file-per-language approach makes contribution trivial. A contributor doesn't need to understand the registry, the merge logic, or any other language — they create one file conforming to a type contract. It also enables tree-shaking: unused language packs are never imported. JSON was considered but rejected because regex literals can't be expressed in JSON without a serialization layer, which would add complexity and hurt debuggability.

**Structure:**

```
src/
  patterns/
    types.ts          # LanguagePack type, PatternSet, registry types
    registry.ts       # Language registry + merging logic
    lang-en.ts        # English patterns (extracted from current patterns.ts)
    lang-de.ts        # German patterns (extracted from current patterns.ts)
    lang-fr.ts        # French patterns
    lang-es.ts        # Spanish patterns
    lang-pt.ts        # Portuguese patterns
    lang-it.ts        # Italian patterns
    lang-zh.ts        # Chinese patterns
    lang-ja.ts        # Japanese patterns
    lang-ko.ts        # Korean patterns
    lang-ru.ts        # Russian patterns
    index.ts          # Re-exports public API (backward-compat shim)
  patterns.ts         # Kept as thin re-export shim for backward compat
```

### 4.2 LanguagePack Type Contract

**Decision:** Every language file exports a single `LanguagePack` object with a fixed shape.

**Rationale:** A typed contract means TypeScript catches missing fields at compile time. Contributors get autocomplete. The registry can validate packs at load time without runtime type-checking libraries.

```typescript
export type LanguagePack = {
  /** ISO 639-1 language code */
  code: string;
  /** Human-readable name (in the language itself) */
  name: string;
  /** English name for logs/docs */
  nameEn: string;

  /** Detection patterns */
  patterns: {
    decision: RegExp[];
    close: RegExp[];
    wait: RegExp[];
    topic: RegExp[];   // MUST have capture group 1 for topic extraction
  };

  /** Words to filter out as thread titles */
  topicBlacklist: string[];

  /** Keywords indicating high-impact decisions */
  highImpactKeywords: string[];

  /** Mood pattern overrides (optional — only override if language has unique mood words) */
  moodPatterns?: Partial<Record<Exclude<Mood, "neutral">, RegExp>>;
};
```

### 4.3 CJK and Non-Whitespace-Delimited Languages

**Decision:** CJK patterns use the same regex infrastructure but with character-class-based patterns rather than word-boundary patterns. No tokenizer. The `topicBlacklist` for CJK contains multi-character strings matched via `includes()` rather than word splitting.

**Rationale:** Adding a segmentation library (e.g., `Intl.Segmenter`, `kuromoji`, `jieba`) would violate the zero-dependency constraint. `Intl.Segmenter` is a Node.js built-in (available since v16), but relying on it for core detection would create a hard coupling to a runtime API that behaves differently across environments. Instead, CJK pattern authors craft regex that match character sequences directly — which is how Chinese/Japanese/Korean NLP regex is commonly done in practice.

CJK decision patterns example:

```typescript
// Chinese: "决定" (decided), "方案是" (the plan is), "我们用" (we'll use)
/(?:决定|已决定|方案[是为]|我们[用采])/
// Japanese: "決めた" (decided), "方針は" (the plan is)
/(?:決め[たる]|方針[はを]|にしよう)/
// Korean: "결정" (decided), "하기로" (decided to)
/(?:결정|하기로|계획은)/
```

For topic extraction in CJK, capture groups match sequences of CJK unified ideographs and common punctuation:

```typescript
// Chinese topic extraction
/(?:关于|回到|讨论)\s*([\u4e00-\u9fff\w]{2,20})/
```

The `isNoiseTopic()` function (section 4.7) handles CJK noise filtering via length thresholds on character count rather than word count.

### 4.4 Topic Blacklist Per Language

**Decision:** Each `LanguagePack` includes its own `topicBlacklist: string[]`. The registry merges all active blacklists into a single `Set<string>` at load time.

**Rationale:** Blacklist words are inherently language-specific (English "the", German "das", French "le" serve the same function but are different strings). Merging into a `Set` is O(n) at startup and O(1) at lookup — no performance concern. The current mixed EN/DE `TOPIC_BLACKLIST` is split into the respective language packs.

### 4.5 High-Impact Keywords Per Language

**Decision:** Each `LanguagePack` includes `highImpactKeywords: string[]`. The registry merges them into a single array at load time, deduplicating.

**Rationale:** Same reasoning as blacklist. Current `HIGH_IMPACT_KEYWORDS` already contains both EN and DE terms — these get split into their respective packs. The merged array is used by `inferImpact()` and `inferPriority()`.

### 4.6 Mood Patterns: Shared Base + Per-Language Extensions

**Decision:** Mood patterns remain a single merged set. The base mood patterns (emoji-based: `✅`, `🚀`, `🎯`) are universal. Each language pack MAY provide `moodPatterns` that get merged into the base. The current mixed EN/DE mood patterns are split: universal emoji stay in the base, language-specific words go into their respective packs.

**Rationale:** Mood detection is inherently cross-lingual for emoji. The word "fuck" is understood across many language communities. Rather than forcing every language pack to redefine all moods, we keep a universal base and let packs extend it. The merge strategy is: per-mood, create a combined alternation regex from all contributing packs.

**Base mood patterns (universal):**

```typescript
const BASE_MOOD_PATTERNS: Record<Exclude<Mood, "neutral">, RegExp> = {
  frustrated: /(?:wtf|argh)/i,
  excited:    /(?:🎯|🚀)/,
  tense:      /(?:⚠️|‼️)/,
  productive: /(?:✅)/,
  exploratory: /(?:🤔|💡)/,
};
```

Language-specific mood words (e.g., EN `"fuck"`, `"damn"`, `"awesome"`; DE `"geil"`, `"mist"`, `"nervig"`) move into their respective `LanguagePack.moodPatterns`.

### 4.7 Noise Topic Filtering Adaptation

**Decision:** The `isNoiseTopic()` function gets a language-aware mode. For whitespace-delimited languages (EN, DE, FR, ES, etc.), the current word-based logic applies. For CJK, character-count thresholds replace word-count thresholds.

**Implementation:** The registry exposes a merged `isNoiseTopic(topic: string)` function that checks the merged blacklist and applies appropriate length thresholds. The detection of "is this CJK?" is done via a simple regex test: `/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/`.

```typescript
export function isNoiseTopic(topic: string): boolean {
  const trimmed = topic.trim();
  const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(trimmed);

  if (isCJK) {
    if (trimmed.length < 2) return true;  // CJK: 2+ chars for a topic
  } else {
    if (trimmed.length < 4) return true;  // Latin: 4+ chars
  }

  // Check against merged blacklist
  const lower = trimmed.toLowerCase();
  if (mergedBlacklist.has(lower)) return true;

  // Word-based checks for non-CJK
  if (!isCJK) {
    const words = lower.split(/\s+/);
    if (words.length === 1 && mergedBlacklist.has(words[0])) return true;
    if (words.every(w => mergedBlacklist.has(w) || w.length < 3)) return true;
  }

  // Pronoun prefix check (extended for all loaded languages)
  if (pronounPrefixPattern && pronounPrefixPattern.test(trimmed)) return true;

  if (trimmed.includes("\n") || trimmed.length > 60) return true;
  return false;
}
```

### 4.8 Pattern Merging Strategy

**Decision:** When multiple languages are configured, all their pattern arrays are concatenated. This is identical to the current `"both"` behavior, just generalized to N languages.

**Rationale:** Concatenation is the simplest merge strategy and matches the existing behavior. Order doesn't matter because pattern matching is `some()` (any match wins) or position-based scanning (mood). There's no conflict between patterns from different languages — a French closure pattern won't false-positive on English text in practice because the words are different.

**Performance consideration:** With 10 languages, each having ~5 patterns per category, the merged set is ~50 regexes per category. Testing 50 regexes against a message is still sub-millisecond on modern hardware. See section 6 for benchmarks.

### 4.9 Configuration: Backward Compatible

**Decision:** The `patterns.language` config field changes from `"en" | "de" | "both"` to `string | string[]`. The old values are mapped:

| Old Value  | New Interpretation        |
|-----------|---------------------------|
| `"en"`    | `["en"]`                   |
| `"de"`    | `["de"]`                   |
| `"both"`  | `["en", "de"]`             |
| `"all"`   | All built-in languages     |
| `["en", "fr"]` | Explicit language list |

**Rationale:** String-to-array coercion is trivial and maintains full backward compatibility. The `"both"` value is preserved as an alias for `["en", "de"]`. Adding `"all"` provides a convenient shorthand for users who want maximum coverage.

```typescript
export type PatternLanguageConfig = string | string[];

// In config resolver:
function resolveLanguages(value: unknown): string[] {
  if (value === "both") return ["en", "de"];
  if (value === "all") return Object.keys(BUILTIN_LANGUAGES);
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter(v => typeof v === "string");
  return ["en", "de"]; // default preserves current behavior
}
```

### 4.10 Custom User Patterns (No Fork Required)

**Decision:** Users can provide custom patterns via the plugin config. Custom patterns are merged on top of built-in patterns (extend) or can replace them (override).

**Rationale:** This is the most-requested extensibility mechanism. Users may need domain-specific decision phrases ("approved by committee", "design review passed") or organization-specific terminology. Config-based patterns avoid forking entirely.

**Config shape:**

```typescript
// In openclaw config
{
  "plugins": {
    "openclaw-cortex": {
      "patterns": {
        "language": ["en", "de", "fr"],
        "custom": {
          "decision": ["approved by committee", "design review passed"],
          "close": ["ticket closed", "JIRA resolved"],
          "wait": ["pending approval from"],
          "topic": [],
          "topicBlacklist": ["standup", "sync"],
          "highImpactKeywords": ["compliance", "gdpr"],
          "mode": "extend"  // "extend" (default) | "override"
        }
      }
    }
  }
}
```

Custom pattern strings are compiled to `RegExp` at load time with `"i"` flag. For topic patterns, users must include a capture group: `"regarding the (\\w[\\w\\s-]{3,40})"`.

**Why strings, not RegExp?** Config files are JSON. Regex can't be expressed as JSON values. String-to-regex compilation is a one-time cost at startup. We validate that each string is a valid regex and log warnings for invalid ones (never throw — graceful degradation).

### 4.11 Runtime Pattern Registration API

**Decision:** Expose `registerLanguagePack(pack: LanguagePack)` on the plugin's service API for runtime registration by other plugins.

**Rationale:** Some users may want to load patterns dynamically (e.g., from a database, from a remote config). This is a MAY-level feature — the static file approach handles 95% of cases. The runtime API is a thin wrapper around the same registry.

```typescript
// Other plugin can do:
api.getService("cortex-patterns")?.registerLanguagePack({
  code: "custom",
  name: "Custom",
  nameEn: "Custom Patterns",
  patterns: { decision: [...], close: [...], wait: [...], topic: [...] },
  topicBlacklist: [],
  highImpactKeywords: [],
});
```

---

## 5. Requirements

### Core (MUST)

| ID    | Requirement | Rationale |
|-------|------------|-----------|
| R-001 | MUST remain zero runtime dependencies. | Fundamental project constraint. No npm packages added. |
| R-002 | MUST remain zero LLM dependency for core pattern detection. | LLM enhance is optional; regex detection is the core. |
| R-003 | MUST NOT break existing EN/DE pattern behavior. All 298 existing tests MUST pass without modification. | Backward compatibility is non-negotiable. |
| R-004 | MUST preserve backward compatibility for `patternLanguage: "en" \| "de" \| "both"` config values. | Existing users must not need to change config. |
| R-005 | MUST define a `LanguagePack` type contract that all language files implement. | Type safety ensures contributor correctness at compile time. |
| R-006 | MUST organize patterns as one TypeScript file per language in `src/patterns/lang-{code}.ts`. | Single-file contribution model lowers the barrier. |
| R-007 | MUST extract current EN patterns from `patterns.ts` into `lang-en.ts` without behavioral change. | Clean separation; current behavior preserved exactly. |
| R-008 | MUST extract current DE patterns from `patterns.ts` into `lang-de.ts` without behavioral change. | Clean separation; current behavior preserved exactly. |
| R-009 | MUST implement a `PatternRegistry` class/module that loads language packs and merges patterns. | Central coordination point for multi-language support. |
| R-010 | MUST merge patterns by concatenating arrays from all configured languages. | Matches current `"both"` behavior, generalized to N languages. |
| R-011 | MUST merge `topicBlacklist` from all configured languages into a single `Set<string>`. | Noise filtering must work across all active languages. |
| R-012 | MUST merge `highImpactKeywords` from all configured languages into a single deduplicated array. | Impact inference must work across all active languages. |
| R-013 | MUST maintain the existing `getPatterns()` function signature as a backward-compatible shim. | Consumers (thread-tracker, decision-tracker) call this function. |
| R-014 | MUST maintain the existing `detectMood()` function signature and behavior. | Mood detection API must not change. |
| R-015 | MUST maintain the existing `isNoiseTopic()` function signature. | Noise filtering API must not change. |
| R-016 | MUST maintain the existing `HIGH_IMPACT_KEYWORDS` export. | Decision tracker imports this directly. |

### Language Coverage (SHOULD)

| ID    | Requirement | Rationale |
|-------|------------|-----------|
| R-017 | SHOULD include built-in language packs for: EN, DE, FR, ES, PT, IT, ZH, JA, KO, RU. | Covers the top 10 languages used in LLM conversations globally. |
| R-018 | SHOULD allow users to configure which languages to load via `patterns.language` as `string \| string[]`. | Users shouldn't pay for languages they don't use. |
| R-019 | SHOULD support `"all"` as a language config value meaning "load all built-in packs". | Convenience for polyglot users. |
| R-020 | SHOULD handle CJK languages via character-sequence regex without requiring tokenization libraries. | Maintains zero-dependency constraint while supporting CJK. |
| R-021 | SHOULD adapt `isNoiseTopic()` with CJK-aware length thresholds (2+ chars for CJK vs 4+ for Latin). | CJK characters carry more semantic density than Latin characters. |
| R-022 | SHOULD keep mood patterns as a shared universal base (emoji) with per-language extensions. | Emoji are universal; language-specific mood words vary. |

### Custom Patterns (SHOULD)

| ID    | Requirement | Rationale |
|-------|------------|-----------|
| R-023 | SHOULD support custom user patterns via `patterns.custom` config object. | Users need domain-specific patterns without forking. |
| R-024 | SHOULD support `"extend"` mode (default): custom patterns are appended to built-in patterns. | Most users want to add patterns, not replace them. |
| R-025 | SHOULD support `"override"` mode: custom patterns replace built-in patterns for their categories. | Power users may need full control. |
| R-026 | SHOULD compile custom pattern strings to `RegExp` at load time with `"i"` flag. | Config is JSON; regex must be expressed as strings. |
| R-027 | SHOULD validate custom pattern strings and log warnings for invalid regex (never throw). | Graceful degradation; one bad pattern shouldn't crash the plugin. |
| R-028 | SHOULD support custom `topicBlacklist` and `highImpactKeywords` in the custom config. | Completeness — users may need domain-specific noise words. |

### Extensibility (MAY)

| ID    | Requirement | Rationale |
|-------|------------|-----------|
| R-029 | MAY expose a `registerLanguagePack()` function for runtime registration by other plugins. | Enables dynamic pattern loading; low priority. |
| R-030 | MAY expose a `getLoadedLanguages(): string[]` function for introspection. | Debugging and status reporting. |
| R-031 | MAY include a `CONTRIBUTING-LANGUAGE.md` guide for community language pack authors. | Lowers the barrier for contributions. |

### Performance (MUST/SHOULD)

| ID    | Requirement | Rationale |
|-------|------------|-----------|
| R-032 | MUST NOT exceed 5ms per message for pattern matching with 10 languages loaded. | Cortex is in the hot path of every message. |
| R-033 | SHOULD complete pattern matching in < 2ms per message with 10 languages loaded. | Target for good UX — imperceptible latency. |
| R-034 | MUST cache merged pattern sets after initial load (not re-merge on every message). | Merge once at startup, reuse for all messages. |
| R-035 | SHOULD lazy-import language pack files only for configured languages. | Don't load 10 language packs if user only wants EN. |

---

## 6. Performance Analysis

### Current Baseline (2 languages)

The current `getPatterns("both")` returns:
- `decision`: 2 regexes
- `close`: 5 regexes
- `wait`: 2 regexes
- `topic`: 2 regexes
- Total: 11 regexes tested per message

### Projected (10 languages)

Assuming each language contributes ~3-5 patterns per category:
- `decision`: ~30-50 regexes
- `close`: ~30-50 regexes
- `wait`: ~20-30 regexes
- `topic`: ~20-30 regexes
- Total: ~100-160 regexes tested per message

**Benchmark estimate:** A single `RegExp.test()` on a 500-char message takes ~1-5μs. Testing 160 regexes = ~0.16-0.8ms. Well within the 2ms target.

**Mood patterns:** Currently 5 moods × 1 regex each = 5 regex tests. With 10 languages contributing mood extensions, we merge into 5 combined alternation regexes (not 50 separate ones). Cost is essentially unchanged.

**Memory:** Each `LanguagePack` is ~2-5KB in memory. 10 packs = ~50KB. Negligible.

### Mitigation

- R-034 ensures merge happens once at startup.
- R-035 ensures unused language files aren't loaded.
- The registry caches the merged `PatternSet`, `Set<string>` blacklist, and `string[]` keywords as instance properties.

---

## 7. Migration Plan

### Phase 1: Extract & Reorganize (Non-Breaking)

1. Create `src/patterns/types.ts` with `LanguagePack`, `PatternSet`, registry types.
2. Create `src/patterns/lang-en.ts` — extract all `*_EN` constants + EN blacklist words + EN high-impact keywords from `patterns.ts`.
3. Create `src/patterns/lang-de.ts` — extract all `*_DE` constants + DE blacklist words + DE high-impact keywords.
4. Create `src/patterns/registry.ts` — `PatternRegistry` class with `load()`, `getPatterns()`, `detectMood()`, `isNoiseTopic()`, `getHighImpactKeywords()`.
5. Create `src/patterns/index.ts` — re-exports matching the current `patterns.ts` API surface.
6. Update `src/patterns.ts` to be a thin shim re-exporting from `src/patterns/index.ts`.
7. **All 298 tests must pass with zero changes.** This is the gate for Phase 1.

### Phase 2: Add Languages

8. Add `lang-fr.ts`, `lang-es.ts`, `lang-pt.ts`, `lang-it.ts`, `lang-zh.ts`, `lang-ja.ts`, `lang-ko.ts`, `lang-ru.ts`.
9. Register all packs in the registry's built-in map.
10. Update config resolver to handle `string | string[]` for `patterns.language`.
11. Add tests for each new language pack (minimum: 5 tests per category per language = ~100 new tests).

### Phase 3: Custom Patterns

12. Add `patterns.custom` config parsing in `resolveConfig()`.
13. Implement string→RegExp compilation with validation.
14. Add extend/override merge logic in registry.
15. Add tests for custom pattern loading, invalid regex handling, extend vs override modes.

### Phase 4: Runtime API (Optional)

16. Expose `registerLanguagePack()` on the cortex service.
17. Add `getLoadedLanguages()` introspection.
18. Write `CONTRIBUTING-LANGUAGE.md`.

---

## 8. File-Level Changes

### New Files

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `src/patterns/types.ts` | `LanguagePack` type, `PatternSet`, `MergedPatterns` | ~60 |
| `src/patterns/registry.ts` | `PatternRegistry` — load, merge, cache, query | ~180 |
| `src/patterns/lang-en.ts` | English language pack | ~80 |
| `src/patterns/lang-de.ts` | German language pack | ~80 |
| `src/patterns/lang-fr.ts` | French language pack | ~80 |
| `src/patterns/lang-es.ts` | Spanish language pack | ~80 |
| `src/patterns/lang-pt.ts` | Portuguese language pack | ~80 |
| `src/patterns/lang-it.ts` | Italian language pack | ~80 |
| `src/patterns/lang-zh.ts` | Chinese (Simplified) language pack | ~70 |
| `src/patterns/lang-ja.ts` | Japanese language pack | ~70 |
| `src/patterns/lang-ko.ts` | Korean language pack | ~70 |
| `src/patterns/lang-ru.ts` | Russian language pack | ~80 |
| `src/patterns/index.ts` | Public API re-exports (backward-compat shim) | ~50 |

### Modified Files

| File | Change |
|------|--------|
| `src/patterns.ts` | Becomes thin re-export shim → `src/patterns/index.ts` |
| `src/types.ts` | Update `CortexConfig.patterns.language` type to `string \| string[]` |
| `src/config.ts` | Add `resolveLanguages()`, update `lang()` validator, add custom pattern parsing |
| `src/thread-tracker.ts` | No changes (imports from `patterns.js` which shim handles) |
| `src/decision-tracker.ts` | No changes (imports from `patterns.js` which shim handles) |
| `src/hooks.ts` | No changes (passes `config.patterns.language` which registry handles) |

### Test Files

| File | Change |
|------|--------|
| `test/patterns.test.ts` | No changes (backward-compat shim ensures all imports work) |
| `test/patterns-registry.test.ts` | New — tests for registry load/merge/cache |
| `test/patterns-lang-*.test.ts` | New — per-language pack tests (~10-20 tests each) |
| `test/patterns-custom.test.ts` | New — custom pattern loading/validation tests |

---

## 9. Detailed Type Definitions

```typescript
// src/patterns/types.ts

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
   * Each value is a RegExp matching mood-indicating words in this language.
   */
  moodPatterns?: Partial<Record<Exclude<Mood, "neutral">, RegExp>>;

  /**
   * Pronoun/noise prefixes for topic filtering (optional).
   * These get compiled into a prefix regex for isNoiseTopic().
   * Example: ["ich", "i", "we", "wir", "je", "nous"]
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
```

---

## 10. Registry Implementation Sketch

```typescript
// src/patterns/registry.ts

import type { Mood } from "../types.js";
import type { LanguagePack, PatternSet, CustomPatternConfig } from "./types.js";

// Built-in language packs (static imports for configured languages)
import { LANG_EN } from "./lang-en.js";
import { LANG_DE } from "./lang-de.js";

// Lazy imports for additional languages
const BUILTIN_LOADERS: Record<string, () => Promise<{ default: LanguagePack }>> = {
  en: async () => ({ default: LANG_EN }),
  de: async () => ({ default: LANG_DE }),
  fr: () => import("./lang-fr.js"),
  es: () => import("./lang-es.js"),
  pt: () => import("./lang-pt.js"),
  it: () => import("./lang-it.js"),
  zh: () => import("./lang-zh.js"),
  ja: () => import("./lang-ja.js"),
  ko: () => import("./lang-ko.js"),
  ru: () => import("./lang-ru.js"),
};

// Universal mood patterns (emoji — language-independent)
const BASE_MOOD: Record<Exclude<Mood, "neutral">, RegExp[]> = {
  frustrated: [/(?:wtf|argh)/i],
  excited:    [/(?:🎯|🚀)/],
  tense:      [/(?:⚠️|‼️)/],
  productive: [/(?:✅)/],
  exploratory:[/(?:🤔|💡)/],
};

export class PatternRegistry {
  private packs: LanguagePack[] = [];
  private cachedPatterns: PatternSet | null = null;
  private cachedBlacklist: Set<string> | null = null;
  private cachedKeywords: string[] | null = null;
  private cachedMoodPatterns: Record<Exclude<Mood, "neutral">, RegExp> | null = null;
  private cachedNoisePrefixPattern: RegExp | null = null;
  private customConfig: CustomPatternConfig | null = null;

  /** Load language packs for the given codes. Call once at startup. */
  async load(codes: string[], custom?: CustomPatternConfig): Promise<void> {
    this.packs = [];
    this.customConfig = custom ?? null;
    this.invalidateCache();

    for (const code of codes) {
      const loader = BUILTIN_LOADERS[code];
      if (loader) {
        const mod = await loader();
        this.packs.push(mod.default);
      }
      // Unknown codes are silently skipped (might be runtime-registered later)
    }
  }

  /** Synchronous load for EN/DE only (backward compat — no async needed). */
  loadSync(codes: string[], custom?: CustomPatternConfig): void {
    this.packs = [];
    this.customConfig = custom ?? null;
    this.invalidateCache();

    // Only EN and DE are available synchronously
    for (const code of codes) {
      if (code === "en") this.packs.push(LANG_EN);
      else if (code === "de") this.packs.push(LANG_DE);
    }
  }

  /** Register a language pack at runtime. */
  registerLanguagePack(pack: LanguagePack): void {
    // Replace if same code exists
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

    // Apply custom patterns
    if (this.customConfig) {
      const compiled = this.compileCustom(this.customConfig);
      if (this.customConfig.mode === "override") {
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

  /** Get merged high-impact keywords (cached). */
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
        if (pattern) sources[mood as Exclude<Mood, "neutral">].push(pattern);
      }
    }

    // Merge each mood's regex array into a single alternation regex
    const merged = {} as Record<Exclude<Mood, "neutral">, RegExp>;
    for (const [mood, patterns] of Object.entries(sources)) {
      const combined = patterns.map(p => p.source).join("|");
      merged[mood as Exclude<Mood, "neutral">] = new RegExp(combined, "i");
    }

    this.cachedMoodPatterns = merged;
    return merged;
  }

  /** Get loaded language codes. */
  getLoadedLanguages(): string[] {
    return this.packs.map(p => p.code);
  }

  private compileCustom(config: CustomPatternConfig): PatternSet {
    const compile = (strings: string[] | undefined): RegExp[] => {
      if (!strings) return [];
      return strings
        .map(s => {
          try { return new RegExp(s, "i"); }
          catch { return null; }
        })
        .filter((r): r is RegExp => r !== null);
    };

    return {
      decision: compile(config.decision),
      close: compile(config.close),
      wait: compile(config.wait),
      topic: compile(config.topic),
    };
  }

  private invalidateCache(): void {
    this.cachedPatterns = null;
    this.cachedBlacklist = null;
    this.cachedKeywords = null;
    this.cachedMoodPatterns = null;
    this.cachedNoisePrefixPattern = null;
  }
}
```

---

## 11. Backward-Compatibility Shim

The existing `src/patterns.ts` becomes a thin shim that delegates to the registry. All existing imports (`getPatterns`, `detectMood`, `isNoiseTopic`, `HIGH_IMPACT_KEYWORDS`, `MOOD_PATTERNS`) continue to work identically.

```typescript
// src/patterns.ts (after migration — backward-compat shim)

import { PatternRegistry } from "./patterns/registry.js";
import type { PatternSet } from "./patterns/types.js";
import type { Mood } from "./types.js";

export type { PatternSet };
export type PatternLanguage = "en" | "de" | "both" | string | string[];

// Singleton registry — initialized on first use
let _registry: PatternRegistry | null = null;

function getRegistry(language: PatternLanguage): PatternRegistry {
  // For backward compat, always create fresh for the requested language
  // In the new world, the registry is initialized once at plugin startup
  const registry = new PatternRegistry();
  const codes = resolveLanguageCodes(language);
  registry.loadSync(codes);
  return registry;
}

function resolveLanguageCodes(language: PatternLanguage): string[] {
  if (language === "both") return ["en", "de"];
  if (typeof language === "string") return [language];
  if (Array.isArray(language)) return language;
  return ["en", "de"];
}

/** Backward-compatible getPatterns(). */
export function getPatterns(language: PatternLanguage): PatternSet {
  return getRegistry(language).getPatterns();
}

/** Backward-compatible detectMood(). */
export function detectMood(text: string): Mood {
  if (!text) return "neutral";

  // Use the default registry (EN+DE) for mood — matches current behavior
  const patterns = getRegistry("both").getMoodPatterns();

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

/** Backward-compatible isNoiseTopic(). */
export function isNoiseTopic(topic: string): boolean {
  const registry = getRegistry("both");
  const blacklist = registry.getBlacklist();
  const trimmed = topic.trim();

  if (trimmed.length < 4) return true;
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 1 && blacklist.has(words[0])) return true;
  if (words.every(w => blacklist.has(w) || w.length < 3)) return true;
  if (/^(ich|i|we|wir|du|er|sie|he|she|it|es|nichts|nothing|etwas|something)\s/i.test(trimmed)) return true;
  if (trimmed.includes("\n") || trimmed.length > 60) return true;
  return false;
}

/** Backward-compatible HIGH_IMPACT_KEYWORDS. */
export const HIGH_IMPACT_KEYWORDS = getRegistry("both").getHighImpactKeywords();

/** Backward-compatible MOOD_PATTERNS. */
export const MOOD_PATTERNS = getRegistry("both").getMoodPatterns();
```

**Key insight:** The shim creates the registry synchronously for EN/DE (which are statically imported). This means zero behavioral change for existing users. The async `load()` path is only used when languages beyond EN/DE are configured, which is a new code path.

---

## 12. Example Language Pack

```typescript
// src/patterns/lang-fr.ts

import type { LanguagePack } from "./types.js";

export const LANG_FR: LanguagePack = {
  code: "fr",
  name: "Français",
  nameEn: "French",

  patterns: {
    decision: [
      /(?:décidé|décision|on fait|le plan est|approche\s*:)/i,
      /(?:convenu|arrêté|choisi de|opté pour)/i,
    ],
    close: [
      /(?:^|\s)(?:c'est |est )?(?:fait|terminé|résolu|fermé|fini)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:ça |il )(?:marche|fonctionne)(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:en attente de|bloqué par|il faut d'abord)/i,
      /(?:attend[s]? (?:le|la|les|que)|besoin (?:de|d').*avant)/i,
    ],
    topic: [
      /(?:revenons à|maintenant|concernant|parlons de|à propos de)\s+(?:la?\s+)?(\w[\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "le", "la", "les", "un", "une", "des", "ce", "cette", "ces",
    "il", "elle", "on", "nous", "vous", "ils", "elles",
    "ça", "cela", "rien", "tout", "quelque", "chose",
    "ici", "là", "maintenant", "alors", "donc", "mais", "ou",
    "aujourd'hui", "demain", "hier",
  ],

  highImpactKeywords: [
    "architecture", "sécurité", "migration", "supprimer",
    "production", "déployer", "critique", "stratégie",
    "budget", "contrat", "majeur",
  ],

  moodPatterns: {
    frustrated: /(?:merde|putain|chiant|énervant|bordel|fait chier)/i,
    excited: /(?:génial|super|trop bien|magnifique|parfait|incroyable)/i,
    tense: /(?:attention|risqué|critique|urgent|dangereux|prudence)/i,
    productive: /(?:terminé|fait|déployé|livré|corrigé)/i,
    exploratory: /(?:et si|peut-être|idée|hypothèse|on pourrait|essayons)/i,
  },

  noisePrefixes: ["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "rien", "quelque"],
};

export default LANG_FR;
```

---

## 13. Configuration Changes

### Updated `CortexConfig.patterns`

```typescript
// In types.ts
patterns: {
  language: string | string[];  // was: "en" | "de" | "both"
  custom?: {
    decision?: string[];
    close?: string[];
    wait?: string[];
    topic?: string[];
    topicBlacklist?: string[];
    highImpactKeywords?: string[];
    mode?: "extend" | "override";
  };
};
```

### Updated `resolveConfig()` in `config.ts`

```typescript
function resolveLanguage(value: unknown): string | string[] {
  // Backward compat: "en", "de", "both" still work
  if (value === "en" || value === "de" || value === "both") return value as string;
  if (value === "all") return "all";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(v => typeof v === "string")) return value;
  return "both"; // default
}

function resolveCustomPatterns(value: unknown): CustomPatternConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    decision: Array.isArray(raw.decision) ? raw.decision.filter(s => typeof s === "string") : undefined,
    close: Array.isArray(raw.close) ? raw.close.filter(s => typeof s === "string") : undefined,
    wait: Array.isArray(raw.wait) ? raw.wait.filter(s => typeof s === "string") : undefined,
    topic: Array.isArray(raw.topic) ? raw.topic.filter(s => typeof s === "string") : undefined,
    topicBlacklist: Array.isArray(raw.topicBlacklist) ? raw.topicBlacklist.filter(s => typeof s === "string") : undefined,
    highImpactKeywords: Array.isArray(raw.highImpactKeywords) ? raw.highImpactKeywords.filter(s => typeof s === "string") : undefined,
    mode: raw.mode === "override" ? "override" : "extend",
  };
}
```

---

## 14. Testing Strategy

### Existing Tests (298 — MUST pass unchanged)

All tests in `test/patterns.test.ts` import from `../src/patterns.js`. The backward-compat shim ensures these imports resolve to the same functions with identical behavior. **Zero test changes needed.**

### New Tests

| Test File | Tests (est.) | Coverage |
|-----------|-------------|----------|
| `test/patterns-registry.test.ts` | ~30 | Registry load, merge, cache invalidation, sync/async loading |
| `test/patterns-lang-fr.test.ts` | ~20 | French decision/close/wait/topic/mood patterns |
| `test/patterns-lang-es.test.ts` | ~20 | Spanish patterns |
| `test/patterns-lang-pt.test.ts` | ~20 | Portuguese patterns |
| `test/patterns-lang-it.test.ts` | ~20 | Italian patterns |
| `test/patterns-lang-zh.test.ts` | ~15 | Chinese patterns, CJK noise filtering |
| `test/patterns-lang-ja.test.ts` | ~15 | Japanese patterns |
| `test/patterns-lang-ko.test.ts` | ~15 | Korean patterns |
| `test/patterns-lang-ru.test.ts` | ~20 | Russian patterns |
| `test/patterns-custom.test.ts` | ~25 | Custom pattern loading, validation, extend/override modes |
| **Total new** | **~200** | |

### Test Quality Requirements

Each language pack test MUST include:
- At least 3 positive matches per pattern category (decision, close, wait, topic).
- At least 1 negative match per category (text that should NOT match).
- Topic capture group extraction verification.
- Mood pattern matching for language-specific mood words.
- Blacklist word filtering for that language's noise words.

---

## 15. Open Questions

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Should we support RTL languages (Arabic, Hebrew) in the first release? | **No.** RTL languages work fine with regex — the patterns don't care about display direction. Add `lang-ar.ts` and `lang-he.ts` as future community contributions. |
| 2 | Should the async `load()` be used for EN/DE too? | **No.** Keep EN/DE as synchronous static imports for backward compat. Only new languages use dynamic import. This avoids making plugin initialization async. |
| 3 | Should we provide a CLI tool for testing patterns? | **MAY.** A `cortex test-pattern --lang fr --text "On a décidé de..."` command would be useful for contributors. Low priority — tests serve this purpose. |
| 4 | Should pattern quality be validated (e.g., "does this regex have too many false positives")? | **Future work.** Not in scope for this RFC. Contributors should test their patterns against a corpus. |
| 5 | Should we pin regex flags or let language packs choose? | **Pin `"i"` flag for all patterns.** Case-insensitive matching is universally correct for this use case. Language packs should not need to worry about flags. The registry applies `"gi"` when scanning for positions. |

---

## 16. Summary

This RFC transforms Cortex's pattern system from a hardcoded 2-language implementation into an extensible, registry-based architecture supporting 10+ languages. The design:

1. **Preserves** all existing behavior via a backward-compatible shim (R-003, R-004, R-013–R-016).
2. **Scales** to N languages via one-file-per-language packs (R-006, R-017).
3. **Handles CJK** via adapted regex patterns and character-aware noise filtering (R-020, R-021).
4. **Enables community contributions** via a typed `LanguagePack` contract (R-005, R-031).
5. **Supports user customization** via config-based custom patterns (R-023–R-028).
6. **Maintains performance** via cached merge results and lazy loading (R-032–R-035).
7. **Requires zero new dependencies** (R-001, R-002).

Estimated implementation effort: **1 Forge session** for Phases 1-2, **1 additional session** for Phase 3. Phase 4 is optional.

---

*End of RFC-004*

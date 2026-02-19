# RFC-005 Addendum: Multi-Language Signal Detection

| Field       | Value                                                      |
|-------------|------------------------------------------------------------|
| Addendum To | RFC-005 (Trace Analyzer)                                   |
| Author      | Atlas (Architecture Agent)                                 |
| Date        | 2026-02-19                                                 |
| Status      | Draft                                                      |
| Depends On  | RFC-004 (Multi-Language Pattern Support), RFC-005 §5 (Failure Signal Taxonomy) |

---

## 1. Problem Statement

The seven signal detectors in `src/trace-analyzer/signals/` currently hardcode English and German regex patterns. Four of the seven signals rely on natural-language text matching:

| Signal | Hardcoded Patterns (current) | Missed Example |
|--------|------------------------------|----------------|
| SIG-CORRECTION | "nein", "falsch", "wrong", "that's not right" | FR: "c'est faux", ES: "eso está mal" |
| SIG-DISSATISFIED | "vergiss es", "forget it", "I'll do it myself" | ES: "olvídalo", PT: "deixa pra lá" |
| SIG-HALLUCINATION | "done", "erledigt", "deployed", "✅" | FR: "terminé", JA: "完了" |
| SIG-UNVERIFIED-CLAIM | "disk usage is", "server is running" | DE already covered; ZH: "磁盘使用率是" |

The remaining three signals are **language-independent** — they operate on event structure, not text content:

| Signal | Why Language-Independent |
|--------|--------------------------|
| SIG-TOOL-FAIL | Checks `toolError` / `toolIsError` fields — no text matching on message content |
| SIG-DOOM-LOOP | Compares tool names, param similarity, and error presence — structural only |
| SIG-REPEAT-FAIL | Fingerprints tool+params+error across sessions — structural only |

RFC-004 established a `PatternRegistry` with per-language `LanguagePack` files covering 10 languages (EN, DE, FR, ES, PT, IT, ZH, JA, KO, RU). This addendum extends the same pattern to the Trace Analyzer's signal detectors.

---

## 2. Signal Language Classification

### 2.1 Language-Sensitive Signals

These detectors match natural-language content in `msg.in` and `msg.out` payloads:

- **SIG-CORRECTION** — matches user correction phrases in `msg.in`
- **SIG-DISSATISFIED** — matches user frustration phrases in `msg.in`
- **SIG-HALLUCINATION** — matches agent completion claims in `msg.out`
- **SIG-UNVERIFIED-CLAIM** — matches agent system-state claims in `msg.out`

### 2.2 Language-Independent Signals

These detectors operate solely on event types, tool metadata, and structural patterns:

- **SIG-TOOL-FAIL** — `tool.result.toolError` presence + absence of recovery
- **SIG-DOOM-LOOP** — consecutive `tool.call`/`tool.result` pairs with param similarity
- **SIG-REPEAT-FAIL** — cross-session fingerprint matching on tool+params+error

Language-independent signals require **no changes** for multi-language support.

---

## 3. `SignalLanguagePack` Type

Following RFC-004's `LanguagePack` convention, each language provides signal-specific pattern sets. The type mirrors `LanguagePack` in structure but serves a different detection domain.

```typescript
// src/trace-analyzer/signals/lang/types.ts

/**
 * Per-language pattern pack for signal detection.
 * Follows RFC-004 LanguagePack conventions:
 * - One file per language (signal-lang-{code}.ts)
 * - Default export of the pack
 * - All RegExp patterns case-insensitive
 */
export type SignalLanguagePack = {
  /** ISO 639-1 code (e.g., "en", "de", "fr") */
  code: string;
  /** Language name in the language itself */
  name: string;
  /** English name for logs */
  nameEn: string;

  /** User correction indicators (SIG-CORRECTION) */
  correction: {
    /**
     * Phrases indicating the user is correcting the agent.
     * Examples: "wrong", "that's not right", "falsch", "c'est faux"
     */
    indicators: RegExp[];
    /**
     * Short negative responses that are valid answers, not corrections.
     * These are suppressed when the preceding agent message was a question.
     * Examples: "nein", "no", "non"
     */
    shortNegatives: RegExp[];
  };

  /** Question indicators (shared: SIG-CORRECTION exclusion, SIG-HALLUCINATION exclusion) */
  question: {
    /**
     * Patterns indicating an agent message is a question, not an assertion.
     * Examples: "shall I?", "soll ich?", "est-ce que je dois?"
     */
    indicators: RegExp[];
  };

  /** User dissatisfaction indicators (SIG-DISSATISFIED) */
  dissatisfaction: {
    /**
     * Phrases indicating the user is frustrated or giving up.
     * Examples: "forget it", "vergiss es", "olvídalo", "もういい"
     */
    indicators: RegExp[];
    /**
     * Phrases indicating user satisfaction (exclusion filter).
     * Examples: "thanks", "danke", "merci", "ありがとう"
     */
    satisfactionOverrides: RegExp[];
    /**
     * Agent resolution attempts (exclusion: agent tried to fix it).
     * Examples: "sorry", "entschuldigung", "désolé"
     */
    resolutionIndicators: RegExp[];
  };

  /** Completion claim indicators (SIG-HALLUCINATION) */
  completion: {
    /**
     * Phrases where the agent claims task completion.
     * Examples: "done", "erledigt", "terminé", "完了", "완료"
     */
    claims: RegExp[];
  };

  /** System state claim indicators (SIG-UNVERIFIED-CLAIM) */
  systemState: {
    /**
     * Patterns matching factual claims about system state that
     * require tool verification.
     * Examples: "disk usage is 45%", "server is running",
     *           "el servidor está activo"
     */
    claims: RegExp[];
    /**
     * Hedging/opinion phrases that exclude a claim from detection.
     * Examples: "I think", "probably", "je crois", "たぶん"
     */
    opinionExclusions: RegExp[];
  };
};
```

### 3.1 Pattern Categories Summary

| Category | Used By | Purpose |
|----------|---------|---------|
| `correction.indicators` | SIG-CORRECTION | User says the agent was wrong |
| `correction.shortNegatives` | SIG-CORRECTION | Short "no" that's a valid answer, not a correction |
| `question.indicators` | SIG-CORRECTION, SIG-HALLUCINATION | Agent was asking, not asserting |
| `dissatisfaction.indicators` | SIG-DISSATISFIED | User is frustrated / giving up |
| `dissatisfaction.satisfactionOverrides` | SIG-DISSATISFIED | User is happy (exclusion) |
| `dissatisfaction.resolutionIndicators` | SIG-DISSATISFIED | Agent attempts to resolve |
| `completion.claims` | SIG-HALLUCINATION | Agent claims "done" |
| `systemState.claims` | SIG-UNVERIFIED-CLAIM | Agent asserts system facts |
| `systemState.opinionExclusions` | SIG-UNVERIFIED-CLAIM | Agent hedges ("I think") |

---

## 4. File Structure

```
src/trace-analyzer/signals/lang/
├── types.ts                    # SignalLanguagePack type definition
├── registry.ts                 # SignalPatternRegistry class
├── signal-lang-en.ts           # English signal patterns
├── signal-lang-de.ts           # German signal patterns
├── signal-lang-fr.ts           # French signal patterns
├── signal-lang-es.ts           # Spanish signal patterns
├── signal-lang-pt.ts           # Portuguese signal patterns
├── signal-lang-it.ts           # Italian signal patterns
├── signal-lang-zh.ts           # Chinese signal patterns
├── signal-lang-ja.ts           # Japanese signal patterns
├── signal-lang-ko.ts           # Korean signal patterns
├── signal-lang-ru.ts           # Russian signal patterns
└── index.ts                    # Re-exports
```

---

## 5. `SignalPatternRegistry`

### 5.1 Design Decision: Separate Registry

The signal detectors use a **separate `SignalPatternRegistry`**, not the existing `PatternRegistry` from RFC-004. Rationale:

| Concern | PatternRegistry (RFC-004) | SignalPatternRegistry (this addendum) |
|---------|---------------------------|---------------------------------------|
| **Purpose** | Thread/decision/narrative detection | Failure signal detection in traces |
| **Pattern shapes** | `decision[]`, `close[]`, `wait[]`, `topic[]` | `correction`, `dissatisfaction`, `completion`, `systemState` |
| **Consumer** | Thread tracker, decision tracker (live hooks) | Trace analyzer signal detectors (batch) |
| **Lifecycle** | Loaded at plugin init, used per-message | Loaded when trace analyzer activates |

However, the `SignalPatternRegistry` **reuses the same architectural conventions**:

- Per-language files with default exports
- Sync load for EN/DE, async (dynamic import) for other languages
- Cache invalidation on load
- `registerSignalLanguagePack()` for runtime extension
- Same `code` / `name` / `nameEn` metadata fields

### 5.2 Registry Implementation

```typescript
// src/trace-analyzer/signals/lang/registry.ts

import type { SignalLanguagePack } from "./types.js";

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

export class SignalPatternRegistry {
  private packs: SignalLanguagePack[] = [];
  private cached: SignalPatternSet | null = null;

  /** Async load — supports all 10 languages. */
  async load(codes: string[]): Promise<void> {
    this.packs = [];
    this.cached = null;

    for (const code of codes) {
      if (SYNC_PACKS[code]) {
        this.packs.push(SYNC_PACKS[code]);
      } else if (ASYNC_LOADERS[code]) {
        this.packs.push(await ASYNC_LOADERS[code]());
      }
    }
  }

  /** Synchronous load — EN/DE only. */
  loadSync(codes: string[]): void { /* same pattern as PatternRegistry */ }

  /** Register a custom pack at runtime. */
  registerSignalLanguagePack(pack: SignalLanguagePack): void {
    this.packs = this.packs.filter(p => p.code !== pack.code);
    this.packs.push(pack);
    this.cached = null;
  }

  /** Get merged patterns (cached). */
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
      question: { indicators: [] },
      dissatisfaction: {
        indicators: [],
        satisfactionOverrides: [],
        resolutionIndicators: [],
      },
      completion: { claims: [] },
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
```

---

## 6. Detector Refactoring

Each language-sensitive detector is refactored to accept a `SignalPatternSet` instead of hardcoded regex arrays.

### 6.1 Before (current — `correction.ts`)

```typescript
const CORRECTION_PATTERNS: RegExp[] = [
  /\b(?:falsch|das ist falsch|so nicht|das stimmt nicht)\b/i,
  /\b(?:wrong|that's not right|incorrect|no that's)\b/i,
  // ... hardcoded EN + DE only
];

export function detectCorrections(chain: ConversationChain): FailureSignal[] {
  // uses CORRECTION_PATTERNS directly
}
```

### 6.2 After (refactored)

```typescript
import type { SignalPatternSet } from "./lang/registry.js";

export function detectCorrections(
  chain: ConversationChain,
  patterns: SignalPatternSet,
): FailureSignal[] {
  // uses patterns.correction.indicators
  // uses patterns.correction.shortNegatives
  // uses patterns.question.indicators
}
```

### 6.3 Signal Registry Integration

The signal index (`signals/index.ts`) initializes the `SignalPatternRegistry` and passes the merged patterns to each language-sensitive detector:

```typescript
export async function detectAllSignals(
  chain: ConversationChain,
  config: SignalConfig,
  signalPatterns: SignalPatternSet,
  repeatFailState: RepeatFailState,
): FailureSignal[] {
  const signals: FailureSignal[] = [];

  // Language-sensitive (receive patterns)
  if (config["SIG-CORRECTION"]?.enabled !== false)
    signals.push(...detectCorrections(chain, signalPatterns));
  if (config["SIG-DISSATISFIED"]?.enabled !== false)
    signals.push(...detectDissatisfied(chain, signalPatterns));
  if (config["SIG-HALLUCINATION"]?.enabled !== false)
    signals.push(...detectHallucinations(chain, signalPatterns));
  if (config["SIG-UNVERIFIED-CLAIM"]?.enabled !== false)
    signals.push(...detectUnverifiedClaims(chain, signalPatterns));

  // Language-independent (no patterns needed)
  if (config["SIG-TOOL-FAIL"]?.enabled !== false)
    signals.push(...detectToolFails(chain));
  if (config["SIG-DOOM-LOOP"]?.enabled !== false)
    signals.push(...detectDoomLoops(chain));
  if (config["SIG-REPEAT-FAIL"]?.enabled !== false)
    signals.push(...detectRepeatFails(chain, repeatFailState));

  return signals;
}
```

---

## 7. Per-Language Pattern Contract

Each `signal-lang-{code}.ts` file MUST provide patterns for all categories in `SignalLanguagePack`. The following table defines the minimum pattern expectations per language per category.

### 7.1 Required Pattern Coverage

| Category | Min Patterns | What to Cover |
|----------|-------------|---------------|
| `correction.indicators` | 3+ | "wrong/incorrect", "that's not right", "you made a mistake", domain-specific corrections |
| `correction.shortNegatives` | 1+ | The language's standard short negation ("no", "nein", "non", "いいえ") |
| `question.indicators` | 2+ | "shall I?", "do you want?", question-mark heuristic |
| `dissatisfaction.indicators` | 3+ | "forget it", "never mind", "I'll do it myself", "useless", "pointless" |
| `dissatisfaction.satisfactionOverrides` | 2+ | "thanks", "perfect", "great", positive emoji |
| `dissatisfaction.resolutionIndicators` | 1+ | "sorry", "let me try again" |
| `completion.claims` | 3+ | "done", "deployed", "fixed", "completed", compound forms ("I've done it") |
| `systemState.claims` | 2+ | Resource claims ("disk usage is X%"), service status ("server is running") |
| `systemState.opinionExclusions` | 2+ | "I think", "probably", "maybe", "it seems" |

### 7.2 Language-Specific Notes

| Language | Code | Special Considerations |
|----------|------|----------------------|
| English | `en` | Baseline patterns; contractions ("that's", "I've") |
| German | `de` | Compound words ("Festplattenauslastung"), separable verbs ("hör auf"), formal/informal ("Sie"/"du") |
| French | `fr` | Elision ("c'est", "l'erreur"), negation structure ("ne...pas"), accent-sensitive patterns |
| Spanish | `es` | Inverted punctuation (¿¡), reflexive verbs ("olvidémonos"), regional variations (tú/vos) |
| Portuguese | `pt` | BR vs PT variants ("pronto" vs "feito"), gerund forms |
| Italian | `it` | Elision ("l'ho fatto"), double consonants ("sbagliato") |
| Chinese | `zh` | No word boundaries (`\b` ineffective) — use character sequences directly. "错了" (wrong), "完成" (complete), "算了" (forget it) |
| Japanese | `ja` | Mixed scripts (hiragana + kanji + katakana). No `\b` — use lookahead/lookbehind or direct sequences. "違う" (wrong), "完了" (done), "もういい" (forget it) |
| Korean | `ko` | Agglutinative — particles attached to stems. "틀렸" (wrong), "완료" (done), "됐어" (forget it) |
| Russian | `ru` | Case endings — use stem matching. "неправильно" (wrong), "готово" (done), "забудь" (forget it) |

### 7.3 CJK Word Boundary Handling

For Chinese, Japanese, and Korean, standard `\b` word boundaries do not work. Signal language packs for these languages MUST use:

- Direct character/sequence matching without `\b` anchors
- Lookahead/lookbehind for context where needed
- Character class ranges for script detection where appropriate

Example (Japanese correction):
```typescript
// ✗ Wrong — \b doesn't work for Japanese
/\b違う\b/
// ✓ Correct — direct sequence match
/違う|間違い|それは違/
```

---

## 8. Configuration

### 8.1 Language Resolution

The trace analyzer's signal language is configured via the existing `patterns.language` setting in Cortex config. No separate `traceAnalyzer.languages` setting is introduced — the user's language choice applies uniformly.

**Rationale:** A user who configures Cortex for `["en", "de", "fr"]` expects all language-aware features to work in those languages. Requiring a separate language config for trace analysis would be surprising and error-prone.

**Resolution order:**
1. `config.patterns.language` — primary source
2. Expansion: `"both"` → `["en", "de"]` (backward compatibility from RFC-004)
3. Expansion: `"all"` → all 10 built-in languages
4. String → single-element array (e.g., `"fr"` → `["fr"]`)

```typescript
// In src/trace-analyzer/index.ts — initialization

const languageCodes = resolveLanguageCodes(config.patterns.language);
const signalRegistry = new SignalPatternRegistry();
await signalRegistry.load(languageCodes);
```

### 8.2 No Config Changes Required

This addendum does NOT add new config keys. The existing config surface is sufficient:

| Existing Config | Effect on Signal Language |
|-----------------|--------------------------|
| `patterns.language: "both"` | Signals detect EN + DE (current behavior) |
| `patterns.language: "all"` | Signals detect all 10 languages |
| `patterns.language: ["en", "fr", "es"]` | Signals detect EN + FR + ES |
| `traceAnalyzer.signals.SIG-CORRECTION.enabled: false` | Disables correction detection entirely (regardless of language) |

---

## 9. Requirements

Continuing from RFC-005 R-054:

### 9.1 MUST

| ID | Requirement |
|----|------------|
| R-055 | Each language-sensitive signal detector (SIG-CORRECTION, SIG-DISSATISFIED, SIG-HALLUCINATION, SIG-UNVERIFIED-CLAIM) MUST accept a `SignalPatternSet` parameter instead of using hardcoded regex arrays. |
| R-056 | A `SignalLanguagePack` type MUST be defined with the pattern categories specified in §3 (`correction`, `question`, `dissatisfaction`, `completion`, `systemState`). |
| R-057 | A `SignalPatternRegistry` MUST be implemented following the same conventions as RFC-004's `PatternRegistry`: per-language files, sync load for EN/DE, async load for other languages, cache on merge. |
| R-058 | Signal language packs MUST be provided for all 10 built-in languages: EN, DE, FR, ES, PT, IT, ZH, JA, KO, RU. |
| R-059 | The `SignalPatternRegistry` MUST load languages based on the existing `config.patterns.language` setting — no separate trace analyzer language config. |
| R-060 | CJK language packs (ZH, JA, KO) MUST NOT use `\b` word boundaries in their patterns. They MUST use direct character sequence matching or appropriate Unicode-aware alternatives. |
| R-061 | Language-independent signal detectors (SIG-TOOL-FAIL, SIG-DOOM-LOOP, SIG-REPEAT-FAIL) MUST NOT be modified by this change. They MUST continue to operate on event structure only. |
| R-062 | The refactored detectors MUST maintain identical behavior for EN and DE inputs as the current hardcoded implementation. Existing tests MUST pass without modification. |

### 9.2 SHOULD

| ID | Requirement |
|----|------------|
| R-063 | Each signal language pack SHOULD include at least the minimum pattern counts defined in §7.1 per category. |
| R-064 | Signal language packs SHOULD include patterns for both formal and informal registers where the language distinguishes them (e.g., German du/Sie, Spanish tú/usted, Portuguese tu/você). |
| R-065 | The `SignalPatternRegistry` SHOULD support `registerSignalLanguagePack()` for runtime extension by third-party plugins or user config. |
| R-066 | Detection accuracy for each language SHOULD be validated with at least 5 positive and 3 negative test cases per signal per language (total: ~320 tests across 4 signals × 10 languages). |

### 9.3 MAY

| ID | Requirement |
|----|------------|
| R-067 | A future `customSignalPatterns` config key MAY be added to allow users to extend or override signal patterns per language (following the `patterns.custom` model from RFC-004). |
| R-068 | The `SignalPatternRegistry` MAY share a base class or utility module with `PatternRegistry` if common loading/caching logic is extracted during implementation. |

---

## 10. Universal Patterns (Language-Independent)

Some patterns are language-independent and apply universally across all signal language packs. These are NOT in per-language files — they live in the registry itself:

| Pattern | Used By | Rationale |
|---------|---------|-----------|
| `/\?\s*$/m` | `question.indicators` | Trailing question mark — universal punctuation |
| `/[✅✓☑]/` | `completion.claims` | Emoji/symbols — no language |
| `/[👍🎉💯❤️]/` | `dissatisfaction.satisfactionOverrides` | Positive emoji — no language |

The `SignalPatternRegistry` merges these universal patterns with the per-language patterns during `getPatterns()`.

---

## 11. Testing Strategy

### 11.1 Per-Language Signal Tests

New test file: `test/trace-analyzer/signals/lang/signal-lang-{code}.test.ts` per language.

Each test file validates:
- All pattern categories have ≥1 pattern
- Positive matches for representative phrases
- No false positives on neutral text
- CJK packs don't use `\b`

### 11.2 Registry Tests

New test file: `test/trace-analyzer/signals/lang/registry.test.ts`

- Single language load
- Multi-language load merges all pattern arrays
- `"both"` / `"all"` expansion
- Runtime pack registration
- Cache invalidation on re-load

### 11.3 Refactored Detector Tests

Existing detector tests (`test/trace-analyzer/signals/correction.test.ts`, etc.) are updated to pass a `SignalPatternSet` but MUST continue to pass for EN/DE inputs (R-062).

New test cases added per detector for each non-EN/DE language.

### 11.4 Estimated Test Count

| Area | Tests |
|------|-------|
| Signal language packs (10 × ~10) | ~100 |
| SignalPatternRegistry | ~15 |
| Refactored detector tests (new language cases) | ~80 |
| **Total new tests** | **~195** |

---

## 12. Migration Plan

### 12.1 Phase 1: Type + Registry (non-breaking)

1. Add `SignalLanguagePack` type and `SignalPatternRegistry` class
2. Create `signal-lang-en.ts` and `signal-lang-de.ts` by extracting current hardcoded patterns
3. Verify existing tests still pass

### 12.2 Phase 2: Refactor Detectors (internal change)

1. Change detector function signatures to accept `SignalPatternSet`
2. Update `signals/index.ts` to initialize registry and pass patterns
3. Update existing tests to provide patterns — no behavior change for EN/DE

### 12.3 Phase 3: Add Languages (additive)

1. Create `signal-lang-{fr,es,pt,it,zh,ja,ko,ru}.ts` — one per language
2. Add per-language tests
3. Verify with `config.patterns.language: "all"`

### 12.4 Estimated Scope

| Item | Lines (est.) |
|------|-------------|
| `SignalLanguagePack` type | ~80 |
| `SignalPatternRegistry` | ~120 |
| 10 language pack files (avg ~60 lines each) | ~600 |
| Detector refactoring (4 files) | ~80 delta |
| Tests | ~800 |
| **Total** | **~1,680** |

---

*End of RFC-005 Addendum — Multi-Language Signal Detection*

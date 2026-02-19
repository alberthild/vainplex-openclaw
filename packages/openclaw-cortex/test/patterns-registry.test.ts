import { describe, it, expect } from "vitest";
import { PatternRegistry, BUILTIN_LANGUAGES } from "../src/patterns/index.js";
import { LANG_EN } from "../src/patterns/lang-en.js";
import { LANG_DE } from "../src/patterns/lang-de.js";
import type { LanguagePack } from "../src/patterns/types.js";

// ════════════════════════════════════════════════════════════
// Synchronous loading
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — loadSync", () => {
  it("loads EN pack", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    expect(reg.getLoadedLanguages()).toEqual(["en"]);
  });

  it("loads DE pack", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["de"]);
    expect(reg.getLoadedLanguages()).toEqual(["de"]);
  });

  it("loads both EN and DE", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    expect(reg.getLoadedLanguages()).toEqual(["en", "de"]);
  });

  it("ignores unknown language codes", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "xx", "yy"]);
    expect(reg.getLoadedLanguages()).toEqual(["en"]);
  });

  it("returns empty patterns for no languages", () => {
    const reg = new PatternRegistry();
    reg.loadSync([]);
    const p = reg.getPatterns();
    expect(p.decision).toHaveLength(0);
    expect(p.close).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// Async loading
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — load (async)", () => {
  it("loads FR async", async () => {
    const reg = new PatternRegistry();
    await reg.load(["fr"]);
    expect(reg.getLoadedLanguages()).toEqual(["fr"]);
    const p = reg.getPatterns();
    expect(p.decision.length).toBeGreaterThan(0);
  });

  it("loads multiple languages async", async () => {
    const reg = new PatternRegistry();
    await reg.load(["en", "de", "fr", "es"]);
    expect(reg.getLoadedLanguages()).toEqual(["en", "de", "fr", "es"]);
  });

  it("loads all builtin languages", async () => {
    const reg = new PatternRegistry();
    await reg.load(BUILTIN_LANGUAGES);
    expect(reg.getLoadedLanguages()).toHaveLength(10);
  });

  it("ignores unknown codes in async mode", async () => {
    const reg = new PatternRegistry();
    await reg.load(["en", "xx"]);
    expect(reg.getLoadedLanguages()).toEqual(["en"]);
  });
});

// ════════════════════════════════════════════════════════════
// Pattern merging
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — pattern merging", () => {
  it("merges decision patterns from multiple packs", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const p = reg.getPatterns();
    expect(p.decision.length).toBe(
      LANG_EN.patterns.decision.length + LANG_DE.patterns.decision.length,
    );
  });

  it("merges close patterns from multiple packs", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const p = reg.getPatterns();
    expect(p.close.length).toBe(
      LANG_EN.patterns.close.length + LANG_DE.patterns.close.length,
    );
  });

  it("merged EN+DE decision patterns match both languages", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const p = reg.getPatterns();
    expect(p.decision.some(r => r.test("We decided"))).toBe(true);
    expect(p.decision.some(r => r.test("Wir haben beschlossen"))).toBe(true);
  });

  it("EN-only patterns do not match DE text", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const p = reg.getPatterns();
    expect(p.decision.some(r => r.test("beschlossen"))).toBe(false);
  });

  it("merges 3+ languages correctly", async () => {
    const reg = new PatternRegistry();
    await reg.load(["en", "de", "fr"]);
    const p = reg.getPatterns();
    expect(p.decision.some(r => r.test("decided"))).toBe(true);
    expect(p.decision.some(r => r.test("beschlossen"))).toBe(true);
    expect(p.decision.some(r => r.test("décidé de faire"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Caching
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — caching", () => {
  it("returns same patterns object on repeated calls", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const p1 = reg.getPatterns();
    const p2 = reg.getPatterns();
    expect(p1).toBe(p2);
  });

  it("returns same blacklist on repeated calls", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const b1 = reg.getBlacklist();
    const b2 = reg.getBlacklist();
    expect(b1).toBe(b2);
  });

  it("returns same keywords on repeated calls", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const k1 = reg.getHighImpactKeywords();
    const k2 = reg.getHighImpactKeywords();
    expect(k1).toBe(k2);
  });

  it("invalidates cache on new loadSync", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const p1 = reg.getPatterns();
    reg.loadSync(["en", "de"]);
    const p2 = reg.getPatterns();
    expect(p1).not.toBe(p2);
    expect(p2.decision.length).toBeGreaterThan(p1.decision.length);
  });

  it("invalidates cache on registerLanguagePack", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const p1 = reg.getPatterns();
    reg.registerLanguagePack(LANG_DE);
    const p2 = reg.getPatterns();
    expect(p1).not.toBe(p2);
  });
});

// ════════════════════════════════════════════════════════════
// Blacklist merging
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — blacklist merging", () => {
  it("merges blacklists from EN and DE", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const bl = reg.getBlacklist();
    // EN words
    expect(bl.has("the")).toBe(true);
    expect(bl.has("nothing")).toBe(true);
    // DE words
    expect(bl.has("das")).toBe(true);
    expect(bl.has("nichts")).toBe(true);
  });

  it("single language has only its blacklist", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const bl = reg.getBlacklist();
    expect(bl.has("the")).toBe(true);
    expect(bl.has("das")).toBe(false);
  });

  it("returns Set type", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    expect(reg.getBlacklist()).toBeInstanceOf(Set);
  });
});

// ════════════════════════════════════════════════════════════
// High-impact keywords merging
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — keywords merging", () => {
  it("merges keywords from EN and DE", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const kw = reg.getHighImpactKeywords();
    expect(kw).toContain("architecture");
    expect(kw).toContain("architektur");
  });

  it("deduplicates shared keywords", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const kw = reg.getHighImpactKeywords();
    // "migration" appears in both packs
    const migrationCount = kw.filter(k => k === "migration").length;
    expect(migrationCount).toBe(1);
  });

  it("returns array type", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    expect(Array.isArray(reg.getHighImpactKeywords())).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Mood patterns
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — mood patterns", () => {
  it("returns all five moods", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const moods = reg.getMoodPatterns();
    expect(moods).toHaveProperty("frustrated");
    expect(moods).toHaveProperty("excited");
    expect(moods).toHaveProperty("tense");
    expect(moods).toHaveProperty("productive");
    expect(moods).toHaveProperty("exploratory");
  });

  it("each mood pattern is a RegExp", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const moods = reg.getMoodPatterns();
    for (const p of Object.values(moods)) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it("merged mood matches universal emoji", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const moods = reg.getMoodPatterns();
    expect(moods.frustrated.test("argh")).toBe(true);
    expect(moods.excited.test("🚀")).toBe(true);
    expect(moods.productive.test("✅")).toBe(true);
  });

  it("merged mood matches language-specific words", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en", "de"]);
    const moods = reg.getMoodPatterns();
    // EN
    expect(moods.frustrated.test("damn it")).toBe(true);
    // DE
    expect(moods.frustrated.test("Mist!")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Runtime registration
// ════════════════════════════════════════════════════════════
describe("PatternRegistry — registerLanguagePack", () => {
  it("adds a new pack", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const custom: LanguagePack = {
      code: "test",
      name: "Test",
      nameEn: "Test",
      patterns: { decision: [/testdecision/], close: [], wait: [], topic: [] },
      topicBlacklist: [],
      highImpactKeywords: ["testword"],
    };
    reg.registerLanguagePack(custom);
    expect(reg.getLoadedLanguages()).toContain("test");
    expect(reg.getPatterns().decision.some(r => r.test("testdecision"))).toBe(true);
    expect(reg.getHighImpactKeywords()).toContain("testword");
  });

  it("replaces existing pack with same code", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"]);
    const replacement: LanguagePack = {
      code: "en",
      name: "English v2",
      nameEn: "English v2",
      patterns: { decision: [/replaced/], close: [], wait: [], topic: [] },
      topicBlacklist: [],
      highImpactKeywords: [],
    };
    reg.registerLanguagePack(replacement);
    const langs = reg.getLoadedLanguages();
    expect(langs.filter(l => l === "en")).toHaveLength(1);
    expect(reg.getPatterns().decision.some(r => r.test("replaced"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// BUILTIN_LANGUAGES constant
// ════════════════════════════════════════════════════════════
describe("BUILTIN_LANGUAGES", () => {
  it("contains 10 languages", () => {
    expect(BUILTIN_LANGUAGES).toHaveLength(10);
  });

  it("includes all expected codes", () => {
    expect(BUILTIN_LANGUAGES).toContain("en");
    expect(BUILTIN_LANGUAGES).toContain("de");
    expect(BUILTIN_LANGUAGES).toContain("fr");
    expect(BUILTIN_LANGUAGES).toContain("es");
    expect(BUILTIN_LANGUAGES).toContain("pt");
    expect(BUILTIN_LANGUAGES).toContain("it");
    expect(BUILTIN_LANGUAGES).toContain("zh");
    expect(BUILTIN_LANGUAGES).toContain("ja");
    expect(BUILTIN_LANGUAGES).toContain("ko");
    expect(BUILTIN_LANGUAGES).toContain("ru");
  });
});

import { describe, it, expect } from "vitest";
import { SignalPatternRegistry, BUILTIN_SIGNAL_LANGUAGES } from "../../../../src/trace-analyzer/signals/lang/index.js";
import type { SignalLanguagePack } from "../../../../src/trace-analyzer/signals/lang/types.js";

describe("SignalPatternRegistry", () => {
  // ---- Sync loading ----

  it("loadSync loads EN patterns", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    expect(reg.getLoadedLanguages()).toEqual(["en"]);

    const p = reg.getPatterns();
    expect(p.correction.indicators.length).toBeGreaterThan(0);
    expect(p.dissatisfaction.indicators.length).toBeGreaterThan(0);
    expect(p.completion.claims.length).toBeGreaterThan(0);
  });

  it("loadSync loads DE patterns", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["de"]);
    expect(reg.getLoadedLanguages()).toEqual(["de"]);

    const p = reg.getPatterns();
    expect(p.correction.indicators.length).toBeGreaterThan(0);
    // "falsch" should match
    expect(p.correction.indicators.some(r => r.test("das ist falsch"))).toBe(true);
  });

  it("loadSync merges EN+DE patterns", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en", "de"]);
    expect(reg.getLoadedLanguages()).toEqual(["en", "de"]);

    const p = reg.getPatterns();
    // EN pattern
    expect(p.correction.indicators.some(r => r.test("wrong"))).toBe(true);
    // DE pattern
    expect(p.correction.indicators.some(r => r.test("falsch"))).toBe(true);
  });

  it("loadSync ignores non-sync languages", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en", "fr"]);
    // FR is async-only, so only EN loads
    expect(reg.getLoadedLanguages()).toEqual(["en"]);
  });

  // ---- Async loading ----

  it("async load supports all 10 languages", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(BUILTIN_SIGNAL_LANGUAGES);
    expect(reg.getLoadedLanguages()).toEqual(BUILTIN_SIGNAL_LANGUAGES);

    const p = reg.getPatterns();
    // Should have patterns from all languages merged
    expect(p.correction.indicators.length).toBeGreaterThan(10);
    expect(p.dissatisfaction.indicators.length).toBeGreaterThan(10);
    expect(p.completion.claims.length).toBeGreaterThan(10);
  });

  it("async load FR patterns detect French correction", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(["fr"]);
    const p = reg.getPatterns();
    expect(p.correction.indicators.some(r => r.test("c'est faux"))).toBe(true);
  });

  it("async load ES patterns detect Spanish dissatisfaction", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(["es"]);
    const p = reg.getPatterns();
    expect(p.dissatisfaction.indicators.some(r => r.test("olvídalo"))).toBe(true);
  });

  // ---- Universal patterns ----

  it("includes universal question mark pattern", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    const p = reg.getPatterns();
    expect(p.question.indicators.some(r => r.test("Is that right?"))).toBe(true);
  });

  it("includes universal completion emoji", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    const p = reg.getPatterns();
    expect(p.completion.claims.some(r => r.test("✅"))).toBe(true);
    expect(p.completion.claims.some(r => r.test("✓"))).toBe(true);
  });

  it("includes universal satisfaction emoji", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    const p = reg.getPatterns();
    expect(p.dissatisfaction.satisfactionOverrides.some(r => r.test("👍"))).toBe(true);
  });

  // ---- Caching ----

  it("caches merged patterns — same object on repeated getPatterns()", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en", "de"]);
    const p1 = reg.getPatterns();
    const p2 = reg.getPatterns();
    expect(p1).toBe(p2);
  });

  it("invalidates cache on loadSync", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    const p1 = reg.getPatterns();
    reg.loadSync(["en", "de"]);
    const p2 = reg.getPatterns();
    expect(p1).not.toBe(p2);
    // p2 should have more patterns (DE added)
    expect(p2.correction.indicators.length).toBeGreaterThan(p1.correction.indicators.length);
  });

  it("invalidates cache on async load", async () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);
    const p1 = reg.getPatterns();
    await reg.load(["en", "fr"]);
    const p2 = reg.getPatterns();
    expect(p1).not.toBe(p2);
  });

  // ---- Runtime registration ----

  it("registerSignalLanguagePack adds new pack", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);

    const custom: SignalLanguagePack = {
      code: "xx",
      name: "Test",
      nameEn: "Test Language",
      correction: {
        indicators: [/\btestfalsch\b/i],
        shortNegatives: [/^\s*testnein\s*$/i],
      },
      question: { indicators: [/\btestfrage\b/i] },
      dissatisfaction: {
        indicators: [/\btestfrust\b/i],
        satisfactionOverrides: [/\btestdanke\b/i],
        resolutionIndicators: [/\btestsorry\b/i],
      },
      completion: { claims: [/\btestfertig\b/i] },
      systemState: {
        claims: [/\btestclaim\b/i],
        opinionExclusions: [/\btestmaybe\b/i],
      },
    };

    reg.registerSignalLanguagePack(custom);
    expect(reg.getLoadedLanguages()).toContain("xx");

    const p = reg.getPatterns();
    expect(p.correction.indicators.some(r => r.test("testfalsch"))).toBe(true);
    expect(p.completion.claims.some(r => r.test("testfertig"))).toBe(true);
  });

  it("registerSignalLanguagePack replaces existing pack", () => {
    const reg = new SignalPatternRegistry();
    reg.loadSync(["en"]);

    // count EN patterns
    const before = reg.getPatterns().correction.indicators.length;

    // Register a pack with code "en" that has only 1 indicator
    const custom: SignalLanguagePack = {
      code: "en",
      name: "Custom EN",
      nameEn: "Custom English",
      correction: { indicators: [/\bcustomwrong\b/i], shortNegatives: [] },
      question: { indicators: [] },
      dissatisfaction: { indicators: [], satisfactionOverrides: [], resolutionIndicators: [] },
      completion: { claims: [] },
      systemState: { claims: [], opinionExclusions: [] },
    };

    reg.registerSignalLanguagePack(custom);
    const p = reg.getPatterns();
    // Should have replaced — so fewer EN patterns
    expect(p.correction.indicators.some(r => r.test("customwrong"))).toBe(true);
    expect(p.correction.indicators.some(r => r.test("wrong"))).toBe(false);
  });

  // ---- CJK patterns — no \b ----

  it("CJK patterns (ZH) match without word boundaries", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(["zh"]);
    const p = reg.getPatterns();

    expect(p.correction.indicators.some(r => r.test("这个错了"))).toBe(true);
    expect(p.completion.claims.some(r => r.test("已经完成了"))).toBe(true);
    expect(p.dissatisfaction.indicators.some(r => r.test("算了吧"))).toBe(true);
  });

  it("CJK patterns (JA) match without word boundaries", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(["ja"]);
    const p = reg.getPatterns();

    expect(p.correction.indicators.some(r => r.test("それは違うよ"))).toBe(true);
    expect(p.completion.claims.some(r => r.test("完了しました"))).toBe(true);
    expect(p.dissatisfaction.indicators.some(r => r.test("もういいよ"))).toBe(true);
  });

  it("CJK patterns (KO) match without word boundaries", async () => {
    const reg = new SignalPatternRegistry();
    await reg.load(["ko"]);
    const p = reg.getPatterns();

    expect(p.correction.indicators.some(r => r.test("그건 틀렸어"))).toBe(true);
    expect(p.completion.claims.some(r => r.test("완료했습니다"))).toBe(true);
    expect(p.dissatisfaction.indicators.some(r => r.test("됐어 그만해"))).toBe(true);
  });

  // ---- BUILTIN_SIGNAL_LANGUAGES constant ----

  it("BUILTIN_SIGNAL_LANGUAGES has 10 entries", () => {
    expect(BUILTIN_SIGNAL_LANGUAGES).toHaveLength(10);
    expect(BUILTIN_SIGNAL_LANGUAGES).toContain("en");
    expect(BUILTIN_SIGNAL_LANGUAGES).toContain("zh");
    expect(BUILTIN_SIGNAL_LANGUAGES).toContain("ko");
  });
});

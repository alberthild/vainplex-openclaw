import { describe, it, expect } from "vitest";
import type { SignalLanguagePack } from "../../../../src/trace-analyzer/signals/lang/types.js";
import { SIGNAL_LANG_EN } from "../../../../src/trace-analyzer/signals/lang/signal-lang-en.js";
import { SIGNAL_LANG_DE } from "../../../../src/trace-analyzer/signals/lang/signal-lang-de.js";

// Async-loaded languages
const asyncLangs: Record<string, () => Promise<SignalLanguagePack>> = {
  fr: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-fr.js")).default,
  es: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-es.js")).default,
  pt: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-pt.js")).default,
  it: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-it.js")).default,
  zh: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-zh.js")).default,
  ja: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-ja.js")).default,
  ko: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-ko.js")).default,
  ru: async () => (await import("../../../../src/trace-analyzer/signals/lang/signal-lang-ru.js")).default,
};

const CJK_CODES = new Set(["zh", "ja", "ko"]);

/**
 * Validate that a language pack meets minimum requirements from §7.1.
 */
function validatePack(pack: SignalLanguagePack): void {
  // Metadata
  expect(pack.code).toBeTruthy();
  expect(pack.name).toBeTruthy();
  expect(pack.nameEn).toBeTruthy();

  // Minimum pattern counts (from §7.1)
  expect(pack.correction.indicators.length).toBeGreaterThanOrEqual(3);
  expect(pack.correction.shortNegatives.length).toBeGreaterThanOrEqual(1);
  expect(pack.question.indicators.length).toBeGreaterThanOrEqual(1);
  expect(pack.dissatisfaction.indicators.length).toBeGreaterThanOrEqual(3);
  expect(pack.dissatisfaction.satisfactionOverrides.length).toBeGreaterThanOrEqual(1);
  expect(pack.dissatisfaction.resolutionIndicators.length).toBeGreaterThanOrEqual(1);
  expect(pack.completion.claims.length).toBeGreaterThanOrEqual(3);
  expect(pack.systemState.claims.length).toBeGreaterThanOrEqual(2);
  expect(pack.systemState.opinionExclusions.length).toBeGreaterThanOrEqual(2);

  // All patterns must compile (no throws on .test())
  const allPatterns = [
    ...pack.correction.indicators,
    ...pack.correction.shortNegatives,
    ...pack.question.indicators,
    ...pack.dissatisfaction.indicators,
    ...pack.dissatisfaction.satisfactionOverrides,
    ...pack.dissatisfaction.resolutionIndicators,
    ...pack.completion.claims,
    ...pack.systemState.claims,
    ...pack.systemState.opinionExclusions,
  ];

  for (const p of allPatterns) {
    expect(p).toBeInstanceOf(RegExp);
    // Ensure it doesn't throw on test
    expect(() => p.test("test string")).not.toThrow();
  }

  // CJK languages MUST NOT use \b
  if (CJK_CODES.has(pack.code)) {
    for (const p of allPatterns) {
      expect(p.source).not.toContain("\\b");
    }
  }
}

// ---- Tests ----

describe("Signal language pack validation", () => {
  describe("EN — English", () => {
    it("meets minimum pattern requirements", () => {
      validatePack(SIGNAL_LANG_EN);
    });

    it("matches representative English phrases", () => {
      expect(SIGNAL_LANG_EN.correction.indicators.some(r => r.test("wrong"))).toBe(true);
      expect(SIGNAL_LANG_EN.correction.indicators.some(r => r.test("that's not right"))).toBe(true);
      expect(SIGNAL_LANG_EN.dissatisfaction.indicators.some(r => r.test("forget it"))).toBe(true);
      expect(SIGNAL_LANG_EN.completion.claims.some(r => r.test("done"))).toBe(true);
      expect(SIGNAL_LANG_EN.completion.claims.some(r => r.test("fixed"))).toBe(true);
    });
  });

  describe("DE — German", () => {
    it("meets minimum pattern requirements", () => {
      validatePack(SIGNAL_LANG_DE);
    });

    it("matches representative German phrases", () => {
      expect(SIGNAL_LANG_DE.correction.indicators.some(r => r.test("das ist falsch"))).toBe(true);
      expect(SIGNAL_LANG_DE.dissatisfaction.indicators.some(r => r.test("vergiss es"))).toBe(true);
      expect(SIGNAL_LANG_DE.completion.claims.some(r => r.test("erledigt"))).toBe(true);
    });
  });

  describe("FR — French", () => {
    it("meets minimum pattern requirements", async () => {
      validatePack(await asyncLangs.fr());
    });

    it("matches representative French phrases", async () => {
      const fr = await asyncLangs.fr();
      expect(fr.correction.indicators.some(r => r.test("c'est faux"))).toBe(true);
      expect(fr.dissatisfaction.indicators.some(r => r.test("laisse tomber"))).toBe(true);
      expect(fr.completion.claims.some(r => r.test("terminé"))).toBe(true);
      expect(fr.systemState.opinionExclusions.some(r => r.test("je crois"))).toBe(true);
    });
  });

  describe("ES — Spanish", () => {
    it("meets minimum pattern requirements", async () => {
      validatePack(await asyncLangs.es());
    });

    it("matches representative Spanish phrases", async () => {
      const es = await asyncLangs.es();
      expect(es.correction.indicators.some(r => r.test("eso está mal"))).toBe(true);
      expect(es.dissatisfaction.indicators.some(r => r.test("olvídalo"))).toBe(true);
      expect(es.completion.claims.some(r => r.test("completado"))).toBe(true);
    });
  });

  describe("PT — Portuguese", () => {
    it("meets minimum pattern requirements", async () => {
      validatePack(await asyncLangs.pt());
    });

    it("matches representative Portuguese phrases", async () => {
      const pt = await asyncLangs.pt();
      expect(pt.correction.indicators.some(r => r.test("isso está errado"))).toBe(true);
      expect(pt.dissatisfaction.indicators.some(r => r.test("deixa pra lá"))).toBe(true);
      expect(pt.completion.claims.some(r => r.test("pronto"))).toBe(true);
    });
  });

  describe("IT — Italian", () => {
    it("meets minimum pattern requirements", async () => {
      validatePack(await asyncLangs.it());
    });

    it("matches representative Italian phrases", async () => {
      const it_ = await asyncLangs.it();
      expect(it_.correction.indicators.some(r => r.test("è sbagliato"))).toBe(true);
      expect(it_.dissatisfaction.indicators.some(r => r.test("lascia perdere"))).toBe(true);
      expect(it_.completion.claims.some(r => r.test("fatto"))).toBe(true);
    });
  });

  describe("ZH — Chinese (CJK)", () => {
    it("meets minimum pattern requirements + no \\b", async () => {
      validatePack(await asyncLangs.zh());
    });

    it("matches representative Chinese phrases", async () => {
      const zh = await asyncLangs.zh();
      expect(zh.correction.indicators.some(r => r.test("这个错了"))).toBe(true);
      expect(zh.dissatisfaction.indicators.some(r => r.test("算了吧"))).toBe(true);
      expect(zh.completion.claims.some(r => r.test("已经完成了"))).toBe(true);
      expect(zh.systemState.opinionExclusions.some(r => r.test("我觉得可能是"))).toBe(true);
    });
  });

  describe("JA — Japanese (CJK)", () => {
    it("meets minimum pattern requirements + no \\b", async () => {
      validatePack(await asyncLangs.ja());
    });

    it("matches representative Japanese phrases", async () => {
      const ja = await asyncLangs.ja();
      expect(ja.correction.indicators.some(r => r.test("それは違うよ"))).toBe(true);
      expect(ja.dissatisfaction.indicators.some(r => r.test("もういいです"))).toBe(true);
      expect(ja.completion.claims.some(r => r.test("完了しました"))).toBe(true);
    });
  });

  describe("KO — Korean (CJK)", () => {
    it("meets minimum pattern requirements + no \\b", async () => {
      validatePack(await asyncLangs.ko());
    });

    it("matches representative Korean phrases", async () => {
      const ko = await asyncLangs.ko();
      expect(ko.correction.indicators.some(r => r.test("그건 틀렸어"))).toBe(true);
      expect(ko.dissatisfaction.indicators.some(r => r.test("됐어 그만"))).toBe(true);
      expect(ko.completion.claims.some(r => r.test("완료했습니다"))).toBe(true);
    });
  });

  describe("RU — Russian", () => {
    it("meets minimum pattern requirements", async () => {
      validatePack(await asyncLangs.ru());
    });

    it("matches representative Russian phrases", async () => {
      const ru = await asyncLangs.ru();
      expect(ru.correction.indicators.some(r => r.test("это неправильно"))).toBe(true);
      expect(ru.dissatisfaction.indicators.some(r => r.test("забудь это"))).toBe(true);
      expect(ru.completion.claims.some(r => r.test("готово"))).toBe(true);
    });
  });
});

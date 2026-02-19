import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function ruRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["ru"]);
  return reg;
}

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

function captureTopics(patterns: RegExp[], text: string): string[] {
  const topics: string[] = [];
  for (const p of patterns) {
    const g = new RegExp(p.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (m[1]) topics.push(m[1].trim());
    }
  }
  return topics;
}

describe("Russian language pack", () => {
  describe("decision patterns", () => {
    it("matches 'решили' (decided)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Мы решили использовать TypeScript")).toBe(true);
    });

    it("matches 'решение' (decision)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Решение принято вчера")).toBe(true);
    });

    it("matches 'договорились' (agreed)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Мы договорились на MIT лицензию")).toBe(true);
    });

    it("matches 'утвердили' (approved)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Архитектуру утвердили")).toBe(true);
    });

    it("does not match unrelated Russian text", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Сегодня хорошая погода")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches 'сделано' (done)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().close, "Всё сделано!")).toBe(true);
    });

    it("matches 'решено' (resolved)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().close, "Проблема решено")).toBe(true);
    });

    it("matches 'готово' (ready)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().close, "Уже готово")).toBe(true);
    });

    it("matches 'работает' (works)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().close, "Теперь работает нормально")).toBe(true);
    });

    it("matches 'исправлено' (fixed)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().close, "Баг исправлено")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches 'ждём' (waiting)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Ждём ревью от команды")).toBe(true);
    });

    it("matches 'заблокировано' (blocked)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Заблокировано из-за API")).toBe(true);
    });

    it("matches 'ожидаем' (expecting)", async () => {
      const reg = await ruRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Ожидаем утверждения")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'по поводу' (about)", async () => {
      const reg = await ruRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "по поводу миграции базы данных");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("миграции");
    });

    it("captures topic after 'давайте обсудим' (let's discuss)", async () => {
      const reg = await ruRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "давайте обсудим архитектуру системы");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'чёрт' (damn)", async () => {
      const reg = await ruRegistry();
      expect(reg.getMoodPatterns().frustrated.test("чёрт, опять сломалось")).toBe(true);
    });

    it("detects excited: 'круто' (cool)", async () => {
      const reg = await ruRegistry();
      expect(reg.getMoodPatterns().excited.test("Это круто!")).toBe(true);
    });

    it("detects tense: 'срочно' (urgently)", async () => {
      const reg = await ruRegistry();
      expect(reg.getMoodPatterns().tense.test("Нужно срочно починить")).toBe(true);
    });

    it("detects productive: 'задеплоил' (deployed)", async () => {
      const reg = await ruRegistry();
      expect(reg.getMoodPatterns().productive.test("Задеплоил на прод")).toBe(true);
    });
  });

  describe("blacklist and keywords", () => {
    it("contains Russian noise words", async () => {
      const reg = await ruRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("это")).toBe(true);
      expect(bl.has("ничего")).toBe(true);
    });

    it("contains Russian keywords", async () => {
      const reg = await ruRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("безопасность");
      expect(kw).toContain("архитектура");
    });
  });
});

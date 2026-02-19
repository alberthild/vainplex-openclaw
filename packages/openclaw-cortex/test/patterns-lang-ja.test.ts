import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function jaRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["ja"]);
  return reg;
}

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

function captureTopics(patterns: RegExp[], text: string): string[] {
  const topics: string[] = [];
  for (const p of patterns) {
    const g = new RegExp(p.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (m[1]) topics.push(m[1].trim());
    }
  }
  return topics;
}

describe("Japanese language pack", () => {
  describe("decision patterns", () => {
    it("matches '決めた' (decided)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().decision, "TypeScriptに決めた")).toBe(true);
    });

    it("matches '決定した' (decided/determined)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().decision, "方針を決定した")).toBe(true);
    });

    it("matches 'にしよう' (let's go with)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Reactにしよう")).toBe(true);
    });

    it("matches '採用する' (adopt)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().decision, "この方法を採用する")).toBe(true);
    });

    it("does not match unrelated Japanese text", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().decision, "今日はいい天気ですね")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches '完了' (completed)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().close, "タスク完了しました")).toBe(true);
    });

    it("matches '解決した' (solved)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().close, "問題を解決した")).toBe(true);
    });

    it("matches '直した' (fixed)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().close, "バグを直した")).toBe(true);
    });

    it("matches 'できた' (done)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().close, "実装できた！")).toBe(true);
    });

    it("matches '動いた' (it works)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().close, "やっと動いた")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches '待って' (waiting)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().wait, "レビューを待ってます")).toBe(true);
    });

    it("matches 'ブロック' (blocked)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().wait, "APIの変更でブロックされてる")).toBe(true);
    });

    it("matches '待機中' (on standby)", async () => {
      const reg = await jaRegistry();
      expect(anyMatch(reg.getPatterns().wait, "承認待機中です")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'について'", async () => {
      const reg = await jaRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "セキュリティについて 認証システム");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'の件'", async () => {
      const reg = await jaRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "デプロイの件 本番環境");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'くそ' (damn)", async () => {
      const reg = await jaRegistry();
      expect(reg.getMoodPatterns().frustrated.test("くそ、また壊れた")).toBe(true);
    });

    it("detects excited: 'すごい' (amazing)", async () => {
      const reg = await jaRegistry();
      expect(reg.getMoodPatterns().excited.test("すごい！動いた")).toBe(true);
    });

    it("detects tense: '緊急' (urgent)", async () => {
      const reg = await jaRegistry();
      expect(reg.getMoodPatterns().tense.test("緊急で対応必要")).toBe(true);
    });

    it("detects productive: '修正済' (fixed)", async () => {
      const reg = await jaRegistry();
      expect(reg.getMoodPatterns().productive.test("バグ修正済み")).toBe(true);
    });
  });

  describe("blacklist and keywords", () => {
    it("contains Japanese noise words", async () => {
      const reg = await jaRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("これ")).toBe(true);
      expect(bl.has("それ")).toBe(true);
    });

    it("contains Japanese keywords", async () => {
      const reg = await jaRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("セキュリティ");
      expect(kw).toContain("デプロイ");
    });
  });
});

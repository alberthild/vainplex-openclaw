import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function koRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["ko"]);
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

describe("Korean language pack", () => {
  describe("decision patterns", () => {
    it("matches '결정' (decision)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().decision, "TypeScript로 결정했습니다")).toBe(true);
    });

    it("matches '하기로' (decided to)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().decision, "이 방식으로 하기로 했어요")).toBe(true);
    });

    it("matches '확정' (confirmed)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().decision, "일정이 확정되었습니다")).toBe(true);
    });

    it("matches '이걸로' (let's go with this)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().decision, "이걸로 가겠습니다")).toBe(true);
    });

    it("does not match unrelated Korean text", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().decision, "오늘 날씨가 좋네요")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches '완료' (completed)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().close, "작업 완료했습니다")).toBe(true);
    });

    it("matches '해결됐' (solved)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().close, "문제가 해결됐어요")).toBe(true);
    });

    it("matches '고쳤다' (fixed)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().close, "버그를 고쳤다")).toBe(true);
    });

    it("matches '끝났다' (finished)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().close, "개발 끝났다")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches '기다려' (waiting)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().wait, "리뷰 기다려주세요")).toBe(true);
    });

    it("matches '블로킹' (blocking)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().wait, "API 변경으로 블로킹됨")).toBe(true);
    });

    it("matches '대기 중' (on standby)", async () => {
      const reg = await koRegistry();
      expect(anyMatch(reg.getPatterns().wait, "승인 대기 중입니다")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after '에 대해' (about)", async () => {
      const reg = await koRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "보안에 대해 인증시스템");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after '관해서' (regarding)", async () => {
      const reg = await koRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "배포관해서 프로덕션");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: '짜증' (annoying)", async () => {
      const reg = await koRegistry();
      expect(reg.getMoodPatterns().frustrated.test("짜증나, 또 깨졌어")).toBe(true);
    });

    it("detects excited: '대박' (awesome)", async () => {
      const reg = await koRegistry();
      expect(reg.getMoodPatterns().excited.test("대박! 됐다")).toBe(true);
    });

    it("detects tense: '긴급' (urgent)", async () => {
      const reg = await koRegistry();
      expect(reg.getMoodPatterns().tense.test("긴급 대응 필요")).toBe(true);
    });
  });

  describe("blacklist and keywords", () => {
    it("contains Korean noise words", async () => {
      const reg = await koRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("이것")).toBe(true);
      expect(bl.has("그것")).toBe(true);
    });

    it("contains Korean keywords", async () => {
      const reg = await koRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("보안");
      expect(kw).toContain("배포");
    });
  });
});

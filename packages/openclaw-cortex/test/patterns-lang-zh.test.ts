import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function zhRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["zh"]);
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

describe("Chinese language pack", () => {
  describe("decision patterns", () => {
    it("matches '决定' (decided)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "我们决定用TypeScript")).toBe(true);
    });

    it("matches '已决定' (already decided)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "已决定下周上线")).toBe(true);
    });

    it("matches '方案是' (the plan is)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "方案是先做数据迁移")).toBe(true);
    });

    it("matches '敲定' (finalized)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "技术方案已经敲定")).toBe(true);
    });

    it("matches '就这么定' (that's settled)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "好，就这么定了")).toBe(true);
    });

    it("does not match unrelated Chinese text", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().decision, "今天天气不错")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches '完成' (completed)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().close, "任务完成了")).toBe(true);
    });

    it("matches '搞定' (done)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().close, "搞定了！")).toBe(true);
    });

    it("matches '解决了' (solved)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().close, "问题解决了")).toBe(true);
    });

    it("matches '修好了' (fixed)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().close, "Bug修好了")).toBe(true);
    });

    it("matches '没问题了' (no problem anymore)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().close, "现在没问题了")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches '等待' (waiting)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().wait, "等待代码审查")).toBe(true);
    });

    it("matches '卡在' (stuck at)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().wait, "卡在权限配置上")).toBe(true);
    });

    it("matches '依赖于' (depends on)", async () => {
      const reg = await zhRegistry();
      expect(anyMatch(reg.getPatterns().wait, "这个依赖于后端接口")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after '关于' (about)", async () => {
      const reg = await zhRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "关于数据迁移的问题");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("数据迁移");
    });

    it("captures topic after '讨论' (discuss)", async () => {
      const reg = await zhRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "讨论架构设计方案");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after '聊聊' (chat about)", async () => {
      const reg = await zhRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "聊聊部署策略");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: '靠' (damn)", async () => {
      const reg = await zhRegistry();
      expect(reg.getMoodPatterns().frustrated.test("靠，又挂了")).toBe(true);
    });

    it("detects excited: '太好了' (great)", async () => {
      const reg = await zhRegistry();
      expect(reg.getMoodPatterns().excited.test("太好了，上线成功")).toBe(true);
    });

    it("detects tense: '小心' (careful)", async () => {
      const reg = await zhRegistry();
      expect(reg.getMoodPatterns().tense.test("小心这个操作")).toBe(true);
    });

    it("detects productive: '上线了' (deployed)", async () => {
      const reg = await zhRegistry();
      expect(reg.getMoodPatterns().productive.test("新版本上线了")).toBe(true);
    });

    it("detects exploratory: '试试' (try)", async () => {
      const reg = await zhRegistry();
      expect(reg.getMoodPatterns().exploratory.test("试试这个方案")).toBe(true);
    });
  });

  describe("blacklist", () => {
    it("contains Chinese noise words", async () => {
      const reg = await zhRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("这个")).toBe(true);
      expect(bl.has("那个")).toBe(true);
      expect(bl.has("什么")).toBe(true);
    });
  });

  describe("high-impact keywords", () => {
    it("contains Chinese keywords", async () => {
      const reg = await zhRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("架构");
      expect(kw).toContain("安全");
      expect(kw).toContain("删除");
    });
  });
});

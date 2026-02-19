import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function ptRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["pt"]);
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

describe("Portuguese language pack", () => {
  describe("decision patterns", () => {
    it("matches 'decidido'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Ficou decidido usar Postgres")).toBe(true);
    });

    it("matches 'decisão'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().decision, "A decisão foi migrar")).toBe(true);
    });

    it("matches 'combinado'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Está combinado com a equipe")).toBe(true);
    });

    it("matches 'ficou definido'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Ficou definido que vamos refatorar")).toBe(true);
    });

    it("does not match unrelated text", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().decision, "O tempo está bom hoje")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches 'feito'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().close, "Já está feito")).toBe(true);
    });

    it("matches 'resolvido'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().close, "O bug está resolvido")).toBe(true);
    });

    it("matches 'funciona'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().close, "Já funciona direitinho")).toBe(true);
    });

    it("matches 'pronto'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().close, "Está pronto!")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches 'esperando'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Estamos esperando a revisão")).toBe(true);
    });

    it("matches 'bloqueado por'", async () => {
      const reg = await ptRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Está bloqueado por falta de acesso")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'voltando a'", async () => {
      const reg = await ptRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "voltando a o assunto da migração");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'agora sobre'", async () => {
      const reg = await ptRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "agora sobre a arquitetura do sistema");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'merda'", async () => {
      const reg = await ptRegistry();
      expect(reg.getMoodPatterns().frustrated.test("Que merda, quebrou")).toBe(true);
    });

    it("detects excited: 'show'", async () => {
      const reg = await ptRegistry();
      expect(reg.getMoodPatterns().excited.test("Ficou show!")).toBe(true);
    });
  });

  describe("high-impact keywords", () => {
    it("contains Portuguese keywords", async () => {
      const reg = await ptRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("segurança");
      expect(kw).toContain("arquitetura");
    });
  });
});

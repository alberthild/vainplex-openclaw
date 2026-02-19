import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function esRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["es"]);
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

describe("Spanish language pack", () => {
  describe("decision patterns", () => {
    it("matches 'decidido'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Hemos decidido usar TypeScript")).toBe(true);
    });

    it("matches 'decisión'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().decision, "La decisión fue cambiar de enfoque")).toBe(true);
    });

    it("matches 'acordado'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Ya está acordado con el equipo")).toBe(true);
    });

    it("matches 'vamos con'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Vamos con la opción B")).toBe(true);
    });

    it("does not match unrelated Spanish text", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Hace buen tiempo hoy")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches 'hecho'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().close, "Ya está hecho")).toBe(true);
    });

    it("matches 'resuelto'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().close, "El problema está resuelto")).toBe(true);
    });

    it("matches 'funciona'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().close, "Ya funciona correctamente")).toBe(true);
    });

    it("matches 'listo'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().close, "Todo listo!")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches 'esperando'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Estamos esperando la respuesta")).toBe(true);
    });

    it("matches 'bloqueado por'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Está bloqueado por el equipo de API")).toBe(true);
    });

    it("matches 'pendiente de'", async () => {
      const reg = await esRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Pendiente de aprobación")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'respecto a'", async () => {
      const reg = await esRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "respecto a la migración de datos");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("migración");
    });

    it("captures topic after 'hablemos de'", async () => {
      const reg = await esRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "hablemos de la seguridad");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'joder'", async () => {
      const reg = await esRegistry();
      expect(reg.getMoodPatterns().frustrated.test("joder, se rompió")).toBe(true);
    });

    it("detects excited: 'genial'", async () => {
      const reg = await esRegistry();
      expect(reg.getMoodPatterns().excited.test("¡Genial!")).toBe(true);
    });
  });

  describe("blacklist", () => {
    it("contains Spanish articles", async () => {
      const reg = await esRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("el")).toBe(true);
      expect(bl.has("la")).toBe(true);
    });
  });

  describe("high-impact keywords", () => {
    it("contains Spanish keywords", async () => {
      const reg = await esRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("seguridad");
      expect(kw).toContain("arquitectura");
    });
  });
});

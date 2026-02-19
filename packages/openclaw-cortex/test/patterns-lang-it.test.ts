import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

async function itRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["it"]);
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

describe("Italian language pack", () => {
  describe("decision patterns", () => {
    it("matches 'deciso'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Abbiamo deciso di usare Redis")).toBe(true);
    });

    it("matches 'decisione'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().decision, "La decisione è stata presa")).toBe(true);
    });

    it("matches 'facciamo'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Facciamo così")).toBe(true);
    });

    it("matches 'andiamo con'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Andiamo con la soluzione A")).toBe(true);
    });

    it("does not match unrelated text", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Fa bel tempo oggi")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches 'fatto'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().close, "È già fatto")).toBe(true);
    });

    it("matches 'risolto'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().close, "Il problema è risolto")).toBe(true);
    });

    it("matches 'funziona'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().close, "Adesso funziona bene")).toBe(true);
    });

    it("matches 'finito'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().close, "È finito!")).toBe(true);
    });
  });

  describe("wait patterns", () => {
    it("matches 'aspettando'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Stiamo aspettando la revisione")).toBe(true);
    });

    it("matches 'bloccato da'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Bloccato da un problema di rete")).toBe(true);
    });

    it("matches 'in attesa di'", async () => {
      const reg = await itRegistry();
      expect(anyMatch(reg.getPatterns().wait, "In attesa di approvazione")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'riguardo'", async () => {
      const reg = await itRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "riguardo la migrazione del database");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'parliamo di'", async () => {
      const reg = await itRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "parliamo di la sicurezza");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'cavolo'", async () => {
      const reg = await itRegistry();
      expect(reg.getMoodPatterns().frustrated.test("cavolo, è rotto")).toBe(true);
    });

    it("detects excited: 'fantastico'", async () => {
      const reg = await itRegistry();
      expect(reg.getMoodPatterns().excited.test("Fantastico!")).toBe(true);
    });
  });

  describe("high-impact keywords", () => {
    it("contains Italian keywords", async () => {
      const reg = await itRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("sicurezza");
      expect(kw).toContain("architettura");
    });
  });
});

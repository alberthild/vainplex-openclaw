import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../src/patterns/registry.js";

function registry(): PatternRegistry {
  const reg = new PatternRegistry();
  reg.loadSync([]);
  // Load FR manually via import for sync testing
  return reg;
}

async function frRegistry(): Promise<PatternRegistry> {
  const reg = new PatternRegistry();
  await reg.load(["fr"]);
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

describe("French language pack", () => {
  describe("decision patterns", () => {
    it("matches 'décidé'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().decision, "On a décidé de migrer")).toBe(true);
    });

    it("matches 'décision'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().decision, "La décision est prise")).toBe(true);
    });

    it("matches 'convenu'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().decision, "C'est convenu avec l'équipe")).toBe(true);
    });

    it("matches 'opté pour'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().decision, "On a opté pour TypeScript")).toBe(true);
    });

    it("does not match unrelated French text", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().decision, "Il fait beau aujourd'hui")).toBe(false);
    });
  });

  describe("close patterns", () => {
    it("matches 'terminé'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().close, "C'est terminé maintenant")).toBe(true);
    });

    it("matches 'résolu'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().close, "Le problème est résolu")).toBe(true);
    });

    it("matches 'ça marche'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().close, "Oui ça marche maintenant")).toBe(true);
    });

    it("matches 'fini'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().close, "C'est fini!")).toBe(true);
    });

    it("does not match ongoing work", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().close, "Je travaille encore dessus")).toBe(false);
    });
  });

  describe("wait patterns", () => {
    it("matches 'en attente de'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().wait, "On est en attente de la review")).toBe(true);
    });

    it("matches 'bloqué par'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().wait, "C'est bloqué par l'API")).toBe(true);
    });

    it("matches 'il faut d'abord'", async () => {
      const reg = await frRegistry();
      expect(anyMatch(reg.getPatterns().wait, "Il faut d'abord finir le module")).toBe(true);
    });
  });

  describe("topic patterns", () => {
    it("captures topic after 'concernant'", async () => {
      const reg = await frRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "concernant la migration des données");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("migration");
    });

    it("captures topic after 'parlons de'", async () => {
      const reg = await frRegistry();
      const topics = captureTopics(reg.getPatterns().topic, "parlons de la sécurité du système");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("mood patterns", () => {
    it("detects frustrated: 'putain'", async () => {
      const reg = await frRegistry();
      expect(reg.getMoodPatterns().frustrated.test("putain c'est cassé")).toBe(true);
    });

    it("detects excited: 'génial'", async () => {
      const reg = await frRegistry();
      expect(reg.getMoodPatterns().excited.test("C'est génial!")).toBe(true);
    });

    it("detects tense: 'attention'", async () => {
      const reg = await frRegistry();
      expect(reg.getMoodPatterns().tense.test("Attention avec ça")).toBe(true);
    });
  });

  describe("blacklist", () => {
    it("contains French articles", async () => {
      const reg = await frRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("le")).toBe(true);
      expect(bl.has("la")).toBe(true);
      expect(bl.has("les")).toBe(true);
    });

    it("contains French pronouns", async () => {
      const reg = await frRegistry();
      const bl = reg.getBlacklist();
      expect(bl.has("il")).toBe(true);
      expect(bl.has("elle")).toBe(true);
    });
  });

  describe("high-impact keywords", () => {
    it("contains French keywords", async () => {
      const reg = await frRegistry();
      const kw = reg.getHighImpactKeywords();
      expect(kw).toContain("sécurité");
      expect(kw).toContain("production");
    });
  });
});

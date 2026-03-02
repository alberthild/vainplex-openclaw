import { describe, it, expect } from "vitest";
import { detectCommitments, ALL_COMMITMENT_PATTERNS } from "../src/commitment-patterns.js";

describe("CommitmentPatterns", () => {
  describe("English", () => {
    it("detects 'I'll' commitments", () => {
      expect(detectCommitments("I'll fix the build tomorrow").length).toBeGreaterThan(0);
    });
    it("detects 'I will' commitments", () => {
      expect(detectCommitments("I will handle the deployment").length).toBeGreaterThan(0);
    });
    it("detects 'let me' commitments", () => {
      expect(detectCommitments("let me check the logs first").length).toBeGreaterThan(0);
    });
    it("detects 'I promise' commitments", () => {
      expect(detectCommitments("I promise to review the PR today").length).toBeGreaterThan(0);
    });
    it("does NOT match casual 'sounds good'", () => {
      expect(detectCommitments("sounds good").length).toBe(0);
    });
    it("does NOT match casual 'agreed'", () => {
      expect(detectCommitments("agreed").length).toBe(0);
    });
  });

  describe("German", () => {
    it("detects 'ich werde'", () => {
      expect(detectCommitments("ich werde das morgen fixen").length).toBeGreaterThan(0);
    });
    it("detects 'mach ich'", () => {
      expect(detectCommitments("mach ich gleich").length).toBeGreaterThan(0);
    });
  });

  describe("Multi-language coverage", () => {
    it("has patterns for 10 languages", () => {
      const languages = new Set(ALL_COMMITMENT_PATTERNS.map((p) => p.language));
      expect(languages.size).toBe(10);
    });
  });

  describe("Edge cases", () => {
    it("returns empty for empty string", () => {
      expect(detectCommitments("")).toHaveLength(0);
    });
    it("returns empty for unrelated text", () => {
      expect(detectCommitments("The weather is nice today")).toHaveLength(0);
    });
  });
});

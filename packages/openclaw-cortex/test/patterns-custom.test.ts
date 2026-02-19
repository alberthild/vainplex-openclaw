import { describe, it, expect } from "vitest";
import { PatternRegistry, BUILTIN_LANGUAGES } from "../src/patterns/registry.js";
import { resolveConfig } from "../src/config.js";

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

// ════════════════════════════════════════════════════════════
// Custom patterns — extend mode
// ════════════════════════════════════════════════════════════
describe("custom patterns — extend mode", () => {
  it("appends custom decision patterns to builtins", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["approved by committee", "design review passed"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    // Custom pattern works
    expect(anyMatch(p.decision, "This was approved by committee")).toBe(true);
    expect(anyMatch(p.decision, "The design review passed")).toBe(true);
    // Builtin still works
    expect(anyMatch(p.decision, "We decided to go")).toBe(true);
  });

  it("appends custom close patterns to builtins", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      close: ["ticket closed", "JIRA resolved"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    expect(anyMatch(p.close, "ticket closed for this issue")).toBe(true);
    expect(anyMatch(p.close, "JIRA resolved as won't fix")).toBe(true);
    // Builtin still works
    expect(anyMatch(p.close, "It's done")).toBe(true);
  });

  it("appends custom wait patterns", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      wait: ["pending approval from"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    expect(anyMatch(p.wait, "pending approval from the VP")).toBe(true);
    expect(anyMatch(p.wait, "waiting for the review")).toBe(true);
  });

  it("appends custom topic patterns", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      topic: ["sprint goal:\\s+(\\w[\\w\\s-]{3,40})"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    const globalP = new RegExp(p.topic[p.topic.length - 1].source, "gi");
    const m = globalP.exec("sprint goal: improve search performance");
    expect(m).not.toBeNull();
    expect(m![1]).toContain("improve");
  });

  it("default mode is extend", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["custom pattern"],
    });
    const p = reg.getPatterns();
    // Custom works
    expect(anyMatch(p.decision, "custom pattern detected")).toBe(true);
    // Builtin still works (not replaced)
    expect(anyMatch(p.decision, "We decided")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Custom patterns — override mode
// ════════════════════════════════════════════════════════════
describe("custom patterns — override mode", () => {
  it("replaces decision patterns in override mode", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["custom only"],
      mode: "override",
    });
    const p = reg.getPatterns();
    expect(anyMatch(p.decision, "custom only match")).toBe(true);
    // Builtin is replaced
    expect(anyMatch(p.decision, "We decided")).toBe(false);
  });

  it("only overrides categories that have custom patterns", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["custom decision"],
      mode: "override",
    });
    const p = reg.getPatterns();
    // close patterns are untouched
    expect(anyMatch(p.close, "It's done")).toBe(true);
  });

  it("does not override when custom array is empty", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: [],
      mode: "override",
    });
    const p = reg.getPatterns();
    // Builtin should still work (empty = no override)
    expect(anyMatch(p.decision, "We decided")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Custom blacklist and keywords
// ════════════════════════════════════════════════════════════
describe("custom blacklist and keywords", () => {
  it("adds custom blacklist words", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      topicBlacklist: ["standup", "sync"],
      mode: "extend",
    });
    const bl = reg.getBlacklist();
    expect(bl.has("standup")).toBe(true);
    expect(bl.has("sync")).toBe(true);
    // Builtin still present
    expect(bl.has("the")).toBe(true);
  });

  it("adds custom keywords", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      highImpactKeywords: ["compliance", "gdpr"],
      mode: "extend",
    });
    const kw = reg.getHighImpactKeywords();
    expect(kw).toContain("compliance");
    expect(kw).toContain("gdpr");
    // Builtin still present
    expect(kw).toContain("architecture");
  });
});

// ════════════════════════════════════════════════════════════
// Invalid regex handling
// ════════════════════════════════════════════════════════════
describe("custom patterns — invalid regex", () => {
  it("silently skips invalid regex strings", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["valid pattern", "[invalid(regex", "another valid"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    // Valid custom patterns work
    expect(anyMatch(p.decision, "valid pattern here")).toBe(true);
    expect(anyMatch(p.decision, "another valid match")).toBe(true);
    // No error thrown
  });

  it("handles all-invalid regex gracefully", () => {
    const reg = new PatternRegistry();
    reg.loadSync(["en"], {
      decision: ["[bad", "(worse", "**worst"],
      mode: "extend",
    });
    const p = reg.getPatterns();
    // Builtin still works
    expect(anyMatch(p.decision, "We decided")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Config integration
// ════════════════════════════════════════════════════════════
describe("config — language resolution", () => {
  it("resolves 'en' as string", () => {
    const cfg = resolveConfig({ patterns: { language: "en" } });
    expect(cfg.patterns.language).toBe("en");
  });

  it("resolves 'de' as string", () => {
    const cfg = resolveConfig({ patterns: { language: "de" } });
    expect(cfg.patterns.language).toBe("de");
  });

  it("resolves 'both' as string", () => {
    const cfg = resolveConfig({ patterns: { language: "both" } });
    expect(cfg.patterns.language).toBe("both");
  });

  it("resolves 'all' as string", () => {
    const cfg = resolveConfig({ patterns: { language: "all" } });
    expect(cfg.patterns.language).toBe("all");
  });

  it("resolves string[] like ['en', 'fr']", () => {
    const cfg = resolveConfig({ patterns: { language: ["en", "fr"] } });
    expect(cfg.patterns.language).toEqual(["en", "fr"]);
  });

  it("resolves single new language string", () => {
    const cfg = resolveConfig({ patterns: { language: "fr" } });
    expect(cfg.patterns.language).toBe("fr");
  });

  it("defaults to 'both' for invalid input", () => {
    const cfg = resolveConfig({ patterns: { language: 42 } });
    expect(cfg.patterns.language).toBe("both");
  });

  it("defaults to 'both' for undefined", () => {
    const cfg = resolveConfig({});
    expect(cfg.patterns.language).toBe("both");
  });
});

describe("config — custom patterns resolution", () => {
  it("resolves custom patterns from config", () => {
    const cfg = resolveConfig({
      patterns: {
        language: "en",
        custom: {
          decision: ["my pattern"],
          topicBlacklist: ["standup"],
          mode: "extend",
        },
      },
    });
    expect(cfg.patterns.custom).toBeDefined();
    expect(cfg.patterns.custom!.decision).toEqual(["my pattern"]);
    expect(cfg.patterns.custom!.topicBlacklist).toEqual(["standup"]);
    expect(cfg.patterns.custom!.mode).toBe("extend");
  });

  it("resolves override mode", () => {
    const cfg = resolveConfig({
      patterns: {
        language: "en",
        custom: { mode: "override" },
      },
    });
    expect(cfg.patterns.custom!.mode).toBe("override");
  });

  it("defaults custom mode to extend", () => {
    const cfg = resolveConfig({
      patterns: {
        language: "en",
        custom: {},
      },
    });
    expect(cfg.patterns.custom!.mode).toBe("extend");
  });

  it("returns undefined for no custom config", () => {
    const cfg = resolveConfig({ patterns: { language: "en" } });
    expect(cfg.patterns.custom).toBeUndefined();
  });

  it("filters non-string values from custom arrays", () => {
    const cfg = resolveConfig({
      patterns: {
        language: "en",
        custom: {
          decision: ["valid", 42, null, "also valid"] as unknown as string[],
        },
      },
    });
    expect(cfg.patterns.custom!.decision).toEqual(["valid", "also valid"]);
  });
});

// ════════════════════════════════════════════════════════════
// All-languages loading
// ════════════════════════════════════════════════════════════
describe("loading all languages", () => {
  it("loads all 10 languages and merges patterns", async () => {
    const reg = new PatternRegistry();
    await reg.load(BUILTIN_LANGUAGES);
    const p = reg.getPatterns();
    // Should have patterns from all languages
    expect(p.decision.length).toBeGreaterThanOrEqual(10);
    expect(p.close.length).toBeGreaterThanOrEqual(10);
  });

  it("all languages contribute to blacklist", async () => {
    const reg = new PatternRegistry();
    await reg.load(BUILTIN_LANGUAGES);
    const bl = reg.getBlacklist();
    // EN
    expect(bl.has("the")).toBe(true);
    // DE
    expect(bl.has("das")).toBe(true);
    // FR
    expect(bl.has("le")).toBe(true);
    // ZH
    expect(bl.has("这个")).toBe(true);
    // JA
    expect(bl.has("これ")).toBe(true);
    // KO
    expect(bl.has("이것")).toBe(true);
    // RU
    expect(bl.has("это")).toBe(true);
  });

  it("all languages contribute to keywords", async () => {
    const reg = new PatternRegistry();
    await reg.load(BUILTIN_LANGUAGES);
    const kw = reg.getHighImpactKeywords();
    expect(kw).toContain("architecture"); // EN
    expect(kw).toContain("architektur"); // DE
    expect(kw).toContain("sécurité"); // FR
    expect(kw).toContain("架构"); // ZH
  });
});

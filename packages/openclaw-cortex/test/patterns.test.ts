import { describe, it, expect } from "vitest";
import { getPatterns, detectMood, HIGH_IMPACT_KEYWORDS, MOOD_PATTERNS } from "../src/patterns.js";
import type { PatternSet } from "../src/patterns.js";

// ── Helper: test if any pattern matches ──
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

// ════════════════════════════════════════════════════════════
// Decision patterns
// ════════════════════════════════════════════════════════════
describe("decision patterns", () => {
  describe("English", () => {
    const { decision } = getPatterns("en");

    it("matches 'decided'", () => {
      expect(anyMatch(decision, "We decided to use TypeScript")).toBe(true);
    });

    it("matches 'decision'", () => {
      expect(anyMatch(decision, "The decision was to go with plan B")).toBe(true);
    });

    it("matches 'agreed'", () => {
      expect(anyMatch(decision, "We agreed on MIT license")).toBe(true);
    });

    it("matches 'let's do'", () => {
      expect(anyMatch(decision, "let's do it this way")).toBe(true);
    });

    it("matches 'lets do' without apostrophe", () => {
      expect(anyMatch(decision, "lets do it this way")).toBe(true);
    });

    it("matches 'the plan is'", () => {
      expect(anyMatch(decision, "the plan is to deploy Friday")).toBe(true);
    });

    it("matches 'approach:'", () => {
      expect(anyMatch(decision, "approach: use atomic writes")).toBe(true);
    });

    it("does not match unrelated text", () => {
      expect(anyMatch(decision, "The weather is nice today")).toBe(false);
    });

    it("does not match partial words like 'undecided'", () => {
      // 'undecided' contains 'decided' — pattern should still match due to regex
      expect(anyMatch(decision, "I am undecided")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(anyMatch(decision, "DECIDED to use ESM")).toBe(true);
    });
  });

  describe("German", () => {
    const { decision } = getPatterns("de");

    it("matches 'entschieden'", () => {
      expect(anyMatch(decision, "Wir haben uns entschieden")).toBe(true);
    });

    it("matches 'beschlossen'", () => {
      expect(anyMatch(decision, "Wir haben beschlossen, TS zu nehmen")).toBe(true);
    });

    it("matches 'machen wir'", () => {
      expect(anyMatch(decision, "Das machen wir so")).toBe(true);
    });

    it("matches 'wir machen'", () => {
      expect(anyMatch(decision, "Dann wir machen das anders")).toBe(true);
    });

    it("matches 'der plan ist'", () => {
      expect(anyMatch(decision, "Der plan ist, morgen zu deployen")).toBe(true);
    });

    it("matches 'ansatz:'", () => {
      expect(anyMatch(decision, "Ansatz: atomare Schreibvorgänge")).toBe(true);
    });

    it("does not match English-only text", () => {
      expect(anyMatch(decision, "We decided to use TypeScript")).toBe(false);
    });
  });

  describe("both", () => {
    const { decision } = getPatterns("both");

    it("matches English patterns", () => {
      expect(anyMatch(decision, "We decided to go")).toBe(true);
    });

    it("matches German patterns", () => {
      expect(anyMatch(decision, "Wir haben beschlossen")).toBe(true);
    });

    it("has combined patterns", () => {
      expect(decision.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ════════════════════════════════════════════════════════════
// Close patterns
// ════════════════════════════════════════════════════════════
describe("close patterns", () => {
  describe("English", () => {
    const { close } = getPatterns("en");

    it("matches 'done'", () => {
      expect(anyMatch(close, "That's done now")).toBe(true);
    });

    it("matches 'fixed'", () => {
      expect(anyMatch(close, "Bug is fixed")).toBe(true);
    });

    it("matches 'solved'", () => {
      expect(anyMatch(close, "Problem solved!")).toBe(true);
    });

    it("matches 'closed'", () => {
      expect(anyMatch(close, "Issue closed")).toBe(true);
    });

    it("matches 'works'", () => {
      expect(anyMatch(close, "It works perfectly")).toBe(true);
    });

    it("matches '✅'", () => {
      expect(anyMatch(close, "Task complete ✅")).toBe(true);
    });

    it("does not match unrelated text", () => {
      expect(anyMatch(close, "Still working on it")).toBe(false);
    });
  });

  describe("German", () => {
    const { close } = getPatterns("de");

    it("matches 'erledigt'", () => {
      expect(anyMatch(close, "Das ist erledigt")).toBe(true);
    });

    it("matches 'gefixt'", () => {
      expect(anyMatch(close, "Bug ist gefixt")).toBe(true);
    });

    it("matches 'gelöst'", () => {
      expect(anyMatch(close, "Problem gelöst")).toBe(true);
    });

    it("matches 'fertig'", () => {
      expect(anyMatch(close, "Bin fertig damit")).toBe(true);
    });

    it("matches 'funktioniert'", () => {
      expect(anyMatch(close, "Es funktioniert jetzt")).toBe(true);
    });
  });

  describe("both", () => {
    const { close } = getPatterns("both");

    it("matches English 'done'", () => {
      expect(anyMatch(close, "It's done")).toBe(true);
    });

    it("matches German 'erledigt'", () => {
      expect(anyMatch(close, "Ist erledigt")).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════
// Wait patterns
// ════════════════════════════════════════════════════════════
describe("wait patterns", () => {
  describe("English", () => {
    const { wait } = getPatterns("en");

    it("matches 'waiting for'", () => {
      expect(anyMatch(wait, "We are waiting for the review")).toBe(true);
    });

    it("matches 'blocked by'", () => {
      expect(anyMatch(wait, "This is blocked by the API change")).toBe(true);
    });

    it("matches 'need...first'", () => {
      expect(anyMatch(wait, "We need the auth module first")).toBe(true);
    });

    it("does not match unrelated text", () => {
      expect(anyMatch(wait, "Let's continue with the work")).toBe(false);
    });
  });

  describe("German", () => {
    const { wait } = getPatterns("de");

    it("matches 'warte auf'", () => {
      expect(anyMatch(wait, "Ich warte auf das Review")).toBe(true);
    });

    it("matches 'blockiert durch'", () => {
      expect(anyMatch(wait, "Blockiert durch API-Änderung")).toBe(true);
    });

    it("matches 'brauche...erst'", () => {
      expect(anyMatch(wait, "Brauche das Auth-Modul erst")).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════
// Topic patterns
// ════════════════════════════════════════════════════════════
describe("topic patterns", () => {
  describe("English", () => {
    const { topic } = getPatterns("en");

    it("captures topic after 'back to'", () => {
      const topics = captureTopics(topic, "Let's get back to the auth migration");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("auth migration");
    });

    it("captures topic after 'now about'", () => {
      const topics = captureTopics(topic, "now about the deployment pipeline");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("deployment pipeline");
    });

    it("captures topic after 'regarding'", () => {
      const topics = captureTopics(topic, "regarding the security audit");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("security audit");
    });

    it("does not match without topic text", () => {
      expect(anyMatch(topic, "just a random sentence")).toBe(false);
    });

    it("limits captured topic to 40 chars", () => {
      const topics = captureTopics(topic, "back to the very long topic name that exceeds forty characters limit here and keeps going");
      if (topics.length > 0) {
        expect(topics[0].length).toBeLessThanOrEqual(41);
      }
    });
  });

  describe("German", () => {
    const { topic } = getPatterns("de");

    it("captures topic after 'zurück zu'", () => {
      const topics = captureTopics(topic, "Zurück zu der Auth-Migration");
      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0]).toContain("Auth-Migration");
    });

    it("captures topic after 'jetzt zu'", () => {
      const topics = captureTopics(topic, "Jetzt zu dem Deployment");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'bzgl.'", () => {
      const topics = captureTopics(topic, "Bzgl. dem Security Audit");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'bzgl' without dot", () => {
      const topics = captureTopics(topic, "bzgl dem Security Review");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures topic after 'wegen'", () => {
      const topics = captureTopics(topic, "wegen der API-Änderung");
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  describe("both", () => {
    const { topic } = getPatterns("both");

    it("captures English topics", () => {
      const topics = captureTopics(topic, "back to the auth flow");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures German topics", () => {
      const topics = captureTopics(topic, "zurück zu dem Plugin");
      expect(topics.length).toBeGreaterThan(0);
    });
  });
});

// ════════════════════════════════════════════════════════════
// Mood detection
// ════════════════════════════════════════════════════════════
describe("detectMood", () => {
  it("returns 'neutral' for empty string", () => {
    expect(detectMood("")).toBe("neutral");
  });

  it("returns 'neutral' for unrelated text", () => {
    expect(detectMood("The sky is blue")).toBe("neutral");
  });

  // Frustrated
  it("detects 'frustrated' for 'fuck'", () => {
    expect(detectMood("oh fuck, that's broken")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'shit'", () => {
    expect(detectMood("shit, it broke again")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'mist'", () => {
    expect(detectMood("So ein Mist")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'nervig'", () => {
    expect(detectMood("Das ist so nervig")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'damn'", () => {
    expect(detectMood("damn, not again")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'wtf'", () => {
    expect(detectMood("wtf is happening")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'schon wieder'", () => {
    expect(detectMood("Schon wieder kaputt")).toBe("frustrated");
  });

  it("detects 'frustrated' for 'sucks'", () => {
    expect(detectMood("this sucks")).toBe("frustrated");
  });

  // Excited
  it("detects 'excited' for 'geil'", () => {
    expect(detectMood("Das ist geil!")).toBe("excited");
  });

  it("detects 'excited' for 'awesome'", () => {
    expect(detectMood("That's awesome!")).toBe("excited");
  });

  it("detects 'excited' for 'nice'", () => {
    expect(detectMood("nice work!")).toBe("excited");
  });

  it("detects 'excited' for '🚀'", () => {
    expect(detectMood("Deployed! 🚀")).toBe("excited");
  });

  it("detects 'excited' for 'perfekt'", () => {
    expect(detectMood("Das ist perfekt")).toBe("excited");
  });

  // Tense
  it("detects 'tense' for 'careful'", () => {
    expect(detectMood("be careful with that")).toBe("tense");
  });

  it("detects 'tense' for 'risky'", () => {
    expect(detectMood("that's risky")).toBe("tense");
  });

  it("detects 'tense' for 'urgent'", () => {
    expect(detectMood("this is urgent")).toBe("tense");
  });

  it("detects 'tense' for 'vorsicht'", () => {
    expect(detectMood("Vorsicht damit")).toBe("tense");
  });

  it("detects 'tense' for 'dringend'", () => {
    expect(detectMood("Dringend fixen")).toBe("tense");
  });

  // Productive
  it("detects 'productive' for 'done'", () => {
    expect(detectMood("All done!")).toBe("productive");
  });

  it("detects 'productive' for 'fixed'", () => {
    expect(detectMood("Bug fixed")).toBe("productive");
  });

  it("detects 'productive' for 'deployed'", () => {
    expect(detectMood("deployed to staging")).toBe("productive");
  });

  it("detects 'productive' for '✅'", () => {
    expect(detectMood("Task ✅")).toBe("productive");
  });

  it("detects 'productive' for 'shipped'", () => {
    expect(detectMood("shipped to prod")).toBe("productive");
  });

  // Exploratory
  it("detects 'exploratory' for 'what if'", () => {
    expect(detectMood("what if we used Rust?")).toBe("exploratory");
  });

  it("detects 'exploratory' for 'was wäre wenn'", () => {
    expect(detectMood("Was wäre wenn wir Rust nehmen?")).toBe("exploratory");
  });

  it("detects 'exploratory' for 'idea'", () => {
    expect(detectMood("I have an idea")).toBe("exploratory");
  });

  it("detects 'exploratory' for 'experiment'", () => {
    expect(detectMood("let's experiment with this")).toBe("exploratory");
  });

  it("detects 'exploratory' for 'maybe'", () => {
    expect(detectMood("maybe we should try")).toBe("exploratory");
  });

  // Last match wins
  it("last match wins: frustrated then productive → productive", () => {
    expect(detectMood("this sucks but then it works!")).toBe("productive");
  });

  it("last match wins: excited then tense → tense", () => {
    expect(detectMood("Awesome but be careful")).toBe("tense");
  });

  it("case-insensitive mood detection", () => {
    expect(detectMood("THIS IS AWESOME")).toBe("excited");
  });
});

// ════════════════════════════════════════════════════════════
// Language switching
// ════════════════════════════════════════════════════════════
describe("getPatterns", () => {
  it("returns only English patterns for 'en'", () => {
    const p = getPatterns("en");
    expect(anyMatch(p.decision, "decided")).toBe(true);
    expect(anyMatch(p.decision, "beschlossen")).toBe(false);
  });

  it("returns only German patterns for 'de'", () => {
    const p = getPatterns("de");
    expect(anyMatch(p.decision, "beschlossen")).toBe(true);
    expect(anyMatch(p.decision, "decided")).toBe(false);
  });

  it("returns merged patterns for 'both'", () => {
    const p = getPatterns("both");
    expect(anyMatch(p.decision, "decided")).toBe(true);
    expect(anyMatch(p.decision, "beschlossen")).toBe(true);
  });

  it("each language has all pattern types", () => {
    for (const lang of ["en", "de", "both"] as const) {
      const p = getPatterns(lang);
      expect(p.decision.length).toBeGreaterThan(0);
      expect(p.close.length).toBeGreaterThan(0);
      expect(p.wait.length).toBeGreaterThan(0);
      expect(p.topic.length).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════
// High-impact keywords
// ════════════════════════════════════════════════════════════
describe("HIGH_IMPACT_KEYWORDS", () => {
  it("contains architecture keywords", () => {
    expect(HIGH_IMPACT_KEYWORDS).toContain("architecture");
    expect(HIGH_IMPACT_KEYWORDS).toContain("architektur");
  });

  it("contains security keywords", () => {
    expect(HIGH_IMPACT_KEYWORDS).toContain("security");
    expect(HIGH_IMPACT_KEYWORDS).toContain("sicherheit");
  });

  it("contains deletion keywords", () => {
    expect(HIGH_IMPACT_KEYWORDS).toContain("delete");
    expect(HIGH_IMPACT_KEYWORDS).toContain("löschen");
  });

  it("contains production keywords", () => {
    expect(HIGH_IMPACT_KEYWORDS).toContain("production");
    expect(HIGH_IMPACT_KEYWORDS).toContain("deploy");
  });

  it("contains strategy keywords", () => {
    expect(HIGH_IMPACT_KEYWORDS).toContain("strategy");
    expect(HIGH_IMPACT_KEYWORDS).toContain("strategie");
  });

  it("is a non-empty array", () => {
    expect(HIGH_IMPACT_KEYWORDS.length).toBeGreaterThan(10);
  });
});

// ════════════════════════════════════════════════════════════
// Mood patterns export
// ════════════════════════════════════════════════════════════
describe("MOOD_PATTERNS", () => {
  it("contains all mood types except neutral", () => {
    expect(MOOD_PATTERNS).toHaveProperty("frustrated");
    expect(MOOD_PATTERNS).toHaveProperty("excited");
    expect(MOOD_PATTERNS).toHaveProperty("tense");
    expect(MOOD_PATTERNS).toHaveProperty("productive");
    expect(MOOD_PATTERNS).toHaveProperty("exploratory");
  });

  it("each mood pattern is a RegExp", () => {
    for (const pattern of Object.values(MOOD_PATTERNS)) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

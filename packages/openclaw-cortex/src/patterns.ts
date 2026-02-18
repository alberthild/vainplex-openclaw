import type { Mood } from "./types.js";

// ============================================================
// Pattern sets by language
// ============================================================

const DECISION_PATTERNS_EN = [
  /(?:decided|decision|agreed|let'?s do|the plan is|approach:)/i,
];

const DECISION_PATTERNS_DE = [
  /(?:entschieden|beschlossen|machen wir|wir machen|der plan ist|ansatz:)/i,
];

const CLOSE_PATTERNS_EN = [
  /(?:^|\s)(?:is |it's |that's |all )?(?:done|fixed|solved|closed)(?:\s|[.!]|$)/i,
  /(?:^|\s)(?:it |that )works(?:\s|[.!]|$)/i,
  /✅/,
];

const CLOSE_PATTERNS_DE = [
  /(?:^|\s)(?:ist |schon )?(?:erledigt|gefixt|gelöst|fertig)(?:\s|[.!]|$)/i,
  /(?:^|\s)(?:es |das )funktioniert(?:\s|[.!]|$)/i,
];

const WAIT_PATTERNS_EN = [
  /(?:waiting for|blocked by|need.*first)/i,
];

const WAIT_PATTERNS_DE = [
  /(?:warte auf|blockiert durch|brauche.*erst)/i,
];

const TOPIC_PATTERNS_EN = [
  /(?:back to|now about|regarding|let's (?:talk|discuss|look at))\s+(?:the\s+)?(\w[\w\s-]{3,40})/i,
];

const TOPIC_PATTERNS_DE = [
  /(?:zurück zu|jetzt zu|bzgl\.?|wegen|lass uns (?:über|mal))\s+(?:dem?|die|das)?\s*(\w[\w\s-]{3,40})/i,
];

/** Words that should never be thread titles (noise filter) */
const TOPIC_BLACKLIST = new Set([
  "it", "that", "this", "the", "them", "what", "which", "there",
  "das", "die", "der", "es", "was", "hier", "dort",
  "nothing", "something", "everything", "nichts", "etwas", "alles",
  "me", "you", "him", "her", "us", "mir", "dir", "ihm", "uns",
  "today", "tomorrow", "yesterday", "heute", "morgen", "gestern",
  "noch", "schon", "jetzt", "dann", "also", "aber", "oder",
]);

const MOOD_PATTERNS: Record<Exclude<Mood, "neutral">, RegExp> = {
  frustrated: /(?:fuck|shit|mist|nervig|genervt|damn|wtf|argh|schon wieder|zum kotzen|sucks)/i,
  excited: /(?:geil|nice|awesome|krass|boom|läuft|yes!|🎯|🚀|perfekt|brilliant|mega|sick)/i,
  tense: /(?:vorsicht|careful|risky|heikel|kritisch|dringend|urgent|achtung|gefährlich)/i,
  productive: /(?:erledigt|done|fixed|works|fertig|deployed|✅|gebaut|shipped|läuft)/i,
  exploratory: /(?:was wäre wenn|what if|könnte man|idea|idee|maybe|vielleicht|experiment)/i,
};

// ============================================================
// Public API
// ============================================================

export type PatternLanguage = "en" | "de" | "both";

export type PatternSet = {
  decision: RegExp[];
  close: RegExp[];
  wait: RegExp[];
  topic: RegExp[];
};

/**
 * Get pattern set for the configured language.
 * "both" merges EN + DE patterns.
 */
export function getPatterns(language: PatternLanguage): PatternSet {
  switch (language) {
    case "en":
      return {
        decision: DECISION_PATTERNS_EN,
        close: CLOSE_PATTERNS_EN,
        wait: WAIT_PATTERNS_EN,
        topic: TOPIC_PATTERNS_EN,
      };
    case "de":
      return {
        decision: DECISION_PATTERNS_DE,
        close: CLOSE_PATTERNS_DE,
        wait: WAIT_PATTERNS_DE,
        topic: TOPIC_PATTERNS_DE,
      };
    case "both":
      return {
        decision: [...DECISION_PATTERNS_EN, ...DECISION_PATTERNS_DE],
        close: [...CLOSE_PATTERNS_EN, ...CLOSE_PATTERNS_DE],
        wait: [...WAIT_PATTERNS_EN, ...WAIT_PATTERNS_DE],
        topic: [...TOPIC_PATTERNS_EN, ...TOPIC_PATTERNS_DE],
      };
  }
}

/**
 * Detect mood from text. Scans for all mood patterns; last match position wins.
 * Returns "neutral" if no mood pattern matches.
 */
export function detectMood(text: string): Mood {
  if (!text) return "neutral";

  let lastMood: Mood = "neutral";
  let lastPos = -1;

  for (const [mood, pattern] of Object.entries(MOOD_PATTERNS) as [Exclude<Mood, "neutral">, RegExp][]) {
    // Use global flag for position scanning
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match.index > lastPos) {
        lastPos = match.index;
        lastMood = mood;
      }
    }
  }

  return lastMood;
}

/**
 * Check if a topic candidate is noise (too short, blacklisted, or garbage).
 */
export function isNoiseTopic(topic: string): boolean {
  const trimmed = topic.trim();
  if (trimmed.length < 4) return true;
  // Single word that's in blacklist
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 1 && TOPIC_BLACKLIST.has(words[0])) return true;
  // All words are blacklisted
  if (words.every(w => TOPIC_BLACKLIST.has(w) || w.length < 3)) return true;
  // Looks like a sentence fragment (starts with pronoun or blacklisted word)
  if (/^(ich|i|we|wir|du|er|sie|he|she|it|es|nichts|nothing|etwas|something)\s/i.test(trimmed)) return true;
  // Contains line breaks or is too long for a title
  if (trimmed.includes("\n") || trimmed.length > 60) return true;
  return false;
}

/** High-impact keywords for decision impact inference */
export const HIGH_IMPACT_KEYWORDS = [
  "architecture", "architektur", "security", "sicherheit",
  "migration", "delete", "löschen", "production", "produktion",
  "deploy", "breaking", "major", "critical", "kritisch",
  "strategy", "strategie", "budget", "contract", "vertrag",
];

/** Export mood patterns for testing */
export { MOOD_PATTERNS };

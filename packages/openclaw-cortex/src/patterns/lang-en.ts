import type { LanguagePack } from "./types.js";

export const LANG_EN: LanguagePack = {
  code: "en",
  name: "English",
  nameEn: "English",

  patterns: {
    decision: [
      /(?:decided|decision|agreed|let'?s do|the plan is|approach:)/i,
    ],
    close: [
      /(?:^|\s)(?:is |it's |that's |all )?(?:done|fixed|solved|closed)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:it |that )works(?:\s|[.!]|$)/i,
      /✅/,
    ],
    wait: [
      /(?:waiting for|blocked by|need.*first)/i,
    ],
    topic: [
      /(?:back to|now about|regarding|let's (?:talk|discuss|look at))\s+(?:the\s+)?(\w[\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "it", "that", "this", "the", "them", "what", "which", "there",
    "nothing", "something", "everything",
    "me", "you", "him", "her", "us",
    "today", "tomorrow", "yesterday",
  ],

  highImpactKeywords: [
    "architecture", "security", "migration", "delete",
    "production", "deploy", "breaking", "major",
    "critical", "strategy", "budget", "contract",
  ],

  moodPatterns: {
    frustrated: /(?:fuck|shit|damn|sucks)/i,
    excited: /(?:nice|awesome|brilliant|sick)/i,
    tense: /(?:careful|risky|urgent)/i,
    productive: /(?:done|fixed|works|deployed|shipped)/i,
    exploratory: /(?:what if|idea|maybe|experiment)/i,
  },

  noisePrefixes: [
    "i", "we", "he", "she", "it", "nothing", "something",
  ],
};

export default LANG_EN;

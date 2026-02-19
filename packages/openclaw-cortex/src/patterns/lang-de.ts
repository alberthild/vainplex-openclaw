import type { LanguagePack } from "./types.js";

export const LANG_DE: LanguagePack = {
  code: "de",
  name: "Deutsch",
  nameEn: "German",

  patterns: {
    decision: [
      /(?:entschieden|beschlossen|machen wir|wir machen|der plan ist|ansatz:)/i,
    ],
    close: [
      /(?:^|\s)(?:ist |schon )?(?:erledigt|gefixt|gelöst|fertig)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:es |das )funktioniert(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:warte auf|blockiert durch|brauche.*erst)/i,
    ],
    topic: [
      /(?:zurück zu|jetzt zu|bzgl\.?|wegen|lass uns (?:über|mal))\s+(?:dem?|die|das)?\s*(\w[\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "das", "die", "der", "es", "was", "hier", "dort",
    "nichts", "etwas", "alles",
    "mir", "dir", "ihm", "uns",
    "heute", "morgen", "gestern",
    "noch", "schon", "jetzt", "dann", "also", "aber", "oder",
  ],

  highImpactKeywords: [
    "architektur", "sicherheit", "migration", "löschen",
    "produktion", "kritisch", "strategie", "vertrag",
  ],

  moodPatterns: {
    frustrated: /(?:mist|nervig|genervt|schon wieder|zum kotzen)/i,
    excited: /(?:geil|krass|boom|läuft|perfekt|mega)/i,
    tense: /(?:vorsicht|heikel|kritisch|dringend|achtung|gefährlich)/i,
    productive: /(?:erledigt|fertig|gebaut|läuft)/i,
    exploratory: /(?:was wäre wenn|könnte man|idee|vielleicht)/i,
  },

  noisePrefixes: [
    "ich", "wir", "du", "er", "sie", "es", "nichts", "etwas",
  ],
};

export default LANG_DE;

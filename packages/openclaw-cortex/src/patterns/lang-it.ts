import type { LanguagePack } from "./types.js";

export const LANG_IT: LanguagePack = {
  code: "it",
  name: "Italiano",
  nameEn: "Italian",

  patterns: {
    decision: [
      /(?:deciso|decisione|facciamo|il piano è|approccio:)/i,
      /(?:concordato|scelto di|optiamo per|andiamo con)/i,
    ],
    close: [
      /(?:^|\s)(?:è |già )?(?:fatto|risolto|chiuso|terminato|finito)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:già )?funziona(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:aspettando|bloccato da|serve.*prima)/i,
      /(?:in attesa di|manca.*prima)/i,
    ],
    topic: [
      /(?:torniamo a|adesso|riguardo|parliamo di|per quanto riguarda)\s+(?:il |la |lo |i |le |gli )?([a-zàèéìíòóùúA-ZÀÈÉÌÍÒÓÙÚ\w][a-zàèéìíòóùúA-ZÀÈÉÌÍÒÓÙÚ\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "il", "la", "lo", "i", "le", "gli", "un", "una", "uno",
    "questo", "quello", "questa", "quella",
    "io", "tu", "lui", "lei", "noi", "loro",
    "niente", "qualcosa", "tutto",
    "qui", "lì", "adesso", "allora", "ma", "perché",
    "oggi", "domani", "ieri",
  ],

  highImpactKeywords: [
    "architettura", "sicurezza", "migrazione", "eliminare",
    "produzione", "deploy", "critico", "strategia",
    "budget", "contratto", "importante",
  ],

  moodPatterns: {
    frustrated: /(?:cazzo|merda|cavolo|che palle|mannaggia|che schifo)/i,
    excited: /(?:fantastico|bellissimo|perfetto|grande|mitico|fichissimo)/i,
    tense: /(?:attenzione|pericoloso|urgente|critico|occhio|prudenza)/i,
    productive: /(?:fatto|terminato|deployato|sistemato|finito)/i,
    exploratory: /(?:e se|forse|idea|magari|potremmo|proviamo)/i,
  },

  noisePrefixes: [
    "io", "tu", "lui", "lei", "noi", "niente", "qualcosa",
  ],
};

export default LANG_IT;

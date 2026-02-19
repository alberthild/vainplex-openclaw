import type { LanguagePack } from "./types.js";

export const LANG_FR: LanguagePack = {
  code: "fr",
  name: "Français",
  nameEn: "French",

  patterns: {
    decision: [
      /(?:décidé|décision|on fait|le plan est|approche\s*:)/i,
      /(?:convenu|arrêté|choisi de|opté pour)/i,
    ],
    close: [
      /(?:^|\s)(?:c'est |est )?(?:fait|terminé|résolu|fermé|fini)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:ça |il )(?:marche|fonctionne)(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:en attente de|bloqué par|il faut d'abord)/i,
      /(?:attend[s]? (?:le|la|les|que)|besoin (?:de|d').*avant)/i,
    ],
    topic: [
      /(?:revenons à|maintenant|concernant|parlons de|à propos de)\s+(?:la?\s+)?([a-zàâçéèêëîïôûùüÿñæœA-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑÆŒ\w][a-zàâçéèêëîïôûùüÿñæœA-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑÆŒ\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "le", "la", "les", "un", "une", "des", "ce", "cette", "ces",
    "il", "elle", "on", "nous", "vous", "ils", "elles",
    "ça", "cela", "rien", "tout", "quelque", "chose",
    "ici", "là", "maintenant", "alors", "donc", "mais", "ou",
    "aujourd'hui", "demain", "hier",
  ],

  highImpactKeywords: [
    "architecture", "sécurité", "migration", "supprimer",
    "production", "déployer", "critique", "stratégie",
    "budget", "contrat", "majeur",
  ],

  moodPatterns: {
    frustrated: /(?:merde|putain|chiant|énervant|bordel|fait chier)/i,
    excited: /(?:génial|super|trop bien|magnifique|parfait|incroyable)/i,
    tense: /(?:attention|risqué|critique|urgent|dangereux|prudence)/i,
    productive: /(?:terminé|fait|déployé|livré|corrigé)/i,
    exploratory: /(?:et si|peut-être|idée|hypothèse|on pourrait|essayons)/i,
  },

  noisePrefixes: [
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "rien", "quelque",
  ],
};

export default LANG_FR;

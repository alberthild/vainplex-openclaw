import type { SignalLanguagePack } from "./types.js";

/**
 * French signal patterns.
 * Note: French accented characters (é, è, ê, ç, etc.) are NOT matched by \b
 * in standard JS regex. Use (?:\s|^) / (?:\s|$) or direct matching for
 * accented words.
 */
export const SIGNAL_LANG_FR: SignalLanguagePack = {
  code: "fr",
  name: "Français",
  nameEn: "French",

  correction: {
    indicators: [
      /(?:^|\s)(?:faux|c'est faux|c'est pas ça|incorrect|erreur)(?:\s|[.!,;]|$)/i,
      /(?:tu te trompes|vous vous trompez|ce n'est pas (?:ça|correct))/i,
      /(?:pas du tout|c'est pas ce que j'ai demandé|non en fait|attends non|corrige|recommence)/i,
    ],
    shortNegatives: [
      /^\s*(?:non)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:est-ce que je dois|dois-je|voulez-vous|veux-tu|tu veux|c'est bon\s*\?)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:laisse tomber|oublie|tant pis|je vais le faire moi-même|c'est inutile)/i,
      /(?:ça sert à rien|tu peux pas faire ça|pas utile|perte de temps)/i,
      /(?:ça marche pas|n'importe quoi|c'est nul|lâche l'affaire)/i,
    ],
    satisfactionOverrides: [
      /(?:merci|parfait|génial|super|excellent|bon travail|bravo)/i,
    ],
    resolutionIndicators: [
      /(?:désolé|pardon|je m'excuse|laisse-moi essayer|je réessaie)/i,
    ],
  },

  completion: {
    claims: [
      /(?:terminé|fait|fini|résolu|déployé|corrigé|accompli)/i,
      /(?:j'ai (?:tout |maintenant )?(?:terminé|fait|fini|déployé|corrigé))/i,
      /(?:c'est (?:maintenant )?(?:fait|terminé|déployé|en ligne|corrigé))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:utilisation (?:du )?disque|mémoire|cpu|charge) (?:est|à) (?:de )?\d+/i,
      /(?:le )?(?:service|serveur|daemon|processus) est (?:actif|arrêté|en marche|inactif|down)/i,
      /(?:le )?(?:fichier|config) (?:existe|est présent)/i,
      /il y a \d+ (?:erreurs?|avertissements?|connexions?|processus|fichiers)/i,
    ],
    opinionExclusions: [
      /(?:je crois|je pense|probablement|peut-être)/i,
      /(?:il semble|on dirait)/i,
    ],
  },
};

export default SIGNAL_LANG_FR;

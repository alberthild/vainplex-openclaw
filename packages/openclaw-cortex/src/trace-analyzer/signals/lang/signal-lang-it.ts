import type { SignalLanguagePack } from "./types.js";

/**
 * Italian signal patterns.
 * Note: Accented characters (à, è, é, ì, ò, ù) are NOT matched by \b
 * in standard JS regex. Avoid \b around accented words.
 */
export const SIGNAL_LANG_IT: SignalLanguagePack = {
  code: "it",
  name: "Italiano",
  nameEn: "Italian",

  correction: {
    indicators: [
      /(?:sbagliato|è sbagliato|non è corretto|hai sbagliato|questo è errato)/i,
      /(?:non è quello|non è quello che ho chiesto|non è quello che intendevo)/i,
      /(?:in realtà no|aspetta no|correggi|rifai)/i,
    ],
    shortNegatives: [
      /^\s*(?:no)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:devo|vuoi che|ti va bene|va bene\s*\?|okay\s*\?)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:lascia perdere|lascia stare|non importa|faccio da solo|è inutile|non serve a niente)/i,
      /(?:non riesci|non è utile|perdita di tempo|non funziona|mi arrendo)/i,
      /(?:è una schifezza|non ha senso|inutile)/i,
    ],
    satisfactionOverrides: [
      /(?:grazie|perfetto|fantastico|eccellente|ottimo lavoro|bravo|benissimo)/i,
    ],
    resolutionIndicators: [
      /(?:scusa|mi scuso|mi dispiace|lasciami provare|riprovo)/i,
    ],
  },

  completion: {
    claims: [
      /(?:fatto|pronto|completato|risolto|deployato|corretto|finito)/i,
      /(?:l'ho (?:fatto|completato|deployato|corretto))/i,
      /(?:è (?:fatto|pronto|deployato|in linea|corretto))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:uso disco|memoria|cpu|carico) (?:è|è al|a) (?:del )?\d+/i,
      /(?:il )?(?:servizio|server|daemon|processo) è (?:attivo|fermo|in esecuzione|inattivo|down)/i,
      /(?:il )?(?:file|config) (?:esiste|è presente)/i,
      /ci sono \d+ (?:errori?|avvisi?|connessioni?|processi|file)/i,
    ],
    opinionExclusions: [
      /(?:penso che|credo che|probabilmente|forse)/i,
      /(?:sembra che|pare che)/i,
    ],
  },
};

export default SIGNAL_LANG_IT;

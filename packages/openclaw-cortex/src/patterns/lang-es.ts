import type { LanguagePack } from "./types.js";

export const LANG_ES: LanguagePack = {
  code: "es",
  name: "Español",
  nameEn: "Spanish",

  patterns: {
    decision: [
      /(?:decidido|decisión|hagamos|el plan es|enfoque:)/i,
      /(?:acordado|optamos por|elegimos|vamos con)/i,
    ],
    close: [
      /(?:^|\s)(?:está |ya )?(?:hecho|resuelto|cerrado|terminado|listo)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:ya )?funciona(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:esperando|bloqueado por|necesitamos.*primero)/i,
      /(?:pendiente de|falta.*antes)/i,
    ],
    topic: [
      /(?:volvamos a|ahora sobre|respecto a|hablemos de|en cuanto a)\s+(?:el |la |los |las )?([a-záéíóúñüA-ZÁÉÍÓÚÑÜ\w][a-záéíóúñüA-ZÁÉÍÓÚÑÜ\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "esto", "eso", "aquello", "ese", "esta",
    "yo", "tú", "él", "ella", "nosotros", "ellos", "ellas",
    "nada", "algo", "todo",
    "aquí", "allí", "ahora", "entonces", "pero", "porque",
    "hoy", "mañana", "ayer",
  ],

  highImpactKeywords: [
    "arquitectura", "seguridad", "migración", "eliminar",
    "producción", "desplegar", "crítico", "estrategia",
    "presupuesto", "contrato", "importante",
  ],

  moodPatterns: {
    frustrated: /(?:mierda|joder|hostia|coño|qué asco|me cago)/i,
    excited: /(?:genial|increíble|perfecto|brutal|guay|mola)/i,
    tense: /(?:cuidado|peligroso|urgente|crítico|ojo|atención)/i,
    productive: /(?:hecho|terminado|desplegado|arreglado|listo)/i,
    exploratory: /(?:y si|quizás|idea|a lo mejor|podríamos|probemos)/i,
  },

  noisePrefixes: [
    "yo", "tú", "él", "ella", "nosotros", "nada", "algo",
  ],
};

export default LANG_ES;

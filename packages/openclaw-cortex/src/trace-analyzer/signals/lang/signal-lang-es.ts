import type { SignalLanguagePack } from "./types.js";

/**
 * Spanish signal patterns.
 * Note: Accented characters (á, é, í, ó, ú, ñ) are NOT matched by \b
 * in standard JS regex. Avoid \b around accented words.
 */
export const SIGNAL_LANG_ES: SignalLanguagePack = {
  code: "es",
  name: "Español",
  nameEn: "Spanish",

  correction: {
    indicators: [
      /(?:mal|eso está mal|incorrecto|equivocado|te equivocas|eso no es)/i,
      /(?:no es eso|no es lo que pedí|no es lo que quise decir)/i,
      /(?:en realidad no|espera no|corrige eso|otra vez)/i,
    ],
    shortNegatives: [
      /^\s*(?:no)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:¿|debo|quieres que|quiere que|te parece bien|está bien\s*\?)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:olvídalo|déjalo|ya da igual|lo hago yo|esto es inútil|no sirve)/i,
      /(?:no puedes hacer esto|no es útil|pérdida de tiempo|no funciona|me rindo)/i,
      /(?:es una porquería|olvidémonos|no tiene sentido)/i,
    ],
    satisfactionOverrides: [
      /(?:gracias|perfecto|genial|excelente|buen trabajo|increíble)/i,
    ],
    resolutionIndicators: [
      /(?:lo siento|perdón|disculpa|déjame intentar|voy a intentar de nuevo)/i,
    ],
  },

  completion: {
    claims: [
      /(?:hecho|listo|completado|resuelto|desplegado|arreglado|terminado)/i,
      /(?:ya lo |lo he )(?:hecho|completado|desplegado|arreglado)/i,
      /(?:ya está|está listo|ha sido desplegado|funcionando)/i,
    ],
  },

  systemState: {
    claims: [
      /(?:uso de disco|memoria|cpu|carga) (?:es|está en|al) (?:de )?\d+/i,
      /(?:el )?(?:servicio|servidor|daemon|proceso) está (?:activo|detenido|corriendo|inactivo|caído)/i,
      /(?:el )?(?:archivo|config) (?:existe|está presente)/i,
      /hay \d+ (?:errores?|advertencias?|conexiones?|procesos|archivos)/i,
    ],
    opinionExclusions: [
      /(?:creo que|pienso que|probablemente|quizás|tal vez)/i,
      /(?:parece que|parece ser)/i,
    ],
  },
};

export default SIGNAL_LANG_ES;

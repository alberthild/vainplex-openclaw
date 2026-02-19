import type { SignalLanguagePack } from "./types.js";

/**
 * Portuguese signal patterns.
 * Note: Accented characters (á, ã, ç, é, etc.) are NOT matched by \b
 * in standard JS regex. Avoid \b around accented words.
 */
export const SIGNAL_LANG_PT: SignalLanguagePack = {
  code: "pt",
  name: "Português",
  nameEn: "Portuguese",

  correction: {
    indicators: [
      /(?:errado|isso está errado|incorreto|você errou|isso não está certo)/i,
      /(?:não é isso|não foi o que pedi|não foi o que eu quis dizer)/i,
      /(?:na verdade não|espera não|corrija isso|de novo)/i,
    ],
    shortNegatives: [
      /^\s*(?:não)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:devo|quer que eu|você quer|tá bom\s*\?|está bem\s*\?)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:deixa pra lá|esquece|tanto faz|eu faço eu mesmo|isso é inútil|não serve)/i,
      /(?:você não consegue|não ajuda|perda de tempo|não funciona|desisto)/i,
      /(?:é uma porcaria|não tem sentido|não adianta)/i,
    ],
    satisfactionOverrides: [
      /(?:obrigado|obrigada|perfeito|genial|excelente|bom trabalho|ótimo)/i,
    ],
    resolutionIndicators: [
      /(?:desculpe|desculpa|perdão|me deixa tentar|vou tentar de novo)/i,
    ],
  },

  completion: {
    claims: [
      /(?:feito|pronto|completado|resolvido|implantado|corrigido|terminado)/i,
      /(?:já (?:fiz|completei|implantei|corrigi))/i,
      /(?:já está|está pronto|foi implantado|funcionando)/i,
    ],
  },

  systemState: {
    claims: [
      /(?:uso de disco|memória|cpu|carga) (?:é|está em|a) (?:de )?\d+/i,
      /(?:o )?(?:serviço|servidor|daemon|processo) está (?:ativo|parado|rodando|inativo|fora)/i,
      /(?:o )?(?:arquivo|config) (?:existe|está presente)/i,
      /existem \d+ (?:erros?|avisos?|conexões?|processos|arquivos)/i,
    ],
    opinionExclusions: [
      /(?:eu acho|acho que|provavelmente|talvez)/i,
      /(?:parece que|parece ser)/i,
    ],
  },
};

export default SIGNAL_LANG_PT;

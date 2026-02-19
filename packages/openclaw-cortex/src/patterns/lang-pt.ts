import type { LanguagePack } from "./types.js";

export const LANG_PT: LanguagePack = {
  code: "pt",
  name: "Português",
  nameEn: "Portuguese",

  patterns: {
    decision: [
      /(?:decidido|decisão|vamos fazer|o plano é|abordagem:)/i,
      /(?:combinado|optamos por|escolhemos|ficou definido)/i,
    ],
    close: [
      /(?:^|\s)(?:está |já )?(?:feito|resolvido|fechado|terminado|pronto)(?:\s|[.!]|$)/i,
      /(?:^|\s)(?:já )?funciona(?:\s|[.!]|$)/i,
    ],
    wait: [
      /(?:esperando|bloqueado por|precisamos.*primeiro)/i,
      /(?:pendente|falta.*antes)/i,
    ],
    topic: [
      /(?:voltando a|agora sobre|quanto a|vamos falar de|em relação a)\s+(?:o |a |os |as )?([a-záâãàéêíóôõúçA-ZÁÂÃÀÉÊÍÓÔÕÚÇ\w][a-záâãàéêíóôõúçA-ZÁÂÃÀÉÊÍÓÔÕÚÇ\w\s-]{3,40})/i,
    ],
  },

  topicBlacklist: [
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "isso", "isto", "aquilo", "esse", "esta",
    "eu", "tu", "ele", "ela", "nós", "eles", "elas",
    "nada", "algo", "tudo",
    "aqui", "ali", "agora", "então", "mas", "porque",
    "hoje", "amanhã", "ontem",
  ],

  highImpactKeywords: [
    "arquitetura", "segurança", "migração", "deletar",
    "produção", "deploy", "crítico", "estratégia",
    "orçamento", "contrato", "importante",
  ],

  moodPatterns: {
    frustrated: /(?:merda|porra|caralho|droga|que saco|inferno)/i,
    excited: /(?:genial|incrível|perfeito|massa|demais|show)/i,
    tense: /(?:cuidado|perigoso|urgente|crítico|atenção)/i,
    productive: /(?:feito|terminado|deployado|arrumado|pronto)/i,
    exploratory: /(?:e se|talvez|ideia|será que|poderíamos|testemos)/i,
  },

  noisePrefixes: [
    "eu", "tu", "ele", "ela", "nós", "nada", "algo",
  ],
};

export default LANG_PT;

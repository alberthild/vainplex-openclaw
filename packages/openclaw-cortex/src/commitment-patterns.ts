/**
 * Multi-language commitment detection patterns.
 * Detects when someone promises or agrees to do something.
 */

export type CommitmentPattern = {
  readonly pattern: RegExp;
  readonly language: string;
};

const EN_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:I'll|I will|I'm going to)\b\s+(.{5,80})/i, language: "en" },
  { pattern: /\b(?:let me|allow me to)\b\s+(.{5,80})/i, language: "en" },
  { pattern: /\b(?:I can do that|I'll handle|I'll take care)\b/i, language: "en" },
  { pattern: /\b(?:I promise|I commit to|I guarantee)\b\s+(.{5,80})/i, language: "en" },
  { pattern: /\b(?:consider it done|I'm on it)\b/i, language: "en" },
];

const DE_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:ich werde|ich mach|ich kümmere mich)\b\s+(.{5,80})/i, language: "de" },
  { pattern: /\b(?:mach ich|erledigt|wird gemacht|klar mach ich)\b/i, language: "de" },
  { pattern: /\b(?:versprochen|abgemacht|geht klar)\b/i, language: "de" },
  { pattern: /\b(?:ich übernehme|das übernehm ich)\b/i, language: "de" },
];

const FR_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:je vais|je ferai|je m'en occupe)\b\s*(.{5,80})/i, language: "fr" },
  { pattern: /\b(?:c'est noté|je m'engage à)\b/i, language: "fr" },
];

const ES_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:lo haré|me encargo|yo me ocupo)\b/i, language: "es" },
  { pattern: /\b(?:prometido|de acuerdo|hecho)\b/i, language: "es" },
];

const PT_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:eu vou|eu farei|fico responsável)\b/i, language: "pt" },
  { pattern: /\b(?:combinado|feito|pode deixar)\b/i, language: "pt" },
];

const IT_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:lo farò|me ne occupo|ci penso io)\b/i, language: "it" },
  { pattern: /\b(?:promesso|affare fatto|d'accordo)\b/i, language: "it" },
];

const ZH_PATTERNS: CommitmentPattern[] = [
  { pattern: /(?:我会|我来|我负责|包在我身上|没问题)/, language: "zh" },
];

const JA_PATTERNS: CommitmentPattern[] = [
  { pattern: /(?:やります|対応します|承知しました)/, language: "ja" },
];

const KO_PATTERNS: CommitmentPattern[] = [
  { pattern: /(?:제가 할게요|처리하겠습니다|알겠습니다)/, language: "ko" },
];

const RU_PATTERNS: CommitmentPattern[] = [
  { pattern: /\b(?:я сделаю|я займусь|обещаю|договорились)\b/i, language: "ru" },
];

export const ALL_COMMITMENT_PATTERNS: ReadonlyArray<CommitmentPattern> = [
  ...EN_PATTERNS, ...DE_PATTERNS, ...FR_PATTERNS, ...ES_PATTERNS,
  ...PT_PATTERNS, ...IT_PATTERNS, ...ZH_PATTERNS, ...JA_PATTERNS,
  ...KO_PATTERNS, ...RU_PATTERNS,
];

/** Detect commitment patterns in a message. Returns matched patterns. */
export function detectCommitments(text: string): CommitmentPattern[] {
  return ALL_COMMITMENT_PATTERNS.filter((p) => p.pattern.test(text));
}

// ============================================================
// Signal Language Pack — Type Definitions
// ============================================================
//
// Per-language pattern pack for signal detection.
// Follows RFC-004 LanguagePack conventions:
// - One file per language (signal-lang-{code}.ts)
// - Default export of the pack
// - All RegExp patterns case-insensitive
// ============================================================

/**
 * Per-language pattern pack for signal detection.
 * Each language provides patterns for four language-sensitive signals.
 */
export type SignalLanguagePack = {
  /** ISO 639-1 code (e.g., "en", "de", "fr") */
  code: string;
  /** Language name in the language itself */
  name: string;
  /** English name for logs */
  nameEn: string;

  /** User correction indicators (SIG-CORRECTION) */
  correction: {
    /**
     * Phrases indicating the user is correcting the agent.
     * Examples: "wrong", "that's not right", "falsch", "c'est faux"
     */
    indicators: RegExp[];
    /**
     * Short negative responses that are valid answers, not corrections.
     * These are suppressed when the preceding agent message was a question.
     * Examples: "nein", "no", "non"
     */
    shortNegatives: RegExp[];
  };

  /** Question indicators (shared: SIG-CORRECTION exclusion, SIG-HALLUCINATION exclusion) */
  question: {
    /**
     * Patterns indicating an agent message is a question, not an assertion.
     * Examples: "shall I?", "soll ich?", "est-ce que je dois?"
     */
    indicators: RegExp[];
  };

  /** User dissatisfaction indicators (SIG-DISSATISFIED) */
  dissatisfaction: {
    /**
     * Phrases indicating the user is frustrated or giving up.
     * Examples: "forget it", "vergiss es", "olvídalo", "もういい"
     */
    indicators: RegExp[];
    /**
     * Phrases indicating user satisfaction (exclusion filter).
     * Examples: "thanks", "danke", "merci", "ありがとう"
     */
    satisfactionOverrides: RegExp[];
    /**
     * Agent resolution attempts (exclusion: agent tried to fix it).
     * Examples: "sorry", "entschuldigung", "désolé"
     */
    resolutionIndicators: RegExp[];
  };

  /** Completion claim indicators (SIG-HALLUCINATION) */
  completion: {
    /**
     * Phrases where the agent claims task completion.
     * Examples: "done", "erledigt", "terminé", "完了", "완료"
     */
    claims: RegExp[];
  };

  /** System state claim indicators (SIG-UNVERIFIED-CLAIM) */
  systemState: {
    /**
     * Patterns matching factual claims about system state that
     * require tool verification.
     * Examples: "disk usage is 45%", "server is running",
     *           "el servidor está activo"
     */
    claims: RegExp[];
    /**
     * Hedging/opinion phrases that exclude a claim from detection.
     * Examples: "I think", "probably", "je crois", "たぶん"
     */
    opinionExclusions: RegExp[];
  };
};

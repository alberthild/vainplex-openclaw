/**
 * Output Validator Module — Output Validation Pipeline (v0.2.0 / v0.5.0)
 *
 * Orchestrates the full output validation pipeline:
 * 1. Claim detection (via claim-detector)
 * 2. Fact checking (via fact-checker)
 * 3. Contradiction detection with trust-proportional verdicts
 * 4. (v0.5.0) LLM validation for external communications (Stage 3)
 *
 * Verdict rules:
 * - No claims or no contradictions → "pass"
 * - Contradiction + trust ≥ flagAbove (default 60) → "pass" (trusted agents tolerate contradictions)
 * - Contradiction + blockBelow ≤ trust < flagAbove → "flag"
 * - Contradiction + trust < blockBelow (default 40) → "block"
 * - unverifiedClaimPolicy default "ignore" → unverified claims not flagged
 * - isExternal + LLM validator enabled → Stage 3 (LLM verdict overrides if more restrictive)
 *
 * Stage 1+2 are synchronous. Stage 3 is async (LLM call).
 */

import type {
  Claim,
  Fact,
  FactCheckResult,
  LlmValidationResult,
  OutputValidationConfig,
  OutputValidationResult,
  OutputVerdict,
  PluginLogger,
} from "./types.js";
import { detectClaims } from "./claim-detector.js";
import { FactRegistry, checkClaims } from "./fact-checker.js";
import type { LlmValidator } from "./llm-validator.js";

/** Default output validation configuration */
export const DEFAULT_OUTPUT_VALIDATION_CONFIG: OutputValidationConfig = {
  enabled: false,
  enabledDetectors: [
    "system_state",
    "entity_name",
    "existence",
    "operational_status",
    "self_referential",
  ],
  factRegistries: [],
  unverifiedClaimPolicy: "ignore",
  selfReferentialPolicy: "ignore",
  contradictionThresholds: {
    flagAbove: 60,
    blockBelow: 40,
  },
};

/** Verdict severity ordering for "most restrictive wins" logic */
const VERDICT_SEVERITY: Record<OutputVerdict, number> = {
  pass: 0,
  flag: 1,
  block: 2,
};

export class OutputValidator {
  private readonly config: OutputValidationConfig;
  private readonly factRegistry: FactRegistry;
  private readonly logger: PluginLogger;
  private llmValidator: LlmValidator | null = null;

  constructor(config: OutputValidationConfig, logger: PluginLogger) {
    this.config = config;
    this.factRegistry = new FactRegistry(config.factRegistries, logger);
    this.logger = logger;

    if (config.enabled) {
      this.logger.info(
        `[governance] Output validation enabled: ${this.factRegistry.size} facts, ` +
        `${config.enabledDetectors.length} detectors, ` +
        `unverifiedClaimPolicy=${config.unverifiedClaimPolicy}`,
      );
    }
  }

  /**
   * Set the LLM validator instance (for Stage 3).
   * Called externally after construction since LLM validator
   * requires dependency injection of callLlm.
   */
  setLlmValidator(validator: LlmValidator): void {
    this.llmValidator = validator;
  }

  /**
   * Validate agent output text.
   * Stages 1+2 are synchronous. Stage 3 (LLM) is async and only runs
   * when isExternal=true and llmValidator is configured.
   *
   * @param text - The output text to validate
   * @param trustScore - Current agent trust score (0-100)
   * @param isExternal - Whether this is an external communication
   * @returns Full validation result with verdict, claims, and reasons
   */
  validate(text: string, trustScore: number, isExternal?: boolean): OutputValidationResult | Promise<OutputValidationResult> {
    const startUs = Math.round(performance.now() * 1000);

    if (!this.config.enabled || !text) {
      return makePassResult(startUs);
    }

    // Stage 1: Detect claims
    const claims = detectClaims(text, this.config.enabledDetectors);

    if (claims.length === 0 && !isExternal) {
      return makePassResult(startUs, [], [], "No claims detected");
    }

    // Stage 2: Fact-check claims
    const factCheckResults = claims.length > 0 ? checkClaims(claims, this.factRegistry) : [];

    const contradictions = factCheckResults.filter((r) => r.status === "contradicted");
    const unverified = factCheckResults.filter((r) => r.status === "unverified");

    const stage12Verdict = this.determineVerdict(
      contradictions,
      unverified,
      trustScore,
    );

    // Stage 3: LLM validation (only for external communications)
    if (isExternal && this.llmValidator && this.config.llmValidator?.enabled) {
      return this.runStage3(
        text, claims, factCheckResults, contradictions,
        stage12Verdict, startUs,
      );
    }

    const endUs = Math.round(performance.now() * 1000);
    return {
      verdict: stage12Verdict.action,
      claims,
      factCheckResults,
      contradictions,
      reason: stage12Verdict.reason,
      evaluationUs: endUs - startUs,
    };
  }

  private async runStage3(
    text: string,
    claims: Claim[],
    factCheckResults: FactCheckResult[],
    contradictions: FactCheckResult[],
    stage12Verdict: { action: OutputVerdict; reason: string },
    startUs: number,
  ): Promise<OutputValidationResult> {
    try {
      // Get all known facts for context
      const allFacts = this.getAllFacts();
      const llmResult = await this.llmValidator!.validate(text, allFacts, true);

      // Most restrictive verdict wins
      const finalVerdict = moreRestrictiveVerdict(stage12Verdict.action, llmResult.verdict);
      const reasons: string[] = [];
      if (stage12Verdict.action !== "pass") reasons.push(stage12Verdict.reason);
      if (llmResult.verdict !== "pass") reasons.push(llmResult.reason);
      const reason = reasons.length > 0
        ? reasons.join(" | ")
        : stage12Verdict.reason || llmResult.reason;

      const endUs = Math.round(performance.now() * 1000);
      return {
        verdict: finalVerdict,
        claims,
        factCheckResults,
        contradictions,
        reason,
        evaluationUs: endUs - startUs,
        llmResult,
      } as OutputValidationResult & { llmResult?: LlmValidationResult };
    } catch (e) {
      this.logger.error(
        `[governance] LLM validation stage error: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Fail open — return Stage 1+2 result
      const endUs = Math.round(performance.now() * 1000);
      return {
        verdict: stage12Verdict.action,
        claims,
        factCheckResults,
        contradictions,
        reason: stage12Verdict.reason,
        evaluationUs: endUs - startUs,
      };
    }
  }

  /**
   * Get all facts from the registry (for LLM context).
   * Delegates to FactRegistry.getAllFacts() which includes both
   * inline facts AND file-loaded facts (RFC-006 §8.3).
   */
  private getAllFacts(): Fact[] {
    return this.factRegistry.getAllFacts();
  }

  private determineVerdict(
    contradictions: FactCheckResult[],
    unverified: FactCheckResult[],
    trustScore: number,
  ): { action: OutputVerdict; reason: string } {
    // Check contradictions first (highest severity)
    if (contradictions.length > 0) {
      return this.verdictForContradiction(contradictions, trustScore);
    }

    // Check unverified claims based on policy
    if (unverified.length > 0 && this.config.unverifiedClaimPolicy !== "ignore") {
      // Separate self-referential from other unverified
      const selfRef = unverified.filter((r) => r.claim.type === "self_referential");
      const otherUnverified = unverified.filter((r) => r.claim.type !== "self_referential");

      // Handle self-referential policy
      if (selfRef.length > 0 && this.config.selfReferentialPolicy !== "ignore") {
        const action = this.config.selfReferentialPolicy === "block" ? "block" : "flag";
        return {
          action: action as OutputVerdict,
          reason: `Self-referential claim${selfRef.length > 1 ? "s" : ""} detected: ` +
            selfRef.map((r) => `"${r.claim.source}"`).join(", "),
        };
      }

      // Handle other unverified claims
      if (otherUnverified.length > 0) {
        const action = this.config.unverifiedClaimPolicy === "block" ? "block" : "flag";
        return {
          action: action as OutputVerdict,
          reason: `Unverified claim${otherUnverified.length > 1 ? "s" : ""}: ` +
            otherUnverified.map((r) => `"${r.claim.source}"`).join(", "),
        };
      }
    }

    return { action: "pass", reason: "All claims verified or no contradictions found" };
  }

  private verdictForContradiction(
    contradictions: FactCheckResult[],
    trustScore: number,
  ): { action: OutputVerdict; reason: string } {
    const { blockBelow, flagAbove } = this.config.contradictionThresholds;

    const summaries = contradictions.map((c) => {
      const claimed = c.claim.value;
      const actual = c.fact?.value ?? "unknown";
      return `${c.claim.subject}: claimed "${claimed}", actual "${actual}"`;
    });
    const detail = summaries.join("; ");

    if (trustScore < blockBelow) {
      return {
        action: "block",
        reason: `Contradiction detected (trust ${trustScore} < ${blockBelow}): ${detail}`,
      };
    }

    if (trustScore >= flagAbove) {
      return {
        action: "pass",
        reason: `Contradiction detected but trusted (trust ${trustScore} >= ${flagAbove}): ${detail}`,
      };
    }

    // blockBelow <= trust < flagAbove → flag
    return {
      action: "flag",
      reason: `Contradiction detected (trust ${trustScore}): ${detail}`,
    };
  }

  /** Get current configuration (for status/debugging) */
  getConfig(): OutputValidationConfig {
    return this.config;
  }

  /** Get fact registry size */
  getFactCount(): number {
    return this.factRegistry.size;
  }
}

function moreRestrictiveVerdict(a: OutputVerdict, b: OutputVerdict): OutputVerdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b;
}

function makePassResult(
  startUs?: number,
  claims: Claim[] = [],
  factCheckResults: FactCheckResult[] = [],
  reason = "Output validation disabled or empty text",
): OutputValidationResult {
  const endUs = Math.round(performance.now() * 1000);
  return {
    verdict: "pass",
    claims,
    factCheckResults,
    contradictions: [],
    reason,
    evaluationUs: startUs ? endUs - startUs : 0,
  };
}

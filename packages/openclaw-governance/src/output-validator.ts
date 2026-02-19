/**
 * Output Validator Module — Output Validation Pipeline (v0.2.0)
 *
 * Orchestrates the full output validation pipeline:
 * 1. Claim detection (via claim-detector)
 * 2. Fact checking (via fact-checker)
 * 3. Contradiction detection with trust-proportional verdicts
 *
 * Verdict rules:
 * - No claims or no contradictions → "pass"
 * - Contradiction + trust ≥ flagAbove (default 60) → "flag"
 * - Contradiction + trust < blockBelow (default 40) → "block"
 * - Contradiction + trust between thresholds → "flag"
 * - unverifiedClaimPolicy default "ignore" → unverified claims not flagged
 *
 * All operations are synchronous. Target: <10ms total.
 */

import type {
  Claim,
  FactCheckResult,
  OutputValidationConfig,
  OutputValidationResult,
  OutputVerdict,
  PluginLogger,
} from "./types.js";
import { detectClaims } from "./claim-detector.js";
import { FactRegistry, checkClaims } from "./fact-checker.js";

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

export class OutputValidator {
  private readonly config: OutputValidationConfig;
  private readonly factRegistry: FactRegistry;
  private readonly logger: PluginLogger;

  constructor(config: OutputValidationConfig, logger: PluginLogger) {
    this.config = config;
    this.factRegistry = new FactRegistry(config.factRegistries);
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
   * Validate agent output text. Synchronous.
   * @param text - The output text to validate
   * @param trustScore - Current agent trust score (0-100)
   * @returns Full validation result with verdict, claims, and reasons
   */
  validate(text: string, trustScore: number): OutputValidationResult {
    const startUs = Math.round(performance.now() * 1000);

    if (!this.config.enabled || !text) {
      return makePassResult(startUs);
    }

    // Step 1: Detect claims
    const claims = detectClaims(text, this.config.enabledDetectors);

    if (claims.length === 0) {
      return makePassResult(startUs, [], [], "No claims detected");
    }

    // Step 2: Fact-check claims
    const factCheckResults = checkClaims(claims, this.factRegistry);

    // Step 3: Separate results
    const contradictions = factCheckResults.filter((r) => r.status === "contradicted");
    const unverified = factCheckResults.filter((r) => r.status === "unverified");

    // Step 4: Determine verdict
    const verdict = this.determineVerdict(
      contradictions,
      unverified,
      trustScore,
    );

    const endUs = Math.round(performance.now() * 1000);

    return {
      verdict: verdict.action,
      claims,
      factCheckResults,
      contradictions,
      reason: verdict.reason,
      evaluationUs: endUs - startUs,
    };
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
    const { blockBelow } = this.config.contradictionThresholds;

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

    // Trust >= blockBelow → flag
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

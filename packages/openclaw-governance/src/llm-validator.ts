/**
 * LLM Validator Module — Stage 3 Output Validation (RFC-006)
 *
 * Uses an LLM to detect semantic hallucinations that regex-based
 * detectors cannot catch: unsubstantiated assertions, misleading
 * implications, contradictions, and exaggerated claims.
 *
 * Only invoked for external communications (tweets, emails, etc.)
 * to keep cost and latency manageable.
 *
 * The LLM is called via dependency injection (callLlm parameter),
 * not by importing OpenClaw internals.
 */

import type {
  Fact,
  LlmValidationIssue,
  LlmValidationResult,
  LlmValidatorConfig,
  OutputVerdict,
  PluginLogger,
} from "./types.js";

/** Function signature for LLM calls (dependency injection) */
export type CallLlmFn = (prompt: string, opts?: {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}) => Promise<string>;

/** Cache entry with TTL */
type CacheEntry = {
  result: LlmValidationResult;
  expiresAt: number;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Simple string hash (djb2) — NOT cryptographic, just for cache keys.
 * Avoids collisions from truncation-based keys.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export const DEFAULT_LLM_VALIDATOR_CONFIG: LlmValidatorConfig = {
  enabled: false,
  maxTokens: 500,
  timeoutMs: 5000,
  externalChannels: ["twitter", "linkedin", "email"],
  externalCommands: ["bird tweet", "bird reply"],
};

/**
 * Build the prompt for the LLM fact-checker.
 * Exported for testing.
 */
export function buildPrompt(text: string, facts: Fact[], isExternal: boolean): string {
  const factsSection = facts.length > 0
    ? `\n## Known Facts\n${facts.map((f) => `- ${f.subject} ${f.predicate}: ${f.value}${f.source ? ` (source: ${f.source})` : ""}`).join("\n")}\n`
    : "\n## Known Facts\nNo known facts provided.\n";

  const contextNote = isExternal
    ? "This text is intended for EXTERNAL communication (social media, email, etc.). Apply strict scrutiny."
    : "This text is for internal use.";

  return `You are a Corporate Communications Fact-Checker. Your job is to identify potential issues in the following text.

${contextNote}

## Text to Review
${text}
${factsSection}
## Check For
1. **false_numeric**: False or fabricated numeric claims (counts, percentages, dates)
2. **unsubstantiated_assertion**: Claims presented as fact without evidence
3. **misleading_implication**: Statements that imply something false through word choice or framing
4. **contradiction**: Claims that contradict the known facts listed above
5. **exaggerated_claim**: Capabilities or achievements stated in exaggerated or absolute terms

## Response Format
Respond ONLY with a JSON object (no markdown, no explanation):
{
  "issues": [
    {
      "category": "one of: false_numeric, unsubstantiated_assertion, misleading_implication, contradiction, exaggerated_claim",
      "claim": "the specific text that is problematic",
      "explanation": "why this is an issue",
      "severity": "critical | high | medium | low"
    }
  ]
}

If no issues are found, respond with: {"issues": []}`;
}

/**
 * Parse the LLM response into a structured result.
 * Handles malformed JSON gracefully.
 */
export function parseResponse(raw: string, logger: PluginLogger): LlmValidationResult {
  try {
    // Try to extract JSON from the response (LLMs sometimes wrap in markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("[governance] LLM validator: no JSON found in response");
      return { verdict: "pass", issues: [], reason: "LLM response unparseable — defaulting to pass", cached: false };
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || !("issues" in parsed)) {
      logger.warn("[governance] LLM validator: response missing 'issues' field");
      return { verdict: "pass", issues: [], reason: "LLM response missing issues — defaulting to pass", cached: false };
    }

    const obj = parsed as { issues: unknown };
    if (!Array.isArray(obj.issues)) {
      return { verdict: "pass", issues: [], reason: "LLM response issues not an array — defaulting to pass", cached: false };
    }

    const issues: LlmValidationIssue[] = [];
    for (const item of obj.issues) {
      if (item && typeof item === "object" && "category" in item && "claim" in item) {
        const i = item as Record<string, unknown>;
        issues.push({
          category: String(i["category"] ?? "unknown"),
          claim: String(i["claim"] ?? ""),
          explanation: String(i["explanation"] ?? ""),
          severity: validateSeverity(i["severity"]),
        });
      }
    }

    if (issues.length === 0) {
      return { verdict: "pass", issues: [], reason: "LLM validation passed — no issues found", cached: false };
    }

    const verdict = determineVerdict(issues);
    const reason = issues.map((i) => `[${i.severity}] ${i.category}: ${i.claim}`).join("; ");

    return { verdict, issues, reason: `LLM validation: ${reason}`, cached: false };
  } catch (e) {
    logger.warn(`[governance] LLM validator: JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    return { verdict: "pass", issues: [], reason: "LLM response parse error — defaulting to pass", cached: false };
  }
}

function validateSeverity(v: unknown): LlmValidationIssue["severity"] {
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function determineVerdict(issues: LlmValidationIssue[]): OutputVerdict {
  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasHigh = issues.some((i) => i.severity === "high");

  if (hasCritical) return "block";
  if (hasHigh) return "flag";
  return "flag"; // medium/low issues still get flagged
}

export class LlmValidator {
  private readonly config: LlmValidatorConfig;
  private readonly callLlm: CallLlmFn;
  private readonly logger: PluginLogger;
  private readonly cache: Map<string, CacheEntry>;
  private readonly cacheTtlMs: number;

  constructor(
    config: LlmValidatorConfig,
    callLlm: CallLlmFn,
    logger: PluginLogger,
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
  ) {
    this.config = config;
    this.callLlm = callLlm;
    this.logger = logger;
    this.cache = new Map();
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Validate text using an LLM.
   * Returns cached result if available and not expired.
   */
  async validate(text: string, facts: Fact[], isExternal: boolean): Promise<LlmValidationResult> {
    if (!this.config.enabled) {
      return { verdict: "pass", issues: [], reason: "LLM validator disabled", cached: false };
    }

    // Check cache
    const cacheKey = this.makeCacheKey(text, facts, isExternal);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cached: true };
    }

    // Build prompt and call LLM
    const prompt = buildPrompt(text, facts, isExternal);

    const maxAttempts = 1 + (this.config.retryAttempts ?? 0);
    let lastError: string = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const raw = await this.callLlm(prompt, {
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          timeoutMs: this.config.timeoutMs,
        });

        const result = parseResponse(raw, this.logger);

        // Cache the result
        this.cache.set(cacheKey, {
          result,
          expiresAt: Date.now() + this.cacheTtlMs,
        });

        // Evict expired entries periodically
        if (this.cache.size > 100) {
          this.evictExpired();
        }

        return result;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `[governance] LLM validator call failed (attempt ${attempt}/${maxAttempts}): ${lastError}`,
        );
        // Brief pause before retry (except on last attempt)
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    // All attempts failed — apply failMode
    const failMode = this.config.failMode ?? "open";
    if (failMode === "closed") {
      return {
        verdict: "block",
        issues: [],
        reason: `LLM call failed after ${maxAttempts} attempt(s) — fail-closed blocks external communication`,
        cached: false,
      };
    }
    return { verdict: "pass", issues: [], reason: "LLM call failed — defaulting to pass (fail-open)", cached: false };
  }

  /** Get current cache size (for monitoring/testing) */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Clear cache (for testing) */
  clearCache(): void {
    this.cache.clear();
  }

  private makeCacheKey(text: string, facts: Fact[], isExternal: boolean): string {
    const factSig = facts.map((f) => `${f.subject}:${f.predicate}:${f.value}`).join("|");
    // Use a simple hash of the full text to avoid collisions from truncation
    const textHash = simpleHash(text);
    return `${isExternal ? "ext" : "int"}:${textHash}:${factSig}`;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}

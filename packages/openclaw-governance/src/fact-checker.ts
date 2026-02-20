/**
 * Fact Checker Module — Output Validation Pipeline (v0.2.0)
 *
 * Checks detected claims against in-memory Fact Registries.
 * Each fact has a subject + predicate → value mapping.
 *
 * Lookup is case-insensitive on subject.
 * Returns: verified (matches), contradicted (different value), or unverified (no fact found).
 *
 * All operations are synchronous. Index is built once at load time.
 */

import type { Claim, Fact, FactCheckResult, FactRegistryConfig } from "./types.js";

/** Normalized key for fact lookup: "subject|predicate" (lowercase) */
type FactKey = string;

function makeKey(subject: string, predicate: string): FactKey {
  return `${subject.toLowerCase()}|${predicate.toLowerCase()}`;
}

/**
 * In-memory fact registry with O(1) lookup.
 */
export class FactRegistry {
  private readonly index: Map<FactKey, Fact>;
  private readonly subjectIndex: Map<string, Fact[]>;

  constructor(configs: FactRegistryConfig[]) {
    this.index = new Map();
    this.subjectIndex = new Map();

    for (const config of configs) {
      for (const fact of config.facts) {
        const key = makeKey(fact.subject, fact.predicate);
        // Later registries override earlier ones
        this.index.set(key, fact);

        const subjKey = fact.subject.toLowerCase();
        const existing = this.subjectIndex.get(subjKey) ?? [];
        existing.push(fact);
        this.subjectIndex.set(subjKey, existing);
      }
    }
  }

  /**
   * Look up a fact by exact subject + predicate.
   * Subject matching is case-insensitive.
   */
  lookup(subject: string, predicate: string): Fact | null {
    return this.index.get(makeKey(subject, predicate)) ?? null;
  }

  /**
   * Look up all facts for a given subject.
   * Used for broader matching when a claim's predicate doesn't
   * exactly match but the subject does.
   */
  lookupBySubject(subject: string): Fact[] {
    return this.subjectIndex.get(subject.toLowerCase()) ?? [];
  }

  /** Total number of facts indexed */
  get size(): number {
    return this.index.size;
  }
}

/**
 * Mapping from claim types to their fact-predicate matching strategy.
 * Some claim types match directly (system_state → "state"),
 * others need broader matching.
 */
const CLAIM_TO_FACT_PREDICATE: Record<string, string | string[] | null> = {
  system_state: "state",
  existence: "exists",
  entity_name: null, // Match by subject, any predicate
  operational_status: ["count", "metric", "percentage"], // Try multiple predicates
  self_referential: null, // Match by "self" subject
};

/**
 * Check a single claim against the fact registry.
 * Returns the fact-check result with status.
 */
export function checkClaim(claim: Claim, registry: FactRegistry): FactCheckResult {
  // 1. Try exact predicate match (single or multiple predicates)
  const directPredicate = CLAIM_TO_FACT_PREDICATE[claim.type];

  if (directPredicate) {
    const predicates = Array.isArray(directPredicate) ? directPredicate : [directPredicate];
    for (const pred of predicates) {
      const fact = registry.lookup(claim.subject, pred);
      if (fact) {
        return {
          claim,
          fact,
          status: valuesMatchFuzzy(claim.value, fact.value) ? "verified" : "contradicted",
        };
      }
    }
  }

  // 2. Try claim's own predicate
  const factByPredicate = registry.lookup(claim.subject, claim.predicate);
  if (factByPredicate) {
    return {
      claim,
      fact: factByPredicate,
      status: valuesMatch(claim.value, factByPredicate.value) ? "verified" : "contradicted",
    };
  }

  // 3. For self_referential claims, also check "self" as subject
  if (claim.type === "self_referential") {
    const selfFact = registry.lookup("self", claim.predicate);
    if (selfFact) {
      return {
        claim,
        fact: selfFact,
        status: valuesMatch(claim.value, selfFact.value) ? "verified" : "contradicted",
      };
    }
  }

  // 4. No matching fact found
  return { claim, fact: null, status: "unverified" };
}

/**
 * Check multiple claims against the fact registry.
 */
export function checkClaims(claims: Claim[], registry: FactRegistry): FactCheckResult[] {
  return claims.map((claim) => checkClaim(claim, registry));
}

/**
 * Value comparison: case-insensitive, trims whitespace.
 * For booleans: normalizes "true"/"false"/"yes"/"no".
 */
function valuesMatch(claimValue: string, factValue: string): boolean {
  const a = normalizeValue(claimValue);
  const b = normalizeValue(factValue);
  return a === b;
}

/**
 * Fuzzy value comparison: also extracts leading numbers for numeric matching.
 * "255908 items" matches "255908". "92000" does NOT match "255908".
 */
function valuesMatchFuzzy(claimValue: string, factValue: string): boolean {
  // Try exact match first
  if (valuesMatch(claimValue, factValue)) return true;

  // Extract leading number from both and compare
  const claimNum = extractNumber(claimValue);
  const factNum = extractNumber(factValue);

  if (claimNum !== null && factNum !== null) {
    return claimNum === factNum;
  }

  return false;
}

/**
 * Extract the numeric portion from a string like "255908 items" or "90%"
 */
function extractNumber(v: string): number | null {
  const match = v.trim().match(/^[\d,]+(\.\d+)?/);
  if (!match) return null;
  const num = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

function normalizeValue(v: string): string {
  const trimmed = v.trim().toLowerCase();

  // Normalize boolean-like values
  if (trimmed === "yes" || trimmed === "1") return "true";
  if (trimmed === "no" || trimmed === "0") return "false";

  return trimmed;
}

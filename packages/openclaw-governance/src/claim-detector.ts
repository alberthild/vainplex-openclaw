/**
 * Claim Detection Module — Output Validation Pipeline (v0.2.0)
 *
 * Detects factual claims in agent output text using 5 built-in detectors:
 * - system_state: "X is running/stopped/online/offline"
 * - entity_name: "the agent/service/server named X"
 * - existence: "X exists/doesn't exist"
 * - operational_status: "X has N items / X is at N%"
 * - self_referential: "I am X / I have X / my name is X"
 *
 * All detectors are synchronous regex-based (<1ms).
 */

import type { Claim, ClaimType, BuiltinDetectorId } from "./types.js";

/** A single detector function: extracts claims from text */
type DetectorFn = (text: string) => Claim[];

/** Built-in detector registry */
const BUILTIN_DETECTORS: Record<BuiltinDetectorId, DetectorFn> = {
  system_state: detectSystemState,
  entity_name: detectEntityName,
  existence: detectExistence,
  operational_status: detectOperationalStatus,
  self_referential: detectSelfReferential,
};

// ── System State Detector ──
// Matches: "X is running", "X is stopped", "X is online", "X is offline",
// "X is active", "X is inactive", "X is enabled", "X is disabled",
// "X is up", "X is down"

const SYSTEM_STATE_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+(?:is|are)\s+(running|stopped|online|offline|active|inactive|enabled|disabled|up|down|started|paused|healthy|unhealthy)\b/gi;

function detectSystemState(text: string): Claim[] {
  const claims: Claim[] = [];
  SYSTEM_STATE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SYSTEM_STATE_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    const state = match[2]!.toLowerCase();

    // Skip common false positives
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "system_state",
      subject,
      predicate: "state",
      value: state,
      source: match[0],
      offset: match.index,
    });
  }

  return claims;
}

// ── Entity Name Detector ──
// Matches: "the agent named X", "the service called X", "the server X"

const ENTITY_NAME_PATTERN =
  /\bthe\s+(agent|service|server|container|process|pod|node|instance|database|cluster|daemon|plugin|module)\s+(?:named|called|known as|labelled|labeled)?\s*["`']?([\w][\w.:-]{0,60})["`']?\b/gi;

function detectEntityName(text: string): Claim[] {
  const claims: Claim[] = [];
  ENTITY_NAME_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ENTITY_NAME_PATTERN.exec(text)) !== null) {
    const entityType = match[1]!.toLowerCase();
    const entityName = match[2]!.trim();

    claims.push({
      type: "entity_name",
      subject: entityName,
      predicate: "entity_type",
      value: entityType,
      source: match[0],
      offset: match.index,
    });
  }

  return claims;
}

// ── Existence Detector ──
// Matches: "X exists", "X doesn't exist", "X does not exist",
// "there is a X", "there is no X"

const EXISTENCE_POSITIVE_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+(?:exists|is available|is present|is configured|is installed|is deployed|is registered)\b/gi;

const EXISTENCE_NEGATIVE_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+(?:does(?:n't| not) exist|is not available|is not present|is not configured|is not installed|is not deployed|is not registered|doesn't exist)\b/gi;

const THERE_IS_PATTERN =
  /\bthere\s+(?:is|are)\s+(no\s+)?([\w][\w.:-]{0,60})\b/gi;

function detectExistence(text: string): Claim[] {
  const claims: Claim[] = [];

  EXISTENCE_POSITIVE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXISTENCE_POSITIVE_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "existence",
      subject,
      predicate: "exists",
      value: "true",
      source: match[0],
      offset: match.index,
    });
  }

  EXISTENCE_NEGATIVE_PATTERN.lastIndex = 0;
  while ((match = EXISTENCE_NEGATIVE_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "existence",
      subject,
      predicate: "exists",
      value: "false",
      source: match[0],
      offset: match.index,
    });
  }

  THERE_IS_PATTERN.lastIndex = 0;
  while ((match = THERE_IS_PATTERN.exec(text)) !== null) {
    const negated = !!match[1];
    const subject = match[2]!.trim();
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "existence",
      subject,
      predicate: "exists",
      value: negated ? "false" : "true",
      source: match[0],
      offset: match.index,
    });
  }

  return claims;
}

// ── Operational Status Detector ──
// Matches: "X has 5 items", "X is at 80%", "X uses 4GB", "X count is 12"

const METRIC_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+(?:has|contains|uses|consumes|shows|reports)\s+(\d+[\d,.]*)\s*(items?|entries|records|connections|requests|errors|GB|MB|KB|%|nodes?|pods?|replicas?|instances?|processes?)?\b/gi;

const PERCENTAGE_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+is\s+at\s+(\d+[\d,.]*)\s*%/gi;

const COUNT_PATTERN =
  /\b([\w][\w.:-]{0,60})\s+count\s+is\s+(\d+[\d,.]*)\b/gi;

function detectOperationalStatus(text: string): Claim[] {
  const claims: Claim[] = [];

  METRIC_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = METRIC_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    const value = match[2]!;
    const unit = match[3] ?? "";
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "operational_status",
      subject,
      predicate: "metric",
      value: unit ? `${value} ${unit}` : value,
      source: match[0],
      offset: match.index,
    });
  }

  PERCENTAGE_PATTERN.lastIndex = 0;
  while ((match = PERCENTAGE_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    const value = match[2]!;
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "operational_status",
      subject,
      predicate: "percentage",
      value: `${value}%`,
      source: match[0],
      offset: match.index,
    });
  }

  COUNT_PATTERN.lastIndex = 0;
  while ((match = COUNT_PATTERN.exec(text)) !== null) {
    const subject = match[1]!.trim();
    const value = match[2]!;
    if (isCommonWord(subject)) continue;

    claims.push({
      type: "operational_status",
      subject,
      predicate: "count",
      value,
      source: match[0],
      offset: match.index,
    });
  }

  return claims;
}

// ── Self-Referential Detector ──
// Matches: "I am X", "my name is X", "I have X capabilities"

const SELF_IDENTITY_PATTERN =
  /\bI\s+am\s+([\w][\w\s.:-]{0,60}?)\s*[.,!?\n]/gi;

const MY_NAME_PATTERN =
  /\bmy\s+name\s+is\s+([\w][\w\s.:-]{0,60}?)\s*[.,!?\n]/gi;

const I_HAVE_PATTERN =
  /\bI\s+(?:have|possess|contain)\s+([\w][\w\s.:-]{0,60}?)\s*[.,!?\n]/gi;

function detectSelfReferential(text: string): Claim[] {
  const claims: Claim[] = [];
  // Append newline to ensure patterns match at end of text
  const padded = text + "\n";

  SELF_IDENTITY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELF_IDENTITY_PATTERN.exec(padded)) !== null) {
    claims.push({
      type: "self_referential",
      subject: "self",
      predicate: "identity",
      value: match[1]!.trim(),
      source: match[0].trim(),
      offset: match.index,
    });
  }

  MY_NAME_PATTERN.lastIndex = 0;
  while ((match = MY_NAME_PATTERN.exec(padded)) !== null) {
    claims.push({
      type: "self_referential",
      subject: "self",
      predicate: "name",
      value: match[1]!.trim(),
      source: match[0].trim(),
      offset: match.index,
    });
  }

  I_HAVE_PATTERN.lastIndex = 0;
  while ((match = I_HAVE_PATTERN.exec(padded)) !== null) {
    claims.push({
      type: "self_referential",
      subject: "self",
      predicate: "capability",
      value: match[1]!.trim(),
      source: match[0].trim(),
      offset: match.index,
    });
  }

  return claims;
}

// ── Common Word Filter ──

const COMMON_WORDS = new Set([
  "it", "this", "that", "the", "a", "an", "they", "we", "he", "she",
  "what", "which", "who", "how", "there", "here", "then", "now",
  "everything", "nothing", "something", "anything",
  "one", "two", "three", "all", "some", "none",
  "yes", "no", "not", "also", "very", "just", "still",
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}

// ── Public API ──

/**
 * Detect all claims in a text using all enabled built-in detectors.
 * @param text - The agent output text to scan
 * @param enabledDetectors - Optional list of detector IDs to use. Defaults to all.
 * @returns Array of detected claims, deduplicated by offset+type.
 */
export function detectClaims(
  text: string,
  enabledDetectors?: BuiltinDetectorId[],
): Claim[] {
  if (!text || text.length === 0) return [];

  const detectorIds = enabledDetectors ?? (Object.keys(BUILTIN_DETECTORS) as BuiltinDetectorId[]);
  const allClaims: Claim[] = [];

  for (const id of detectorIds) {
    const detector = BUILTIN_DETECTORS[id];
    if (detector) {
      const claims = detector(text);
      allClaims.push(...claims);
    }
  }

  // Deduplicate by offset + type
  return deduplicateClaims(allClaims);
}

/** Get list of available built-in detector IDs */
export function getBuiltinDetectorIds(): BuiltinDetectorId[] {
  return Object.keys(BUILTIN_DETECTORS) as BuiltinDetectorId[];
}

function deduplicateClaims(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  const result: Claim[] = [];

  for (const claim of claims) {
    const key = `${claim.type}:${claim.offset}:${claim.subject}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(claim);
    }
  }

  return result;
}

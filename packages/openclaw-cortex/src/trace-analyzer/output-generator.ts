// ============================================================
// Trace Analyzer — Output Generator (Stage 3)
// ============================================================
//
// Groups classified findings by actionType and generates
// SOUL.md rules, governance policies, and Cortex patterns.
// Implements R-019, R-021, R-022, R-023.
// ============================================================

import { randomUUID } from "node:crypto";
import type { Finding, SignalId } from "./signals/types.js";

/** A generated output: rule, policy, or pattern. */
export type GeneratedOutput = {
  /** Output ID (UUIDv4). */
  id: string;
  /** Type of output. */
  type: "soul_rule" | "governance_policy" | "cortex_pattern";
  /** The generated content. */
  content: string;
  /** Finding IDs that produced this output. */
  sourceFindings: string[];
  /** Number of observations across findings. */
  observationCount: number;
  /** Confidence (average of source finding confidences). */
  confidence: number;
};

// ---- Helpers ----

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Group findings by a similarity key derived from their actionText.
 * Simple approach: normalize whitespace and lowercase first 80 chars.
 */
function groupByActionText(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();

  for (const f of findings) {
    const key = (f.classification?.actionText ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(f);
  }

  return [...groups.values()];
}

// ---- SOUL.md Rule Generation (R-021) ----

/**
 * Format: "NIEMALS X — stattdessen Y. [Grund: Z, {N}× beobachtet in Traces, Findings: abc, def]"
 */
function formatSoulRule(actionText: string, observationCount: number, findingIds: string[]): string {
  const idRef = findingIds.slice(0, 3).map(id => id.slice(0, 8)).join(", ");
  return `${actionText} [${observationCount}× beobachtet in Traces, Findings: ${idRef}]`;
}

function generateSoulRules(findings: Finding[]): GeneratedOutput[] {
  const ruleFindings = findings.filter(
    f => f.classification?.actionType === "soul_rule",
  );
  if (ruleFindings.length === 0) return [];

  const grouped = groupByActionText(ruleFindings);

  return grouped.map(group => {
    const primary = group[0].classification!;
    const count = group.length;
    const findingIds = group.map(f => f.id);
    const ruleText = formatSoulRule(primary.actionText, count, findingIds);

    return {
      id: randomUUID(),
      type: "soul_rule" as const,
      content: ruleText,
      sourceFindings: findingIds,
      observationCount: count,
      confidence: average(group.map(f => f.classification!.confidence)),
    };
  });
}

// ---- Governance Policy Generation (R-022) ----

function inferHooksFromSignal(signal: SignalId): string[] {
  switch (signal) {
    case "SIG-DOOM-LOOP":
    case "SIG-TOOL-FAIL":
      return ["before_tool_call"];
    case "SIG-HALLUCINATION":
    case "SIG-UNVERIFIED-CLAIM":
      return ["message_sending"];
    default:
      return ["message_sent"];
  }
}

function generateGovernancePolicies(findings: Finding[]): GeneratedOutput[] {
  const policyFindings = findings.filter(
    f => f.classification?.actionType === "governance_policy",
  );

  return policyFindings.map(f => {
    const classification = f.classification!;
    const policy = {
      id: `trace-gen-${f.signal.signal.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${f.id.slice(0, 8)}`,
      name: `Auto: ${f.signal.summary.slice(0, 60)}`,
      version: "1.0.0",
      description: `Auto-generated from trace analysis finding ${f.id}. Root cause: ${classification.rootCause}`,
      scope: { hooks: inferHooksFromSignal(f.signal.signal) },
      rules: [{
        id: `rule-${f.id.slice(0, 8)}`,
        description: classification.actionText,
        conditions: { signal: f.signal.signal, severity: f.signal.severity },
        effect: {
          action: "audit" as const,
          reason: classification.actionText,
        },
      }],
    };

    return {
      id: randomUUID(),
      type: "governance_policy" as const,
      content: JSON.stringify(policy, null, 2),
      sourceFindings: [f.id],
      observationCount: 1,
      confidence: classification.confidence,
    };
  });
}

// ---- Cortex Pattern Generation (R-023) ----

function generateCortexPatterns(findings: Finding[]): GeneratedOutput[] {
  const patternFindings = findings.filter(
    f => f.classification?.actionType === "cortex_pattern",
  );

  return patternFindings.map(f => ({
    id: randomUUID(),
    type: "cortex_pattern" as const,
    content: f.classification!.actionText,
    sourceFindings: [f.id],
    observationCount: 1,
    confidence: f.classification!.confidence,
  }));
}

// ---- Public API ----

/**
 * Generate outputs from classified findings (Stage 3).
 *
 * Groups findings by classification.actionType and produces:
 * - SOUL.md rules (soul_rule) — R-021
 * - Governance policies (governance_policy) — R-022
 * - Cortex patterns (cortex_pattern) — R-023
 * - manual_review findings produce no output (appear in report only)
 *
 * Findings without classification are skipped.
 */
export function generateOutputs(findings: Finding[]): GeneratedOutput[] {
  const classified = findings.filter(f => f.classification !== null);
  if (classified.length === 0) return [];

  return [
    ...generateSoulRules(classified),
    ...generateGovernancePolicies(classified),
    ...generateCortexPatterns(classified),
  ];
}

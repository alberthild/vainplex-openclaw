import type {
  AgentCondition,
  CompositeCondition,
  Condition,
  ConditionDeps,
  ConditionEvaluatorMap,
  EvaluationContext,
  FrequencyCondition,
  NegationCondition,
  RiskCondition,
  RiskLevel,
  TrustTier,
} from "../types.js";
import { globToRegex, tierOrdinal } from "../util.js";

// ── Agent Condition ──

function matchAgentId(
  pattern: string | string[],
  agentId: string,
): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((p) => {
    if (p.includes("*") || p.includes("?")) {
      return globToRegex(p).test(agentId);
    }
    return p === agentId;
  });
}

function matchTrustTier(
  expected: TrustTier | TrustTier[],
  actual: TrustTier,
): boolean {
  const tiers = Array.isArray(expected) ? expected : [expected];
  return tiers.includes(actual);
}

export function evaluateAgentCondition(
  condition: Condition,
  ctx: EvaluationContext,
  _deps: ConditionDeps,
): boolean {
  const c = condition as AgentCondition;

  if (c.id !== undefined && !matchAgentId(c.id, ctx.agentId)) {
    return false;
  }

  if (c.trustTier !== undefined && !matchTrustTier(c.trustTier, ctx.trust.tier)) {
    return false;
  }

  if (c.minScore !== undefined && ctx.trust.score < c.minScore) {
    return false;
  }

  if (c.maxScore !== undefined && ctx.trust.score > c.maxScore) {
    return false;
  }

  return true;
}

// ── Risk Condition ──

const RISK_ORDINAL: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function evaluateRiskCondition(
  condition: Condition,
  _ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as RiskCondition;
  const currentOrd = RISK_ORDINAL[deps.risk.level];

  if (c.minRisk !== undefined) {
    const minOrd = RISK_ORDINAL[c.minRisk];
    if (currentOrd < minOrd) return false;
  }

  if (c.maxRisk !== undefined) {
    const maxOrd = RISK_ORDINAL[c.maxRisk];
    if (currentOrd > maxOrd) return false;
  }

  return true;
}

// ── Frequency Condition ──

export function evaluateFrequencyCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as FrequencyCondition;
  const scope = c.scope ?? "agent";
  const count = deps.frequencyTracker.count(
    c.windowSeconds,
    scope,
    ctx.agentId,
    ctx.sessionKey,
  );
  return count >= c.maxCount;
}

// ── Composite Condition (any = OR) ──

let _evaluators: ConditionEvaluatorMap | undefined;

export function setEvaluatorMap(evaluators: ConditionEvaluatorMap): void {
  _evaluators = evaluators;
}

export function evaluateCompositeCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as CompositeCondition;
  if (!_evaluators) return false;
  return c.conditions.some((sub) => {
    const evaluator = _evaluators?.[sub.type];
    if (!evaluator) return false;
    return evaluator(sub, ctx, deps);
  });
}

// ── Negation Condition ──

export function evaluateNegationCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as NegationCondition;
  if (!_evaluators) return true;
  const evaluator = _evaluators[c.condition.type];
  if (!evaluator) return true;
  return !evaluator(c.condition, ctx, deps);
}

// ── Trust tier comparison helpers (exported for rules) ──

export function isTierAtLeast(tier: TrustTier, min: TrustTier): boolean {
  return tierOrdinal(tier) >= tierOrdinal(min);
}

export function isTierAtMost(tier: TrustTier, max: TrustTier): boolean {
  return tierOrdinal(tier) <= tierOrdinal(max);
}

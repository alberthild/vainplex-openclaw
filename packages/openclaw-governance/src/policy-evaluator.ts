import type {
  ConditionEvaluatorMap,
  ConditionDeps,
  EvaluationContext,
  MatchedPolicy,
  Policy,
  RiskAssessment,
} from "./types.js";
import { evaluateConditions } from "./conditions/index.js";
import { isTierAtLeast, isTierAtMost } from "./conditions/simple.js";

type EvalResult = {
  action: "allow" | "deny";
  reason: string;
  matches: MatchedPolicy[];
};

function matchesScope(policy: Policy, ctx: EvaluationContext): boolean {
  if (policy.scope.excludeAgents?.includes(ctx.agentId)) return false;
  if (policy.scope.channels && policy.scope.channels.length > 0) {
    if (!ctx.channel || !policy.scope.channels.includes(ctx.channel)) {
      return false;
    }
  }
  return true;
}

function policySpecificity(policy: Policy): number {
  let score = 0;
  if (policy.scope.agents && policy.scope.agents.length > 0) score += 10;
  if (policy.scope.channels && policy.scope.channels.length > 0) score += 5;
  if (policy.scope.hooks && policy.scope.hooks.length > 0) score += 3;
  return score;
}

function sortPolicies(policies: Policy[]): Policy[] {
  return [...policies].sort((a, b) => {
    const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priDiff !== 0) return priDiff;
    return policySpecificity(b) - policySpecificity(a);
  });
}

function aggregateMatches(matches: MatchedPolicy[]): EvalResult {
  let hasDeny = false;
  let denyReason = "";
  let hasAudit = false;

  for (const m of matches) {
    if (m.effect.action === "deny") {
      hasDeny = true;
      if (!denyReason) denyReason = "reason" in m.effect ? m.effect.reason : "";
    } else if (m.effect.action === "audit") {
      hasAudit = true;
    }
  }

  if (hasDeny) {
    return { action: "deny", reason: denyReason || "Denied by governance policy", matches };
  }
  if (hasAudit) {
    return { action: "allow", reason: "Allowed with audit logging", matches };
  }
  return {
    action: "allow",
    reason: matches.length > 0 ? "Allowed by governance policy" : "No matching policies",
    matches,
  };
}

export class PolicyEvaluator {
  private readonly evaluators: ConditionEvaluatorMap;

  constructor(evaluators: ConditionEvaluatorMap) {
    this.evaluators = evaluators;
  }

  evaluate(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
  ): EvalResult {
    const stubDeps: ConditionDeps = {
      regexCache: new Map(),
      timeWindows: {},
      risk,
      frequencyTracker: { record: () => {}, count: () => 0, clear: () => {} },
    };
    return this.evaluateInternal(ctx, policies, risk, stubDeps);
  }

  evaluateWithDeps(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
    deps: ConditionDeps,
  ): EvalResult {
    return this.evaluateInternal(ctx, policies, risk, deps);
  }

  private evaluateInternal(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
    deps: ConditionDeps,
  ): EvalResult {
    const applicable = sortPolicies(
      policies.filter((p) => matchesScope(p, ctx)),
    );

    const matches: MatchedPolicy[] = [];
    for (const policy of applicable) {
      const match = this.matchPolicy(policy, ctx, { ...deps, risk });
      if (match) matches.push(match);
    }

    return aggregateMatches(matches);
  }

  private matchPolicy(
    policy: Policy,
    ctx: EvaluationContext,
    deps: ConditionDeps,
  ): MatchedPolicy | null {
    for (const rule of policy.rules) {
      if (rule.minTrust && !isTierAtLeast(ctx.trust.tier, rule.minTrust)) {
        continue;
      }
      if (rule.maxTrust && !isTierAtMost(ctx.trust.tier, rule.maxTrust)) {
        continue;
      }
      if (evaluateConditions(rule.conditions, ctx, deps, this.evaluators)) {
        return { policyId: policy.id, ruleId: rule.id, effect: rule.effect };
      }
    }
    return null;
  }
}

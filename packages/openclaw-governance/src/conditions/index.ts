import type {
  Condition,
  ConditionDeps,
  ConditionEvaluatorFn,
  ConditionEvaluatorMap,
  EvaluationContext,
} from "../types.js";
import { evaluateToolCondition } from "./tool.js";
import { evaluateTimeCondition } from "./time.js";
import { evaluateContextCondition } from "./context.js";
import {
  evaluateAgentCondition,
  evaluateCompositeCondition,
  evaluateFrequencyCondition,
  evaluateNegationCondition,
  evaluateRiskCondition,
  setEvaluatorMap,
} from "./simple.js";

export function createConditionEvaluators(): ConditionEvaluatorMap {
  const map: ConditionEvaluatorMap = {
    tool: evaluateToolCondition as ConditionEvaluatorFn,
    time: evaluateTimeCondition as ConditionEvaluatorFn,
    context: evaluateContextCondition as ConditionEvaluatorFn,
    agent: evaluateAgentCondition as ConditionEvaluatorFn,
    risk: evaluateRiskCondition as ConditionEvaluatorFn,
    frequency: evaluateFrequencyCondition as ConditionEvaluatorFn,
    any: evaluateCompositeCondition as ConditionEvaluatorFn,
    not: evaluateNegationCondition as ConditionEvaluatorFn,
  };
  // Wire up the evaluator map for recursive conditions (any, not)
  setEvaluatorMap(map);
  return map;
}

export function evaluateConditions(
  conditions: Condition[],
  ctx: EvaluationContext,
  deps: ConditionDeps,
  evaluators: ConditionEvaluatorMap,
): boolean {
  return conditions.every((cond) => {
    const evaluator = evaluators[cond.type];
    if (!evaluator) return false;
    return evaluator(cond, ctx, deps);
  });
}

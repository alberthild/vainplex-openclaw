import type {
  Condition,
  ConditionDeps,
  EvaluationContext,
  TimeCondition,
} from "../types.js";
import { isInTimeRange, parseTimeToMinutes } from "../util.js";

function evaluateNamedWindow(
  c: TimeCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const win = deps.timeWindows[c.window!];
  if (!win) return false;

  const current = ctx.time.hour * 60 + ctx.time.minute;
  const start = parseTimeToMinutes(win.start);
  const end = parseTimeToMinutes(win.end);
  if (start < 0 || end < 0) return false;
  if (!isInTimeRange(current, start, end)) return false;
  if (win.days && win.days.length > 0 && !win.days.includes(ctx.time.dayOfWeek)) {
    return false;
  }
  return true;
}

function evaluateInlineRange(
  c: TimeCondition,
  ctx: EvaluationContext,
): boolean {
  const current = ctx.time.hour * 60 + ctx.time.minute;

  if (c.after !== undefined && c.before !== undefined) {
    const a = parseTimeToMinutes(c.after);
    const b = parseTimeToMinutes(c.before);
    if (a < 0 || b < 0) return false;
    return isInTimeRange(current, a, b);
  }
  if (c.after !== undefined) {
    const a = parseTimeToMinutes(c.after);
    return a >= 0 && current >= a;
  }
  if (c.before !== undefined) {
    const b = parseTimeToMinutes(c.before);
    return b >= 0 && current < b;
  }
  return true;
}

export function evaluateTimeCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as TimeCondition;

  if (c.window) return evaluateNamedWindow(c, ctx, deps);
  if (!evaluateInlineRange(c, ctx)) return false;
  if (c.days && c.days.length > 0 && !c.days.includes(ctx.time.dayOfWeek)) {
    return false;
  }
  return true;
}

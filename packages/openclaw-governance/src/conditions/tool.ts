import type {
  Condition,
  ConditionDeps,
  EvaluationContext,
  ParamMatcher,
  ToolCondition,
} from "../types.js";
import { globToRegex } from "../util.js";

function matchToolName(
  pattern: string | string[],
  toolName: string | undefined,
): boolean {
  if (!toolName) return false;
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((p) => {
    if (p.includes("*") || p.includes("?")) {
      return globToRegex(p).test(toolName);
    }
    return p === toolName;
  });
}

function matchParam(
  matcher: ParamMatcher,
  value: unknown,
  regexCache: Map<string, RegExp>,
): boolean {
  if ("equals" in matcher) {
    return value === matcher.equals;
  }
  if ("contains" in matcher) {
    return typeof value === "string" && value.includes(matcher.contains);
  }
  if ("matches" in matcher) {
    if (typeof value !== "string") return false;
    const cached = regexCache.get(matcher.matches);
    if (cached) return cached.test(value);
    try {
      const re = new RegExp(matcher.matches);
      return re.test(value);
    } catch {
      return false;
    }
  }
  if ("startsWith" in matcher) {
    return typeof value === "string" && value.startsWith(matcher.startsWith);
  }
  if ("in" in matcher) {
    return matcher.in.includes(value as string | number);
  }
  return false;
}

function matchParams(
  params: Record<string, ParamMatcher>,
  toolParams: Record<string, unknown> | undefined,
  regexCache: Map<string, RegExp>,
): boolean {
  if (!toolParams) return false;
  return Object.entries(params).every(([key, matcher]) =>
    matchParam(matcher, toolParams[key], regexCache),
  );
}

export function evaluateToolCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as ToolCondition;

  if (c.name !== undefined && !matchToolName(c.name, ctx.toolName)) {
    return false;
  }

  if (c.params && !matchParams(c.params, ctx.toolParams, deps.regexCache)) {
    return false;
  }

  return true;
}

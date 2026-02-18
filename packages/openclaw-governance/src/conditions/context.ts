import type {
  Condition,
  ConditionDeps,
  ContextCondition,
  EvaluationContext,
} from "../types.js";
import { globToRegex } from "../util.js";

function matchesAny(
  patterns: string | string[],
  texts: string[],
  regexCache: Map<string, RegExp>,
): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((pattern) => {
    const re = regexCache.get(pattern);
    if (re) return texts.some((t) => re.test(t));
    try {
      const compiled = new RegExp(pattern);
      return texts.some((t) => compiled.test(t));
    } catch {
      return texts.some((t) => t.includes(pattern));
    }
  });
}

function checkConversation(
  c: ContextCondition, ctx: EvaluationContext, deps: ConditionDeps,
): boolean {
  if (c.conversationContains === undefined) return true;
  const convo = ctx.conversationContext ?? [];
  if (convo.length === 0) return false;
  return matchesAny(c.conversationContains, convo, deps.regexCache);
}

function checkMessage(
  c: ContextCondition, ctx: EvaluationContext, deps: ConditionDeps,
): boolean {
  if (c.messageContains === undefined) return true;
  if (!ctx.messageContent) return false;
  return matchesAny(c.messageContains, [ctx.messageContent], deps.regexCache);
}

function checkMetadata(c: ContextCondition, ctx: EvaluationContext): boolean {
  if (c.hasMetadata === undefined) return true;
  const meta = ctx.metadata ?? {};
  const keys = Array.isArray(c.hasMetadata) ? c.hasMetadata : [c.hasMetadata];
  return keys.every((k) => k in meta);
}

function checkChannel(c: ContextCondition, ctx: EvaluationContext): boolean {
  if (c.channel === undefined) return true;
  const channels = Array.isArray(c.channel) ? c.channel : [c.channel];
  return !!ctx.channel && channels.includes(ctx.channel);
}

function checkSessionKey(c: ContextCondition, ctx: EvaluationContext): boolean {
  if (c.sessionKey === undefined) return true;
  if (!ctx.sessionKey) return false;
  return globToRegex(c.sessionKey).test(ctx.sessionKey);
}

export function evaluateContextCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as ContextCondition;
  return (
    checkConversation(c, ctx, deps) &&
    checkMessage(c, ctx, deps) &&
    checkMetadata(c, ctx) &&
    checkChannel(c, ctx) &&
    checkSessionKey(c, ctx)
  );
}

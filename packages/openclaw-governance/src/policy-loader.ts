import type {
  BuiltinPoliciesConfig,
  Condition,
  ParamMatcher,
  PluginLogger,
  Policy,
  PolicyHookName,
  PolicyIndex,
} from "./types.js";
import { getBuiltinPolicies } from "./builtin-policies.js";

const NESTED_QUANTIFIER_RE = /(\+|\*|\{)\)(\+|\*|\{)/;
const MAX_PATTERN_LENGTH = 500;

export function validateRegex(
  pattern: string,
): { valid: boolean; error?: string } {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { valid: false, error: `Pattern exceeds ${MAX_PATTERN_LENGTH} chars` };
  }
  if (NESTED_QUANTIFIER_RE.test(pattern)) {
    return { valid: false, error: "Nested quantifiers detected (ReDoS risk)" };
  }
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, error: msg };
  }
}

function collectRegexPatterns(conditions: Condition[]): string[] {
  const patterns: string[] = [];
  for (const cond of conditions) {
    if (cond.type === "tool" && cond.params) {
      for (const matcher of Object.values(cond.params)) {
        if (isMatchesMatcher(matcher)) {
          patterns.push(matcher.matches);
        }
      }
    }
    if (cond.type === "context") {
      const conv = cond.conversationContains;
      if (conv) {
        const arr = Array.isArray(conv) ? conv : [conv];
        patterns.push(...arr);
      }
      const msg = cond.messageContains;
      if (msg) {
        const arr = Array.isArray(msg) ? msg : [msg];
        patterns.push(...arr);
      }
    }
    if (cond.type === "any") {
      patterns.push(...collectRegexPatterns(cond.conditions));
    }
    if (cond.type === "not") {
      patterns.push(...collectRegexPatterns([cond.condition]));
    }
  }
  return patterns;
}

function isMatchesMatcher(
  m: ParamMatcher,
): m is { matches: string } {
  return "matches" in m;
}

export function loadPolicies(
  policies: Policy[],
  builtinConfig: BuiltinPoliciesConfig,
  logger: PluginLogger,
): Policy[] {
  const builtins = getBuiltinPolicies(builtinConfig);
  const all = [...builtins, ...policies];

  return all.filter((p) => {
    if (p.enabled === false) {
      logger.info(`[governance] Policy "${p.id}" disabled`);
      return false;
    }
    return true;
  });
}

export function buildPolicyIndex(
  policies: Policy[],
): PolicyIndex {
  const byHook = new Map<PolicyHookName, Policy[]>();
  const byAgent = new Map<string, Policy[]>();
  const regexCache = new Map<string, RegExp>();

  const hooks: PolicyHookName[] = [
    "before_tool_call",
    "message_sending",
    "before_agent_start",
    "session_start",
  ];

  for (const policy of policies) {
    // Index by hook
    const policyHooks = policy.scope.hooks ?? hooks;
    for (const hook of policyHooks) {
      const list = byHook.get(hook) ?? [];
      list.push(policy);
      byHook.set(hook, list);
    }

    // Index by agent
    const agents = policy.scope.agents ?? ["*"];
    for (const agent of agents) {
      const list = byAgent.get(agent) ?? [];
      list.push(policy);
      byAgent.set(agent, list);
    }

    // Collect and compile regex patterns
    for (const rule of policy.rules) {
      const patterns = collectRegexPatterns(rule.conditions);
      for (const pattern of patterns) {
        if (regexCache.has(pattern)) continue;
        const validation = validateRegex(pattern);
        if (validation.valid) {
          regexCache.set(pattern, new RegExp(pattern));
        }
      }
    }
  }

  return { byHook, byAgent, regexCache };
}

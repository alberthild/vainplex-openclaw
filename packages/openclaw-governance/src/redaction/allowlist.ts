/**
 * Redaction Allowlist Evaluator (RFC-007 §6)
 *
 * Evaluates whether a specific redaction should be bypassed based on
 * channel, tool, or agent allowlists.
 *
 * Security invariant: Credentials are NEVER allowlisted, regardless
 * of configuration. This is enforced at the code level and cannot be
 * overridden.
 */

import type { RedactionAllowlist, RedactionCategory } from "../types.js";

export type AllowlistContext = {
  channel?: string;
  toolName?: string;
  agentId?: string;
};

export type AllowlistDecision = {
  allowed: boolean;
  reason: string;
};

/**
 * Evaluate whether a redaction category should be bypassed
 * for the given context.
 *
 * @param category - The redaction category to check
 * @param context - The current execution context
 * @param allowlist - The configured allowlist
 * @returns Decision with reason
 */
export function evaluateAllowlist(
  category: RedactionCategory,
  context: AllowlistContext,
  allowlist: RedactionAllowlist,
): AllowlistDecision {
  // SECURITY INVARIANT: Credentials are NEVER allowlisted
  if (category === "credential") {
    return { allowed: false, reason: "Credentials are never allowlisted" };
  }

  // Check tool exemption (Layer 1 only — caller must enforce scope)
  if (context.toolName && allowlist.exemptTools.includes(context.toolName)) {
    return {
      allowed: true,
      reason: `Tool "${context.toolName}" is exempt from redaction`,
    };
  }

  // Check agent exemption (Layer 2 only — caller must enforce scope)
  if (context.agentId && allowlist.exemptAgents.includes(context.agentId)) {
    return {
      allowed: true,
      reason: `Agent "${context.agentId}" is exempt from outbound redaction`,
    };
  }

  // Check channel-specific PII allowlist
  if (category === "pii" && context.channel) {
    if (allowlist.piiAllowedChannels.includes(context.channel)) {
      return {
        allowed: true,
        reason: `PII allowed on channel "${context.channel}"`,
      };
    }
  }

  // Check channel-specific financial data allowlist
  if (category === "financial" && context.channel) {
    if (allowlist.financialAllowedChannels.includes(context.channel)) {
      return {
        allowed: true,
        reason: `Financial data allowed on channel "${context.channel}"`,
      };
    }
  }

  return { allowed: false, reason: "No allowlist match" };
}

/**
 * Check if a tool is exempt from Layer 1 redaction.
 * Credentials in exempt tool output are STILL redacted.
 */
export function isToolExempt(
  toolName: string,
  allowlist: RedactionAllowlist,
): boolean {
  return allowlist.exemptTools.includes(toolName);
}

/**
 * Check if an agent is exempt from Layer 2 outbound redaction.
 * Credentials are STILL redacted for exempt agents.
 */
export function isAgentExempt(
  agentId: string,
  allowlist: RedactionAllowlist,
): boolean {
  return allowlist.exemptAgents.includes(agentId);
}

/**
 * Filter categories that should be redacted for the given context.
 * Removes categories that are allowlisted, but ALWAYS keeps credentials.
 */
export function getRedactableCategories(
  categories: RedactionCategory[],
  context: AllowlistContext,
  allowlist: RedactionAllowlist,
): RedactionCategory[] {
  return categories.filter((cat) => {
    const decision = evaluateAllowlist(cat, context, allowlist);
    return !decision.allowed;
  });
}

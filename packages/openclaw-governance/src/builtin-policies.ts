import type { BuiltinPoliciesConfig, Policy } from "./types.js";

function resolveNightMode(
  config: BuiltinPoliciesConfig["nightMode"],
): Policy | null {
  if (!config) return null;

  const after = typeof config === "object" ? config.after ?? "23:00" : "23:00";
  const before = typeof config === "object" ? config.before ?? "08:00" : "08:00";

  return {
    id: "builtin-night-mode",
    name: "Night Mode",
    version: "1.0.0",
    description: `Restricts non-critical operations between ${after} and ${before}`,
    scope: { hooks: ["before_tool_call", "message_sending"] },
    priority: 100,
    controls: ["A.7.1", "A.6.2"],
    rules: [
      {
        id: "allow-critical-at-night",
        description: "Always allow read-only tools at night",
        conditions: [
          { type: "time", after, before },
          { type: "tool", name: ["read", "memory_search", "memory_get", "web_search"] },
        ],
        effect: { action: "allow" },
      },
      {
        id: "deny-non-critical-at-night",
        description: "Deny all other tools at night",
        conditions: [
          { type: "time", after, before },
          {
            type: "not",
            condition: {
              type: "tool",
              name: ["read", "memory_search", "memory_get", "web_search"],
            },
          },
        ],
        effect: {
          action: "deny",
          reason: `Night mode active (${after}-${before}). Only critical operations allowed.`,
        },
      },
    ],
  };
}

function resolveCredentialGuard(
  enabled: boolean | undefined,
): Policy | null {
  if (!enabled) return null;

  return {
    id: "builtin-credential-guard",
    name: "Credential Guard",
    version: "1.0.0",
    description: "Prevents access to credential files and secrets",
    scope: { hooks: ["before_tool_call"] },
    priority: 200,
    controls: ["A.8.11", "A.8.4", "A.5.33"],
    rules: [
      {
        id: "block-credential-read",
        conditions: [
          { type: "tool", name: ["read", "exec", "write", "edit"] },
          {
            type: "any",
            conditions: [
              { type: "tool", params: { file_path: { matches: "\\.(env|pem|key)$" } } },
              { type: "tool", params: { path: { matches: "\\.(env|pem|key)$" } } },
              { type: "tool", params: { command: { matches: "(cat|less|head|tail).*\\.(env|pem|key)" } } },
              { type: "tool", params: { file_path: { contains: "credentials" } } },
              { type: "tool", params: { path: { contains: "credentials" } } },
              { type: "tool", params: { file_path: { contains: "secrets" } } },
              { type: "tool", params: { path: { contains: "secrets" } } },
            ],
          },
        ],
        effect: {
          action: "deny",
          reason: "Credential Guard: Access to credential files is restricted",
        },
      },
    ],
  };
}

function resolveProductionSafeguard(
  enabled: boolean | undefined,
): Policy | null {
  if (!enabled) return null;

  return {
    id: "builtin-production-safeguard",
    name: "Production Safeguard",
    version: "1.0.0",
    description: "Restricts production-impacting operations",
    scope: { hooks: ["before_tool_call"] },
    priority: 150,
    controls: ["A.8.31", "A.8.32", "A.8.9"],
    rules: [
      {
        id: "block-production-ops",
        conditions: [
          {
            type: "any",
            conditions: [
              { type: "tool", name: "exec", params: { command: { matches: "(docker push|docker-compose.*prod|deploy|systemctl.*(restart|stop))" } } },
              { type: "tool", name: "exec", params: { command: { matches: "git push.*(main|master|prod)" } } },
              { type: "tool", name: "gateway" },
            ],
          },
        ],
        effect: {
          action: "deny",
          reason: "Production Safeguard: This operation requires explicit approval",
        },
      },
    ],
  };
}

function resolveRateLimiter(
  config: BuiltinPoliciesConfig["rateLimiter"],
): Policy | null {
  if (!config) return null;

  const maxPerMinute =
    typeof config === "object" ? config.maxPerMinute ?? 15 : 15;

  return {
    id: "builtin-rate-limiter",
    name: "Rate Limiter",
    version: "1.0.0",
    description: `Limits agents to ${maxPerMinute} tool calls per minute`,
    scope: { hooks: ["before_tool_call"] },
    priority: 50,
    controls: ["A.8.6"],
    rules: [
      {
        id: "rate-limit-exceeded",
        conditions: [
          { type: "frequency", maxCount: maxPerMinute, windowSeconds: 60, scope: "agent" },
        ],
        effect: {
          action: "deny",
          reason: `Rate limit exceeded (${maxPerMinute}/min)`,
        },
      },
    ],
  };
}

export function getBuiltinPolicies(
  config: BuiltinPoliciesConfig,
): Policy[] {
  const policies: Policy[] = [];

  const nightMode = resolveNightMode(config.nightMode);
  if (nightMode) policies.push(nightMode);

  const credGuard = resolveCredentialGuard(config.credentialGuard);
  if (credGuard) policies.push(credGuard);

  const prodSafe = resolveProductionSafeguard(config.productionSafeguard);
  if (prodSafe) policies.push(prodSafe);

  const rateLimiter = resolveRateLimiter(config.rateLimiter);
  if (rateLimiter) policies.push(rateLimiter);

  return policies;
}

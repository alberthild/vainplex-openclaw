> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — a collection of five production plugins that turn OpenClaw into a self-governing, learning system. See the monorepo for the full picture.

---

# @vainplex/openclaw-governance

**Your AI agents are powerful. That's the problem.**

An agent that can `exec("rm -rf /")` at 3 AM because a prompt injection told it to? That's not a feature, that's a liability. This plugin adds contextual, learning governance to OpenClaw — so your agents stay powerful but accountable.

---

## Why This Exists

Every other guardrail tool works like a firewall: static rules, single-agent, no memory. *"Can agent X use tool Y? Yes/No."*

That's not governance. That's a whitelist.

Real governance asks: **"Should agent X run `docker rm` at 3 AM on production, given it failed twice this week and its trust score dropped to 25?"**

This plugin answers that question in <5ms.

## What It Does

```
Agent calls exec("git push origin main")
  → Governance evaluates: tool + time + trust + frequency + context
  → Verdict: DENY — "Forge cannot push to main (trust: restricted, score: 32)"
  → Audit record written (JSONL, compliance-mapped)
  → Agent gets a clear rejection reason
```

**What this plugin adds to OpenClaw:**

- **Contextual Policies** — Not just "which tool" but "which tool, when, by whom, in what conversation, at what risk level"
- **Learning Trust** — Agents earn autonomy. Score 0-100, five tiers, decay on inactivity. A new sub-agent starts untrusted and works its way up.
- **Cross-Agent Governance** — Parent policies cascade to sub-agents. A "no deploy" rule on main also blocks forge. Trust is capped: child can never exceed parent.
- **Compliance Audit Trail** — Append-only JSONL with compliance control mapping (ISO 27001, SOC 2, NIS2, GDPR). Every decision recorded, redacted, rotatable.

## Quick Start

### Install

```bash
npm install @vainplex/openclaw-governance
```

### Minimal Config

Add to `openclaw.json` → `plugins`:

```json
{
  "openclaw-governance": {
    "enabled": true,
    "timezone": "Europe/Berlin",
    "builtinPolicies": {
      "nightMode": true,
      "credentialGuard": true
    }
  }
}
```

That's it. Night mode blocks risky operations 23:00–08:00. Credential guard blocks access to secrets, `.env` files, and password stores.

### Realistic Config

```json
{
  "openclaw-governance": {
    "enabled": true,
    "timezone": "Europe/Berlin",
    "failMode": "open",
    "trust": {
      "defaults": {
        "main": 60,
        "forge": 45,
        "cerberus": 50,
        "*": 10
      }
    },
    "builtinPolicies": {
      "nightMode": { "after": "23:00", "before": "08:00" },
      "credentialGuard": true,
      "productionSafeguard": true,
      "rateLimiter": { "maxPerMinute": 15 }
    },
    "policies": [
      {
        "id": "forge-no-deploy",
        "name": "Forge Cannot Deploy",
        "version": "1.0.0",
        "scope": { "agents": ["forge"] },
        "rules": [{
          "id": "block-push",
          "conditions": [
            { "type": "tool", "name": "exec", "params": { "command": { "matches": "git push.*(main|master)" } } }
          ],
          "effect": { "action": "deny", "reason": "Forge cannot push to main — submit a PR instead" }
        }]
      }
    ],
    "audit": {
      "retentionDays": 90,
      "level": "standard"
    }
  }
}
```

## Policy Examples

### "No dangerous commands at night"

```json
{
  "id": "night-guard",
  "name": "Night Guard",
  "scope": {},
  "rules": [{
    "id": "deny-exec-at-night",
    "conditions": [
      { "type": "tool", "name": ["exec", "gateway", "cron"] },
      { "type": "time", "after": "23:00", "before": "07:00" }
    ],
    "effect": { "action": "deny", "reason": "High-risk tools blocked during night hours" }
  }]
}
```

### "Only trusted agents can spawn sub-agents"

```json
{
  "id": "spawn-control",
  "name": "Spawn Control",
  "scope": {},
  "rules": [{
    "id": "require-trust",
    "conditions": [
      { "type": "tool", "name": "sessions_spawn" },
      { "type": "agent", "maxScore": 39 }
    ],
    "effect": { "action": "deny", "reason": "Agents below score 40 cannot spawn sub-agents" }
  }]
}
```

### "Rate limit external messaging"

```json
{
  "id": "message-rate-limit",
  "name": "Message Rate Limit",
  "scope": {},
  "rules": [{
    "id": "throttle",
    "conditions": [
      { "type": "tool", "name": "message" },
      { "type": "frequency", "maxCount": 5, "windowSeconds": 60, "scope": "agent" }
    ],
    "effect": { "action": "deny", "reason": "Message rate limit exceeded (5/min)" }
  }]
}
```

### "Block production commands for untrusted agents"

```json
{
  "id": "prod-safety",
  "name": "Production Safety",
  "scope": {},
  "rules": [{
    "id": "block-prod",
    "conditions": [
      { "type": "tool", "name": "exec", "params": { "command": { "matches": "(systemctl|docker).*(restart|stop|rm|kill)" } } },
      { "type": "agent", "trustTier": ["untrusted", "restricted"] }
    ],
    "effect": { "action": "deny", "reason": "Production operations require at least 'standard' trust tier" }
  }]
}
```

## Condition Types

| Type | What it checks | Example |
|------|---------------|---------|
| `tool` | Tool name, parameters (exact, glob, regex) | `{ "type": "tool", "name": "exec", "params": { "command": { "contains": "rm" } } }` |
| `time` | Hour, day-of-week, named windows | `{ "type": "time", "after": "22:00", "before": "06:00", "days": [0, 6] }` |
| `agent` | Agent ID, trust tier, score range | `{ "type": "agent", "trustTier": "untrusted", "maxScore": 20 }` |
| `context` | Conversation, message content, channel | `{ "type": "context", "channel": "telegram" }` |
| `risk` | Computed risk level | `{ "type": "risk", "minRisk": "high" }` |
| `frequency` | Actions per time window | `{ "type": "frequency", "maxCount": 10, "windowSeconds": 60 }` |
| `any` | OR — at least one sub-condition | `{ "type": "any", "conditions": [...] }` |
| `not` | Negation | `{ "type": "not", "condition": { ... } }` |

All conditions in a rule are AND-combined. Use `any` for OR logic.

## Trust System

Agents start with a configured default score and earn (or lose) trust through actions:

| Tier | Score | What they can do |
|------|-------|-----------------|
| `untrusted` | 0–19 | Read-only, no external actions |
| `restricted` | 20–39 | Basic operations, no production |
| `standard` | 40–59 | Normal operation |
| `trusted` | 60–79 | Extended permissions, can spawn agents |
| `privileged` | 80–100 | Full autonomy |

- **+0.1** per successful tool call (capped at +30 total)
- **-2** per violation (resets clean streak)
- **+0.5/day** age bonus (capped at +20)
- **+0.3/day** clean streak (capped at +20)
- **Decay:** Score × 0.95 after 30 days of inactivity

Trust persists across restarts. Sub-agents inherit a trust ceiling from their parent — they can never exceed their parent's score.

## Cross-Agent Governance

When a main agent spawns a sub-agent (e.g. `forge`):

1. The parent→child relationship is tracked automatically
2. Parent's deny policies cascade to the child
3. Child's trust is capped at parent's score
4. Audit records include the full lineage (`parentAgentId`, `inheritedPolicyIds`)

This means: if you deny `main` from touching production, `forge` can't either. No escaping through sub-agents.

## Audit Trail

Every governance decision is logged to `{workspace}/governance/audit/YYYY-MM-DD.jsonl`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1708300000000,
  "timestampIso": "2026-02-18T14:00:00.000Z",
  "verdict": "deny",
  "context": {
    "hook": "before_tool_call",
    "agentId": "forge",
    "toolName": "exec",
    "toolParams": { "command": "git push origin main" },
    "crossAgent": { "parentAgentId": "main", "trustCeiling": 60 }
  },
  "trust": { "score": 32, "tier": "restricted" },
  "risk": { "level": "high", "score": 72 },
  "matchedPolicies": [{ "policyId": "forge-no-deploy", "ruleId": "block-push" }],
  "controls": ["A.8.3", "A.8.5", "A.5.24", "A.5.28"]
}
```

- **Rotation:** One file per day, auto-cleaned after `retentionDays`
- **Redaction:** Sensitive data (passwords, tokens, keys) redacted before write
- **Compliance:** Each record maps to standard controls (ISO 27001 Annex A, SOC 2, NIS2) for audits

## Built-in Policies

Enable with a boolean or customize:

| Policy | What it does | Config |
|--------|-------------|--------|
| `nightMode` | Blocks risky tools during off-hours | `true` or `{ "after": "23:00", "before": "08:00" }` |
| `credentialGuard` | Blocks access to secrets, `.env`, passwords | `true` |
| `productionSafeguard` | Blocks `systemctl`, `docker rm`, destructive ops | `true` |
| `rateLimiter` | Throttles tool calls per minute | `true` or `{ "maxPerMinute": 15 }` |

## Commands

| Command | Description |
|---------|-------------|
| `/governance` | Show engine status, policy count, trust overview |

## Important: Policy Reload Behavior

⚠️ **Policies are loaded once at gateway startup.** If you change policy configuration in `openclaw.json` (add, remove, or edit rules), you must restart the gateway for changes to take effect:

```bash
openclaw gateway restart
# or send SIGUSR1 to the gateway process
```

A config edit alone (including `config.patch`) will write the file but **not reload policies into the running governance engine**. This is by design — deterministic policy evaluation means no mid-session surprises.

If you add custom policies via the config and they don't seem to fire, check:
1. Was the gateway restarted after the config change?
2. Does the policy scope match the hook? (e.g., `before_tool_call` for tool blocking)
3. Is the regex correct? Use `new RegExp("your-pattern").test("your-input")` in Node.js to verify.

## Performance

- Evaluation: **<5ms** for 10+ regex policies
- Zero runtime dependencies (only Node.js builtins)
- Pre-compiled regex cache, ring buffer frequency tracking
- Fail-open by default (configurable to fail-closed)

## Requirements

- Node.js ≥ 22.0.0
- OpenClaw gateway

## Part of the Vainplex Plugin Suite

All plugins live in one monorepo: [alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)

| # | Plugin | Version | Description |
|---|--------|---------|-------------|
| 1 | [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | 0.2.1 | NATS JetStream event persistence + audit trail |
| 2 | [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | 0.4.0 | Conversation intelligence — threads, decisions, boot context, trace analysis, 10 languages |
| 3 | [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | 0.1.3 | Real-time fact extraction from conversations |
| 4 | **@vainplex/openclaw-governance** | **0.3.2** | Policy-as-code — trust scoring, audit trail, production safeguards (this plugin) |

## License

MIT © [Albert Hild](https://github.com/alberthild)

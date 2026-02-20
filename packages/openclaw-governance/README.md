> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — a collection of production plugins that turn OpenClaw into a self-governing, learning system. See the monorepo for the full picture.

---

# @vainplex/openclaw-governance

**Your AI agents are powerful. That's the problem.**

An agent that can `exec("rm -rf /")` at 3 AM because a prompt injection told it to? That's not a feature, that's a liability. This plugin adds contextual, learning governance to OpenClaw — so your agents stay powerful but accountable.

**v0.5.4** — 767 tests, zero runtime dependencies.

---

## What It Does

```
Agent calls exec("git push origin main")
  → Governance evaluates: tool + time + trust + frequency + context
  → Verdict: DENY — "Forge cannot push to main (trust: restricted, score: 32)"
  → Audit record written (JSONL, compliance-mapped)
  → Agent gets a clear rejection reason
```

### Core Features

- **Contextual Policies** — Not just "which tool" but "which tool, when, by whom, at what risk level"
- **Learning Trust** — Score 0–100, five tiers, decay on inactivity. Sub-agents can never exceed parent's trust.
- **Cross-Agent Governance** — Parent policies cascade to sub-agents. Deny on main = deny on forge.
- **Compliance Audit Trail** — Append-only JSONL with ISO 27001/SOC 2/NIS2 control mapping.

### v0.5 Features

- **Output Validation (RFC-006)** — Detects unverified numeric claims, contradictions, and hallucinated system states. Configurable LLM gate for external communications.
- **Redaction Layer (RFC-007)** — 3-layer defense-in-depth for credentials, PII, and financial data. SHA-256 vault, fail-closed mode, 17 built-in patterns.
- **Fact Registry** — Register known facts (from live systems or static files). Claims are checked against facts with fuzzy numeric matching.

## Quick Start

### Install

```bash
npm install @vainplex/openclaw-governance
```

### Minimal Config (`openclaw.json`)

```json
{
  "plugins": {
    "entries": {
      "openclaw-governance": { "enabled": true }
    }
  }
}
```

### External Config (`~/.openclaw/plugins/openclaw-governance/config.json`)

```json
{
  "enabled": true,
  "timezone": "Europe/Berlin",
  "failMode": "open",
  "trust": {
    "defaults": {
      "main": 60,
      "forge": 45,
      "*": 10
    }
  },
  "builtinPolicies": {
    "nightMode": { "start": "23:00", "end": "06:00" },
    "credentialGuard": true,
    "productionSafeguard": true,
    "rateLimiter": { "maxPerMinute": 15 }
  },
  "outputValidation": {
    "enabled": true,
    "unverifiedClaimPolicy": "flag"
  },
  "redaction": {
    "enabled": true,
    "categories": ["credential", "pii", "financial"],
    "failMode": "closed"
  }
}
```

## Redaction Layer (RFC-007)

3-layer defense-in-depth against credential, PII, and financial data leakage.

### What It Protects

| Layer | Hook | When | Can Modify? |
|-------|------|------|-------------|
| **Layer 1** | `tool_result_persist` | Before tool output is written to transcript | ✅ Yes (sync) |
| **Layer 2** | `message_sending` | Before outbound messages to channels | ✅ Yes (modifying) |
| **Layer 2b** | `before_message_write` | Before message persistence | ✅ Yes (sync) |

### 17 Built-in Patterns

| Category | Patterns |
|----------|----------|
| **Credential** | OpenAI API key, Anthropic key, Google API key, GitHub PAT/server token, GitLab PAT, Private key headers, Bearer tokens, Key-value credentials, AWS access key, Generic API key (`sk-*`), Basic Auth |
| **PII** | Email addresses, Phone numbers (international) |
| **Financial** | Credit card numbers (Luhn-valid), IBAN, US SSN |

### How It Works

```
Tool returns: "Found key sk_test_51Ss4R2..."
  → Layer 1: Pattern match → Replace with [REDACTED:api_key:a3f2]
  → SHA-256 hash stored in vault (1h TTL)
  → Transcript gets redacted version
  → If agent needs the real value later: vault resolves placeholder in before_tool_call
```

### Configuration

```json
{
  "redaction": {
    "enabled": true,
    "categories": ["credential", "pii", "financial"],
    "vaultExpirySeconds": 3600,
    "failMode": "closed",
    "customPatterns": [
      {
        "name": "internal-token",
        "regex": "MYAPP_[A-Z0-9]{32}",
        "category": "credential"
      }
    ],
    "allowlist": {
      "piiAllowedChannels": [],
      "financialAllowedChannels": [],
      "exemptTools": ["web_search"],
      "exemptAgents": []
    },
    "performanceBudgetMs": 5
  }
}
```

### Security Invariants

- **Credentials can NEVER be allowlisted** — even exempt tools get credential-only scanning
- **fail-closed** — on redaction errors, output is suppressed entirely
- **SHA-256 vault** — no plaintext storage, hash collision handling, TTL-based expiry
- **No secrets in logs** — audit entries log categories and counts, never values

### Known Limitations

> **Be honest about what this does and doesn't protect.**

| ✅ Protected | ❌ Not Protected |
|-------------|-----------------|
| Tool outputs written to transcript | Live-streamed tool output (before persist) |
| Outbound messages to channels | Inbound user messages |
| Audit log entries | LLM context window (keys sent by user) |
| Persisted conversation history | Third-party tool-internal logging |

**Why?** OpenClaw streams tool output to the LLM in real-time for responsiveness. The `tool_result_persist` hook fires after streaming but before writing to the transcript. This means:

1. If a tool returns a secret, the LLM **sees it during the current turn** (streaming)
2. But the **transcript** and **audit logs** get the redacted version
3. The LLM's response goes through Layer 2 (`message_sending`) — so secrets won't appear in outbound messages

**For maximum protection:** Don't store secrets in files that agents can `cat`. Use a vault (Vaultwarden, 1Password CLI) and let agents fetch secrets via dedicated tools that you exempt from redaction.

## Output Validation (RFC-006)

Detects and flags potentially hallucinated or unverified claims in agent output.

### Detectors

| Detector | What It Catches |
|----------|----------------|
| `system_state` | "The server is running" without live verification |
| `entity_name` | Incorrect names for known entities |
| `existence` | "Feature X exists" claims without evidence |
| `operational_status` | "Service Y is healthy" without live check |

### Fact Registry

Register known facts for claim verification:

```json
{
  "outputValidation": {
    "enabled": true,
    "factRegistries": [{
      "id": "system-live",
      "facts": [
        { "subject": "governance-tests", "predicate": "count", "value": "767", "source": "vitest" },
        { "subject": "nats-events", "predicate": "count", "value": "255908", "source": "nats stream ls" }
      ]
    }],
    "unverifiedClaimPolicy": "flag"
  }
}
```

### Policies

| Policy | Effect |
|--------|--------|
| `ignore` | No action on unverified claims |
| `flag` | Add `[UNVERIFIED]` annotation |
| `warn` | Log warning |
| `block` | Block the message entirely |

### LLM Gate (Optional)

For external communications (email, message tool, sessions_send), an optional LLM validator can verify claims against the fact registry before sending:

```json
{
  "outputValidation": {
    "llmValidator": {
      "enabled": true,
      "model": "gemini/gemini-3-flash-preview",
      "failMode": "open",
      "maxRetries": 2,
      "cacheSeconds": 300
    }
  }
}
```

## Policy Examples

### "No dangerous commands at night"

```json
{
  "id": "night-guard",
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

## Condition Types

| Type | What it checks |
|------|---------------|
| `tool` | Tool name, parameters (exact, glob, regex) |
| `time` | Hour, day-of-week, named windows |
| `agent` | Agent ID, trust tier, score range |
| `context` | Conversation, message content, channel |
| `risk` | Computed risk level |
| `frequency` | Actions per time window |
| `any` | OR — at least one sub-condition |
| `not` | Negation |

All conditions in a rule are AND-combined. Use `any` for OR logic.

## Trust System

| Tier | Score | Capability |
|------|-------|------------|
| `untrusted` | 0–19 | Read-only, no external actions |
| `restricted` | 20–39 | Basic operations, no production |
| `standard` | 40–59 | Normal operation |
| `trusted` | 60–79 | Extended permissions, can spawn agents |
| `privileged` | 80–100 | Full autonomy |

Trust modifiers: +0.1/success, -2/violation, +0.5/day age, +0.3/day clean streak. Decay: ×0.95 after 30 days inactive. Sub-agents inherit parent's trust ceiling.

## Built-in Policies

| Policy | What it does |
|--------|-------------|
| `nightMode` | Blocks risky tools during off-hours |
| `credentialGuard` | Blocks access to secrets, `.env`, passwords |
| `productionSafeguard` | Blocks `systemctl`, `docker rm`, destructive ops |
| `rateLimiter` | Throttles tool calls per minute |

## Audit Trail

Every decision → `~/.openclaw/plugins/openclaw-governance/governance/audit/YYYY-MM-DD.jsonl`:
- One file per day, auto-cleaned after `retentionDays`
- Sensitive data redacted before write
- Each record maps to compliance controls (ISO 27001, SOC 2, NIS2)

## Performance

- Policy evaluation: **<5ms** for 10+ regex policies
- Redaction scan: **<5ms** for typical tool output
- Zero runtime dependencies (Node.js builtins only)
- Pre-compiled regex cache, ring buffer frequency tracking

## Requirements

- Node.js ≥ 22.0.0
- OpenClaw gateway

## Part of the Vainplex Plugin Suite

| # | Plugin | Version | Description |
|---|--------|---------|-------------|
| 1 | [@vainplex/nats-eventstore](../openclaw-nats-eventstore) | 0.2.1 | NATS JetStream event persistence + audit |
| 2 | [@vainplex/openclaw-cortex](../openclaw-cortex) | 0.4.5 | Conversation intelligence — threads, decisions, trace analysis |
| 3 | [@vainplex/openclaw-knowledge-engine](../openclaw-knowledge-engine) | 0.1.4 | Real-time fact extraction |
| 4 | **@vainplex/openclaw-governance** | **0.5.4** | Policy-as-code, trust, redaction, output validation (this plugin) |

## License

MIT © [Albert Hild](https://github.com/alberthild)

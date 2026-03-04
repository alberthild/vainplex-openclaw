> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — a collection of production plugins that turn OpenClaw into a self-governing, learning system. See the monorepo for the full picture.

---

# @vainplex/openclaw-governance

In February 2026, UC Berkeley's Center for Long-Term Cybersecurity published a [67-page framework](https://ppc.land/uc-berkeley-unveils-framework-as-ai-agents-threaten-to-outrun-oversight/) for governing autonomous AI agents. The same month, [Microsoft's Cyber Pulse report](https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/) revealed that 80% of Fortune 500 companies now run active AI agents — and 29% of employees use unsanctioned ones. Microsoft followed up with a [threat analysis specific to OpenClaw](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/), outlining identity, isolation, and runtime risks for self-hosted agents.

The gap is clear: agents are everywhere, governance is nowhere. The Berkeley framework defines what's needed. The existing tools — scanners, input/output filters, output validators — cover fragments. None of them do contextual, learning, runtime governance across agents.

This plugin does. It implements 8 of Berkeley's 12 core requirements today, with the remaining 4 designed and scheduled.

[![npm](https://img.shields.io/npm/v/@vainplex/openclaw-governance)](https://www.npmjs.com/package/@vainplex/openclaw-governance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero runtime dependencies. 810 tests. Production since February 2026.

---

## Berkeley/Microsoft Compliance Mapping

UC Berkeley's Agentic AI Risk-Management Standards Profile and Microsoft's governance requirements define what responsible agent infrastructure looks like. Here's where this plugin stands:

| Requirement | Our Implementation | Status |
|---|---|---|
| **Agent Registry** | Trust config with per-agent scores, all 9 agents registered | ✅ Implemented |
| **Access Control / Least Privilege** | Per-agent tool blocking, trust tier-based permissions | ✅ Implemented |
| **Real-time Monitoring** | Every tool call evaluated against policies before execution | ✅ Implemented |
| **Activity Logging / Audit Trail** | Append-only JSONL, ISO 27001 / SOC 2 / NIS2 control mapping | ✅ Implemented |
| **Emergency Controls** | Night Mode (time-based blocking), Rate Limiter (frequency cap) | ✅ Implemented |
| **Cascading Agent Policies** | Cross-agent governance — parent policies propagate to sub-agents | ✅ Implemented |
| **Autonomy Levels** | Trust tiers (0–100, five levels) — functionally equivalent to Berkeley's L0–L5 | ✅ Implemented |
| **Credential Protection** | 3-layer redaction with SHA-256 vault, 17 built-in patterns, fail-closed | ✅ Implemented |
| **Output Integrity** | Response Gate — enforce tool usage, content patterns, block non-compliant output | ✅ Implemented |
| **Human-in-the-Loop** | Approval Manager for high-risk operations | 📋 Planned |
| **Semantic Intent Analysis** | LLM-powered intent classification before tool execution | 📋 Planned |
| **Multi-Agent Interaction Monitoring** | Agent-to-agent message governance | 📋 Planned |
| **Tamper-evident Audit** | Hash-chain audit trail for compliance verification | 📋 Planned |

9 implemented. 4 planned. Production since 2026-02-18.

---

## They Scan. We Govern.

Most tools in this space solve a piece of the problem. None of them solve the whole thing.

| Tool | What It Does | What's Missing |
|---|---|---|
| **Invariant Labs → Snyk** | Runtime guardrails, MCP scanning, trace analysis | Acquired by Snyk — enterprise-only. No trust scores. No cross-agent governance. No compliance audit trail. |
| **NVIDIA NeMo Guardrails** | Input/output filtering, topical control | Filters messages, not tool calls. No agent context. No trust awareness. No multi-agent policies. |
| **GuardrailsAI** | Output validation, schema enforcement | Validates what comes out. No idea who called what, when, or whether they should have. Python-only. |
| **SecureClaw** | 56 audit checks, 5 hardening modules, OWASP-aligned | Scanner, not runtime. Tells you what's wrong — doesn't prevent it. No policies, no trust. |
| **OpenClaw built-in** | Tool allowlists, realpath containment, plugin sandboxing | Static config. No trust scoring. No time-awareness. No learning. No compliance mapping. |

The difference: those tools operate on inputs and outputs. This plugin operates on **decisions** — which tool, which agent, what time, what trust level, what frequency, what context. Then it decides, logs, and learns.

As [Peter Steinberger noted](https://x.com/steipete/status/2026092642623201379), this is what a trust model for AI agents should look like.

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

### v0.6: Session Trust (RFC-008)

Trust is not a config value. It's earned per conversation.

- **Two-Tier Trust Model** — Persistent *agent trust* (configured baseline) + ephemeral *session trust* (earned in real-time). A fresh session starts at 70% of agent trust and climbs with successful tool calls.
- **Session Signals** — Success (+1), policy block (−2), credential violation (−10). Clean streak bonus after 10 consecutive good calls.
- **Ceiling & Floor** — Sessions can earn up to 120% of agent trust, but can always drop to zero.
- **Adaptive Display** — `[Governance] Agent: main (60/trusted) | Session: 42/standard | Policies: 4`

No existing governance tool implements session-level trust. Static per-agent allowlists don't capture that the same agent performs differently across sessions.

### v0.7: Response Gate

Output validation catches hallucinations. Response Gate enforces **structural requirements** — did the agent actually do the work before answering?

```
User: "What's the weather in Berlin?"
Agent responds without calling weather tool
  → Response Gate: requiredTools check failed — "weather" not called
  → Message blocked, fallback sent: "I need to check the weather first."
```

**Three validator types:**

| Validator | What It Enforces |
|-----------|-----------------|
| `requiredTools` | Specific tools must have been called before responding |
| `mustMatch` | Response must match regex pattern(s) |
| `mustNotMatch` | Response must NOT match regex pattern(s) |

**Configuration:**

```json
{
  "responseGate": {
    "enabled": true,
    "rules": [
      {
        "agentId": "research-agent",
        "validators": [
          {
            "type": "requiredTools",
            "tools": ["web_search", "web_fetch"],
            "message": "Research agent must search before answering."
          }
        ]
      },
      {
        "validators": [
          {
            "type": "mustNotMatch",
            "pattern": "(?i)as an ai|i cannot|i'm sorry",
            "message": "No generic AI refusals — give a real answer or escalate."
          }
        ]
      }
    ],
    "fallbackMessage": "⚠️ Response blocked by governance. Reason: {reasons}"
  }
}
```

**Key design decisions:**
- Runs in `before_message_write` — synchronous, zero latency overhead
- Tracks tool calls per session via `after_tool_call` — no config needed
- Fail-closed on invalid regex patterns (blocks, doesn't silently pass)
- Preserves ContentBlock arrays — compatible with all message transforms
- Fallback messages replace blocked content instead of silent drops (v0.7.1)

No other governance tool validates that an agent actually used its tools before responding. Output validators check *what* the agent said. Response Gate checks *whether the agent did the work*.

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
        { "subject": "governance-tests", "predicate": "count", "value": "771", "source": "vitest" },
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

## Part of the Vainplex OpenClaw Suite

| Plugin | Description |
|--------|-------------|
| [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | NATS JetStream event persistence + audit trail |
| [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Conversation intelligence — threads, decisions, boot context, trace analysis |
| [@vainplex/openclaw-governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Policy engine — trust scores, credential redaction, production safeguards |
| [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Entity and relationship extraction from conversations |
| [@vainplex/openclaw-sitrep](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-sitrep) | Situation reports — health, goals, timers aggregated |
| [@vainplex/openclaw-leuko](https://github.com/alberthild/openclaw-leuko) | Cognitive immune system — health checks, anomaly detection |
| [@vainplex/openclaw-membrane](https://github.com/alberthild/openclaw-membrane) | Episodic memory bridge via gRPC |

Full suite: [alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)


## License

MIT © [Albert Hild](https://github.com/alberthild)

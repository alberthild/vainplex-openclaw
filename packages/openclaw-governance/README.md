> **Part of [Brainplex](https://npmjs.com/package/brainplex)** — The intelligence layer for AI agents. `npx brainplex init` to install the full suite.

---

> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — production plugins that turn OpenClaw into a self-governing, learning system.

---

# @vainplex/openclaw-governance

Runtime governance for autonomous AI agents. Not a scanner. Not an output filter. A decision layer that evaluates **which tool, which agent, what time, what trust level** — then decides, logs, and learns.

[![npm](https://img.shields.io/npm/v/@vainplex/openclaw-governance)](https://www.npmjs.com/package/@vainplex/openclaw-governance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

848 tests. Zero runtime dependencies. Production since February 2026.

```bash
npm install @vainplex/openclaw-governance
```

---

## Why This Exists

UC Berkeley's [67-page framework](https://ppc.land/uc-berkeley-unveils-framework-as-ai-agents-threaten-to-outrun-oversight/) defines what governing AI agents requires. [Microsoft's Cyber Pulse report](https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/) revealed 80% of Fortune 500 run active AI agents. Their [OpenClaw-specific threat analysis](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/) outlines identity, isolation, and runtime risks.

The gap: agents are everywhere, governance is nowhere. Existing tools scan inputs or filter outputs. None of them do contextual, learning, runtime governance across agents.

This plugin implements **10 of 13** Berkeley governance requirements:

| Requirement | Implementation | Status |
|---|---|---|
| Agent Registry | Trust config with per-agent scores | ✅ |
| Access Control / Least Privilege | Per-agent tool blocking, trust tier permissions | ✅ |
| Real-time Monitoring | Every tool call evaluated before execution | ✅ |
| Activity Logging / Audit Trail | Append-only JSONL, ISO 27001 / SOC 2 / NIS2 mapping | ✅ |
| Emergency Controls | Night Mode, Rate Limiter | ✅ |
| Cascading Agent Policies | Parent policies propagate to sub-agents | ✅ |
| Autonomy Levels | Trust tiers 0–100, five levels (≈ Berkeley L0–L5) | ✅ |
| Credential Protection | 3-layer redaction, SHA-256 vault, 17 built-in patterns | ✅ |
| Output Integrity | Response Gate — enforce tool usage + content patterns | ✅ |
| Human-in-the-Loop | Approval Manager — `/approve`, `/deny`, timeout, trust bypass | ✅ |
| Semantic Intent Analysis | LLM-powered intent classification | 📋 Planned |
| Multi-Agent Interaction Monitoring | Agent-to-agent message governance | 📋 Planned |
| Tamper-evident Audit | Hash-chain audit trail | 📋 Planned |

---

## How It Works

```
Agent calls exec("git push origin main")
  → Governance evaluates: tool + time + trust + frequency + context
  → Verdict: DENY — "Forge cannot push to main (trust: restricted, score: 32)"
  → Audit record written (JSONL, compliance-mapped)
  → Agent gets a clear rejection reason
```

---

## Features

### Contextual Policies

Not just "which tool" but "which tool, when, by whom, at what risk level." Conditions are AND-combined; use `any` for OR logic.

| Condition Type | What It Checks |
|---|---|
| `tool` | Tool name, parameters (exact, glob, regex) |
| `time` | Hour, day-of-week, named time windows |
| `agent` | Agent ID, trust tier, score range |
| `context` | Conversation, message content, channel |
| `risk` | Computed risk level |
| `frequency` | Actions per time window |
| `any` / `not` | OR logic, negation |

**Example: No dangerous commands at night**

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

### Trust System

Trust is earned, not configured. Two tiers: persistent **agent trust** + ephemeral **session trust**.

| Tier | Score | Capability |
|---|---|---|
| `untrusted` | 0–19 | Read-only, no external actions |
| `restricted` | 20–39 | Basic operations, no production |
| `standard` | 40–59 | Normal operation |
| `trusted` | 60–79 | Extended permissions, can spawn agents |
| `privileged` | 80–100 | Full autonomy |

- **Session Trust** — Fresh sessions start at 70% of agent trust, climb with successful tool calls
- **Signals** — Success (+1), policy block (−2), credential violation (−10)
- **Clean streak bonus** after 10 consecutive good calls
- **Sub-agent ceiling** — sub-agents can never exceed parent's trust score
- **Decay** — ×0.95 after 30 days inactive

### Human-in-the-Loop (Approval Manager)

Pauses agent execution for high-risk tool calls. Waits for a human to `/approve` or `/deny`.

```
Agent calls exec("npm publish")
  → Policy match → action: "approve"
  → Agent paused ⏸️
  → Notification: "⚠️ Approval Required [a1b2c3] — forge wants to exec"
  → Human: /approve a1b2c3
  → Agent resumes ▶️
```

- New policy effect `approve` — alongside allow/deny
- Async Promise-based: agent waits, nothing else blocks
- Configurable timeout with auto-deny (or auto-allow)
- **Trust bypass** — agents above `minTrust` skip approval
- **Self-approval prevention** — agents cannot approve their own requests
- **Approver allowlist** — only authorized users can `/approve`
- **Notification failure safety** — auto-deny if delivery fails and `defaultAction` is `allow`

```json
{
  "approvalManager": {
    "enabled": true,
    "defaultTimeoutSeconds": 300,
    "defaultAction": "deny",
    "approvers": ["@albert:vainplex.dev"]
  }
}
```

### Response Gate

Enforces **structural requirements** — did the agent actually do the work before answering?

```
User: "What's the weather in Berlin?"
Agent responds without calling weather tool
  → Response Gate: requiredTools check failed
  → Message blocked, fallback: "I need to check the weather first."
```

| Validator | What It Enforces |
|---|---|
| `requiredTools` | Specific tools must have been called before responding |
| `mustMatch` | Response must match regex pattern(s) |
| `mustNotMatch` | Response must NOT match regex pattern(s) |

- Runs in `before_message_write` — synchronous, zero latency
- Tracks tool calls per session automatically
- Fail-closed on invalid regex
- Fallback messages replace blocked content (not silent drops)

```json
{
  "responseGate": {
    "enabled": true,
    "rules": [
      {
        "agentId": "research-agent",
        "validators": [
          { "type": "requiredTools", "tools": ["web_search"], "message": "Must search first." }
        ]
      }
    ],
    "fallbackMessage": "⚠️ Response blocked. Reason: {reasons}"
  }
}
```

### Credential Redaction

3-layer defense-in-depth against credential, PII, and financial data leakage.

| Layer | Hook | When |
|---|---|---|
| Layer 1 | `tool_result_persist` | Before tool output is written to transcript |
| Layer 2 | `message_sending` | Before outbound messages to channels |
| Layer 2b | `before_message_write` | Before message persistence |

**17 built-in patterns:** OpenAI/Anthropic/Google/GitHub/GitLab API keys, AWS access keys, private key headers, Bearer tokens, Basic Auth, email addresses, phone numbers, credit cards (Luhn-valid), IBAN, US SSN.

- SHA-256 vault with 1h TTL — no plaintext storage
- Credentials can **never** be allowlisted
- Fail-closed — on redaction errors, output is suppressed
- Custom patterns supported
- Performance budget: <5ms

```json
{
  "redaction": {
    "enabled": true,
    "categories": ["credential", "pii", "financial"],
    "failMode": "closed"
  }
}
```

### Output Validation

Detects unverified claims, contradictions, and hallucinated system states.

| Detector | What It Catches |
|---|---|
| `system_state` | "The server is running" without live verification |
| `entity_name` | Incorrect names for known entities |
| `existence` | "Feature X exists" claims without evidence |
| `operational_status` | "Service Y is healthy" without live check |

**Fact Registry** — register known facts, claims checked with fuzzy numeric matching.
**LLM Gate** — optional LLM validator for external communications.
**Policies:** `ignore`, `flag` (add [UNVERIFIED]), `warn`, `block`.

### Built-in Policies

| Policy | What It Does |
|---|---|
| `nightMode` | Blocks risky tools during configured off-hours |
| `credentialGuard` | Blocks access to secrets, `.env`, passwords |
| `productionSafeguard` | Blocks `systemctl`, `docker rm`, destructive ops |
| `rateLimiter` | Throttles tool calls per minute |

### Compliance Audit Trail

Every decision → `~/.openclaw/plugins/openclaw-governance/governance/audit/YYYY-MM-DD.jsonl`

- One file per day, auto-cleaned after `retentionDays`
- Sensitive data redacted before write
- Each record maps to ISO 27001 / SOC 2 / NIS2 controls
- Append-only — no edits, no deletes

---

## They Scan. We Govern.

| Tool | What It Does | What's Missing |
|---|---|---|
| **Invariant Labs → Snyk** | Runtime guardrails, MCP scanning | Enterprise-only. No trust scores. No cross-agent governance. |
| **NVIDIA NeMo Guardrails** | Input/output filtering | Filters messages, not tool calls. No agent context. No trust. |
| **GuardrailsAI** | Output validation, schema enforcement | Validates output. No idea who called what. Python-only. |
| **SecureClaw** | 56 audit checks, OWASP-aligned | Scanner, not runtime. Tells you what's wrong, doesn't prevent it. |
| **OpenClaw built-in** | Tool allowlists, realpath containment | Static config. No trust. No time-awareness. No learning. |

The difference: those tools operate on inputs and outputs. This plugin operates on **decisions**.

---

## Quick Start

```json
// openclaw.json
{
  "plugins": {
    "entries": {
      "openclaw-governance": { "enabled": true }
    }
  }
}
```

```json
// ~/.openclaw/plugins/openclaw-governance/config.json
{
  "enabled": true,
  "timezone": "Europe/Berlin",
  "failMode": "open",
  "trust": {
    "defaults": { "main": 60, "forge": 45, "*": 10 }
  },
  "builtinPolicies": {
    "nightMode": { "start": "23:00", "end": "06:00" },
    "credentialGuard": true,
    "productionSafeguard": true,
    "rateLimiter": { "maxPerMinute": 15 }
  }
}
```

---

## Performance

- Policy evaluation: **<5ms** for 10+ regex policies
- Redaction scan: **<5ms** for typical tool output
- Zero runtime dependencies (Node.js builtins only)
- Pre-compiled regex cache, ring buffer frequency tracking

## Requirements

- Node.js ≥ 22.0.0
- OpenClaw gateway

---

## Part of the Vainplex OpenClaw Suite

| Plugin | Description |
|---|---|
| **[@vainplex/openclaw-governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance)** | Policy engine — trust, redaction, approval, response gate |
| [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Conversation intelligence — threads, decisions, trace analysis |
| [@vainplex/openclaw-membrane](https://github.com/alberthild/openclaw-membrane) | Episodic memory bridge via gRPC |
| [@vainplex/openclaw-leuko](https://github.com/alberthild/openclaw-leuko) | Cognitive immune system — health checks, anomaly detection |
| [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Entity and relationship extraction |
| [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | NATS JetStream event persistence |

Full suite: **[alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)**

## License

MIT © [Albert Hild](https://github.com/alberthild)

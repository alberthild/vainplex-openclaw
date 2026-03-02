> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — a collection of production plugins that turn OpenClaw into a self-governing, learning system. See the monorepo for the full picture.

---

# @vainplex/openclaw-cortex

Your AI agent has a 200k token context window. Sounds like a lot — until compaction hits and everything before the last 20 messages disappears. Every thread you discussed, every decision you made, every commitment your agent agreed to. Gone.

Cortex fixes this. It listens to every conversation, extracts the structure (threads, decisions, mood, blocking items), and generates a dense boot context that survives compaction. Your agent wakes up knowing what happened — not starting from zero.

[![npm](https://img.shields.io/npm/v/@vainplex/openclaw-cortex)](https://www.npmjs.com/package/@vainplex/openclaw-cortex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem

OpenClaw agents lose context in three ways:

1. **Compaction** — When the context window fills up, older messages get compressed or dropped. Decisions from yesterday? Gone.
2. **Session boundaries** — New session, new agent. No memory of what was discussed 4 hours ago.
3. **State drift** — After a few compaction cycles, the agent confidently acts on outdated information it can no longer verify.

Memory plugins store raw conversation history. But raw history doesn't tell you *what was decided*, *which threads are still open*, or *what the agent was waiting for*. You need conversation intelligence.

---

## What It Does

`openclaw-cortex` listens to OpenClaw message hooks and automatically:

- **📋 Tracks conversation threads** — detects topic shifts, closures, decisions, and blocking items
- **🎯 Extracts decisions** — recognizes when decisions are made (English + German) and logs them
- **🚀 Generates boot context** — assembles a dense `BOOTSTRAP.md` at session start so the agent has continuity
- **📸 Pre-compaction snapshots** — saves thread state + hot snapshot before memory compaction
- **📖 Structured narratives** — generates 24h activity summaries from threads + decisions
- **🔍 Trace Analyzer** — 3-stage pipeline that detects failure signals, classifies findings with LLM triage, and generates PII-redacted reports

Works **alongside** `memory-core` (OpenClaw's built-in memory) — doesn't replace it.

### Regex + LLM Hybrid

By default, Cortex uses fast regex patterns (zero cost, instant). Optionally, you can plug in **any OpenAI-compatible LLM** for deeper analysis:

- **Ollama** (local, free): `mistral:7b`, `qwen2.5:7b`, `llama3.1:8b`
- **OpenAI**: `gpt-4o-mini`, `gpt-4o`
- **OpenRouter / vLLM / any OpenAI-compatible API**

The LLM runs **on top of regex** — it enhances, never replaces. If the LLM is down, Cortex falls back silently to regex-only.

## 🛠️ Agent Tools (v0.5.0)

Cortex registers **5 agent tools** that let your AI agent query its own memory directly. No manual lookups, no stale context — the agent asks, Cortex answers.

All tools are **read-only**, **optional** (opt-in via `tools.allow`), and respond in **<100ms**.

| Tool | Description | Example Use |
|------|-------------|-------------|
| `cortex_threads` | List and filter conversation threads | *"What threads are still open?"* |
| `cortex_decisions` | Query tracked decisions | *"What did we decide about auth?"* |
| `cortex_search` | Cross-search threads + decisions | *"Find everything related to deployment"* |
| `cortex_commitments` | View tracked commitments from messages | *"What did I promise to do?"* |
| `cortex_status` | Plugin health — thread/decision counts, mood | *"How's Cortex doing?"* |

### Enable Agent Tools

Add the tools to your agent's allowlist in `openclaw.json`:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tools: {
          allow: [
            "cortex_threads",
            "cortex_decisions",
            "cortex_search",
            "cortex_commitments",
            "cortex_status"
          ]
        }
      }
    ]
  }
}
```

### Commitment Tracking

Cortex automatically detects commitments from conversation messages in **10 languages**:

```
"I'll fix the auth bug tomorrow"     → ✅ Detected (EN)
"Ich werde das morgen fixen"         → ✅ Detected (DE)
"Je vais corriger ça demain"         → ✅ Detected (FR)
"sounds good"                        → ❌ Ignored (casual acknowledgment)
```

Commitments are tracked with:
- **who** — who made the commitment
- **what** — the specific promise (captured from regex, not full message)
- **status** — `open` → `overdue` (after 7 days) → `done`
- **deduplication** — same commitment from same message won't create duplicates

Query with `cortex_commitments`, or let the agent check what's overdue.

---

## 🎬 Demo

Interactive step-by-step demo — walk through a conversation, see Cortex extract threads and decisions in real-time:

```bash
git clone https://github.com/alberthild/vainplex-openclaw.git
cd vainplex-openclaw/packages/openclaw-cortex
npm install
npx tsx demo/demo.ts
```

The demo has 5 phases:
1. **Step-by-step conversation** — press Enter to advance each message, see what Cortex detects
2. **Thread & decision analysis** — view extracted threads, decisions, mood
3. **Pre-compaction snapshot** — see how Cortex saves state before memory loss
4. **Boot context generation** — the dense briefing assembled for the next session
5. **Interactive sandbox** — type your own messages, use `/threads` `/decisions` `/mood` `/boot`

### Sample conversation

A 13-message conversation between a developer and an AI assistant covering 3 topics:

```
👤 You:   Let's get back to the auth migration. We need to switch from JWT to OAuth2.
🤖 Agent: I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks.
👤 You:   Agreed. We decided to use Auth0 as the provider.
👤 You:   Now about the performance bug. The API takes 3 seconds for simple queries.
🤖 Agent: I ran the profiler. The problem is an N+1 query in the user resolver.
👤 You:   That's annoying. We need this fixed by Friday.
🤖 Agent: We'll use a batched DataLoader. The plan is to fix the user resolver first, then the rest.
👤 You:   Decided. And we wait for Alexey's review before we deploy.
🤖 Agent: Auth migration is done ✅ All tests green, backward compat verified.
👤 You:   Nice! That went perfectly. 🚀
👤 You:   Now about the Kubernetes cluster — we need to plan the migration from Docker Compose.
🤖 Agent: I'll draft an architecture doc. Waiting for the cost estimate from Hetzner first.
👤 You:   Good progress today. Let's continue with the K8s plan tomorrow.
```

<details>
<summary><b>🧵 Thread Tracking</b> — 3 threads detected, 1 auto-closed</summary>

```
Found 3 threads (2 open, 1 closed)

  ○ 🟠 the auth migration
      Status: closed           ← detected "done ✅" as closure signal
      Priority: high
      Mood: neutral

  ● 🟡 the performance bug
      Status: open
      Priority: medium
      Mood: neutral

  ● 🟡 the Kubernetes cluster
      Status: open
      Priority: medium
      Mood: neutral
      Waiting for: cost estimate from Hetzner
```

</details>

<details>
<summary><b>🎯 Decision Extraction</b> — 4 decisions found</summary>

```
  🎯 The plan is to keep backward compatibility for 2 weeks
      Impact: medium | Who: assistant

  🎯 We decided to use Auth0 as the provider
      Impact: medium | Who: user

  🎯 We'll use a batched DataLoader
      Impact: medium | Who: assistant

  🎯 Decided. And we wait for Alexey's review before we deploy.
      Impact: high | Who: user
```

Trigger patterns: `"the plan is"`, `"we decided"`, `"we'll use"`, `"decided"`

</details>

<details>
<summary><b>🔥 Mood Detection</b> — session mood tracked from patterns</summary>

```
  Session mood: 🔥 excited
  (Detected from "Nice!", "That went perfectly", "🚀")
```

Supported moods: `frustrated` 😤 · `excited` 🔥 · `tense` ⚡ · `productive` 🔧 · `exploratory` 🔬 · `neutral` 😐

</details>

<details>
<summary><b>📸 Pre-Compaction Snapshot</b> — saves state before memory loss</summary>

```
  Success: yes
  Messages snapshotted: 13
  Warnings: none

  Hot Snapshot (memory/reboot/hot-snapshot.md):
    # Hot Snapshot — 2026-02-17
    ## Last conversation before compaction

    **Recent messages:**
    - [user] Let's get back to the auth migration...
    - [assistant] I'll start with the token validation layer...
    - [user] Agreed. We decided to use Auth0 as the provider.
    - [user] Now about the performance bug...
    - ...
```

</details>

<details>
<summary><b>📋 Boot Context (BOOTSTRAP.md)</b> — ~786 tokens, ready for next session</summary>

```markdown
# Context Briefing
Generated: 2026-02-17 | Local: 12:30

## ⚡ State
Mode: Afternoon — execution mode
Last session mood: excited 🔥

## 📖 Narrative (last 24h)
**Completed:**
- ✅ the auth migration: Topic detected from user

**Open:**
- 🟡 the performance bug: Topic detected from user
- 🟡 the Kubernetes cluster: Topic detected from user

**Decisions:**
- 🎯 The plan is to keep backward compatibility for 2 weeks (assistant)
- 🎯 We decided to use Auth0 as the provider (user)
- 🎯 We'll use a batched DataLoader (assistant)
- 🎯 Decided. Wait for Alexey's review before deploy (user)
```

Total: 3,143 chars · ~786 tokens · regenerated every session start

</details>

<details>
<summary><b>📁 Generated Files</b></summary>

```
{workspace}/
├── BOOTSTRAP.md                          3,143 bytes
└── memory/reboot/
    ├── threads.json                      1,354 bytes
    ├── decisions.json                    1,619 bytes
    ├── narrative.md                        866 bytes
    └── hot-snapshot.md                   1,199 bytes
```

All plain JSON + Markdown. No database, no external dependencies.

</details>

> 📝 Full raw output: [`demo/SAMPLE-OUTPUT.md`](demo/SAMPLE-OUTPUT.md)

## Install

```bash
# From npm
npm install @vainplex/openclaw-cortex

# Copy to OpenClaw extensions
cp -r node_modules/@vainplex/openclaw-cortex ~/.openclaw/extensions/openclaw-cortex
```

Or clone directly:

```bash
cd ~/.openclaw/extensions
git clone https://github.com/alberthild/vainplex-openclaw.git
cd vainplex-openclaw/packages/openclaw-cortex
npm install && npm run build
```

## Configure

Add to your OpenClaw config (`openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "openclaw-cortex": { "enabled": true }
    }
  }
}
```

Then create `~/.openclaw/plugins/openclaw-cortex/config.json`:

```json
{
  "patterns": {
    "language": "all"
  },
  "threadTracker": {
    "enabled": true,
    "pruneDays": 7,
    "maxThreads": 50
  },
  "decisionTracker": {
    "enabled": true,
    "maxDecisions": 100,
    "dedupeWindowHours": 24
  },
  "bootContext": {
    "enabled": true,
    "maxChars": 16000,
    "onSessionStart": true,
    "maxThreadsInBoot": 7,
    "maxDecisionsInBoot": 10,
    "decisionRecencyDays": 14
  },
  "preCompaction": {
    "enabled": true,
    "maxSnapshotMessages": 15
  },
  "narrative": {
    "enabled": true
  }
}
```

### LLM Enhancement (optional)

Add an `llm` section to enable AI-powered analysis on top of regex:

```json
{
  "plugins": {
    "openclaw-cortex": {
      "enabled": true,
      "llm": {
        "enabled": true,
        "endpoint": "http://localhost:11434/v1",
        "model": "mistral:7b",
        "apiKey": "",
        "timeoutMs": 15000,
        "batchSize": 3
      }
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable LLM enhancement |
| `endpoint` | `http://localhost:11434/v1` | Any OpenAI-compatible API endpoint |
| `model` | `mistral:7b` | Model identifier |
| `apiKey` | `""` | API key (optional, for cloud providers) |
| `timeoutMs` | `15000` | Timeout per LLM call |
| `batchSize` | `3` | Messages to buffer before calling the LLM |

**Examples:**

```jsonc
// Ollama (local, free)
{ "endpoint": "http://localhost:11434/v1", "model": "mistral:7b" }

// OpenAI
{ "endpoint": "https://api.openai.com/v1", "model": "gpt-4o-mini", "apiKey": "sk-..." }

// OpenRouter
{ "endpoint": "https://openrouter.ai/api/v1", "model": "meta-llama/llama-3.1-8b-instruct", "apiKey": "sk-or-..." }
```

The LLM receives batches of messages and returns structured JSON: detected threads, decisions, closures, and mood. Results are merged with regex findings — the LLM can catch things regex misses (nuance, implicit decisions, context-dependent closures).

Restart OpenClaw after configuring.

## How It Works

### Hooks

| Hook | Feature | Priority |
|---|---|---|
| `message_received` | Thread + Decision Tracking | 100 |
| `message_sent` | Thread + Decision Tracking | 100 |
| `session_start` | Boot Context Generation | 10 |
| `before_compaction` | Pre-Compaction Snapshot | 5 |
| `after_compaction` | Logging | 200 |

### Output Files

```
{workspace}/
├── BOOTSTRAP.md                    # Dense boot context (regenerated each session)
└── memory/
    └── reboot/
        ├── threads.json            # Thread state
        ├── decisions.json          # Decision log
        ├── narrative.md            # 24h activity summary
        └── hot-snapshot.md         # Pre-compaction snapshot
```

### Pattern Languages

Thread and decision detection supports **10 languages** out of the box:

| Language | Code | Decision | Closure | Wait | Mood |
|----------|------|----------|---------|------|------|
| English | `en` | "we decided", "let's do", "the plan is" | "is done", "fixed ✅" | "waiting for", "blocked by" | ✅ |
| German | `de` | "wir machen", "beschlossen" | "erledigt", "gefixt" | "warte auf" | ✅ |
| French | `fr` | "nous avons décidé", "on fait" | "c'est fait", "résolu" | "en attente de" | ✅ |
| Spanish | `es` | "decidimos", "el plan es" | "está hecho", "resuelto" | "esperando" | ✅ |
| Portuguese | `pt` | "decidimos", "o plano é" | "está feito", "resolvido" | "aguardando" | ✅ |
| Italian | `it` | "abbiamo deciso", "il piano è" | "è fatto", "risolto" | "in attesa di" | ✅ |
| Chinese | `zh` | "我们决定", "计划是" | "已完成", "已解决" | "等待", "阻塞" | ✅ |
| Japanese | `ja` | "決定しました", "方針は" | "完了", "解決済み" | "待ち" | ✅ |
| Korean | `ko` | "결정했습니다", "계획은" | "완료", "해결" | "대기 중" | ✅ |
| Russian | `ru` | "мы решили", "план такой" | "готово", "исправлено" | "ждём", "заблокировано" | ✅ |

Configure via `patternLanguage`:
```jsonc
"both"              // backward-compat: EN + DE
"all"               // all 10 languages
["en", "fr", "es"]  // specific languages
"de"                // single language
```

**Custom patterns** — add your own via config:
```json
{
  "patterns": {
    "language": "all",
    "custom": {
      "mode": "extend",
      "decision": ["my custom pattern"],
      "close": ["zakończone"]
    }
  }
}
```

### LLM Enhancement Flow

When `llm.enabled: true`:

```
message_received → regex analysis (instant, always)
                 → buffer message
                 → batch full? → LLM call (async, fire-and-forget)
                              → merge LLM results into threads + decisions
                              → LLM down? → silent fallback to regex-only
```

The LLM sees a conversation snippet (configurable batch size) and returns:
- **Threads**: title, status (open/closed), summary
- **Decisions**: what was decided, who, impact level
- **Closures**: which threads were resolved
- **Mood**: overall conversation mood

### Graceful Degradation

- Read-only workspace → runs in-memory, skips writes
- Corrupt JSON → starts fresh, next write recovers
- Missing directories → creates them automatically
- Hook errors → caught and logged, never crashes the gateway
- LLM timeout/error → falls back to regex-only, no data loss

## Trace Analyzer

The Trace Analyzer is a **3-stage pipeline** that processes NATS event streams to detect failure patterns in AI agent conversations. It reconstructs conversation chains, runs signal detection, classifies findings with an optional LLM triage step, applies PII redaction, and generates structured reports.

### 3-Stage Pipeline

```
Stage 1: Ingest + Reconstruct
  NATS events → normalize → chain reconstruction (gap-based splitting)

Stage 2: Signal Detection + Classification
  chains → 7 signal detectors (multi-language) → LLM triage (optional) → classified findings

Stage 3: Redaction + Output
  findings → PII redaction → report assembly → Markdown/JSON output
```

### 7 Signal Detectors

| Signal ID | Detects | Default |
|-----------|---------|---------|
| `SIG-CORRECTION` | User correcting the agent after a wrong response | ✅ enabled |
| `SIG-TOOL-FAIL` | Tool/function call failures and error responses | ✅ enabled |
| `SIG-DOOM-LOOP` | Agent stuck in repetitive retry loops | ✅ enabled |
| `SIG-DISSATISFIED` | User expressing frustration or dissatisfaction | ✅ enabled |
| `SIG-REPEAT-FAIL` | Same failure pattern recurring across sessions | ✅ enabled |
| `SIG-HALLUCINATION` | Agent making claims contradicted by tool output | ✅ enabled |
| `SIG-UNVERIFIED-CLAIM` | Agent stating facts without tool verification | ❌ disabled |

Each detector supports **multi-language signal patterns** — the same 10 languages as the core pattern engine (EN, DE, FR, ES, PT, IT, ZH, JA, KO, RU).

### Configuration

Add a `traceAnalyzer` section to your external config (`~/.openclaw/plugins/openclaw-cortex/config.json`):

```json
{
  "traceAnalyzer": {
    "enabled": true,
    "nats": {
      "url": "nats://localhost:4222",
      "stream": "openclaw-events",
      "subjectPrefix": "openclaw.events",
      "user": "your-nats-user",
      "password": "your-nats-password"
    },
    "schedule": {
      "enabled": true,
      "intervalHours": 24
    },
    "signals": {
      "SIG-UNVERIFIED-CLAIM": { "enabled": true, "severity": "medium" }
    },
    "llm": {
      "enabled": true,
      "endpoint": "http://localhost:11434/v1",
      "model": "mistral:7b"
    },
    "output": {
      "maxFindings": 200,
      "reportPath": "./reports/trace-analysis.md"
    },
    "redactPatterns": ["\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"]
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Master switch for trace analysis |
| `nats.url` | `nats://localhost:4222` | NATS server URL |
| `nats.stream` | `openclaw-events` | JetStream stream name |
| `nats.user` | — | NATS username (required if auth enabled) |
| `nats.password` | — | NATS password (required if auth enabled) |
| `schedule.enabled` | `false` | Enable scheduled analysis runs |
| `schedule.intervalHours` | `24` | Hours between runs |
| `chainGapMinutes` | `30` | Inactivity gap for chain boundary detection |
| `llm.enabled` | `false` | Enable LLM-powered finding classification |
| `llm.triage` | — | Optional fast/local model for pre-filtering |
| `output.maxFindings` | `200` | Maximum findings per report |
| `output.reportPath` | — | Custom report output path |
| `redactPatterns` | `[]` | Regex patterns for PII redaction |

### Programmatic API

The trace analyzer is fully exported for programmatic use:

```typescript
import {
  TraceAnalyzer,
  createNatsTraceSource,
  reconstructChains,
  detectAllSignals,
  classifyFindings,
  redactChain,
  assembleReport,
  generateOutputs,
  resolveTraceAnalyzerConfig,
} from "@vainplex/openclaw-cortex";
```

## Development

```bash
npm install
npm test            # 879 tests
npm run typecheck   # TypeScript strict mode
npm run build       # Compile to dist/
```

## Performance

- Zero runtime dependencies (Node built-ins only — even LLM calls use `node:http`)
- Regex analysis: instant, runs on every message
- LLM enhancement: async, batched, fire-and-forget (never blocks hooks)
- Atomic file writes via `.tmp` + rename
- Noise filter prevents garbage threads from polluting state
- Tested with 879 unit + integration tests

## Security Context

Cortex adds two layers to OpenClaw's [defense-in-depth model](https://docs.openclaw.ai/gateway/security):

- **Pre-compaction snapshots** ensure agent state survives memory compaction — preventing state drift that could lead to confused or conflicting actions
- **Trace Analyzer** detects failure signals (hallucination, doom loops, unverified claims) across conversation chains — giving operators forensic visibility into what agents actually did

Microsoft's [threat analysis of self-hosted agent runtimes](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/) (Feb 2026) identifies state management and audit trail as key operational risks — exactly what Cortex and the companion [NATS EventStore](../openclaw-nats-eventstore) address.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design document including module diagrams, data flows, type definitions, and testing strategy.

## License

MIT — see [LICENSE](LICENSE)

## Works Great With

| Plugin | Why |
|--------|-----|
| [**@vainplex/openclaw-governance**](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Governance controls what agents can do. Cortex ensures they remember what they did. Together: governed continuity. |
| [**@vainplex/openclaw-knowledge-engine**](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Knowledge Engine extracts entities and facts. Cortex tracks threads and decisions. Together: structured understanding. |
| [**@vainplex/openclaw-membrane**](https://github.com/alberthild/openclaw-membrane) | Membrane stores episodic memories. Cortex pre-compaction snapshots ensure the best moments get preserved. |
| [**@vainplex/nats-eventstore**](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | EventStore logs all events to NATS. Cortex Trace Analyzer reads them back for failure signal detection. |

---

## Part of the Vainplex OpenClaw Suite

| Plugin | Description |
|--------|-------------|
| [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | NATS JetStream event persistence + audit trail |
| [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Conversation intelligence — threads, decisions, boot context, trace analysis |
| [@vainplex/openclaw-governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Policy engine — trust scores, credential redaction, production safeguards |
| [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Entity and relationship extraction from conversations |
| [@vainplex/openclaw-leuko](https://github.com/alberthild/openclaw-leuko) | Cognitive immune system — health checks, anomaly detection |
| [@vainplex/openclaw-membrane](https://github.com/alberthild/openclaw-membrane) | Episodic memory bridge via gRPC |

Full suite: [alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)


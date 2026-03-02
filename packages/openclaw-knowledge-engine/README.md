> **📦 This plugin is part of the [Vainplex OpenClaw Suite](https://github.com/alberthild/vainplex-openclaw)** — a collection of production plugins that turn OpenClaw into a self-governing, learning system. See the monorepo for the full picture.

---

# @vainplex/openclaw-knowledge-engine

Your AI agent processes hundreds of messages a day. Names, companies, decisions, technical details — all of it flows through and disappears after compaction. The agent forgets what it learned yesterday.

The Knowledge Engine fixes this. It extracts entities, facts, and relationships from every conversation in real-time — building a persistent, queryable knowledge base that grows with every message. Zero runtime dependencies. Works with or without an LLM.

[![npm](https://img.shields.io/npm/v/@vainplex/openclaw-knowledge-engine)](https://www.npmjs.com/package/@vainplex/openclaw-knowledge-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero runtime dependencies. TypeScript strict. 12 modules, each with a single responsibility.

---

## The Problem

OpenClaw agents are stateless by design. Context windows compress. Compaction drops details. After a week, your agent doesn't know:

- Who "Alex from Acme" is (mentioned 14 times last month)
- That your team decided to use PostgreSQL over MongoDB (discussed Tuesday)
- Which vendors quoted what price (3 different conversations)

Memory plugins like [Membrane](https://github.com/alberthild/openclaw-membrane) store conversation history. But raw history isn't knowledge — it's noise with signal buried inside. You need extraction.

### How Others Approach This

| Approach | Limitation |
|----------|-----------|
| **RAG over chat logs** | Retrieves raw messages, not structured facts. Noisy. |
| **Vector search** | Good for similarity, bad for "Who works at Acme?" |
| **Manual tagging** | Doesn't scale. Agents process 100+ messages/day. |
| **Knowledge Engine** | Extracts structured triples automatically. Regex (free) + LLM (optional). Queryable. Decays gracefully. |

---

## What It Does

Every message your OpenClaw agent processes flows through the Knowledge Engine:

1. **Regex Extraction** (instant, zero cost) — Detects people, organizations, technologies, URLs, emails, and other entities using pattern matching
2. **LLM Enhancement** (optional, batched) — Groups messages and sends them to a local LLM for deeper entity and fact extraction
3. **Fact Storage** — Stores extracted knowledge as structured subject-predicate-object triples with relevance scoring
4. **Relevance Decay** — Automatically decays old facts so recent knowledge surfaces first
5. **Vector Sync** — Optionally syncs facts to ChromaDB for semantic search
6. **Background Maintenance** — Prunes low-relevance facts, compacts storage, runs cleanup

```
User: "We're meeting with Alex from Acme Corp next Tuesday"
  │
  ├─ Regex → entities: [Alex (person), Acme Corp (organization)]
  └─ LLM   → facts:   [Alex — works-at — Acme Corp]
                       [Meeting — scheduled-with — Acme Corp]
```

### Use Cases

- **Multi-agent teams** — Agent A learns "client prefers email over Slack". Agent B (via shared knowledge store) respects the preference without being told.
- **Long-running projects** — After 3 months of conversations, your agent still knows every stakeholder, every decision, every constraint.
- **Support/Sales** — Automatically builds a contact graph: who works where, who reports to whom, which companies are in your pipeline.
- **Compliance** — Structured fact triples create an auditable record of what your agent "knows" and where it learned it.

---

## Quick Start

### 1. Install

```bash
cd ~/.openclaw
npm install @vainplex/openclaw-knowledge-engine
```

### 2. Sync to extensions

OpenClaw loads plugins from the `extensions/` directory:

```bash
mkdir -p extensions/openclaw-knowledge-engine
cp -r node_modules/@vainplex/openclaw-knowledge-engine/{dist,package.json,openclaw.plugin.json} extensions/openclaw-knowledge-engine/
```

### 3. Configure

Add to your `openclaw.json` — just enable the plugin:

```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": { "enabled": true }
    }
  }
}
```

That's it. The plugin creates its own config file at `~/.openclaw/plugins/openclaw-knowledge-engine/config.json` on first run with sensible defaults. Edit that file to customize — syntax errors there won't crash your gateway.

### 4. Restart gateway

```bash
openclaw gateway restart
```

That's it. Every message now builds your knowledge base automatically.

---

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `workspace` | string | `~/.clawd/plugins/knowledge-engine` | Storage directory for knowledge files |
| `extraction.regex.enabled` | boolean | `true` | High-speed regex entity extraction |
| `extraction.llm.enabled` | boolean | `true` | LLM-based deep extraction |
| `extraction.llm.model` | string | `"mistral:7b"` | Ollama/OpenAI-compatible model |
| `extraction.llm.endpoint` | string | `"http://localhost:11434/api/generate"` | LLM API endpoint (HTTP or HTTPS) |
| `extraction.llm.batchSize` | number | `10` | Messages per LLM batch |
| `extraction.llm.cooldownMs` | number | `30000` | Wait time before sending batch |
| `decay.enabled` | boolean | `true` | Periodic relevance decay |
| `decay.intervalHours` | number | `24` | Hours between decay cycles |
| `decay.rate` | number | `0.02` | Decay rate per interval (2%) |
| `embeddings.enabled` | boolean | `false` | Sync facts to ChromaDB |
| `embeddings.endpoint` | string | `"http://localhost:8000/..."` | ChromaDB API endpoint |
| `embeddings.collectionName` | string | `"openclaw-facts"` | Vector collection name |
| `embeddings.syncIntervalMinutes` | number | `15` | Minutes between vector syncs |
| `storage.maxEntities` | number | `5000` | Max entities before pruning |
| `storage.maxFacts` | number | `10000` | Max facts before pruning |
| `storage.writeDebounceMs` | number | `15000` | Debounce delay for disk writes |

### Plugin Config File

The plugin stores its config at `~/.openclaw/plugins/openclaw-knowledge-engine/config.json`. This is separate from `openclaw.json` by design — a syntax error here won't crash your gateway.

To point to a custom location, set `configPath` in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": {
        "enabled": true,
        "configPath": "/path/to/my/ke-config.json"
      }
    }
  }
}
```

### Minimal config (regex only, no LLM)

In `~/.openclaw/plugins/openclaw-knowledge-engine/config.json`:

```json
{
  "enabled": true,
  "extraction": {
    "llm": { "enabled": false }
  }
}
```

Zero-cost entity extraction. No Ollama, no API keys, no GPU. Just install and go.

### Full config (LLM + ChromaDB)

```json
{
  "enabled": true,
  "workspace": "~/my-agent/knowledge",
  "extraction": {
    "llm": {
      "enabled": true,
      "endpoint": "http://localhost:11434/api/generate",
      "model": "mistral:7b"
    }
  },
  "embeddings": {
    "enabled": true,
    "endpoint": "http://localhost:8000/api/v1/collections/facts/add"
  },
  "decay": {
    "intervalHours": 12,
    "rate": 0.03
  }
}
```

---

## How It Works

### Extraction Pipeline

```
Message received
      │
      ├──▶ Regex Engine (sync, <1ms)
      │     └─ Extracts: proper nouns, organizations, tech terms,
      │        URLs, emails, monetary amounts, dates
      │
      └──▶ LLM Batch Queue (async, batched)
            └─ Every N messages or after cooldown:
               └─ Sends batch to local LLM
               └─ Extracts: entities + fact triples
               └─ Stores in FactStore
```

### Fact Lifecycle

Facts are stored as structured triples:

```json
{
  "id": "f-abc123",
  "subject": "Alex",
  "predicate": "works-at",
  "object": "Acme Corp",
  "source": "extracted-llm",
  "relevance": 0.95,
  "createdAt": 1707123456789,
  "lastAccessedAt": 1707123456789
}
```

- **Relevance** starts at 1.0 and decays over time
- **Accessed facts** get a relevance boost (LRU-style)
- **Pruning** removes facts below the relevance floor when storage limits are hit
- **Minimum floor** (0.1) prevents complete decay — old facts never fully disappear

### Storage

All data is persisted as JSON files in your workspace:

```
workspace/
├── entities.json    # Extracted entities with types and counts
└── facts.json       # Fact triples with relevance scores
```

Writes use atomic file operations (write to `.tmp`, then rename) to prevent corruption.

---

## Architecture

```
index.ts                 → Plugin entry point
src/
├── types.ts             → All TypeScript interfaces
├── config.ts            → Config resolution + validation
├── patterns.ts          → Regex factories (Proxy-based, no /g state bleed)
├── entity-extractor.ts  → Regex-based entity extraction
├── llm-enhancer.ts      → Batched LLM extraction with cooldown
├── fact-store.ts        → In-memory fact store with decay + pruning
├── hooks.ts             → OpenClaw hook registration + orchestration
├── http-client.ts       → Shared HTTP/HTTPS transport
├── embeddings.ts        → ChromaDB vector sync
├── storage.ts           → Atomic JSON I/O with debounce
└── maintenance.ts       → Scheduled background tasks
```

- **12 modules**, each with a single responsibility
- **Zero runtime dependencies** — Node.js built-ins only
- **TypeScript strict** — no `any` in source code
- **All functions ≤40 lines**

## Hooks

| Hook | Priority | Description |
|------|----------|-------------|
| `session_start` | 200 | Loads fact store from disk |
| `message_received` | 100 | Extracts entities + queues LLM batch |
| `message_sent` | 100 | Same extraction on outbound messages |
| `gateway_stop` | 50 | Flushes writes, stops timers |

## Testing

```bash
npm test        # Unit + integration tests
```

Tests cover: config validation, entity extraction, fact CRUD, decay, pruning, LLM batching, HTTP client, embeddings, storage atomicity, maintenance scheduling, hook orchestration.

---

## Works Great With

| Plugin | Why |
|--------|-----|
| [**@vainplex/openclaw-membrane**](https://github.com/alberthild/openclaw-membrane) | Membrane stores conversation history. Knowledge Engine extracts the signal from it. Together: memory + understanding. |
| [**@vainplex/openclaw-governance**](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Governance controls what agents can do. Knowledge Engine tracks what agents know. Together: controlled intelligence. |
| [**@vainplex/openclaw-cortex**](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Cortex tracks conversation threads and decisions. Knowledge Engine persists the entities behind those decisions. |

---

## Part of the Vainplex OpenClaw Suite

| Plugin | Description |
|--------|-------------|
| [@vainplex/openclaw-governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Policy engine — trust scores, credential redaction, production safeguards |
| [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Conversation intelligence — threads, decisions, boot context, trace analysis |
| [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Entity and relationship extraction from conversations |
| [@vainplex/openclaw-membrane](https://github.com/alberthild/openclaw-membrane) | Episodic memory bridge via gRPC |
| [@vainplex/openclaw-leuko](https://github.com/alberthild/openclaw-leuko) | Cognitive immune system — health checks, anomaly detection |
| [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | NATS JetStream event persistence + audit trail |
| [@vainplex/openclaw-sitrep](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-sitrep) | Situation reports — health, goals, timers aggregated |

Full suite: [alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)

## License

MIT

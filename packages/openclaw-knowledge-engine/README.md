# @vainplex/openclaw-knowledge-engine

A real-time knowledge extraction plugin for [OpenClaw](https://github.com/openclaw/openclaw). Automatically extracts entities, facts, and relationships from conversations — building a persistent, queryable knowledge base that grows with every message.

## What it does

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

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": {
        "enabled": true,
        "config": {
          "workspace": "/path/to/your/workspace",
          "extraction": {
            "regex": { "enabled": true },
            "llm": {
              "enabled": true,
              "endpoint": "http://localhost:11434/api/generate",
              "model": "mistral:7b",
              "batchSize": 10,
              "cooldownMs": 30000
            }
          }
        }
      }
    }
  }
}
```

### 4. Restart gateway

```bash
openclaw gateway restart
```

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

### Minimal config (regex only, no LLM)

```json
{
  "openclaw-knowledge-engine": {
    "enabled": true,
    "config": {
      "extraction": {
        "llm": { "enabled": false }
      }
    }
  }
}
```

This gives you zero-cost entity extraction with no external dependencies.

### Full config (LLM + ChromaDB)

```json
{
  "openclaw-knowledge-engine": {
    "enabled": true,
    "config": {
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
  }
}
```

## How it works

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
npm test
# Runs 94 tests across 11 test files
```

Tests cover: config validation, entity extraction, fact CRUD, decay, pruning, LLM batching, HTTP client, embeddings, storage atomicity, maintenance scheduling, hook orchestration.

## Part of the Vainplex Plugin Suite

All plugins live in one monorepo: [alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)

| # | Plugin | Version | Description |
|---|--------|---------|-------------|
| 1 | [@vainplex/nats-eventstore](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-nats-eventstore) | 0.2.1 | NATS JetStream event persistence + audit trail |
| 2 | [@vainplex/openclaw-cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | 0.4.0 | Conversation intelligence — threads, decisions, boot context, trace analysis, 10 languages |
| 3 | **@vainplex/openclaw-knowledge-engine** | **0.1.3** | Real-time fact extraction from conversations (this plugin) |
| 4 | [@vainplex/openclaw-governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | 0.3.2 | Policy-as-code — trust scoring, audit trail, production safeguards |

## License

MIT

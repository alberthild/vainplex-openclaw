# @vainplex/openclaw-cortex — Architecture Document

> Conversation intelligence layer for OpenClaw.
> Adds automated thread tracking, decision extraction, boot context generation, and pre-compaction snapshots on top of `memory-core`.

**Version:** 0.1.0
**Date:** 2026-02-17
**Status:** Design — ready for implementation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Module Diagram](#2-module-diagram)
3. [Hook Registration Table](#3-hook-registration-table)
4. [Data Flow Per Feature](#4-data-flow-per-feature)
5. [File & Directory Structure](#5-file--directory-structure)
6. [Config Schema](#6-config-schema)
7. [TypeScript Interface Definitions](#7-typescript-interface-definitions)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Overview

### What This Plugin Does

`openclaw-cortex` is a **read-and-derive** plugin. It listens to message hooks, extracts structured intelligence (threads, decisions, mood), and persists state to `{workspace}/memory/reboot/`. At session start, it assembles a dense `BOOTSTRAP.md` that primes the agent with continuity context. Before compaction, it snapshots the hot zone so nothing is lost.

### What This Plugin Does NOT Do

- Does **not** replace `memory-core` (daily notes, facts, compaction are handled there)
- Does **not** call external LLMs (v1 is structured-only)
- Does **not** require NATS or any external service
- Does **not** mutate conversation history or intercept messages

### Design Principles

| Principle | Rationale |
|---|---|
| Zero runtime dependencies | Node built-ins only. Keeps the plugin fast and portable. |
| Graceful degradation | Read-only workspace? Skip writes, log warning, continue. |
| Workspace-relative paths | No hardcoded paths. Everything derived from workspace root. |
| Complementary to memory-core | Reads memory-core artifacts (daily notes), writes to its own `memory/reboot/` directory. |
| Idempotent operations | Running thread tracker twice on the same messages produces the same state. |
| Synchronous hooks, async I/O | Hook handlers are synchronous decision-makers; file I/O is fire-and-forget with error catching. |

### Relationship to Python Reference

The Python reference at `darkplex-core/cortex/memory/` (5 modules, ~950 LOC) is the source of truth for regex patterns, data shapes, and algorithmic behavior. This TypeScript port preserves:

- All regex patterns (decision, closure, wait, topic, mood) verbatim
- Thread scoring and prioritization logic
- Boot context assembly structure and character budget
- Pre-compaction pipeline ordering

Differences from Python reference:
- No NATS CLI subprocess calls (plugin receives messages via hooks, not NATS stream queries)
- No Ollama/LLM narrative generation (v1 structured-only)
- No `facts.jsonl` / knowledge queries (deferred to v2 — depends on memory-core API)
- No calendar/wellbeing integration (deferred to v2)

---

## 2. Module Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                         │
│                                                             │
│  Hooks:                                                     │
│  ├─ message_received ──┐                                    │
│  ├─ message_sent ──────┤                                    │
│  ├─ session_start ─────┤                                    │
│  ├─ before_compaction ─┤                                    │
│  └─ after_compaction ──┘                                    │
│                        │                                    │
└────────────────────────┼────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 index.ts (Plugin Entry)                      │
│                                                             │
│  register(api) {                                            │
│    config = resolveConfig(api.pluginConfig)                 │
│    registerCortexHooks(api, config)                         │
│    api.registerCommand("cortexstatus", ...)                 │
│  }                                                          │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/hooks.ts                              │
│                                                             │
│  Dispatches hook events to feature modules:                 │
│                                                             │
│  message_received ──→ threadTracker.processMessage()        │
│  message_sent ──────→ threadTracker.processMessage()        │
│                  ──→ decisionTracker.processMessage()        │
│  session_start ─────→ bootContext.generate()                │
│  before_compaction ─→ preCompaction.run()                   │
│  after_compaction ──→ (log only)                            │
└────┬───────┬────────┬────────┬──────────────────────────────┘
     │       │        │        │
     ▼       ▼        ▼        ▼
┌────────┐┌────────┐┌────────┐┌──────────────┐┌──────────┐
│ Thread ││Decision││  Boot  ││    Pre-      ││Narrative │
│Tracker ││Tracker ││Context ││ Compaction   ││Generator │
│        ││        ││        ││              ││          │
│track() ││extract ││assem-  ││snapshot() +  ││generate()│
│prune() ││persist ││ble()   ││orchestrate   ││          │
│close() ││        ││write() ││all modules   ││          │
└───┬────┘└───┬────┘└───┬────┘└──────┬───────┘└────┬─────┘
    │         │         │            │              │
    ▼         ▼         ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/patterns.ts                           │
│                                                             │
│  DECISION_PATTERNS, CLOSE_PATTERNS, WAIT_PATTERNS,          │
│  TOPIC_PATTERNS, MOOD_PATTERNS                              │
│  getPatterns(language: "en" | "de" | "both")                │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/storage.ts                            │
│                                                             │
│  loadJson(), saveJson() — atomic writes via .tmp rename     │
│  ensureRebootDir() — create memory/reboot/ if needed        │
│  isWritable() — check workspace write permission            │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              {workspace}/memory/reboot/                      │
│                                                             │
│  threads.json      — Thread state                           │
│  decisions.json    — Decision log                           │
│  narrative.md      — 24h activity summary                   │
│  hot-snapshot.md   — Pre-compaction context snapshot         │
│                                                             │
│              {workspace}/BOOTSTRAP.md                        │
│              — Dense boot context for agent priming          │
└─────────────────────────────────────────────────────────────┘
```

### Module Dependency Graph

```
index.ts
  ├── src/config.ts         (resolveConfig, CortexConfig type)
  ├── src/hooks.ts          (registerCortexHooks — hook dispatcher)
  │     ├── src/thread-tracker.ts
  │     │     ├── src/patterns.ts
  │     │     └── src/storage.ts
  │     ├── src/decision-tracker.ts
  │     │     ├── src/patterns.ts
  │     │     └── src/storage.ts
  │     ├── src/boot-context.ts
  │     │     └── src/storage.ts
  │     ├── src/pre-compaction.ts
  │     │     ├── src/thread-tracker.ts
  │     │     ├── src/narrative-generator.ts
  │     │     ├── src/boot-context.ts
  │     │     └── src/storage.ts
  │     └── src/narrative-generator.ts
  │           └── src/storage.ts
  └── src/types.ts          (shared TypeScript interfaces)
```

No circular dependencies. `patterns.ts`, `storage.ts`, and `types.ts` are leaf modules.

---

## 3. Hook Registration Table

| Hook | Feature | Priority | Behavior | Blocking |
|---|---|---|---|---|
| `message_received` | Thread Tracker | 100 (low) | Extract signals from user message, update thread state | No — fire-and-forget |
| `message_sent` | Thread Tracker | 100 (low) | Extract signals from assistant message, update thread state | No — fire-and-forget |
| `message_received` | Decision Tracker | 100 (low) | Scan for decision patterns, append to decisions.json | No — fire-and-forget |
| `message_sent` | Decision Tracker | 100 (low) | Scan for decision patterns, append to decisions.json | No — fire-and-forget |
| `session_start` | Boot Context | 10 (high) | Assemble BOOTSTRAP.md from persisted state | No — fire-and-forget |
| `before_compaction` | Pre-Compaction | 5 (highest) | Run full pipeline: threads → snapshot → narrative → boot | No — fire-and-forget |
| `after_compaction` | Logging | 200 (lowest) | Log compaction completion timestamp | No — fire-and-forget |

**Priority rationale:**
- Pre-compaction runs at priority 5 to execute before other `before_compaction` handlers (e.g., NATS event store might publish the compaction event — we want our snapshot saved first).
- Boot context at priority 10 ensures BOOTSTRAP.md exists before other `session_start` handlers that might read it.
- Message processing at priority 100 is non-critical and should not delay message delivery.

**All handlers are non-blocking.** File I/O failures are caught and logged, never thrown. The plugin must never interfere with message flow.

---

## 4. Data Flow Per Feature

### 4.1 Thread Tracker

```
message_received / message_sent
         │
         ▼
  ┌──────────────────┐
  │  Extract content  │  ← event.content || event.message || event.text
  │  from hook event  │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ extractSignals() │  ← Run all regex patterns against content
  │                  │  → { decisions[], closures[], waits[], topics[] }
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ detectMood()     │  ← Last mood pattern match wins
  │                  │  → "frustrated" | "excited" | "tense" | etc.
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ loadThreads()    │  ← Read threads.json
  │ updateThreads()  │  ← Match signals to existing threads via word overlap
  │ pruneThreads()   │  ← Remove closed threads older than pruneDays
  │ capThreads()     │  ← Enforce maxThreads limit (drop lowest-priority closed)
  │ saveThreads()    │  ← Atomic write to threads.json
  └──────────────────┘
```

**Signal-to-thread matching:**
A signal (decision context, closure, wait) is matched to a thread when at least 2 words from the thread title appear in the signal text (case-insensitive). This is the same heuristic as the Python reference.

**Thread lifecycle:**
1. **Detection:** New topics detected via `TOPIC_PATTERNS` create new threads with status `open`
2. **Update:** Decisions and waits are appended to matching threads
3. **Closure:** `CLOSE_PATTERNS` set matching open threads to status `closed`
4. **Pruning:** Closed threads older than `pruneDays` are removed on every write
5. **Cap:** If thread count exceeds `maxThreads`, oldest closed threads are removed first

### 4.2 Decision Tracker

```
message_received / message_sent
         │
         ▼
  ┌──────────────────┐
  │  Extract content  │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ matchDecisionPatterns()  │  ← DECISION_PATTERNS regex scan
  │                          │  → context window: 50 chars before, 100 chars after match
  └────────┬─────────────────┘
           │ (if any matches)
           ▼
  ┌──────────────────────────┐
  │ buildDecision()          │  ← Construct Decision object
  │   what: context excerpt  │
  │   date: ISO date         │
  │   why: surrounding text  │
  │   impact: inferred       │
  │   who: from event sender │
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ deduplicateDecisions()   │  ← Skip if identical 'what' exists within last 24h
  │ loadDecisions()          │
  │ appendDecision()         │
  │ saveDecisions()          │  ← Atomic write to decisions.json
  └──────────────────────────┘
```

**Impact inference:** Decisions matching critical keywords (e.g., "architecture", "security", "migration", "delete") get `impact: "high"`. All others default to `"medium"`.

### 4.3 Boot Context Generator

```
session_start (or before_agent_start, first call)
         │
         ▼
  ┌──────────────────────────┐
  │ shouldGenerate()         │  ← Check bootContext.enabled + onSessionStart
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐    ┌─────────────────────┐
  │ loadOpenThreads()        │◄───│ memory/reboot/      │
  │ loadRecentDecisions()    │◄───│   threads.json      │
  │ loadNarrative()          │◄───│   decisions.json     │
  │ loadHotSnapshot()        │◄───│   narrative.md       │
  └────────┬─────────────────┘    │   hot-snapshot.md    │
           │                      └─────────────────────┘
           ▼
  ┌──────────────────────────┐
  │ assembleSections()       │
  │                          │
  │  1. Header + timestamp   │  ~100 chars
  │  2. State + mode + mood  │  ~200 chars
  │  3. Staleness warnings   │  ~100 chars (if applicable)
  │  4. Hot snapshot         │  ~1000 chars (if fresh, <1h old)
  │  5. Narrative            │  ~2000 chars (if fresh, <36h old)
  │  6. Active threads       │  ~4000 chars (top 7, by priority)
  │  7. Recent decisions     │  ~2000 chars (last 10, within 14d)
  │  8. Footer               │  ~100 chars
  │                          │
  │  Total budget: maxChars  │  default 16000 (~4000 tokens)
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ truncateIfNeeded()       │  ← Hard cut at maxChars + "[truncated]" marker
  │ writeBootstrap()         │  ← Write to {workspace}/BOOTSTRAP.md
  └──────────────────────────┘
```

**Section budget allocation** (within 16000 char default):
| Section | Max Chars | Notes |
|---|---|---|
| Header + State | 500 | Always included |
| Hot Snapshot | 1000 | Only if <1h old |
| Narrative | 2000 | Only if <36h old |
| Threads (×7) | 8000 | Sorted by priority, then recency |
| Decisions (×10) | 3000 | Last 14 days |
| Footer | 500 | Stats line |

**Thread prioritization** (same as Python reference):
1. Sort by priority: critical → high → medium → low
2. Within same priority: sort by `last_activity` descending (most recent first)
3. Take top 7

### 4.4 Pre-Compaction Snapshot

```
before_compaction
         │
         ▼
  ┌──────────────────────────┐
  │ 1. threadTracker.flush() │  ← Force-write current thread state
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ 2. buildHotSnapshot()    │  ← Summarize event.compactingMessages (from hook payload)
  │    writeSnapshot()       │  ← Write to memory/reboot/hot-snapshot.md
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ 3. narrative.generate()  │  ← Structured narrative from threads + decisions
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ 4. bootContext.generate() │  ← Full BOOTSTRAP.md assembly
  └──────────────────────────┘
```

**Hot snapshot content format:**
```markdown
# Hot Snapshot — 2026-02-17T10:30:00Z
## Last conversation before compaction

**Recent messages:**
- [user] Can you fix the auth bug in...
- [assistant] I'll look at the JWT validation...
- [user] Also check the rate limiter
- [assistant] Done — both issues fixed...

**Thread state at compaction:**
- 3 open threads, 1 decision pending
```

**Important:** The `before_compaction` hook receives the messages that are about to be compacted. The plugin extracts a summary from these messages for the hot snapshot, rather than querying NATS (unlike the Python reference which calls `nats stream get`).

### 4.5 Narrative Generator

```
Called by: pre-compaction pipeline OR standalone via command
         │
         ▼
  ┌──────────────────────────┐
  │ loadDailyNotes()         │  ← Read {workspace}/memory/{date}.md for today + yesterday
  │ loadThreads()            │  ← Read threads.json
  │ loadDecisions()          │  ← Read decisions.json (last 24h)
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ generateStructured()     │  ← Pure template-based generation
  │                          │
  │  Sections:               │
  │  1. Date header          │
  │  2. Completed threads    │  ← closed in last 24h
  │  3. Open threads         │  ← with priority emoji
  │  4. Decisions            │  ← from last 24h
  │  5. Timeline             │  ← extracted from daily note headers
  └────────┬─────────────────┘
           │
           ▼
  ┌──────────────────────────┐
  │ writeNarrative()         │  ← Write to memory/reboot/narrative.md
  └──────────────────────────┘
```

**v1 is structured-only.** No LLM dependency. The Python reference's `generate_llm()` with Ollama is intentionally excluded. A future v2 could use `llm_input`/`llm_output` hooks or a dedicated API to enrich the narrative.

---

## 5. File & Directory Structure

### Plugin Repository Layout

```
openclaw-cortex/
├── package.json
├── tsconfig.json
├── openclaw.plugin.json
├── index.ts                          # Plugin entry point
├── LICENSE                           # MIT
├── README.md
├── docs/
│   └── ARCHITECTURE.md               # This document
├── src/
│   ├── types.ts                      # All shared TypeScript interfaces
│   ├── config.ts                     # Config resolution + defaults
│   ├── storage.ts                    # JSON I/O, path helpers, atomic writes
│   ├── patterns.ts                   # Regex patterns (EN/DE/both) + mood detection
│   ├── hooks.ts                      # Hook registration dispatcher
│   ├── thread-tracker.ts             # Thread detection, matching, pruning
│   ├── decision-tracker.ts           # Decision extraction + deduplication
│   ├── boot-context.ts               # BOOTSTRAP.md assembly
│   ├── pre-compaction.ts             # Pre-compaction pipeline orchestration
│   └── narrative-generator.ts        # Structured narrative generation
└── test/
    ├── patterns.test.ts              # Pattern matching unit tests
    ├── thread-tracker.test.ts        # Thread lifecycle tests
    ├── decision-tracker.test.ts      # Decision extraction tests
    ├── boot-context.test.ts          # Boot context assembly tests
    ├── pre-compaction.test.ts        # Pipeline orchestration tests
    ├── narrative-generator.test.ts   # Narrative generation tests
    ├── storage.test.ts               # Atomic I/O tests
    ├── config.test.ts                # Config resolution tests
    ├── hooks.test.ts                 # Hook dispatch integration tests
    └── fixtures/                     # Test data
        ├── threads.json
        ├── decisions.json
        ├── narrative.md
        ├── daily-note-sample.md
        └── messages/                 # Sample message payloads
            ├── decision-de.json
            ├── decision-en.json
            ├── closure.json
            └── topic-shift.json
```

### Runtime File Layout (workspace)

```
{workspace}/
├── BOOTSTRAP.md                      # Generated boot context (overwritten each session)
└── memory/
    ├── 2026-02-17.md                 # Daily notes (read by narrative generator)
    ├── 2026-02-16.md
    └── reboot/
        ├── threads.json              # Thread state
        ├── decisions.json            # Decision log
        ├── narrative.md              # 24h activity summary
        └── hot-snapshot.md           # Pre-compaction snapshot
```

---

## 6. Config Schema

### `openclaw.plugin.json`

```json
{
  "id": "openclaw-cortex",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "Enable/disable the cortex plugin entirely"
      },
      "workspace": {
        "type": "string",
        "default": "",
        "description": "Workspace directory override. Empty = auto-detect from OpenClaw context."
      },
      "threadTracker": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable thread detection and tracking"
          },
          "pruneDays": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90,
            "default": 7,
            "description": "Auto-prune closed threads older than N days"
          },
          "maxThreads": {
            "type": "integer",
            "minimum": 5,
            "maximum": 200,
            "default": 50,
            "description": "Maximum number of threads to retain"
          }
        }
      },
      "decisionTracker": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable decision extraction from messages"
          },
          "maxDecisions": {
            "type": "integer",
            "minimum": 10,
            "maximum": 500,
            "default": 100,
            "description": "Maximum number of decisions to retain"
          },
          "dedupeWindowHours": {
            "type": "integer",
            "minimum": 1,
            "maximum": 168,
            "default": 24,
            "description": "Skip decisions with identical 'what' within this window"
          }
        }
      },
      "bootContext": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable BOOTSTRAP.md generation"
          },
          "maxChars": {
            "type": "integer",
            "minimum": 2000,
            "maximum": 64000,
            "default": 16000,
            "description": "Maximum character budget for BOOTSTRAP.md (~4 chars per token)"
          },
          "onSessionStart": {
            "type": "boolean",
            "default": true,
            "description": "Generate BOOTSTRAP.md on session_start hook"
          },
          "maxThreadsInBoot": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20,
            "default": 7,
            "description": "Maximum number of threads to include in boot context"
          },
          "maxDecisionsInBoot": {
            "type": "integer",
            "minimum": 1,
            "maximum": 30,
            "default": 10,
            "description": "Maximum number of recent decisions in boot context"
          },
          "decisionRecencyDays": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90,
            "default": 14,
            "description": "Include decisions from the last N days"
          }
        }
      },
      "preCompaction": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable pre-compaction snapshot pipeline"
          },
          "maxSnapshotMessages": {
            "type": "integer",
            "minimum": 5,
            "maximum": 50,
            "default": 15,
            "description": "Maximum messages to include in hot snapshot"
          }
        }
      },
      "narrative": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable structured narrative generation"
          }
        }
      },
      "patterns": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "language": {
            "type": "string",
            "enum": ["en", "de", "both"],
            "default": "both",
            "description": "Language for regex pattern matching: English, German, or both"
          }
        }
      }
    }
  }
}
```

### `package.json`

```json
{
  "name": "@vainplex/openclaw-cortex",
  "version": "0.1.0",
  "description": "OpenClaw plugin: conversation intelligence — thread tracking, decision extraction, boot context, pre-compaction snapshots",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist",
    "openclaw.plugin.json",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "openclaw": {
    "extensions": [
      "./dist/index.js"
    ]
  },
  "keywords": [
    "openclaw",
    "plugin",
    "cortex",
    "memory",
    "thread-tracking",
    "boot-context",
    "conversation-intelligence"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alberthild/openclaw-cortex.git"
  },
  "homepage": "https://github.com/alberthild/openclaw-cortex#readme",
  "author": "Vainplex <hildalbert@gmail.com>"
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["index.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## 7. TypeScript Interface Definitions

### `src/types.ts` — All Shared Interfaces

```typescript
// ============================================================
// Plugin API Types (OpenClaw contract)
// ============================================================

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

export type OpenClawPluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  registerService: (service: PluginService) => void;
  registerCommand: (command: PluginCommand) => void;
  on: (
    hookName: string,
    handler: (event: HookEvent, ctx: HookContext) => void,
    opts?: { priority?: number },
  ) => void;
};

export type PluginService = {
  id: string;
  start: (ctx: ServiceContext) => Promise<void>;
  stop: (ctx: ServiceContext) => Promise<void>;
};

export type ServiceContext = {
  logger: PluginLogger;
  config: Record<string, unknown>;
};

export type PluginCommand = {
  name: string;
  description: string;
  requireAuth?: boolean;
  handler: (args?: Record<string, unknown>) => { text: string } | Promise<{ text: string }>;
};

export type HookEvent = {
  content?: string;
  message?: string;
  text?: string;
  from?: string;
  to?: string;
  sender?: string;
  role?: string;
  timestamp?: string;
  sessionId?: string;
  messageCount?: number;
  compactingCount?: number;
  compactingMessages?: CompactingMessage[];
  [key: string]: unknown;
};

export type HookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  channelId?: string;
  workspaceDir?: string;
};

export type CompactingMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

// ============================================================
// Thread Tracker Types
// ============================================================

export type ThreadStatus = "open" | "closed";

export type ThreadPriority = "critical" | "high" | "medium" | "low";

export type Thread = {
  /** Unique thread ID (UUIDv4) */
  id: string;
  /** Human-readable thread title (extracted from topic patterns or first message) */
  title: string;
  /** Thread lifecycle status */
  status: ThreadStatus;
  /** Priority level — inferred from content or manually set */
  priority: ThreadPriority;
  /** Brief summary of the thread topic */
  summary: string;
  /** Decisions made within this thread context */
  decisions: string[];
  /** What the thread is blocked on, if anything */
  waiting_for: string | null;
  /** Detected mood of conversation within this thread */
  mood: string;
  /** ISO 8601 timestamp of last activity */
  last_activity: string;
  /** ISO 8601 timestamp of thread creation */
  created: string;
};

export type ThreadsData = {
  /** Schema version (current: 2) */
  version: number;
  /** ISO 8601 timestamp of last update */
  updated: string;
  /** All tracked threads */
  threads: Thread[];
  /** Integrity tracking for staleness detection */
  integrity: ThreadIntegrity;
  /** Overall session mood from latest processing */
  session_mood: string;
};

export type ThreadIntegrity = {
  /** Timestamp of last processed event */
  last_event_timestamp: string;
  /** Number of events processed in last run */
  events_processed: number;
  /** Source of events */
  source: "hooks" | "daily_notes" | "unknown";
};

export type ThreadSignals = {
  decisions: string[];
  closures: boolean[];
  waits: string[];
  topics: string[];
};

// ============================================================
// Decision Tracker Types
// ============================================================

export type ImpactLevel = "critical" | "high" | "medium" | "low";

export type Decision = {
  /** Unique decision ID (UUIDv4) */
  id: string;
  /** What was decided — extracted context window around decision pattern match */
  what: string;
  /** ISO 8601 date (YYYY-MM-DD) when the decision was detected */
  date: string;
  /** Surrounding context explaining why / rationale */
  why: string;
  /** Inferred impact level */
  impact: ImpactLevel;
  /** Who made/announced the decision (from message sender) */
  who: string;
  /** ISO 8601 timestamp of extraction */
  extracted_at: string;
};

export type DecisionsData = {
  /** Schema version (current: 1) */
  version: number;
  /** ISO 8601 timestamp of last update */
  updated: string;
  /** All tracked decisions */
  decisions: Decision[];
};

// ============================================================
// Boot Context Types
// ============================================================

export type ExecutionMode =
  | "Morning — brief, directive, efficient"
  | "Afternoon — execution mode"
  | "Evening — strategic, philosophical possible"
  | "Night — emergencies only";

export type BootContextSections = {
  header: string;
  state: string;
  warnings: string;
  hotSnapshot: string;
  narrative: string;
  threads: string;
  decisions: string;
  footer: string;
};

// ============================================================
// Pre-Compaction Types
// ============================================================

export type PreCompactionResult = {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Timestamp of snapshot */
  timestamp: string;
  /** Number of messages in hot snapshot */
  messagesSnapshotted: number;
  /** Errors encountered (non-fatal) */
  warnings: string[];
};

// ============================================================
// Narrative Types
// ============================================================

export type NarrativeSections = {
  completed: Thread[];
  open: Thread[];
  decisions: Decision[];
  timelineEntries: string[];
};

// ============================================================
// Config Types
// ============================================================

export type CortexConfig = {
  enabled: boolean;
  workspace: string;
  threadTracker: {
    enabled: boolean;
    pruneDays: number;
    maxThreads: number;
  };
  decisionTracker: {
    enabled: boolean;
    maxDecisions: number;
    dedupeWindowHours: number;
  };
  bootContext: {
    enabled: boolean;
    maxChars: number;
    onSessionStart: boolean;
    maxThreadsInBoot: number;
    maxDecisionsInBoot: number;
    decisionRecencyDays: number;
  };
  preCompaction: {
    enabled: boolean;
    maxSnapshotMessages: number;
  };
  narrative: {
    enabled: boolean;
  };
  patterns: {
    language: "en" | "de" | "both";
  };
};

// ============================================================
// Mood Types
// ============================================================

export type Mood =
  | "neutral"
  | "frustrated"
  | "excited"
  | "tense"
  | "productive"
  | "exploratory";

export const MOOD_EMOJI: Record<Mood, string> = {
  neutral: "",
  frustrated: "😤",
  excited: "🔥",
  tense: "⚡",
  productive: "🔧",
  exploratory: "🔬",
};

export const PRIORITY_EMOJI: Record<ThreadPriority, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

export const PRIORITY_ORDER: Record<ThreadPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
```

### `src/patterns.ts` — Pattern Definitions

```typescript
import type { Mood } from "./types.js";

// ============================================================
// Pattern sets by language
// ============================================================

const DECISION_PATTERNS_EN = [
  /(?:decided|decision|agreed|let'?s do|the plan is|approach:)/i,
];

const DECISION_PATTERNS_DE = [
  /(?:entschieden|beschlossen|machen wir|wir machen|der plan ist|ansatz:)/i,
];

const CLOSE_PATTERNS_EN = [
  /(?:done|fixed|solved|closed|works|✅)/i,
];

const CLOSE_PATTERNS_DE = [
  /(?:erledigt|gefixt|gelöst|fertig|funktioniert)/i,
];

const WAIT_PATTERNS_EN = [
  /(?:waiting for|blocked by|need.*first)/i,
];

const WAIT_PATTERNS_DE = [
  /(?:warte auf|blockiert durch|brauche.*erst)/i,
];

const TOPIC_PATTERNS_EN = [
  /(?:back to|now about|regarding)\s+(\w[\w\s-]{2,30})/i,
];

const TOPIC_PATTERNS_DE = [
  /(?:zurück zu|jetzt zu|bzgl\.?|wegen)\s+(\w[\w\s-]{2,30})/i,
];

const MOOD_PATTERNS: Record<Mood, RegExp> = {
  neutral: /(?!)/,  // never matches — neutral is the default
  frustrated: /(?:fuck|shit|mist|nervig|genervt|damn|wtf|argh|schon wieder|zum kotzen|sucks)/i,
  excited: /(?:geil|nice|awesome|krass|boom|läuft|yes!|🎯|🚀|perfekt|brilliant|mega|sick)/i,
  tense: /(?:vorsicht|careful|risky|heikel|kritisch|dringend|urgent|achtung|gefährlich)/i,
  productive: /(?:erledigt|done|fixed|works|fertig|deployed|✅|gebaut|shipped|läuft)/i,
  exploratory: /(?:was wäre wenn|what if|könnte man|idea|idee|maybe|vielleicht|experiment)/i,
};

// ============================================================
// Public API
// ============================================================

export type PatternLanguage = "en" | "de" | "both";

export type PatternSet = {
  decision: RegExp[];
  close: RegExp[];
  wait: RegExp[];
  topic: RegExp[];
};

/**
 * Get pattern set for the configured language.
 * "both" merges EN + DE patterns.
 */
export function getPatterns(language: PatternLanguage): PatternSet {
  switch (language) {
    case "en":
      return {
        decision: DECISION_PATTERNS_EN,
        close: CLOSE_PATTERNS_EN,
        wait: WAIT_PATTERNS_EN,
        topic: TOPIC_PATTERNS_EN,
      };
    case "de":
      return {
        decision: DECISION_PATTERNS_DE,
        close: CLOSE_PATTERNS_DE,
        wait: WAIT_PATTERNS_DE,
        topic: TOPIC_PATTERNS_DE,
      };
    case "both":
      return {
        decision: [...DECISION_PATTERNS_EN, ...DECISION_PATTERNS_DE],
        close: [...CLOSE_PATTERNS_EN, ...CLOSE_PATTERNS_DE],
        wait: [...WAIT_PATTERNS_EN, ...WAIT_PATTERNS_DE],
        topic: [...TOPIC_PATTERNS_EN, ...TOPIC_PATTERNS_DE],
      };
  }
}

/**
 * Detect mood from text. Scans for all mood patterns; last match position wins.
 * Returns "neutral" if no mood pattern matches.
 */
export function detectMood(text: string): Mood {
  if (!text) return "neutral";

  let lastMood: Mood = "neutral";
  let lastPos = -1;

  for (const [mood, pattern] of Object.entries(MOOD_PATTERNS) as [Mood, RegExp][]) {
    if (mood === "neutral") continue;
    // Use global flag for position scanning
    const globalPattern = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match.index > lastPos) {
        lastPos = match.index;
        lastMood = mood;
      }
    }
  }

  return lastMood;
}

/** High-impact keywords for decision impact inference */
export const HIGH_IMPACT_KEYWORDS = [
  "architecture", "architektur", "security", "sicherheit",
  "migration", "delete", "löschen", "production", "produktion",
  "deploy", "breaking", "major", "critical", "kritisch",
  "strategy", "strategie", "budget", "contract", "vertrag",
];
```

### `src/storage.ts` — File I/O

```typescript
import { readFileSync, writeFileSync, renameSync, mkdirSync, accessSync, statSync } from "node:fs";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import type { PluginLogger } from "./types.js";

/**
 * Resolve the reboot directory path.
 * Does NOT create it — use ensureRebootDir() for that.
 */
export function rebootDir(workspace: string): string {
  return join(workspace, "memory", "reboot");
}

/**
 * Ensure the memory/reboot/ directory exists.
 * Returns false if creation fails (read-only workspace).
 */
export function ensureRebootDir(workspace: string, logger: PluginLogger): boolean {
  const dir = rebootDir(workspace);
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    logger.warn(`[cortex] Cannot create ${dir}: ${err}`);
    return false;
  }
}

/**
 * Check if the workspace is writable.
 */
export function isWritable(workspace: string): boolean {
  try {
    accessSync(join(workspace, "memory"), constants.W_OK);
    return true;
  } catch {
    // memory/ might not exist yet — check workspace itself
    try {
      accessSync(workspace, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Load a JSON file. Returns empty object on any failure.
 */
export function loadJson<T = Record<string, unknown>>(filePath: string): T {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Atomically write JSON to a file.
 * Writes to .tmp first, then renames. This prevents partial writes on crash.
 * Returns false on failure (read-only filesystem).
 */
export function saveJson(filePath: string, data: unknown, logger: PluginLogger): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    logger.warn(`[cortex] Failed to write ${filePath}: ${err}`);
    return false;
  }
}

/**
 * Load a text file. Returns empty string on failure.
 */
export function loadText(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Write a text file atomically.
 * Returns false on failure.
 */
export function saveText(filePath: string, content: string, logger: PluginLogger): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    logger.warn(`[cortex] Failed to write ${filePath}: ${err}`);
    return false;
  }
}

/**
 * Get file modification time as ISO string. Returns null if file doesn't exist.
 */
export function getFileMtime(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Check if a file is older than the given number of hours.
 * Returns true if the file doesn't exist.
 */
export function isFileOlderThan(filePath: string, hours: number): boolean {
  const mtime = getFileMtime(filePath);
  if (!mtime) return true;
  const ageMs = Date.now() - new Date(mtime).getTime();
  return ageMs > hours * 60 * 60 * 1000;
}
```

---

## 8. Error Handling Strategy

### Core Principle: Never Crash the Gateway

The cortex plugin processes intelligence in the background. A failure in thread detection must never prevent a message from being delivered. Every hook handler follows this pattern:

```typescript
api.on("message_received", (event, ctx) => {
  try {
    // ... feature logic ...
  } catch (err) {
    logger.warn(`[cortex] thread-tracker error: ${err}`);
    // Swallow — do not re-throw
  }
});
```

### Error Categories

| Category | Handling | Example |
|---|---|---|
| **File read failure** | Return default (empty object/string) | `threads.json` missing → empty thread list |
| **File write failure** | Log warning, skip write, continue | Read-only workspace → no state persistence |
| **Regex error** | Should never happen (compile-time patterns), but caught at outer level | — |
| **Malformed JSON** | Return empty object, log debug | Corrupt `threads.json` → treated as fresh state |
| **Missing hook fields** | Fallback chain: `event.content ?? event.message ?? event.text ?? ""` | Older gateway version missing `content` |
| **Workspace not found** | Disable all write operations, log error once at registration | — |
| **Config type mismatch** | Use defaults for any misconfigured value | `maxChars: "big"` → use 16000 |

### Graceful Degradation Matrix

| Condition | Behavior |
|---|---|
| Workspace is read-only | All features run but skip file writes. In-memory state is maintained for the session. Log warning once. |
| `threads.json` corrupt | Start with empty thread list. Next successful write recovers. |
| `memory/` dir missing | Create it. If creation fails → read-only mode. |
| No daily notes exist | Narrative generator produces minimal output (threads + decisions only). |
| All features disabled | Plugin registers but does nothing. No hooks registered. |
| Hook event missing content | Skip processing for that event. No error logged (high frequency). |

### In-Memory Fallback

When writes fail, the thread tracker and decision tracker maintain state in memory for the current session:

```typescript
class ThreadTracker {
  private threads: Thread[] = [];
  private dirty = false;
  private writeable = true;

  processMessage(content: string, sender: string): void {
    // Always process in memory
    this.updateThreads(content, sender);
    this.dirty = true;

    // Attempt persist
    if (this.writeable) {
      const ok = saveJson(this.filePath, this.buildData(), this.logger);
      if (!ok) {
        this.writeable = false;
        this.logger.warn("[cortex] Workspace not writable — running in-memory only");
      }
      if (ok) this.dirty = false;
    }
  }

  /** Force persist — called by pre-compaction */
  flush(): boolean {
    if (!this.dirty) return true;
    return saveJson(this.filePath, this.buildData(), this.logger);
  }
}
```

---

## 9. Testing Strategy

### Framework & Configuration

- **Vitest** (consistent with NATS Event Store plugin)
- No mocking libraries — test doubles are hand-written (zero-dep constraint)
- Tests run against in-memory or `tmp/` directories (never real workspace)

### Test Categories

| Category | Count (est.) | What's tested |
|---|---|---|
| Pattern matching | ~80 | Every regex pattern × multiple inputs + edge cases |
| Thread tracker | ~60 | Signal extraction, thread matching, closure, pruning, cap, mood |
| Decision tracker | ~40 | Extraction, deduplication, impact inference, edge cases |
| Boot context | ~50 | Section assembly, truncation, staleness warnings, empty states |
| Narrative generator | ~30 | Structured output, daily note parsing, thread/decision inclusion |
| Pre-compaction | ~20 | Pipeline ordering, hot snapshot building, error resilience |
| Storage | ~25 | Atomic writes, JSON loading, corruption recovery, read-only handling |
| Config | ~15 | Default resolution, type coercion, nested config merging |
| Hooks integration | ~15 | Hook dispatch, feature disable, priority ordering |
| **Total** | **~335** | |

### Test Patterns

#### 1. Pattern Tests (unit)

```typescript
import { describe, it, expect } from "vitest";
import { getPatterns, detectMood } from "../src/patterns.js";

describe("decision patterns (both)", () => {
  const { decision } = getPatterns("both");

  it("matches English 'decided'", () => {
    expect(decision.some(p => p.test("We decided to use TypeScript"))).toBe(true);
  });

  it("matches German 'beschlossen'", () => {
    expect(decision.some(p => p.test("Wir haben beschlossen, TS zu nehmen"))).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(decision.some(p => p.test("The weather is nice today"))).toBe(false);
  });
});

describe("detectMood", () => {
  it("returns 'frustrated' for frustration keywords", () => {
    expect(detectMood("This is damn annoying")).toBe("frustrated");
  });

  it("last match wins", () => {
    expect(detectMood("This sucks but then it works!")).toBe("productive");
  });

  it("returns 'neutral' for empty string", () => {
    expect(detectMood("")).toBe("neutral");
  });
});
```

#### 2. Thread Tracker Tests (unit, with temp filesystem)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ThreadTracker } from "../src/thread-tracker.js";

describe("ThreadTracker", () => {
  let workspace: string;
  let tracker: ThreadTracker;
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "cortex-test-"));
    mkdirSync(join(workspace, "memory", "reboot"), { recursive: true });
    tracker = new ThreadTracker(workspace, {
      enabled: true, pruneDays: 7, maxThreads: 50
    }, "both", logger);
  });

  it("detects a new topic from a topic pattern", () => {
    tracker.processMessage("Let's get back to the auth migration", "user");
    const threads = tracker.getThreads();
    expect(threads.some(t => t.title.includes("auth migration"))).toBe(true);
  });

  it("closes a thread when closure pattern detected", () => {
    tracker.processMessage("back to the login bug", "user");
    tracker.processMessage("login bug is fixed ✅", "assistant");
    const threads = tracker.getThreads();
    const loginThread = threads.find(t => t.title.includes("login bug"));
    expect(loginThread?.status).toBe("closed");
  });

  it("prunes closed threads older than pruneDays", () => {
    // ... inject a thread with old last_activity, run prune, verify removal
  });

  it("enforces maxThreads cap", () => {
    // ... create 55 threads, verify only 50 remain after processing
  });
});
```

#### 3. Boot Context Tests (unit)

```typescript
describe("BootContextGenerator", () => {
  it("produces valid markdown with all sections", () => {
    // Seed threads.json, decisions.json, narrative.md in temp workspace
    // Generate BOOTSTRAP.md
    // Verify each section header exists
  });

  it("respects maxChars budget", () => {
    // Seed many threads + decisions
    // Set maxChars to 2000
    // Verify output length <= 2000 + truncation marker
  });

  it("includes staleness warning for old data", () => {
    // Set integrity.last_event_timestamp to 12h ago
    // Verify "⚠️ Data staleness" appears in output
  });

  it("excludes hot snapshot if older than 1 hour", () => {
    // Create hot-snapshot.md with old mtime
    // Verify it's not in output
  });

  it("handles empty state gracefully", () => {
    // No threads, no decisions, no narrative
    // Verify minimal valid output with header + footer
  });
});
```

#### 4. Hooks Integration Tests

```typescript
describe("registerCortexHooks", () => {
  it("registers hooks for all enabled features", () => {
    const registeredHooks: string[] = [];
    const mockApi = {
      logger,
      on: (name: string) => registeredHooks.push(name),
      registerCommand: () => {},
      registerService: () => {},
      pluginConfig: {},
      config: {},
      id: "test",
    };
    // Call register(mockApi)
    expect(registeredHooks).toContain("message_received");
    expect(registeredHooks).toContain("session_start");
    expect(registeredHooks).toContain("before_compaction");
  });

  it("skips hooks for disabled features", () => {
    // Set threadTracker.enabled = false, decisionTracker.enabled = false
    // Verify message_received is NOT registered
  });

  it("uses correct hook priorities", () => {
    const hookPriorities: Record<string, number[]> = {};
    const mockApi = {
      logger,
      on: (name: string, _handler: any, opts?: { priority?: number }) => {
        hookPriorities[name] ??= [];
        hookPriorities[name].push(opts?.priority ?? 100);
      },
      registerCommand: () => {},
      registerService: () => {},
      pluginConfig: {},
      config: {},
      id: "test",
    };
    // Verify before_compaction priority is 5
    // Verify session_start priority is 10
  });
});
```

### Test Fixtures

Test fixtures in `test/fixtures/` provide realistic data for deterministic tests:

**`test/fixtures/threads.json`** — 5 threads (3 open, 2 closed) with varied priorities and ages.

**`test/fixtures/decisions.json`** — 8 decisions spanning 3 weeks with mixed impact levels.

**`test/fixtures/messages/decision-de.json`** — Hook event payload for a German decision message:
```json
{
  "content": "Wir haben beschlossen, die Auth-Migration auf nächste Woche zu verschieben",
  "from": "albert",
  "timestamp": "2026-02-17T10:30:00Z"
}
```

### Coverage Target

- Line coverage: **≥90%**
- Branch coverage: **≥85%**
- Uncovered: only the plugin `register()` function itself (integration-level, tested via hooks tests)

### Running Tests

```bash
npm test                    # Single run
npm run test:watch          # Watch mode
npx vitest --coverage       # With coverage report
```

---

## Appendix A: Workspace Resolution

The workspace directory is resolved in this order:

1. `config.workspace` (explicit plugin config override)
2. `ctx.workspaceDir` (from hook context, provided by OpenClaw gateway)
3. `process.env.WORKSPACE_DIR` (environment variable)
4. `process.cwd()` (last resort fallback)

```typescript
export function resolveWorkspace(config: CortexConfig, ctx?: HookContext): string {
  if (config.workspace) return config.workspace;
  if (ctx?.workspaceDir) return ctx.workspaceDir;
  return process.env.WORKSPACE_DIR ?? process.cwd();
}
```

## Appendix B: Thread Matching Algorithm

The word-overlap algorithm for matching signals to threads:

```typescript
function matchesThread(thread: Thread, text: string, minOverlap = 2): boolean {
  const threadWords = new Set(
    thread.title.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );
  const textWords = new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );

  let overlap = 0;
  for (const word of threadWords) {
    if (textWords.has(word)) overlap++;
  }
  return overlap >= minOverlap;
}
```

This is intentionally simple and matches the Python reference behavior. It requires at least 2 words from the thread title to appear in the signal text. Words shorter than 3 characters are excluded to avoid false positives from articles/prepositions.

## Appendix C: Full `index.ts` Blueprint

```typescript
import { registerCortexHooks } from "./src/hooks.js";
import { resolveConfig } from "./src/config.js";
import type { OpenClawPluginApi, CortexConfig } from "./src/types.js";

const plugin = {
  id: "openclaw-cortex",
  name: "OpenClaw Cortex",
  description: "Conversation intelligence — thread tracking, decision extraction, boot context, pre-compaction snapshots",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[cortex] Disabled via config");
      return;
    }

    api.logger.info("[cortex] Registering conversation intelligence hooks...");

    // Register all hook handlers
    registerCortexHooks(api, config);

    // Register /cortexstatus command
    api.registerCommand({
      name: "cortexstatus",
      description: "Show cortex plugin status: thread count, last update, mood",
      requireAuth: true,
      handler: () => {
        // Read current state from files and return summary
        return {
          text: "[cortex] Status: operational",
        };
      },
    });

    api.logger.info("[cortex] Ready");
  },
};

export default plugin;
```

## Appendix D: Migration Notes from Python Reference

| Python module | TypeScript module | Key changes |
|---|---|---|
| `common.py` | `storage.ts` + `config.ts` | Split: file I/O → storage.ts, config → config.ts. No NATS credentials (not needed). |
| `thread_tracker.py` | `thread-tracker.ts` | No NATS subprocess calls. Messages arrive via hooks, not stream queries. No CLI (`main()`). |
| `boot_assembler.py` | `boot-context.ts` | No `facts.jsonl` knowledge queries (v2). No calendar/wellbeing integration (v2). No Ollama. |
| `narrative_generator.py` | `narrative-generator.ts` | Structured-only. No `generate_llm()`. No Ollama dependency. |
| `pre_compaction.py` | `pre-compaction.ts` | No NATS subprocess for recent messages. Messages come from `before_compaction` hook payload. |

---

*End of architecture document.*

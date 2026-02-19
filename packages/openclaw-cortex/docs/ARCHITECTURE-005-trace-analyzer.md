# ARCHITECTURE-005: Trace Analyzer

> Implementation blueprint for RFC-005 — maps every RFC requirement to concrete module design,
> data flow, algorithms, and test strategy.

**Version:** 0.1.0
**Date:** 2026-02-19
**Status:** Design — ready for implementation
**RFC:** [RFC-005-trace-analyzer.md](./RFC-005-trace-analyzer.md)

---

## Table of Contents

1. [Overview & Traceability Matrix](#1-overview--traceability-matrix)
2. [NATS Event Field Mapping (Actual vs RFC)](#2-nats-event-field-mapping-actual-vs-rfc)
3. [Module Structure](#3-module-structure)
4. [Data Flow](#4-data-flow)
5. [NatsTraceSource Implementation](#5-natstracesource-implementation)
6. [Chain Reconstruction Algorithm](#6-chain-reconstruction-algorithm)
7. [Signal Detector Contracts & Algorithms](#7-signal-detector-contracts--algorithms)
8. [Classifier (LLM Stage 2)](#8-classifier-llm-stage-2)
9. [LLM Prompt Design](#9-llm-prompt-design)
10. [Output Generator (Stage 3)](#10-output-generator-stage-3)
11. [Redaction Pipeline](#11-redaction-pipeline)
12. [Config Resolution](#12-config-resolution)
13. [Error Handling](#13-error-handling)
14. [Testing Plan](#14-testing-plan)
15. [Build Phases](#15-build-phases)

---

## 1. Overview & Traceability Matrix

### What This Module Does

The Trace Analyzer is a **batch/on-demand analysis pipeline** inside `@vainplex/openclaw-cortex`.
It reads historical agent events from a NATS JetStream event store, reconstructs conversation
chains, detects structural failure patterns, optionally classifies them via LLM, and produces
actionable outputs (SOUL.md rules, governance policies, Cortex patterns).

### What This Module Does NOT Do

- Does **not** run in the message hot path (implements R-010)
- Does **not** import `@vainplex/openclaw-nats-eventstore` (implements R-005)
- Does **not** auto-deploy generated rules (out of scope per §7 of RFC)
- Does **not** require NATS to be installed — gracefully deactivates without it (implements R-004, R-013)

### Requirement → Module Traceability Matrix

| Req | Summary | Implementing Module(s) |
|-----|---------|----------------------|
| R-001 | Module inside `src/trace-analyzer/` | All files under `src/trace-analyzer/` |
| R-002 | `TraceSource` interface | `trace-source.ts` |
| R-003 | `NatsTraceSource` implementation | `nats-trace-source.ts` |
| R-004 | `nats` is optional peer dependency | `nats-trace-source.ts` (dynamic import) |
| R-005 | Config from external file, no eventstore import | `config.ts`, `nats-trace-source.ts` |
| R-006 | Reconstruct chains by (session, agent) | `chain-reconstructor.ts` |
| R-007 | Chain boundary detection | `chain-reconstructor.ts` |
| R-008 | All 7 signal detectors | `signals/*.ts` |
| R-009 | No LLM in detection | `signals/*.ts` (pure functions) |
| R-010 | Batch-only, not in hook path | `index.ts` (command + schedule only) |
| R-011 | Credential redaction | `redactor.ts` |
| R-012 | State persistence | `index.ts` → `saveJson()` |
| R-013 | Graceful deactivation | `index.ts` guard clause |
| R-014 | No change to existing modules | Additive-only changes to `types.ts`, `config.ts`, `hooks.ts` |
| R-015 | 3-stage pipeline | `index.ts` orchestrator |
| R-016 | Finding objects | `signals/types.ts` |
| R-017 | LLM classification | `classifier.ts` |
| R-018 | LLM config reuse with override | `config.ts` → `resolveAnalyzerLlmConfig()` |
| R-019 | AnalysisReport | `report.ts` |
| R-020 | Report persistence | `index.ts` → `saveJson()` |
| R-021 | SOUL.md rule format | `output-generator.ts` |
| R-022 | Governance policy format | `output-generator.ts` |
| R-023 | Cortex pattern format | `output-generator.ts` |
| R-024 | TraceSource method signatures | `trace-source.ts` |
| R-025 | FetchOpts (eventTypes, agents, batchSize) | `trace-source.ts` |
| R-026 | AsyncIterable for backpressure | `trace-source.ts`, `nats-trace-source.ts` |
| R-027 | Own NATS connection | `nats-trace-source.ts` |
| R-028 | `traceAnalyzer` config key, `enabled: false` default | `config.ts` |
| R-029 | Full config shape | `config.ts` |
| R-030 | External config file | `config.ts` (loaded by existing `config-loader.ts`) |
| R-031 | LLM config fallback + per-field merge | `config.ts` → `resolveAnalyzerLlmConfig()` |
| R-032 | Group by (session, agent), order by ts | `chain-reconstructor.ts` |
| R-033 | Boundary detection (lifecycle, gap) | `chain-reconstructor.ts` |
| R-034 | Chain metadata | `chain-reconstructor.ts` |
| R-035 | Redaction before LLM/disk | `redactor.ts`, called by `classifier.ts` and `index.ts` |
| R-036 | Default redaction patterns + custom | `redactor.ts`, `config.ts` |
| R-037 | ≥10k events/min throughput | Streaming design, no full-dataset load |
| R-038 | ≤500 MB memory | Sliding window in `chain-reconstructor.ts` |
| R-039 | JetStream batch consumers | `nats-trace-source.ts` |
| R-040–R-042 | Feedback loop, rule effectiveness | `report.ts` |
| R-043–R-045 | Incremental processing | `index.ts` state management |
| R-046–R-047 | Two-tier LLM | `classifier.ts` |

---

## 2. NATS Event Field Mapping (Actual vs RFC)

**Critical finding:** The live NATS stream contains **two distinct event schemas** coexisting in the same stream, produced by different systems:

### Schema A: Hook-based events (nats-eventstore plugin)

Published by `@vainplex/openclaw-nats-eventstore` hook handlers. Uses the canonical `ClawEvent` shape from `events.ts`.

```typescript
// Actual payload — event types: msg.in, msg.out, tool.call, tool.result, session.start, etc.
{
  id: string;           // UUIDv4 (crypto.randomUUID())
  ts: number;           // Date.now() — ms since epoch
  agent: string;        // "main", "forge", etc.
  session: string;      // sessionKey ?? sessionId ?? "unknown"
  type: EventType;      // "msg.in", "msg.out", "tool.call", "tool.result"
  payload: { ... };     // event-type-specific
}
```

**Actual payload shapes observed:**

| type | payload fields | Example |
|------|---------------|---------|
| `msg.in` | `{ from, content, timestamp, channel, metadata }` | `{ from: "matrix:@albert:vainplex.dev", content: "und nu?", timestamp: 1771504212206, channel: "matrix", metadata: { to, provider, surface, ... } }` |
| `msg.out` | `{ to, content, success, error?, channel }` | `{ to: "room:!Wgox...", content: "Gateway restart ok...", success: true, channel: "matrix" }` |
| `tool.call` | `{ toolName, params }` | `{ toolName: "exec", params: { command: "...", timeout: 15 } }` |
| `tool.result` | `{ toolName, params, result, error?, durationMs }` | `{ toolName: "exec", params: { command: "..." }, result: { content: [...], details: { status, exitCode, durationMs } }, durationMs: 5893 }` |
| `session.start` | `{ sessionId, resumedFrom? }` | `{ sessionId: "8ae7c1b0-..." }` |
| `session.end` | `{ sessionId, messageCount, durationMs? }` | `{ sessionId: "eaec7b8c-...", messageCount: 0 }` |

**Subject format:** `openclaw.events.{agent}.{type_underscored}` — e.g., `openclaw.events.main.msg_in`

### Schema B: Session-sync events (legacy conversation.* events)

Published by `session-sync.mjs`, a separate synchronization script. Uses a different shape with `timestamp` instead of `ts`, includes `visibility` and `meta` fields, and uses `conversation.*` type names.

```typescript
// Actual payload — event types: conversation.message.in, conversation.message.out,
// conversation.tool_call, conversation.tool_result
{
  id: string;           // "{shortId}-{random}" format (NOT UUIDv4)
  timestamp: number;    // ms since epoch (field is "timestamp", NOT "ts")
  agent: string;
  session: string;      // "agent:main:{sessionId}" format
  type: string;         // "conversation.message.in", "conversation.tool_call", etc.
  visibility: string;   // "internal"
  payload: { ... };     // different structure per type
  meta: {               // additional metadata
    source: string;     // "session-sync"
    originalId?: string;
    runId?: string;
    seq?: number;
    stream?: string;
  };
}
```

**Actual payload shapes observed:**

| type | payload fields |
|------|---------------|
| `conversation.message.in` | `{ role: "user", text_preview: [{ type: "text", text: "..." }], content_length: number, sessionId }` |
| `conversation.message.out` | `{ role: "assistant", text_preview: [{ type: "text", text: "..." }], content_length: number, sessionId }` |
| `conversation.tool_call` | `{ runId, stream, data: { phase: "start", name, toolCallId, args }, sessionKey, seq, ts }` |
| `conversation.tool_result` | `{ runId, stream, data: { phase: "result", name, toolCallId, meta, isError, result: { content: [...], details } }, sessionKey, seq, ts }` |

**Subject format:** `openclaw.events.{agent}.conversation_message_in` (underscores, NOT dots in type segment)

### Volume comparison (from stream subject counts)

| Subject | Count | Schema |
|---------|-------|--------|
| `main.conversation_message_in` | 20,448 | B (session-sync) |
| `main.conversation_message_out` | 73,574 | B (session-sync) |
| `main.conversation_tool_call` | 4,162 | B (session-sync) |
| `main.conversation_tool_result` | 1,997 | B (session-sync) |
| `main.msg_in` | 584 | A (nats-eventstore) |
| `main.msg_out` | 722 | A (nats-eventstore) |
| `main.tool_call` | 4,220 | A (nats-eventstore) |
| `main.tool_result` | 8,393 | A (nats-eventstore) |

**Conclusion:** The bulk of message data (~94k) is in Schema B (session-sync conversation events). Schema A (hook events) has much less message volume (1.3k msg.in + msg.out) but significantly more tool events (12.6k). Both schemas must be supported.

### Unified `ClawEvent` Normalization

The `NatsTraceSource` MUST normalize both schemas into a single internal `ClawEvent` type before passing events to the chain reconstructor:

```typescript
// src/trace-analyzer/events.ts

/** Canonical event types for the analyzer. */
export type AnalyzerEventType =
  | "msg.in"
  | "msg.out"
  | "tool.call"
  | "tool.result"
  | "session.start"
  | "session.end"
  | "run.start"
  | "run.end"
  | "run.error";

/** Normalized event — all schemas converted to this shape. */
export type NormalizedEvent = {
  /** Original event ID. */
  id: string;
  /** Timestamp in ms (extracted from `ts` or `timestamp`). */
  ts: number;
  /** Agent ID. */
  agent: string;
  /** Session identifier (normalized — see below). */
  session: string;
  /** Canonical event type. */
  type: AnalyzerEventType;
  /** Normalized payload. */
  payload: NormalizedPayload;
  /** NATS stream sequence number (for incremental tracking). */
  seq: number;
};

/**
 * Unified payload — consistent field names regardless of source schema.
 * Detectors access ONLY these fields, never raw payloads.
 */
export type NormalizedPayload = {
  // msg.in / msg.out
  content?: string;
  role?: "user" | "assistant";
  from?: string;
  to?: string;
  channel?: string;
  success?: boolean;

  // tool.call / tool.result
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  toolError?: string;
  toolDurationMs?: number;
  toolIsError?: boolean;

  // session lifecycle
  sessionId?: string;

  // run lifecycle
  prompt?: string;
  durationMs?: number;
  error?: string;
};
```

### Normalization Rules

| Source Field | Schema | Target Field | Transform |
|-------------|--------|-------------|-----------|
| `ts` | A | `ts` | Direct |
| `timestamp` | B | `ts` | Direct |
| `session` where starts with `"agent:"` | B | `session` | Extract UUID: `"agent:main:uuid" → "uuid"` |
| `session` | A | `session` | Direct (may be `"unknown"`) |
| `type: "msg.in"` | A | `type: "msg.in"` | Direct |
| `type: "conversation.message.in"` | B | `type: "msg.in"` | Remap |
| `type: "conversation.message.out"` | B | `type: "msg.out"` | Remap |
| `type: "conversation.tool_call"` | B | `type: "tool.call"` | Remap |
| `type: "conversation.tool_result"` | B | `type: "tool.result"` | Remap |
| `payload.content` | A (msg.in/out) | `payload.content` | Direct |
| `payload.text_preview[0].text` | B (conversation.message.*) | `payload.content` | Extract first text block |
| `payload.toolName` | A (tool.call) | `payload.toolName` | Direct |
| `payload.data.name` | B (conversation.tool_call) | `payload.toolName` | Extract from nested data |
| `payload.params` | A (tool.call) | `payload.toolParams` | Direct |
| `payload.data.args` | B (conversation.tool_call) | `payload.toolParams` | Extract from nested data |
| `payload.error` | A (tool.result) | `payload.toolError` | Direct (string) |
| `payload.data.isError` | B (conversation.tool_result) | `payload.toolIsError` | Direct (boolean) |
| `payload.result` | A (tool.result) | `payload.toolResult` | Direct |
| `payload.data.result` | B (conversation.tool_result) | `payload.toolResult` | Extract from nested data |

Implementation in `nats-trace-source.ts`:

```typescript
function normalizeEvent(raw: Record<string, unknown>, seq: number): NormalizedEvent | null {
  const rawType = String(raw.type ?? "");
  const ts = typeof raw.ts === "number" ? raw.ts
    : typeof raw.timestamp === "number" ? raw.timestamp
    : 0;
  if (ts === 0) return null; // Skip events with no timestamp

  const type = mapEventType(rawType);
  if (!type) return null; // Skip unknown event types

  const agent = String(raw.agent ?? "unknown");
  const rawSession = String(raw.session ?? "unknown");
  const session = normalizeSession(rawSession);

  const rawPayload = (raw.payload ?? {}) as Record<string, unknown>;
  const payload = normalizePayload(type, rawPayload, rawType);

  return { id: String(raw.id ?? ""), ts, agent, session, type, payload, seq };
}

function mapEventType(raw: string): AnalyzerEventType | null {
  const MAP: Record<string, AnalyzerEventType> = {
    "msg.in": "msg.in",
    "msg.out": "msg.out",
    "conversation.message.in": "msg.in",
    "conversation.message.out": "msg.out",
    "tool.call": "tool.call",
    "tool.result": "tool.result",
    "conversation.tool_call": "tool.call",
    "conversation.tool_result": "tool.result",
    "session.start": "session.start",
    "session.end": "session.end",
    "run.start": "run.start",
    "run.end": "run.end",
    "run.error": "run.error",
  };
  return MAP[raw] ?? null;
}

/** "agent:main:uuid" → "uuid"; "unknown" → "unknown"; "main" → "main" */
function normalizeSession(raw: string): string {
  if (raw.startsWith("agent:")) {
    const parts = raw.split(":");
    return parts[2] ?? parts[1] ?? raw;
  }
  return raw;
}
```

### Deduplication Strategy

Since both schema A and schema B events exist for overlapping time periods (especially for tool calls), the chain reconstructor MUST deduplicate events within the same (session, agent) group. Deduplication key:

- **Messages:** `(agent, session, ts ±500ms, content hash)` — if two events resolve to the same msg.in/msg.out with the same content within 500ms, keep the one with the higher NATS sequence number (more recent schema).
- **Tool calls:** `(agent, session, toolName, ts ±1000ms, params hash)` — same tool call from both schemas → keep one.

When deduplication fires, prefer Schema A (nats-eventstore) events because they have a cleaner, more consistent structure. Schema B events serve as fallback for the period before the nats-eventstore plugin was deployed.

---

## 3. Module Structure

### 3.1 New Files

```
src/trace-analyzer/
├── index.ts                  # Public API: TraceAnalyzer class, registerTraceAnalyzerHooks()
├── trace-source.ts           # TraceSource interface, FetchOpts, NormalizedEvent types
├── events.ts                 # AnalyzerEventType, NormalizedEvent, NormalizedPayload types
├── nats-trace-source.ts      # NatsTraceSource: NATS connection, normalization, AsyncIterable
├── chain-reconstructor.ts    # groupBySessionAgent(), splitOnBoundaries(), deduplication
├── signals/
│   ├── index.ts              # SignalRegistry: runs all enabled detectors, returns Finding[]
│   ├── types.ts              # SignalId, Severity, FailureSignal, Finding, FindingClassification
│   ├── correction.ts         # SIG-CORRECTION detector
│   ├── tool-fail.ts          # SIG-TOOL-FAIL detector
│   ├── doom-loop.ts          # SIG-DOOM-LOOP detector
│   ├── dissatisfied.ts       # SIG-DISSATISFIED detector
│   ├── repeat-fail.ts        # SIG-REPEAT-FAIL cross-session detector
│   ├── hallucination.ts      # SIG-HALLUCINATION detector
│   └── unverified-claim.ts   # SIG-UNVERIFIED-CLAIM detector
├── classifier.ts             # LLM classification (Stage 2), triage + deep analysis
├── output-generator.ts       # Stage 3: SOUL.md rules, governance policies, Cortex patterns
├── report.ts                 # AnalysisReport type, assembly, SignalStats aggregation
├── redactor.ts               # Credential redaction pipeline
└── config.ts                 # TraceAnalyzerConfig type, defaults, resolveTraceAnalyzerConfig()
```

### 3.2 Modified Files

| File | Change | Implements |
|------|--------|-----------|
| `src/types.ts` | Add `TraceAnalyzerConfig` to `CortexConfig` | R-028 |
| `src/config.ts` | Add `traceAnalyzer` to `DEFAULTS`, extend `resolveConfig()` | R-028, R-029 |
| `src/hooks.ts` | Add `registerTraceAnalyzerHooks()` call (conditional) | R-010, R-014 |

### 3.3 Internal Dependency Graph

```
index.ts
├── trace-source.ts (interface)
├── nats-trace-source.ts
│   ├── events.ts (types)
│   └── trace-source.ts (implements)
├── chain-reconstructor.ts
│   └── events.ts (NormalizedEvent)
├── signals/index.ts
│   ├── signals/types.ts
│   ├── signals/correction.ts
│   ├── signals/tool-fail.ts
│   ├── signals/doom-loop.ts
│   ├── signals/dissatisfied.ts
│   ├── signals/repeat-fail.ts
│   ├── signals/hallucination.ts
│   └── signals/unverified-claim.ts
├── classifier.ts
│   ├── signals/types.ts
│   ├── redactor.ts
│   └── events.ts
├── output-generator.ts
│   ├── signals/types.ts
│   └── report.ts
├── report.ts
│   └── signals/types.ts
├── redactor.ts
└── config.ts
```

No circular dependencies. Dependency flow is strictly top-down: `index.ts` is the only file that imports from all submodules.

### 3.4 Exports from `index.ts`

```typescript
// src/trace-analyzer/index.ts

// Types (re-exported for external consumers)
export type { TraceSource, FetchOpts } from "./trace-source.js";
export type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "./events.js";
export type { ConversationChain } from "./chain-reconstructor.js";
export type { SignalId, Severity, FailureSignal, Finding, FindingClassification } from "./signals/types.js";
export type { AnalysisReport, GeneratedOutput, ProcessingState, RunStats } from "./report.js";
export type { TraceAnalyzerConfig } from "./config.js";

// Runtime
export { createNatsTraceSource } from "./nats-trace-source.js";
export { TraceAnalyzer } from "./analyzer.js";  // see §4 orchestrator
export { registerTraceAnalyzerHooks } from "./hooks-registration.js";
```

Wait — let me reconsider. The RFC specifies `index.ts` as both the public API and the orchestrator. For cleanliness, split:

- `index.ts` — re-exports only (public surface)
- `analyzer.ts` — the `TraceAnalyzer` class (orchestrates the 3-stage pipeline)
- `hooks-registration.ts` — `registerTraceAnalyzerHooks()` (commands + scheduling)

Updated file list:

```
src/trace-analyzer/
├── index.ts                  # Re-exports (public surface)
├── analyzer.ts               # TraceAnalyzer class (orchestrates 3-stage pipeline)
├── hooks-registration.ts     # registerTraceAnalyzerHooks() — commands, scheduling
├── trace-source.ts           # TraceSource interface + FetchOpts
├── events.ts                 # NormalizedEvent, AnalyzerEventType, NormalizedPayload
├── nats-trace-source.ts      # NatsTraceSource implementation
├── chain-reconstructor.ts    # Chain reconstruction + deduplication
├── signals/
│   ├── index.ts              # SignalRegistry
│   ├── types.ts              # Signal types
│   ├── correction.ts
│   ├── tool-fail.ts
│   ├── doom-loop.ts
│   ├── dissatisfied.ts
│   ├── repeat-fail.ts
│   ├── hallucination.ts
│   └── unverified-claim.ts
├── classifier.ts             # LLM classification
├── output-generator.ts       # Rule/policy/pattern generation
├── report.ts                 # Report types + assembly
├── redactor.ts               # Credential redaction
└── config.ts                 # Config types + resolver
```

---

## 4. Data Flow

### 4.1 Complete Pipeline (implements R-015)

```
                         ┌───────────────────────┐
                         │   TraceSource          │
                         │   (NatsTraceSource)    │
                         │                        │
                         │  fetchByTimeRange()    │
                         │  → AsyncIterable<raw>  │
                         └───────────┬────────────┘
                                     │ raw JSON events
                                     ▼
                         ┌───────────────────────┐
                         │   Normalizer           │
                         │   (in nats-trace-      │
                         │    source.ts)          │
                         │                        │
                         │  Schema A + B → unified│
                         │  NormalizedEvent        │
                         └───────────┬────────────┘
                                     │ NormalizedEvent stream
                                     ▼
                         ┌───────────────────────┐
                         │   Chain Reconstructor  │
                         │                        │
                         │  group by (session,    │
                         │  agent), split on      │
                         │  boundaries, dedup     │
                         │                        │
                         │  → ConversationChain[] │
                         └───────────┬────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                 ▼
           ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
           │ SIG-CORRECT  │ │ SIG-DOOM     │  │ ... (7 total)│
Stage 1    │ detector     │ │ detector     │  │              │
           └──────┬───────┘ └──────┬───────┘  └──────┬───────┘
                  │                │                  │
                  └────────────────┼──────────────────┘
                                   ▼
                         ┌───────────────────────┐
                         │   Finding[]            │
                         │   (unclassified)       │
                         └───────────┬────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Redactor             │
Stage 2                  │   (strip credentials)  │
(optional)               └───────────┬────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Classifier           │
                         │   (LLM triage →        │
                         │    LLM deep analysis)  │
                         │                        │
                         │  → Finding[]           │
                         │    (classified)         │
                         └───────────┬────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Output Generator     │
Stage 3                  │   (soul_rules,         │
                         │    governance_policies, │
                         │    cortex_patterns)    │
                         └───────────┬────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Report Assembler     │
                         │   (AnalysisReport)     │
                         └───────────┬────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Persistence          │
                         │   saveJson() to        │
                         │   workspace/memory/    │
                         │   reboot/              │
                         └────────────────────────┘
```

### 4.2 Orchestrator: `TraceAnalyzer` class

```typescript
// src/trace-analyzer/analyzer.ts

import type { PluginLogger } from "../types.js";
import type { TraceSource } from "./trace-source.js";
import type { TraceAnalyzerConfig } from "./config.js";
import type { AnalysisReport, ProcessingState } from "./report.js";
import type { Finding } from "./signals/types.js";
import type { LlmConfig } from "../llm-enhance.js";
import { reconstructChains, type ConversationChain } from "./chain-reconstructor.js";
import { runAllDetectors } from "./signals/index.js";
import { classifyFindings } from "./classifier.js";
import { generateOutputs } from "./output-generator.js";
import { assembleReport } from "./report.js";
import { redactChain } from "./redactor.js";
import { saveJson, loadJson } from "../storage.js";
import { join } from "node:path";

export class TraceAnalyzer {
  constructor(
    private readonly source: TraceSource,
    private readonly config: TraceAnalyzerConfig,
    private readonly topLevelLlm: LlmConfig,
    private readonly workspace: string,
    private readonly logger: PluginLogger,
  ) {}

  async run(opts?: { full?: boolean }): Promise<AnalysisReport> {
    const startedAt = Date.now();
    const state = this.loadState();

    // 1. Determine time range
    const startMs = (opts?.full || !state.lastProcessedTs)
      ? 0
      : state.lastProcessedTs - (this.config.incrementalContextWindow * 60_000);
    const endMs = Date.now();

    // 2. Fetch + normalize events (streaming)
    const events = this.source.fetchByTimeRange(startMs, endMs, {
      batchSize: this.config.fetchBatchSize,
    });

    // 3. Reconstruct chains
    const chains = await reconstructChains(events, {
      gapMinutes: this.config.chainGapMinutes,
      maxEventsPerChain: 1000,
    });

    // 4. Stage 1 — structural detection
    let findings = runAllDetectors(chains, this.config.signals, state);

    // 5. Limit findings
    if (findings.length > this.config.output.maxFindings) {
      findings = findings
        .sort((a, b) => severityRank(b.signal.severity) - severityRank(a.signal.severity))
        .slice(0, this.config.output.maxFindings);
    }

    // 6. Stage 2 — LLM classification (optional)
    if (this.config.llm.enabled) {
      const chainMap = new Map(chains.map(c => [c.id, c]));
      findings = await classifyFindings(
        findings,
        chainMap,
        this.config,
        this.topLevelLlm,
        this.logger,
      );
    }

    // 7. Stage 3 — output generation
    const generatedOutputs = generateOutputs(findings);

    // 8. Assemble report
    const report = assembleReport({
      startedAt,
      completedAt: Date.now(),
      eventsProcessed: chains.reduce((s, c) => s + c.events.length, 0),
      chains,
      findings,
      generatedOutputs,
      previousState: state,
    });

    // 9. Persist
    const reportPath = this.config.output.reportPath
      ?? join(this.workspace, "memory", "reboot", "trace-analysis-report.json");
    saveJson(reportPath, report, this.logger);

    const statePath = join(this.workspace, "memory", "reboot", "trace-analyzer-state.json");
    saveJson(statePath, report.processingState, this.logger);

    return report;
  }

  private loadState(): ProcessingState {
    const path = join(this.workspace, "memory", "reboot", "trace-analyzer-state.json");
    return loadJson<ProcessingState>(path);
  }
}
```

---

## 5. NatsTraceSource Implementation

Implements R-003, R-004, R-005, R-026, R-027, R-039.

### 5.1 Dynamic Import Pattern

```typescript
// src/trace-analyzer/nats-trace-source.ts

import type { PluginLogger } from "../types.js";
import type { TraceSource, FetchOpts } from "./trace-source.js";
import type { NormalizedEvent } from "./events.js";
import type { TraceAnalyzerConfig } from "./config.js";

/**
 * Attempt to create a NatsTraceSource. Returns null if:
 * - `nats` npm package is not installed (R-004)
 * - NATS connection fails
 */
export async function createNatsTraceSource(
  natsConfig: TraceAnalyzerConfig["nats"],
  logger: PluginLogger,
): Promise<TraceSource | null> {
  // Dynamic import — R-004
  let nats: typeof import("nats");
  try {
    nats = await import("nats");
  } catch {
    logger.info("[trace-analyzer] `nats` package not installed — NATS trace source unavailable");
    return null;
  }

  try {
    const nc = await nats.connect({
      servers: natsConfig.url.replace(/^nats:\/\//, ""),
      user: natsConfig.user,
      pass: natsConfig.password,
      reconnect: true,
      maxReconnectAttempts: 10,
      timeout: 10_000,
    });

    logger.info(`[trace-analyzer] Connected to NATS at ${natsConfig.url}`);

    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();

    return new NatsTraceSourceImpl(nc, js, jsm, natsConfig, nats, logger);
  } catch (err) {
    logger.warn(`[trace-analyzer] NATS connection failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
```

### 5.2 JetStream Consumer Setup

```typescript
class NatsTraceSourceImpl implements TraceSource {
  constructor(
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly config: TraceAnalyzerConfig["nats"],
    private readonly natsModule: typeof import("nats"),
    private readonly logger: PluginLogger,
  ) {}

  async *fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    const sc = this.natsModule.StringCodec();

    // Build subject filter: if specific event types requested, build subjects
    const filterSubjects = this.buildFilterSubjects(opts);

    // Create an ordered ephemeral consumer starting at startMs
    // Using ordered consumers for simplicity (no durable state on NATS side)
    const consumer = await this.js.consumers.get(this.config.stream);

    // Use fetch() with batch for ordered pull
    const batchSize = opts?.batchSize ?? 500;

    // Consume messages starting from the given start time
    const messages = await consumer.consume({
      max_messages: batchSize,
      idle_heartbeat: 5_000,  // 5s heartbeat to detect stalls
    });

    let yieldedCount = 0;

    for await (const msg of messages) {
      // Parse the message
      const rawStr = sc.decode(msg.data);
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(rawStr);
      } catch {
        msg.ack();
        continue; // Skip unparseable messages
      }

      // Normalize
      const event = normalizeEvent(raw, msg.seq);
      if (!event) { msg.ack(); continue; }

      // Time range filter
      if (event.ts < startMs) { msg.ack(); continue; }
      if (event.ts > endMs) { msg.ack(); break; } // Past end — stop consuming

      // Event type filter
      if (opts?.eventTypes && !opts.eventTypes.includes(event.type)) {
        msg.ack();
        continue;
      }

      // Agent filter
      if (opts?.agents && !opts.agents.includes(event.agent)) {
        msg.ack();
        continue;
      }

      msg.ack();
      yieldedCount++;
      yield event;
    }

    this.logger.info(`[trace-analyzer] Fetched ${yieldedCount} events in time range`);
  }

  async *fetchByAgent(
    agent: string,
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    yield* this.fetchByTimeRange(startMs, endMs, {
      ...opts,
      agents: [agent],
    });
  }

  async getLastSequence(): Promise<number> {
    const info = await this.jsm.streams.info(this.config.stream);
    return info.state.last_seq;
  }

  async getEventCount(): Promise<number> {
    const info = await this.jsm.streams.info(this.config.stream);
    return info.state.messages;
  }

  async close(): Promise<void> {
    await this.nc.drain().catch(() => {});
    await this.nc.close().catch(() => {});
  }

  private buildFilterSubjects(opts?: FetchOpts): string[] | undefined {
    if (!opts?.eventTypes?.length && !opts?.agents?.length) return undefined;
    // For now, use wildcard subscription — filtering happens in-process
    // JetStream subject-based filtering is an optimization for later
    return undefined;
  }
}
```

### 5.3 Connection Lifecycle & Reconnection

- Connection is established in `createNatsTraceSource()` with `maxReconnectAttempts: 10`
- The `nats.js` library handles automatic reconnection transparently
- If connection drops mid-iteration, the `AsyncIterable` will throw — caught by the `TraceAnalyzer.run()` error handler, which persists partial state so the next run resumes from the last successfully processed event
- `close()` is idempotent — called in `finally` blocks

### 5.4 Alternative: Start-Time-Based Consumption

For optimal incremental processing (R-043), use `DeliverPolicy.StartTime`:

```typescript
// When creating the consumer for incremental mode
const consumer = await this.js.consumers.get(this.config.stream, {
  opt_start_time: new Date(startMs).toISOString(),
  deliver_policy: DeliverPolicy.StartTime,
});
```

This avoids scanning events before the start time. JetStream handles seeking efficiently.

---

## 6. Chain Reconstruction Algorithm

Implements R-006, R-007, R-032, R-033, R-034, R-038.

### 6.1 Two-Pass Algorithm

**Pass 1: Accumulate events into session-agent buckets (streaming)**

```typescript
// src/trace-analyzer/chain-reconstructor.ts

export type ChainReconstructorOpts = {
  gapMinutes: number;       // Default: 30 (R-007c, R-033d)
  maxEventsPerChain: number; // Default: 1000 (memory cap)
};

export async function reconstructChains(
  events: AsyncIterable<NormalizedEvent>,
  opts: ChainReconstructorOpts,
): Promise<ConversationChain[]> {

  // Phase 1: Bucket events by (session, agent), maintaining order
  const buckets = new Map<string, NormalizedEvent[]>();

  for await (const event of events) {
    const key = `${event.session}::${event.agent}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(event);
  }

  // Phase 2: For each bucket, split into chains by boundaries
  const chains: ConversationChain[] = [];

  for (const [key, events] of buckets) {
    // Sort by timestamp (should already be ordered, but defensive)
    events.sort((a, b) => a.ts - b.ts);

    // Deduplicate
    const deduped = deduplicateEvents(events);

    // Split on boundaries
    const sessionChains = splitOnBoundaries(deduped, opts);

    for (const chainEvents of sessionChains) {
      if (chainEvents.length < 2) continue; // Skip trivially short chains

      const agent = chainEvents[0].agent;
      const session = chainEvents[0].session;
      const startTs = chainEvents[0].ts;
      const endTs = chainEvents[chainEvents.length - 1].ts;

      // Compute chain ID (deterministic)
      const chainId = await computeChainId(session, agent, startTs);

      // Count events by type
      const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
      for (const e of chainEvents) {
        typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
      }

      chains.push({
        id: chainId,
        agent,
        session,
        startTs,
        endTs,
        events: chainEvents,
        typeCounts,
        boundaryType: determineBoundaryType(chainEvents),
      });
    }
  }

  return chains;
}
```

### 6.2 Boundary Splitting (implements R-007, R-033)

```typescript
function splitOnBoundaries(
  events: NormalizedEvent[],
  opts: ChainReconstructorOpts,
): NormalizedEvent[][] {
  if (events.length === 0) return [];

  const gapMs = opts.gapMinutes * 60 * 1000;
  const chains: NormalizedEvent[][] = [];
  let current: NormalizedEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    let split = false;

    // Boundary (a): session.start begins a new chain
    if (curr.type === "session.start") {
      split = true;
    }

    // Boundary (b): session.end closes current chain
    if (prev.type === "session.end") {
      split = true;
    }

    // Boundary (c): run.start after run.end (new conversation turn)
    // Only split if there's also a meaningful time gap (>5 min)
    // to avoid splitting rapid multi-run sessions
    if (prev.type === "run.end" && curr.type === "run.start") {
      if (curr.ts - prev.ts > 5 * 60 * 1000) {
        split = true;
      }
    }

    // Boundary (d): inactivity gap exceeds configured threshold
    if (curr.ts - prev.ts > gapMs) {
      split = true;
    }

    if (split) {
      if (current.length > 0) chains.push(current);
      current = [curr];
    } else {
      current.push(curr);
      // Memory cap: if chain exceeds max, close it and start new
      if (current.length >= opts.maxEventsPerChain) {
        chains.push(current);
        current = [];
      }
    }
  }

  if (current.length > 0) chains.push(current);
  return chains;
}
```

### 6.3 Deduplication (addresses dual-schema issue from §2)

```typescript
function deduplicateEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  // Build a fingerprint for each event
  const seen = new Map<string, NormalizedEvent>();

  for (const event of events) {
    const fp = eventFingerprint(event);
    const existing = seen.get(fp);

    if (!existing) {
      seen.set(fp, event);
    } else {
      // Keep the event with the higher sequence number (more recent schema)
      if (event.seq > existing.seq) {
        seen.set(fp, event);
      }
    }
  }

  // Return in timestamp order
  return [...seen.values()].sort((a, b) => a.ts - b.ts);
}

function eventFingerprint(event: NormalizedEvent): string {
  const tsWindow = Math.floor(event.ts / 1000); // 1-second window

  switch (event.type) {
    case "msg.in":
    case "msg.out": {
      const contentHash = simpleHash(event.payload.content ?? "");
      return `${event.type}:${event.agent}:${tsWindow}:${contentHash}`;
    }
    case "tool.call": {
      const paramsHash = simpleHash(JSON.stringify(event.payload.toolParams ?? {}));
      return `${event.type}:${event.agent}:${event.payload.toolName}:${tsWindow}:${paramsHash}`;
    }
    case "tool.result": {
      const toolName = event.payload.toolName ?? "";
      return `tool.result:${event.agent}:${toolName}:${tsWindow}`;
    }
    default:
      // Session lifecycle events — use exact type + timestamp
      return `${event.type}:${event.agent}:${event.ts}`;
  }
}

/** Fast non-crypto hash for dedup fingerprinting. */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < Math.min(str.length, 200); i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
```

### 6.4 Chain ID Computation (implements R-034)

```typescript
import { createHash } from "node:crypto";

async function computeChainId(session: string, agent: string, firstTs: number): Promise<string> {
  const input = `${session}:${agent}:${firstTs}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
```

### 6.5 Sliding Window for Memory Management (implements R-038)

The chain reconstructor processes events in streaming fashion — events arrive via `AsyncIterable` and are bucketed lazily. However, we must cap memory:

1. **Per-bucket cap:** Each `(session, agent)` bucket holds at most `maxEventsPerChain` events. When exceeded, the current chain is flushed to the output array and a new bucket starts.
2. **Bucket eviction:** Buckets that haven't received events for `gapMinutes * 2` are closed and flushed. Checked every 10,000 events.
3. **Total event cap:** Track total buffered events. If exceeding 200,000, flush all buckets with >50 events and emit chains.

This ensures memory stays bounded regardless of input size, satisfying R-038's 500 MB limit for 255k events.

### 6.6 `ConversationChain` Type

```typescript
// In chain-reconstructor.ts

export type ConversationChain = {
  /** Deterministic chain ID: first 16 hex chars of SHA-256("session:agent:firstTs"). */
  id: string;
  /** Agent ID (e.g., "main", "forge", "viola"). */
  agent: string;
  /** Normalized session key. */
  session: string;
  /** Timestamp of first event (ms). */
  startTs: number;
  /** Timestamp of last event (ms). */
  endTs: number;
  /** Ordered events in this chain. */
  events: NormalizedEvent[];
  /** Event count per type (for quick filtering). */
  typeCounts: Partial<Record<AnalyzerEventType, number>>;
  /** How the chain boundary was determined. */
  boundaryType: "lifecycle" | "gap" | "time_range" | "memory_cap";
};
```

---

## 7. Signal Detector Contracts & Algorithms

Implements R-008, R-009.

### 7.0 Detector Contract

Every detector is a **pure function** with this signature:

```typescript
type SignalDetector = (chain: ConversationChain) => FailureSignal[];
```

- Input: a single `ConversationChain`
- Output: zero or more `FailureSignal` objects
- **No side effects.** No I/O, no LLM calls, no network. (R-009)
- Exception: `SIG-REPEAT-FAIL` is a cross-session detector with an extra `state` parameter (see §7.5)

### 7.1 SIG-CORRECTION (implements R-008, RFC §5.1)

**Algorithm:**

```
for each consecutive pair (events[i-1], events[i]):
  if events[i-1].type == "msg.out" AND events[i].type == "msg.in":
    userText = events[i].payload.content
    agentText = events[i-1].payload.content

    if userText matches CORRECTION_PATTERNS:
      // Exclusion: agent asked a question → "nein" is a valid answer
      if agentText matches QUESTION_PATTERNS AND userText is short negative:
        skip

      emit FailureSignal {
        signal: "SIG-CORRECTION",
        severity: "medium",
        eventRange: { start: i-1, end: i },
        summary: "User corrected agent after: '{agentText[0..80]}'"
        evidence: { agentMessage, userCorrection }
      }
```

**Correction patterns** (bilingual DE/EN):

```typescript
const CORRECTION_PATTERNS: RegExp[] = [
  // German
  /\b(?:nein|falsch|stop|nicht das|das ist falsch|so nicht|das stimmt nicht|du hast dich geirrt)\b/i,
  /\b(?:stopp|halt|vergiss das|das war falsch|korrektur|nochmal|das meine ich nicht)\b/i,
  // English
  /\b(?:wrong|that's not right|incorrect|no that's|you're wrong|that's wrong|fix that|undo)\b/i,
  /\b(?:actually no|wait no|not what i asked|not what i meant)\b/i,
];
```

**Question exclusion patterns:**

```typescript
const QUESTION_PATTERNS: RegExp[] = [
  /\?$/m,  // Ends with question mark
  /\b(?:soll ich|shall i|should i|möchtest du|do you want|willst du|darf ich)\b/i,
  /\b(?:ist das ok|is that ok|okay so|passt das)\b/i,
];
```

**Short negative check:** If the user's entire response (trimmed) is `≤ 10 chars` and matches `/^(?:nein|no|nope|stop|halt)$/i`, and the agent's message matches `QUESTION_PATTERNS`, it's a valid response not a correction.

### 7.2 SIG-TOOL-FAIL (implements R-008, RFC §5.2)

**Algorithm:**

```
for each tool.call at index i, where events[i+1].type == "tool.result":
  if events[i+1].payload.toolError OR events[i+1].payload.toolIsError:
    // Scan forward: is there a recovery attempt before the next msg.out?
    recovered = false
    for j = i+2 to end:
      if events[j].type == "msg.out":
        break  // Agent responded — check if recovered
      if events[j].type == "tool.call":
        // Different tool or different params? That's a recovery attempt.
        if events[j].payload.toolName != events[i].payload.toolName
           OR !paramsSimilar(events[j].payload.toolParams, events[i].payload.toolParams):
          // Check if THIS recovery call succeeded
          if events[j+1]?.type == "tool.result" && !events[j+1].payload.toolError:
            recovered = true
            break

    if NOT recovered:
      emit FailureSignal {
        signal: "SIG-TOOL-FAIL",
        severity: "low",
        eventRange: { start: i, end: i+1 },
        summary: "Unrecovered tool failure: {toolName} — {error[0..100]}",
        evidence: { toolName, params, error }
      }
```

**Recovery heuristic:** A subsequent tool call counts as a "recovery attempt" if:
1. It uses a **different tool name**, OR
2. It uses the **same tool** but with **substantially different parameters** (similarity < 0.5)

If the recovery attempt succeeds (tool.result has no error), the original failure is NOT flagged.

### 7.3 SIG-DOOM-LOOP (implements R-008, RFC §5.3)

**Algorithm:**

```
Extract all (tool.call, tool.result) pairs as ToolAttempt[]
Sliding window scan:
  anchor = first failed attempt
  count = 1
  for each subsequent attempt:
    if same tool AND paramSimilarity > 0.8 AND also failed:
      count++
    else:
      break  // Loop broken
  if count >= 3:
    emit FailureSignal {
      signal: "SIG-DOOM-LOOP",
      severity: count >= 5 ? "critical" : "high",
      eventRange: { start: anchor.callIdx, end: lastInLoop.resultIdx },
      summary: "Doom loop: {count}× {toolName} with similar params, all failing",
      evidence: { toolName, loopSize: count, firstError, params }
    }
```

**Similarity computation:**

```typescript
function paramSimilarity(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  // Special case for `exec` tool: compare command strings
  const aCmd = typeof a.command === "string" ? a.command : "";
  const bCmd = typeof b.command === "string" ? b.command : "";
  if (aCmd && bCmd) {
    return levenshteinRatio(aCmd, bCmd);
  }

  // Generic: Jaccard similarity on stringified key-value pairs
  const aEntries = new Set(
    Object.entries(a)
      .filter(([k]) => k !== "timeout") // ignore timing params
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`),
  );
  const bEntries = new Set(
    Object.entries(b)
      .filter(([k]) => k !== "timeout")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`),
  );
  const intersection = [...aEntries].filter(x => bEntries.has(x)).length;
  const union = new Set([...aEntries, ...bEntries]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Levenshtein ratio: 1.0 = identical, 0.0 = completely different. */
function levenshteinRatio(a: string, b: string): number {
  // Cap at 500 chars to keep O(n²) bounded
  const sa = a.slice(0, 500);
  const sb = b.slice(0, 500);
  const maxLen = Math.max(sa.length, sb.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshteinDistance(sa, sb) / maxLen;
}
```

A simple Levenshtein implementation (~30 lines, standard DP) is included inline.

### 7.4 SIG-DISSATISFIED (implements R-008, RFC §5.4)

**Algorithm:**

```
// Look at the LAST user message in the chain
for i = chain.events.length - 1 downto 0:
  if events[i].type == "msg.in":
    lastUserMsg = events[i]
    break

if lastUserMsg:
  text = lastUserMsg.payload.content
  if text matches DISSATISFACTION_PATTERNS:
    // Verify: is this actually the end of the session?
    // Check if there's no subsequent msg.out with resolution
    hasResolution = false
    for j = indexOf(lastUserMsg) + 1 to end:
      if events[j].type == "msg.out":
        // Agent responded after dissatisfaction — check if it's a resolution
        responseText = events[j].payload.content
        if responseText matches RESOLUTION_PATTERNS:
          hasResolution = true
          break

    if NOT hasResolution:
      // Also check: is this near the chain end? (last 3 events)
      if indexOf(lastUserMsg) >= chain.events.length - 3:
        emit FailureSignal {
          signal: "SIG-DISSATISFIED",
          severity: "high",
          eventRange: { start: indexOf(lastUserMsg), end: chain.events.length - 1 },
          summary: "Session ended with user dissatisfaction: '{text[0..80]}'",
          evidence: { userMessage: text }
        }
```

**Dissatisfaction patterns:**

```typescript
const DISSATISFACTION_PATTERNS: RegExp[] = [
  // German
  /\b(?:vergiss es|lass gut sein|lassen wir das|ich mach.s selbst|egal|schon gut|nicht hilfreich)\b/i,
  /\b(?:das bringt nichts|hoffnungslos|sinnlos|unmöglich|du kannst das nicht)\b/i,
  // English
  /\b(?:forget it|never mind|nevermind|i'?ll do it myself|this is useless|pointless|hopeless)\b/i,
  /\b(?:you can't do this|not helpful|waste of time|give up|doesn't work)\b/i,
];

const RESOLUTION_PATTERNS: RegExp[] = [
  /\b(?:entschuldigung|sorry|I apologize|lass mich|let me try|here's another|versuch ich)\b/i,
];
```

**Exclude satisfaction phrases:** `danke`, `passt`, `gut`, `thanks`, `perfect`, `great` → NOT dissatisfaction.

### 7.5 SIG-REPEAT-FAIL (implements R-008, RFC §5.5)

This is the only **cross-session** detector. It requires persistent state (fingerprint index).

**Interface:**

```typescript
export type RepeatFailState = {
  /** fingerprint → { count, lastSeenTs, sessions: string[] } */
  fingerprints: Map<string, {
    count: number;
    lastSeenTs: number;
    sessions: string[];
    toolName: string;
    errorPreview: string;
  }>;
};

export function detectRepeatFails(
  chain: ConversationChain,
  state: RepeatFailState,
): FailureSignal[] {
  // ...
}
```

**Algorithm:**

```
for each (tool.call → tool.result) pair in chain where tool.result has error:
  fingerprint = computeToolFailFingerprint(toolName, params, error)

  if state.fingerprints.has(fingerprint):
    entry = state.fingerprints.get(fingerprint)
    if chain.session NOT IN entry.sessions:
      // Same failure in a DIFFERENT session → repeat fail
      entry.count++
      entry.lastSeenTs = max(entry.lastSeenTs, event.ts)
      entry.sessions.push(chain.session)

      if entry.count >= 2:
        emit FailureSignal {
          signal: "SIG-REPEAT-FAIL",
          severity: entry.count >= 3 ? "critical" : "high",
          eventRange: { start: toolCallIdx, end: toolResultIdx },
          summary: "Same failure repeated across {count} sessions: {toolName} — {error[0..80]}",
          evidence: { toolName, fingerprint, count: entry.count, sessions: entry.sessions }
        }
  else:
    state.fingerprints.set(fingerprint, {
      count: 1,
      lastSeenTs: event.ts,
      sessions: [chain.session],
      toolName, errorPreview: error[0..200]
    })
```

**Fingerprint computation:**

```typescript
function computeToolFailFingerprint(
  toolName: string,
  params: Record<string, unknown>,
  error: string,
): string {
  // Normalize: strip timestamps, PIDs, sequence numbers, paths with dates
  const normalizedError = error
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, "<TIMESTAMP>")
    .replace(/\bpid[= ]\d+/gi, "pid=<PID>")
    .replace(/\bseq[= ]\d+/gi, "seq=<SEQ>")
    .replace(/\/tmp\/[^\s]+/g, "/tmp/<PATH>")
    .trim()
    .slice(0, 200);

  // Normalize params: remove volatile fields
  const stableParams = { ...params };
  delete stableParams.timeout;
  delete stableParams.timestamp;

  const input = `${toolName}|${JSON.stringify(stableParams)}|${normalizedError}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
```

**State persistence:** The `RepeatFailState.fingerprints` map is serialized as part of `trace-analyzer-state.json` (R-012). Bounded to 10,000 entries with LRU eviction (oldest `lastSeenTs` dropped first).

### 7.6 SIG-HALLUCINATION (implements R-008, RFC §5.6)

**Algorithm:**

```
for each msg.out at index i:
  content = events[i].payload.content
  if content matches COMPLETION_CLAIMS:
    // Check: did the LAST tool result before this msg.out fail?
    lastToolResult = scan backward from i for type == "tool.result"
    if lastToolResult AND (lastToolResult.payload.toolError OR lastToolResult.payload.toolIsError):
      emit FailureSignal {
        signal: "SIG-HALLUCINATION",
        severity: "critical",
        eventRange: { start: indexOf(lastToolResult) - 1, end: i },
        summary: "Agent claimed completion despite tool failure: '{content[0..100]}'",
        evidence: {
          agentClaim: content[0..300],
          precedingError: lastToolResult.payload.toolError[0..200],
          toolName: lastToolResult.payload.toolName
        }
      }
```

**Completion claim patterns:**

```typescript
const COMPLETION_CLAIMS: RegExp[] = [
  // German
  /\b(?:erledigt|erfolg(?:reich)?|fertig|gemacht|deployed|gefixt|gelöst|abgeschlossen)\b/i,
  /(?:✅|✓|☑)/,
  /\bhabe ich (?:jetzt |nun )?(?:gemacht|erledigt|deployed|gefixt)/i,
  // English
  /\b(?:done|success(?:fully)?|completed|fixed|resolved|deployed|finished)\b/i,
  /\bi(?:'ve| have) (?:just |now )?(?:done|completed|deployed|fixed|resolved)\b/i,
  /\bit(?:'s| is|has been) (?:now )?(?:done|deployed|fixed|live|running)\b/i,
];
```

**NOT completion (exclusion):** Questions like `"Is it done?"`, `"Soll ich deployen?"` — check for question mark or question patterns in the same sentence.

### 7.7 SIG-UNVERIFIED-CLAIM (implements R-008, RFC §5.7)

**Algorithm:**

```
for each msg.out at index i:
  content = events[i].payload.content
  if content matches FACTUAL_CLAIM_PATTERNS:
    // Scan backward: was there any tool.call between the preceding msg.in and this msg.out?
    hasToolCall = false
    for j = i-1 downto 0:
      if events[j].type == "msg.in":
        break  // Reached the user's request — no tool call found
      if events[j].type == "tool.call":
        hasToolCall = true
        break

    if NOT hasToolCall:
      emit FailureSignal {
        signal: "SIG-UNVERIFIED-CLAIM",
        severity: "medium",
        eventRange: { start: max(0, i-2), end: i },
        summary: "Agent made factual claim without tool verification: '{content[0..100]}'",
        evidence: { agentClaim: content[0..300] }
      }
```

**Factual claim patterns** (system state assertions that require tool verification):

```typescript
const FACTUAL_CLAIM_PATTERNS: RegExp[] = [
  // Disk/memory/resource claims
  /\b(?:disk usage|speicherplatz|memory|cpu|load) (?:is|ist|beträgt|liegt bei) \d+/i,
  // Service status claims
  /\b(?:service|server|daemon|process) (?:is|ist) (?:running|stopped|active|down)\b/i,
  // File existence claims
  /\b(?:file|datei|config) (?:exists|existiert|is present|ist vorhanden)\b/i,
  // Quantitative claims about systems
  /\bthere (?:are|is) \d+ (?:errors|warnings|connections|processes|files)\b/i,
  /\bes gibt \d+ (?:fehler|warnungen|verbindungen|prozesse|dateien)\b/i,
];
```

**Exclusions:**
- Conversational claims (`"I think"`, `"ich glaube"`) — opinions, not factual assertions
- Claims about the conversation itself (`"We discussed 3 topics"`)
- Claims within code blocks (analysis output, not assertions about system state)

### 7.8 Signal Registry

```typescript
// src/trace-analyzer/signals/index.ts

import type { ConversationChain } from "../chain-reconstructor.js";
import type { FailureSignal, Finding, SignalId, Severity } from "./types.js";
import type { TraceAnalyzerConfig } from "../config.js";
import { detectCorrections } from "./correction.js";
import { detectToolFails } from "./tool-fail.js";
import { detectDoomLoops } from "./doom-loop.js";
import { detectDissatisfied } from "./dissatisfied.js";
import { detectRepeatFails, type RepeatFailState } from "./repeat-fail.js";
import { detectHallucinations } from "./hallucination.js";
import { detectUnverifiedClaims } from "./unverified-claim.js";
import { randomUUID } from "node:crypto";

type DetectorEntry = {
  id: SignalId;
  fn: (chain: ConversationChain) => FailureSignal[];
};

const DETECTORS: DetectorEntry[] = [
  { id: "SIG-CORRECTION", fn: detectCorrections },
  { id: "SIG-TOOL-FAIL", fn: detectToolFails },
  { id: "SIG-DOOM-LOOP", fn: detectDoomLoops },
  { id: "SIG-DISSATISFIED", fn: detectDissatisfied },
  { id: "SIG-HALLUCINATION", fn: detectHallucinations },
  { id: "SIG-UNVERIFIED-CLAIM", fn: detectUnverifiedClaims },
];

/**
 * Run all enabled signal detectors across all chains.
 * Returns Finding[] (unclassified).
 */
export function runAllDetectors(
  chains: ConversationChain[],
  signalConfig: TraceAnalyzerConfig["signals"],
  repeatFailState: RepeatFailState,
): Finding[] {
  const findings: Finding[] = [];

  for (const chain of chains) {
    // Run per-chain detectors
    for (const detector of DETECTORS) {
      const config = signalConfig[detector.id];
      if (config && config.enabled === false) continue;

      const signals = detector.fn(chain);
      for (const signal of signals) {
        // Apply severity override from config
        if (config?.severity) {
          signal.severity = config.severity;
        }

        findings.push({
          id: randomUUID(),
          chainId: chain.id,
          agent: chain.agent,
          session: chain.session,
          signal,
          detectedAt: Date.now(),
          occurredAt: chain.events[signal.eventRange.start]?.ts ?? chain.startTs,
          classification: null,
        });
      }
    }

    // Cross-session detector
    const repeatConfig = signalConfig["SIG-REPEAT-FAIL"];
    if (repeatConfig?.enabled !== false) {
      const repeatSignals = detectRepeatFails(chain, repeatFailState);
      for (const signal of repeatSignals) {
        if (repeatConfig?.severity) signal.severity = repeatConfig.severity;
        findings.push({
          id: randomUUID(),
          chainId: chain.id,
          agent: chain.agent,
          session: chain.session,
          signal,
          detectedAt: Date.now(),
          occurredAt: chain.events[signal.eventRange.start]?.ts ?? chain.startTs,
          classification: null,
        });
      }
    }
  }

  return findings;
}
```

---

## 8. Classifier (LLM Stage 2)

Implements R-015, R-017, R-018, R-046, R-047.

### 8.1 Two-Tier Classification Flow

```
                     Finding[]
                         │
                         ▼
              ┌──────────────────────┐
              │  Triage LLM          │  (optional — R-047)
              │  (local/fast model)  │
              │                      │
              │  Input: finding      │
              │  summary + signal ID │
              │                      │
              │  Output: keep/drop   │
              │  + severity adjust   │
              └──────────┬───────────┘
                         │ filtered findings
                         ▼
              ┌──────────────────────┐
              │  Deep Analysis LLM   │
              │  (cloud/capable)     │
              │                      │
              │  Input: full chain   │
              │  (redacted) + signal │
              │                      │
              │  Output: rootCause,  │
              │  actionType,         │
              │  actionText,         │
              │  confidence          │
              └──────────┬───────────┘
                         │ classified findings
                         ▼
                     Finding[] (with classification)
```

### 8.2 LLM Config Resolution (implements R-018, R-031)

```typescript
// src/trace-analyzer/classifier.ts

import type { LlmConfig } from "../llm-enhance.js";
import type { TraceAnalyzerConfig } from "./config.js";

/** Merge analyzer-specific LLM overrides with top-level config. Per-field, not replace. */
function resolveAnalyzerLlmConfig(
  topLevel: LlmConfig,
  override: TraceAnalyzerConfig["llm"],
): LlmConfig {
  if (!override.enabled) {
    return { ...topLevel, enabled: false };
  }
  return {
    enabled: true,
    endpoint: override.endpoint ?? topLevel.endpoint,
    model: override.model ?? topLevel.model,
    apiKey: override.apiKey ?? topLevel.apiKey,
    timeoutMs: override.timeoutMs ?? topLevel.timeoutMs,
    batchSize: 1, // One finding at a time — not batched like thread analysis
  };
}
```

### 8.3 Classification Implementation

```typescript
export async function classifyFindings(
  findings: Finding[],
  chains: Map<string, ConversationChain>,
  config: TraceAnalyzerConfig,
  topLevelLlm: LlmConfig,
  logger: PluginLogger,
): Promise<Finding[]> {
  const llmConfig = resolveAnalyzerLlmConfig(topLevelLlm, config.llm);
  if (!llmConfig.enabled) return findings;

  const result: Finding[] = [];

  for (const finding of findings) {
    // Step 1: Triage (optional)
    if (config.llm.triage) {
      const keep = await triageFinding(finding, config.llm.triage, logger);
      if (!keep) {
        logger.debug(`[trace-analyzer] Triage filtered finding ${finding.id}`);
        continue;
      }
    }

    // Step 2: Deep analysis
    const chain = chains.get(finding.chainId);
    if (!chain) {
      result.push(finding); // No chain context — skip classification
      continue;
    }

    const redactedChain = redactChain(chain, config.redactPatterns);
    const classification = await deepAnalyze(finding, redactedChain, llmConfig, logger);
    result.push({
      ...finding,
      classification,
    });
  }

  return result;
}
```

### 8.4 HTTP Call Pattern

Reuses the same `node:http`/`node:https` pattern from `llm-enhance.ts`:

```typescript
function callLlmChat(
  config: LlmConfig | TriageLlmConfig,
  messages: Array<{ role: string; content: string }>,
  logger: PluginLogger,
): Promise<string | null> {
  // Same implementation as llm-enhance.ts callLlm():
  // - Construct OpenAI-compatible /chat/completions request
  // - Use node:http or node:https based on URL protocol
  // - Set Authorization header if apiKey provided
  // - Parse response.choices[0].message.content
  // - Graceful timeout handling
  // - Returns null on any failure
}
```

This is intentionally duplicated (not imported from `llm-enhance.ts`) because:
1. The trace analyzer may be extracted to a separate package later
2. The prompts and response parsing are different
3. Avoids coupling the analyzer's LLM interface to the thread tracker's

---

## 9. LLM Prompt Design

### 9.1 Triage Prompt (R-047)

Sent to the fast/local model. Goal: filter false positives, adjust severity.

```typescript
const TRIAGE_SYSTEM_PROMPT = `You are a signal triage system. Given a failure detection summary, decide:
1. Is this a TRUE positive (real failure) or FALSE positive (benign/expected behavior)?
2. If true positive, what severity? (low/medium/high/critical)

Respond ONLY with JSON: {"keep": true|false, "severity": "low|medium|high|critical", "reason": "one sentence"}

Common false positives to watch for:
- User saying "nein" to a question (not a correction)
- Tool errors that the agent intentionally provoked for testing
- Session endings due to timeout, not dissatisfaction
- Tool calls to check status (no claim made, just checking)`;

function buildTriageUserPrompt(finding: Finding): string {
  return `Signal: ${finding.signal.signal}
Detected severity: ${finding.signal.severity}
Summary: ${finding.signal.summary}
Agent: ${finding.agent}
Evidence: ${JSON.stringify(finding.signal.evidence, null, 2)}`;
}
```

### 9.2 Deep Analysis Prompt (R-017)

Sent to the capable model. Goal: root cause analysis + actionable output.

```typescript
const DEEP_ANALYSIS_SYSTEM_PROMPT = `You are analyzing an agent failure trace. Given the full conversation chain and failure signal, produce:

1. **rootCause**: Why did the failure happen? Be specific — name the exact behavior or missing capability.
2. **actionType**: What kind of fix prevents recurrence?
   - "soul_rule": A behavioral directive for the agent's system prompt (e.g., "NEVER do X — instead Y")
   - "governance_policy": A machine-enforced policy rule that blocks/audits specific actions
   - "cortex_pattern": A regex pattern for detecting this situation in real-time
   - "manual_review": Requires human judgment — no automated fix possible
3. **actionText**: The specific rule/policy/pattern text. Be concrete and actionable.
   - For soul_rule: Write in the format "NIEMALS X — stattdessen Y. [Grund: Z]" (German) or "NEVER X — instead Y. [Reason: Z]" (English).
   - For governance_policy: Write the condition and effect as a sentence.
   - For cortex_pattern: Write a regex string.
   - For manual_review: Describe what a human should investigate.
4. **confidence**: How confident are you (0.0–1.0)?

Respond ONLY with valid JSON matching this schema:
{
  "rootCause": "...",
  "actionType": "soul_rule|governance_policy|cortex_pattern|manual_review",
  "actionText": "...",
  "confidence": 0.85
}`;

function buildDeepAnalysisUserPrompt(
  finding: Finding,
  chain: ConversationChain,
): string {
  const transcript = formatChainAsTranscript(chain);

  return `## Failure Signal
Type: ${finding.signal.signal}
Severity: ${finding.signal.severity}
Summary: ${finding.signal.summary}

## Evidence
${JSON.stringify(finding.signal.evidence, null, 2)}

## Full Conversation Chain (${chain.events.length} events, ${chain.agent}@${chain.session})
${transcript}`;
}
```

### 9.3 Chain-to-Transcript Formatter

```typescript
function formatChainAsTranscript(chain: ConversationChain): string {
  const lines: string[] = [];
  for (const event of chain.events) {
    const ts = new Date(event.ts).toISOString();
    switch (event.type) {
      case "msg.in":
        lines.push(`[${ts}] USER: ${truncate(event.payload.content ?? "", 500)}`);
        break;
      case "msg.out":
        lines.push(`[${ts}] AGENT: ${truncate(event.payload.content ?? "", 500)}`);
        break;
      case "tool.call":
        lines.push(`[${ts}] TOOL_CALL: ${event.payload.toolName}(${truncate(JSON.stringify(event.payload.toolParams ?? {}), 300)})`);
        break;
      case "tool.result":
        if (event.payload.toolError) {
          lines.push(`[${ts}] TOOL_ERROR: ${event.payload.toolName} → ${truncate(String(event.payload.toolError), 300)}`);
        } else {
          const resultStr = typeof event.payload.toolResult === "object"
            ? JSON.stringify(event.payload.toolResult)
            : String(event.payload.toolResult ?? "");
          lines.push(`[${ts}] TOOL_OK: ${event.payload.toolName} → ${truncate(resultStr, 300)}`);
        }
        break;
      case "session.start":
        lines.push(`[${ts}] SESSION_START`);
        break;
      case "session.end":
        lines.push(`[${ts}] SESSION_END`);
        break;
      default:
        lines.push(`[${ts}] ${event.type.toUpperCase()}`);
    }
  }
  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}
```

### 9.4 Response Parsing (Graceful Degradation)

```typescript
function parseClassification(
  raw: string | null,
  model: string,
  logger: PluginLogger,
): FindingClassification | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.rootCause !== "string" ||
      typeof parsed.actionType !== "string" ||
      typeof parsed.actionText !== "string"
    ) {
      logger.warn("[trace-analyzer] LLM response missing required fields");
      return null;
    }

    const validTypes = ["soul_rule", "governance_policy", "cortex_pattern", "manual_review"];
    if (!validTypes.includes(parsed.actionType)) {
      logger.warn(`[trace-analyzer] LLM returned unknown actionType: ${parsed.actionType}`);
      parsed.actionType = "manual_review";
    }

    return {
      rootCause: parsed.rootCause,
      actionType: parsed.actionType,
      actionText: parsed.actionText,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      model,
    };
  } catch {
    logger.warn("[trace-analyzer] Failed to parse LLM classification response as JSON");
    return null;
  }
}
```

On parse failure, the finding retains `classification: null` — it still appears in the report as an unclassified structural detection. No data is lost.

---

## 10. Output Generator (Stage 3)

Implements R-019, R-021, R-022, R-023.

### 10.1 SOUL.md Rule Generation (R-021)

```typescript
function generateSoulRules(findings: Finding[]): GeneratedOutput[] {
  const ruleFindings = findings.filter(
    f => f.classification?.actionType === "soul_rule",
  );

  // Group by similar actionText to consolidate
  const grouped = groupByActionText(ruleFindings);

  return grouped.map(group => {
    const primary = group[0].classification!;
    const count = group.length;
    const findingIds = group.map(f => f.id);

    // Format per R-021
    const ruleText = formatSoulRule(primary.actionText, count, findingIds);

    return {
      id: randomUUID(),
      type: "soul_rule" as const,
      content: ruleText,
      sourceFindings: findingIds,
      observationCount: count,
      confidence: average(group.map(f => f.classification!.confidence)),
    };
  });
}

function formatSoulRule(
  actionText: string,
  observationCount: number,
  findingIds: string[],
): string {
  const idRef = findingIds.slice(0, 3).map(id => id.slice(0, 8)).join(", ");
  // R-021 format with observation count and finding references
  return `${actionText} [${observationCount}× beobachtet in Traces, Findings: ${idRef}]`;
}
```

### 10.2 Governance Policy Generation (R-022)

```typescript
function generateGovernancePolicies(findings: Finding[]): GeneratedOutput[] {
  const policyFindings = findings.filter(
    f => f.classification?.actionType === "governance_policy",
  );

  return policyFindings.map(f => {
    const policy = {
      id: `trace-gen-${f.signal.signal.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${f.id.slice(0, 8)}`,
      name: `Auto: ${f.signal.summary.slice(0, 60)}`,
      version: "1.0.0",
      description: `Auto-generated from trace analysis finding ${f.id}. Root cause: ${f.classification!.rootCause}`,
      scope: { hooks: inferHooksFromSignal(f.signal.signal) },
      rules: [{
        id: `rule-${f.id.slice(0, 8)}`,
        description: f.classification!.actionText,
        conditions: inferConditionsFromSignal(f),
        effect: {
          action: "audit" as const,
          reason: f.classification!.actionText,
        },
      }],
    };

    return {
      id: randomUUID(),
      type: "governance_policy" as const,
      content: JSON.stringify(policy, null, 2),
      sourceFindings: [f.id],
      observationCount: 1,
      confidence: f.classification!.confidence,
    };
  });
}

function inferHooksFromSignal(signal: SignalId): string[] {
  switch (signal) {
    case "SIG-DOOM-LOOP":
    case "SIG-TOOL-FAIL":
      return ["before_tool_call"];
    case "SIG-HALLUCINATION":
    case "SIG-UNVERIFIED-CLAIM":
      return ["message_sending"];
    default:
      return ["message_sent"];
  }
}
```

### 10.3 Cortex Pattern Generation (R-023)

```typescript
function generateCortexPatterns(findings: Finding[]): GeneratedOutput[] {
  const patternFindings = findings.filter(
    f => f.classification?.actionType === "cortex_pattern",
  );

  return patternFindings.map(f => {
    return {
      id: randomUUID(),
      type: "cortex_pattern" as const,
      content: f.classification!.actionText, // Should be a regex string from LLM
      sourceFindings: [f.id],
      observationCount: 1,
      confidence: f.classification!.confidence,
    };
  });
}
```

### 10.4 Report Assembly

```typescript
// src/trace-analyzer/report.ts

export function assembleReport(params: {
  startedAt: number;
  completedAt: number;
  eventsProcessed: number;
  chains: ConversationChain[];
  findings: Finding[];
  generatedOutputs: GeneratedOutput[];
  previousState: ProcessingState;
}): AnalysisReport {
  const { startedAt, completedAt, eventsProcessed, chains, findings, generatedOutputs, previousState } = params;

  // Compute signal stats
  const signalStatsMap = new Map<SignalId, SignalStats>();
  for (const finding of findings) {
    const sid = finding.signal.signal;
    let stats = signalStatsMap.get(sid);
    if (!stats) {
      stats = { signal: sid, count: 0, bySeverity: {}, topAgents: [] };
      signalStatsMap.set(sid, stats);
    }
    stats.count++;
    stats.bySeverity[finding.signal.severity] = (stats.bySeverity[finding.signal.severity] ?? 0) + 1;
  }

  // Top agents per signal
  for (const stats of signalStatsMap.values()) {
    const agentCounts = new Map<string, number>();
    for (const f of findings.filter(f => f.signal.signal === stats.signal)) {
      agentCounts.set(f.agent, (agentCounts.get(f.agent) ?? 0) + 1);
    }
    stats.topAgents = [...agentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([agent, count]) => ({ agent, count }));
  }

  // Time range from chains
  const allTs = chains.flatMap(c => [c.startTs, c.endTs]);
  const timeRange = {
    startMs: allTs.length > 0 ? Math.min(...allTs) : 0,
    endMs: allTs.length > 0 ? Math.max(...allTs) : 0,
  };

  // Processing state for incremental runs
  const lastEvent = chains.length > 0
    ? chains.reduce((max, c) => c.endTs > max ? c.endTs : max, 0)
    : previousState.lastProcessedTs ?? 0;

  const processingState: ProcessingState = {
    lastProcessedTs: lastEvent,
    lastProcessedSeq: 0, // Updated by NatsTraceSource during fetch
    totalEventsProcessed: (previousState.totalEventsProcessed ?? 0) + eventsProcessed,
    totalFindings: (previousState.totalFindings ?? 0) + findings.length,
    updatedAt: new Date().toISOString(),
  };

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    stats: {
      startedAt,
      completedAt,
      eventsProcessed,
      chainsReconstructed: chains.length,
      findingsDetected: findings.length,
      findingsClassified: findings.filter(f => f.classification !== null).length,
      outputsGenerated: generatedOutputs.length,
      timeRange,
    },
    signalStats: [...signalStatsMap.values()],
    findings,
    generatedOutputs,
    ruleEffectiveness: [], // Populated in subsequent runs (R-040)
    processingState,
  };
}
```

---

## 11. Redaction Pipeline

Implements R-011, R-035, R-036.

### 11.1 Redaction Order

Redaction is applied **before** any Finding is:
1. Sent to the LLM (classifier.ts)
2. Written to the analysis report (report.ts)
3. Written to generated outputs (output-generator.ts)

The pipeline processes in this order:
1. Default built-in patterns (API keys, passwords, PEM blocks)
2. Custom patterns from `config.traceAnalyzer.redactPatterns`

### 11.2 Built-in Patterns

```typescript
// src/trace-analyzer/redactor.ts

const BUILTIN_REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys (OpenAI, Stripe, etc.)
  { pattern: /(?:sk-|pk_(?:live|test)_|Bearer\s+)[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED_API_KEY]" },

  // Passwords in URLs: ://user:password@host
  { pattern: /:\/\/([^:]+):([^@]+)@/g, replacement: "://$1:[REDACTED]@" },

  // Environment variable values with sensitive names
  { pattern: /(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY)=\S+/gi, replacement: "$&".replace(/=\S+/, "=[REDACTED]") },
  // More precise version:
  { pattern: /((?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY)\s*=\s*)\S+/gi, replacement: "$1[REDACTED]" },

  // PEM key blocks
  { pattern: /-----BEGIN [A-Z ]*(?:PRIVATE |RSA )?KEY-----[\s\S]*?-----END [A-Z ]*KEY-----/g, replacement: "[REDACTED_PEM_BLOCK]" },

  // GitHub tokens
  { pattern: /gh[ps]_[A-Za-z0-9]{36,}/g, replacement: "[REDACTED_GH_TOKEN]" },

  // SSH private key content (not in PEM block)
  { pattern: /(?:AAAA[A-Za-z0-9+/]{40,})/g, replacement: "[REDACTED_SSH_KEY]" },

  // JWT tokens
  { pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED_JWT]" },
];
```

### 11.3 Redaction Functions

```typescript
export function redactText(
  text: string,
  customPatterns: string[],
): string {
  let result = text;

  // Apply built-in patterns
  for (const { pattern, replacement } of BUILTIN_REDACT_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  // Apply custom patterns
  for (const patternStr of customPatterns) {
    try {
      const regex = new RegExp(patternStr, "g");
      result = result.replace(regex, "[REDACTED]");
    } catch {
      // Invalid regex — skip (logged once at config load time)
    }
  }

  return result;
}

export function redactChain(
  chain: ConversationChain,
  customPatterns: string[],
): ConversationChain {
  return {
    ...chain,
    events: chain.events.map(event => ({
      ...event,
      payload: redactPayload(event.payload, customPatterns),
    })),
  };
}

function redactPayload(
  payload: NormalizedPayload,
  customPatterns: string[],
): NormalizedPayload {
  return {
    ...payload,
    content: payload.content ? redactText(payload.content, customPatterns) : undefined,
    toolError: payload.toolError ? redactText(payload.toolError, customPatterns) : undefined,
    toolResult: payload.toolResult ? redactUnknown(payload.toolResult, customPatterns) : undefined,
    toolParams: payload.toolParams ? redactRecord(payload.toolParams, customPatterns) : undefined,
    from: payload.from ? redactText(payload.from, customPatterns) : undefined,
  };
}

function redactUnknown(value: unknown, customPatterns: string[]): unknown {
  if (typeof value === "string") return redactText(value, customPatterns);
  if (typeof value === "object" && value !== null) {
    return JSON.parse(redactText(JSON.stringify(value), customPatterns));
  }
  return value;
}

function redactRecord(
  record: Record<string, unknown>,
  customPatterns: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = redactUnknown(value, customPatterns);
  }
  return result;
}
```

---

## 12. Config Resolution

Implements R-028, R-029, R-030, R-031.

### 12.1 Default Config

```typescript
// src/trace-analyzer/config.ts

import type { SignalId, Severity } from "./signals/types.js";

export type TraceAnalyzerConfig = {
  enabled: boolean;
  nats: {
    url: string;
    stream: string;
    subjectPrefix: string;
    credentials?: string;
    user?: string;
    password?: string;
  };
  schedule: {
    enabled: boolean;
    intervalHours: number;
  };
  chainGapMinutes: number;
  signals: Partial<Record<SignalId, { enabled: boolean; severity?: Severity }>>;
  llm: {
    enabled: boolean;
    endpoint?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    triage?: {
      endpoint: string;
      model: string;
      apiKey?: string;
      timeoutMs?: number;
    };
  };
  output: {
    maxFindings: number;
    reportPath?: string;
  };
  redactPatterns: string[];
  incrementalContextWindow: number;
  fetchBatchSize: number;
  maxEventsPerRun: number;
};

export const TRACE_ANALYZER_DEFAULTS: TraceAnalyzerConfig = {
  enabled: false,   // R-028: opt-in
  nats: {
    url: "nats://localhost:4222",
    stream: "openclaw-events",
    subjectPrefix: "openclaw.events",
  },
  schedule: {
    enabled: false,
    intervalHours: 24,
  },
  chainGapMinutes: 30,
  signals: {
    "SIG-CORRECTION":      { enabled: true },
    "SIG-TOOL-FAIL":       { enabled: true },
    "SIG-DOOM-LOOP":       { enabled: true },
    "SIG-DISSATISFIED":    { enabled: true },
    "SIG-REPEAT-FAIL":     { enabled: true },
    "SIG-HALLUCINATION":   { enabled: true },
    "SIG-UNVERIFIED-CLAIM": { enabled: false }, // RFC §18 Q2: disabled by default
  },
  llm: {
    enabled: false,
  },
  output: {
    maxFindings: 200,
  },
  redactPatterns: [],
  incrementalContextWindow: 500,
  fetchBatchSize: 500,
  maxEventsPerRun: 100_000,  // RFC §18 Q6
};
```

### 12.2 Config Resolver

Follows the same pattern as `resolveConfig()` in `src/config.ts`: typed extractors with fallbacks.

```typescript
export function resolveTraceAnalyzerConfig(
  raw?: Record<string, unknown>,
): TraceAnalyzerConfig {
  if (!raw) return { ...TRACE_ANALYZER_DEFAULTS };

  const natsRaw = (raw.nats ?? {}) as Record<string, unknown>;
  const schedRaw = (raw.schedule ?? {}) as Record<string, unknown>;
  const llmRaw = (raw.llm ?? {}) as Record<string, unknown>;
  const outRaw = (raw.output ?? {}) as Record<string, unknown>;
  const signalsRaw = (raw.signals ?? {}) as Record<string, unknown>;
  const triageRaw = (llmRaw.triage ?? undefined) as Record<string, unknown> | undefined;

  return {
    enabled: bool(raw.enabled, TRACE_ANALYZER_DEFAULTS.enabled),
    nats: {
      url: str(natsRaw.url, TRACE_ANALYZER_DEFAULTS.nats.url),
      stream: str(natsRaw.stream, TRACE_ANALYZER_DEFAULTS.nats.stream),
      subjectPrefix: str(natsRaw.subjectPrefix, TRACE_ANALYZER_DEFAULTS.nats.subjectPrefix),
      credentials: optStr(natsRaw.credentials),
      user: optStr(natsRaw.user),
      password: optStr(natsRaw.password),
    },
    schedule: {
      enabled: bool(schedRaw.enabled, TRACE_ANALYZER_DEFAULTS.schedule.enabled),
      intervalHours: int(schedRaw.intervalHours, TRACE_ANALYZER_DEFAULTS.schedule.intervalHours),
    },
    chainGapMinutes: int(raw.chainGapMinutes, TRACE_ANALYZER_DEFAULTS.chainGapMinutes),
    signals: resolveSignalConfig(signalsRaw),
    llm: {
      enabled: bool(llmRaw.enabled, TRACE_ANALYZER_DEFAULTS.llm.enabled),
      endpoint: optStr(llmRaw.endpoint),
      model: optStr(llmRaw.model),
      apiKey: optStr(llmRaw.apiKey),
      timeoutMs: optInt(llmRaw.timeoutMs),
      triage: triageRaw ? {
        endpoint: str(triageRaw.endpoint, ""),
        model: str(triageRaw.model, ""),
        apiKey: optStr(triageRaw.apiKey),
        timeoutMs: optInt(triageRaw.timeoutMs),
      } : undefined,
    },
    output: {
      maxFindings: int(outRaw.maxFindings, TRACE_ANALYZER_DEFAULTS.output.maxFindings),
      reportPath: optStr(outRaw.reportPath),
    },
    redactPatterns: strArr(raw.redactPatterns) ?? [],
    incrementalContextWindow: int(raw.incrementalContextWindow, TRACE_ANALYZER_DEFAULTS.incrementalContextWindow),
    fetchBatchSize: int(raw.fetchBatchSize, TRACE_ANALYZER_DEFAULTS.fetchBatchSize),
    maxEventsPerRun: int(raw.maxEventsPerRun, TRACE_ANALYZER_DEFAULTS.maxEventsPerRun),
  };
}

// Helper functions (same style as src/config.ts)
function bool(v: unknown, d: boolean): boolean { return typeof v === "boolean" ? v : d; }
function int(v: unknown, d: number): number { return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d; }
function str(v: unknown, d: string): string { return typeof v === "string" ? v : d; }
function optStr(v: unknown): string | undefined { return typeof v === "string" ? v : undefined; }
function optInt(v: unknown): number | undefined { return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined; }
function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((s): s is string => typeof s === "string");
}
```

### 12.3 Integration with Existing Config

In `src/types.ts`, extend `CortexConfig`:

```typescript
// Addition to CortexConfig
export type CortexConfig = {
  // ... existing fields ...
  traceAnalyzer: TraceAnalyzerConfig;
};
```

In `src/config.ts`, extend `DEFAULTS` and `resolveConfig()`:

```typescript
import { TRACE_ANALYZER_DEFAULTS, resolveTraceAnalyzerConfig } from "./trace-analyzer/config.js";

export const DEFAULTS: CortexConfig = {
  // ... existing defaults ...
  traceAnalyzer: TRACE_ANALYZER_DEFAULTS,
};

export function resolveConfig(pluginConfig?: Record<string, unknown>): CortexConfig {
  const raw = pluginConfig ?? {};
  // ... existing resolution ...
  const ta = (raw.traceAnalyzer ?? {}) as Record<string, unknown>;

  return {
    // ... existing fields ...
    traceAnalyzer: resolveTraceAnalyzerConfig(ta),
  };
}
```

The external config file (`~/.openclaw/plugins/openclaw-cortex/config.json`) already loads the full config object — adding a `traceAnalyzer` key is purely additive (R-014).

---

## 13. Error Handling

All error handling follows Cortex's established pattern: **never throw from hook handlers, never block agent operations, log and continue.**

| Scenario | Module | Behavior | Recovery |
|----------|--------|----------|----------|
| `nats` not installed | `nats-trace-source.ts` | `createNatsTraceSource()` returns `null` | Module deactivates, rest of Cortex unaffected (R-013) |
| NATS connection fails | `nats-trace-source.ts` | `createNatsTraceSource()` returns `null` with warning | Same as above |
| NATS drops mid-fetch | `nats-trace-source.ts` | `AsyncIterable` throws, caught in `analyzer.ts` | Partial state persisted, next run resumes (R-043) |
| Event JSON parse fails | `nats-trace-source.ts` | Event skipped, `msg.ack()` called | Chain reconstructor works with remaining events |
| Unknown event type | `events.ts` `mapEventType()` | Returns `null`, event filtered out | Silent skip — non-analyzer-relevant events ignored |
| Chain has <2 events | `chain-reconstructor.ts` | Chain not emitted | Trivial chains can't have meaningful signals |
| Detector throws | `signals/index.ts` | Try-catch per detector, log warning | Other detectors continue, partial findings emitted |
| LLM endpoint down | `classifier.ts` | `callLlmChat()` returns `null` | Finding keeps `classification: null`, appears unclassified in report |
| LLM returns bad JSON | `classifier.ts` | `parseClassification()` returns `null` | Same as above |
| Invalid redact pattern | `redactor.ts` | Pattern skipped with warning | Other patterns still applied |
| Workspace not writable | `analyzer.ts` | `saveJson()` returns `false` | Report returned in memory (from command handler) |
| Memory pressure | `chain-reconstructor.ts` | Sliding window evicts old buckets | Chains bounded by `maxEventsPerChain` |
| Run exceeds `maxEventsPerRun` | `analyzer.ts` | Stop fetching after limit | State saved at limit point, next run continues |

### Error Boundary in Hooks Registration

```typescript
// src/trace-analyzer/hooks-registration.ts

export function registerTraceAnalyzerHooks(
  api: OpenClawPluginApi,
  config: CortexConfig,
  state: HookState,
): void {
  if (!config.traceAnalyzer.enabled) return; // R-013

  // Register /trace-analyze command
  api.registerCommand({
    name: "trace-analyze",
    description: "Run trace analysis on historical events",
    handler: async (args) => {
      try {
        const source = await createNatsTraceSource(config.traceAnalyzer.nats, api.logger);
        if (!source) {
          return { text: "❌ Trace analysis unavailable — NATS not configured or `nats` package not installed." };
        }

        const workspace = resolveWorkspace(config, state.workspace ? { workspaceDir: state.workspace } : undefined);
        const analyzer = new TraceAnalyzer(source, config.traceAnalyzer, config.llm, workspace, api.logger);

        const full = args?.full === true || args?.full === "true";
        const report = await analyzer.run({ full });
        await source.close();

        return {
          text: formatReportSummary(report),
        };
      } catch (err) {
        api.logger.warn(`[trace-analyzer] Analysis run failed: ${err}`);
        return { text: `❌ Trace analysis failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // Register /trace-status command
  api.registerCommand({
    name: "trace-status",
    description: "Show trace analyzer status and last run stats",
    handler: () => {
      try {
        const workspace = resolveWorkspace(config, state.workspace ? { workspaceDir: state.workspace } : undefined);
        const statePath = join(workspace, "memory", "reboot", "trace-analyzer-state.json");
        const processingState = loadJson<ProcessingState>(statePath);

        if (!processingState.updatedAt) {
          return { text: "ℹ️ Trace analyzer has not run yet." };
        }

        return {
          text: [
            `📊 **Trace Analyzer Status**`,
            `Last run: ${processingState.updatedAt}`,
            `Total events processed: ${processingState.totalEventsProcessed}`,
            `Total findings: ${processingState.totalFindings}`,
            `Last processed timestamp: ${new Date(processingState.lastProcessedTs).toISOString()}`,
          ].join("\n"),
        };
      } catch (err) {
        return { text: `❌ Cannot read trace analyzer state: ${err}` };
      }
    },
  });

  // Optional: scheduled runs
  if (config.traceAnalyzer.schedule.enabled) {
    const intervalMs = config.traceAnalyzer.schedule.intervalHours * 60 * 60 * 1000;
    setInterval(async () => {
      api.logger.info("[trace-analyzer] Starting scheduled analysis run");
      try {
        const source = await createNatsTraceSource(config.traceAnalyzer.nats, api.logger);
        if (!source) return;

        const workspace = resolveWorkspace(config, state.workspace ? { workspaceDir: state.workspace } : undefined);
        const analyzer = new TraceAnalyzer(source, config.traceAnalyzer, config.llm, workspace, api.logger);
        await analyzer.run();
        await source.close();
        api.logger.info("[trace-analyzer] Scheduled analysis run completed");
      } catch (err) {
        api.logger.warn(`[trace-analyzer] Scheduled run failed: ${err}`);
      }
    }, intervalMs);
  }

  api.logger.info(
    `[cortex] Trace analyzer registered — schedule:${config.traceAnalyzer.schedule.enabled}` +
    ` signals:${Object.entries(config.traceAnalyzer.signals).filter(([, v]) => v?.enabled !== false).length}/7` +
    ` llm:${config.traceAnalyzer.llm.enabled}`,
  );
}
```

---

## 14. Testing Plan

### 14.1 Test Helpers & Fixtures

```typescript
// test/trace-analyzer/helpers.ts

import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../src/trace-analyzer/chain-reconstructor.js";

let seqCounter = 1;
let tsCounter = 1700000000000; // Arbitrary base timestamp

/** Create a NormalizedEvent for testing. */
export function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    id: `test-${seqCounter}`,
    ts: tsCounter += 1000, // 1 second between events
    agent: "main",
    session: "test-session",
    type,
    payload: {
      content: undefined,
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

/** Create a ConversationChain from an array of events. */
export function makeChain(
  events: NormalizedEvent[],
  overrides: Partial<ConversationChain> = {},
): ConversationChain {
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }

  return {
    id: `chain-${events[0]?.seq ?? 0}`,
    agent: events[0]?.agent ?? "main",
    session: events[0]?.session ?? "test-session",
    startTs: events[0]?.ts ?? 0,
    endTs: events[events.length - 1]?.ts ?? 0,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

/** Reset counters between tests. */
export function resetCounters(): void {
  seqCounter = 1;
  tsCounter = 1700000000000;
}

// Common event sequence builders

/** Build a successful tool call + result pair. */
export function makeToolSuccess(
  toolName: string,
  params: Record<string, unknown> = {},
  result: unknown = { exitCode: 0 },
): NormalizedEvent[] {
  return [
    makeEvent("tool.call", { toolName, toolParams: params }),
    makeEvent("tool.result", { toolName, toolParams: params, toolResult: result }),
  ];
}

/** Build a failed tool call + result pair. */
export function makeToolFailure(
  toolName: string,
  params: Record<string, unknown> = {},
  error: string = "Command failed",
): NormalizedEvent[] {
  return [
    makeEvent("tool.call", { toolName, toolParams: params }),
    makeEvent("tool.result", { toolName, toolParams: params, toolError: error, toolIsError: true }),
  ];
}
```

### 14.2 Mock TraceSource

```typescript
// test/trace-analyzer/mock-trace-source.ts

import type { TraceSource, FetchOpts } from "../../src/trace-analyzer/trace-source.js";
import type { NormalizedEvent } from "../../src/trace-analyzer/events.js";

/**
 * In-memory TraceSource for testing.
 * Accepts pre-built NormalizedEvent arrays.
 */
export class MockTraceSource implements TraceSource {
  private events: NormalizedEvent[];
  private closed = false;

  constructor(events: NormalizedEvent[]) {
    this.events = [...events].sort((a, b) => a.ts - b.ts);
  }

  async *fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    for (const event of this.events) {
      if (event.ts < startMs) continue;
      if (event.ts > endMs) break;
      if (opts?.eventTypes && !opts.eventTypes.includes(event.type)) continue;
      if (opts?.agents && !opts.agents.includes(event.agent)) continue;
      yield event;
    }
  }

  async *fetchByAgent(
    agent: string,
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<NormalizedEvent> {
    yield* this.fetchByTimeRange(startMs, endMs, { ...opts, agents: [agent] });
  }

  async getLastSequence(): Promise<number> {
    return this.events.length > 0 ? this.events[this.events.length - 1].seq : 0;
  }

  async getEventCount(): Promise<number> {
    return this.events.length;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  isClosed(): boolean { return this.closed; }
}
```

### 14.3 Test Plan Per Module

#### chain-reconstructor.test.ts (~20 tests)

| # | Test | Category |
|---|------|----------|
| 1 | Groups events by (session, agent) into separate chains | Core |
| 2 | Same session, different agents → separate chains | Core |
| 3 | Orders events by timestamp within a chain | Core |
| 4 | Splits chain on `session.start` event | Boundary |
| 5 | Splits chain on `session.end` event | Boundary |
| 6 | Splits chain on inactivity gap > 30 min | Boundary |
| 7 | Does NOT split on gap < 30 min | Boundary negative |
| 8 | Splits on `run.end` → `run.start` with >5 min gap | Boundary |
| 9 | Does NOT split on `run.end` → `run.start` with <5 min gap | Boundary negative |
| 10 | Filters out chains with <2 events | Filter |
| 11 | Deduplicates events with same fingerprint within 1s window | Dedup |
| 12 | Prefers higher seq (Schema A) over lower seq (Schema B) when deduplicating | Dedup |
| 13 | Computes chain ID deterministically | Metadata |
| 14 | Computes typeCounts correctly | Metadata |
| 15 | Caps chain at maxEventsPerChain | Memory |
| 16 | Handles empty event stream | Edge case |
| 17 | Handles single-agent, single-session stream | Edge case |
| 18 | Handles events with session="unknown" | Edge case |
| 19 | Configurable gapMinutes parameter | Config |
| 20 | Multiple agents interleaved in timestamps | Complex |

#### signals/correction.test.ts (~12 tests)

| # | Test |
|---|------|
| 1 | Detects "nein, das ist falsch" after agent assertion |
| 2 | Detects "that's not right" after agent assertion |
| 3 | Does NOT detect "nein" after agent question |
| 4 | Does NOT detect "nein" as standalone response to "Soll ich X tun?" |
| 5 | Detects correction with German keywords |
| 6 | Detects correction with English keywords |
| 7 | Returns empty for clean chain (no corrections) |
| 8 | Multiple corrections in same chain → multiple signals |
| 9 | Severity is "medium" for single correction |
| 10 | Handles empty content gracefully |
| 11 | Does NOT detect "nein" in middle of longer sentence ("nein, ich meine etwas anderes" → IS a correction) |
| 12 | Does NOT detect correction in non-adjacent messages (msg.out → tool.call → msg.in) |

#### signals/tool-fail.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Detects unrecovered tool failure → agent responds without recovery |
| 2 | Does NOT detect failure when agent recovers (different tool call succeeds) |
| 3 | Does NOT detect failure when same tool retried with different params and succeeds |
| 4 | Detects failure when retry with same params also fails |
| 5 | Handles tool.result with `toolIsError=true` (Schema B) |
| 6 | Handles tool.result with `toolError` string (Schema A) |
| 7 | Returns empty for chain with only successful tool calls |
| 8 | Severity is "low" for single occurrence |
| 9 | Multiple unrecovered failures → multiple signals |
| 10 | Does NOT detect failure at chain end (no msg.out follows) |

#### signals/doom-loop.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Detects 3× identical exec failures as doom loop |
| 2 | Detects 5× failures as critical severity |
| 3 | Does NOT detect loop when agent varies approach (different commands) |
| 4 | Does NOT detect loop when 2nd attempt succeeds |
| 5 | Detects loop with similar but not identical params (similarity > 0.8) |
| 6 | Does NOT detect loop with dissimilar params (similarity < 0.8) |
| 7 | Detects loop for non-exec tools (generic Jaccard similarity) |
| 8 | Returns empty for chain with no tool calls |
| 9 | Correctly handles interspersed successful calls between failure loops |
| 10 | Loop of exactly 3 → severity "high", loop of 5+ → severity "critical" |

#### signals/dissatisfied.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Detects "vergiss es" as last user message |
| 2 | Detects "forget it" as last user message |
| 3 | Does NOT detect "danke, passt" (satisfaction) |
| 4 | Does NOT detect dissatisfaction in middle of chain (not session end) |
| 5 | Detects "ich mach's selbst" |
| 6 | Does NOT detect if agent resolves after dissatisfaction |
| 7 | Handles chain with no user messages |
| 8 | Severity is "high" |
| 9 | Detects "this is useless" |
| 10 | Does NOT flag "nein" alone (ambiguous) |

#### signals/repeat-fail.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Detects same tool+params+error across two different sessions |
| 2 | Does NOT flag within same session (that's doom-loop) |
| 3 | Increments count for 3rd session → severity "critical" |
| 4 | Normalizes timestamps in error messages before fingerprinting |
| 5 | Normalizes PIDs in error messages |
| 6 | State persists fingerprints across calls |
| 7 | State evicts oldest entries when exceeding 10,000 |
| 8 | Different params → different fingerprint (no false match) |
| 9 | Same tool, same error, different params → different fingerprint |
| 10 | Returns empty on first-ever run (no previous state) |

#### signals/hallucination.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Detects "Done ✅" after tool error |
| 2 | Detects "erledigt" after tool failure |
| 3 | Does NOT detect "Done" after successful tool result |
| 4 | Does NOT detect question "Is it done?" after tool error |
| 5 | Severity is "critical" |
| 6 | Handles chain with no tool calls (no signal) |
| 7 | Detects "Successfully deployed" after connection failure |
| 8 | Does NOT detect claims in chains without tool results |
| 9 | Handles multiple msg.out — only flags ones following failures |
| 10 | Handles chain where tool.result has no error AND no explicit success field |

#### signals/unverified-claim.test.ts (~8 tests)

| # | Test |
|---|------|
| 1 | Detects "disk usage is at 45%" without preceding tool call |
| 2 | Does NOT detect same claim when preceded by `exec` tool call |
| 3 | Detects "service is running" without tool verification |
| 4 | Does NOT detect conversational claim ("I think...") |
| 5 | Severity is "medium" |
| 6 | Handles claims inside code blocks (skip) |
| 7 | Returns empty for chain with only tool calls and no claims |
| 8 | Does NOT detect claims when ANY tool was called (even different tool) |

#### classifier.test.ts (~15 tests, mocked LLM)

| # | Test |
|---|------|
| 1 | Classifies finding with valid LLM response |
| 2 | Handles LLM returning null (timeout) — finding stays unclassified |
| 3 | Handles LLM returning invalid JSON — finding stays unclassified |
| 4 | Handles LLM returning unknown actionType → defaults to manual_review |
| 5 | Resolves LLM config: analyzer override takes precedence over top-level |
| 6 | Resolves LLM config: falls back to top-level when analyzer override absent |
| 7 | Skips classification when `llm.enabled = false` |
| 8 | Triage filters out findings when triage says `keep: false` |
| 9 | Triage adjusts severity |
| 10 | Triage disabled → all findings go to deep analysis |
| 11 | Redaction is applied before sending chain to LLM |
| 12 | Chain-to-transcript formatting is correct |
| 13 | Handles chain not found in map (returns unclassified) |
| 14 | Confidence defaults to 0.5 if LLM omits it |
| 15 | Model name is recorded in classification |

#### output-generator.test.ts (~12 tests)

| # | Test |
|---|------|
| 1 | Generates SOUL.md rule with correct format (R-021) |
| 2 | Rule includes observation count |
| 3 | Rule includes finding ID references |
| 4 | Groups similar soul_rule findings into single output |
| 5 | Generates governance policy with correct structure (R-022) |
| 6 | Policy has valid `scope.hooks` based on signal type |
| 7 | Generates cortex_pattern output |
| 8 | Handles findings with no classification (skips output generation) |
| 9 | Handles manual_review type (no output generated, appears in report only) |
| 10 | Confidence is averaged for grouped findings |
| 11 | Mixed actionTypes produce correct output types |
| 12 | Returns empty array for empty findings |

#### redactor.test.ts (~12 tests)

| # | Test |
|---|------|
| 1 | Redacts `sk-abc123...` API keys |
| 2 | Redacts `Bearer eyJ...` tokens |
| 3 | Redacts URL passwords: `postgres://user:secret@host` → `postgres://user:[REDACTED]@host` |
| 4 | Redacts PEM key blocks |
| 5 | Redacts GitHub tokens (`ghp_...`) |
| 6 | Redacts JWT tokens |
| 7 | Redacts environment variable values (`PASSWORD=mysecret`) |
| 8 | Custom patterns from config are applied |
| 9 | Invalid custom regex is skipped without crashing |
| 10 | Does NOT redact normal text |
| 11 | `redactChain()` redacts all payload fields |
| 12 | Handles nested tool result objects |

#### report.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Assembles report with correct version field |
| 2 | Stats computed correctly (events, chains, findings) |
| 3 | Signal stats aggregated by signal type |
| 4 | Top agents computed per signal |
| 5 | Time range extracted from chains |
| 6 | Processing state updated correctly |
| 7 | Incremental totals accumulate across runs |
| 8 | Handles empty findings |
| 9 | Handles empty chains |
| 10 | `generatedAt` is ISO timestamp |

#### config.test.ts (~10 tests)

| # | Test |
|---|------|
| 1 | Default config has `enabled: false` |
| 2 | Missing config returns defaults |
| 3 | Partial config merges with defaults |
| 4 | Signal config resolves per-signal enable/disable |
| 5 | Signal severity override is applied |
| 6 | LLM config merges analyzer overrides with top-level |
| 7 | LLM triage config resolves when present |
| 8 | LLM triage is undefined when not configured |
| 9 | Custom redact patterns parsed from array |
| 10 | Non-string redact patterns filtered out |

#### nats-trace-source.test.ts (~8 tests, integration, `@nats` tag)

Skip when NATS unavailable. Tests actual NATS connectivity:

| # | Test |
|---|------|
| 1 | Connects to NATS and fetches events |
| 2 | Normalizes Schema A events correctly |
| 3 | Normalizes Schema B events correctly |
| 4 | Maps `conversation.message.in` → `msg.in` |
| 5 | Extracts content from `text_preview[0].text` (Schema B) |
| 6 | `close()` is idempotent |
| 7 | Returns `null` when `nats` package not available (mock) |
| 8 | Handles connection timeout gracefully |

### 14.4 Test Count Summary

| Module | Tests |
|--------|-------|
| chain-reconstructor | 20 |
| signals/correction | 12 |
| signals/tool-fail | 10 |
| signals/doom-loop | 10 |
| signals/dissatisfied | 10 |
| signals/repeat-fail | 10 |
| signals/hallucination | 10 |
| signals/unverified-claim | 8 |
| classifier | 15 |
| output-generator | 12 |
| redactor | 12 |
| report | 10 |
| config | 10 |
| nats-trace-source (integration) | 8 |
| **Total** | **~157** |

---

## 15. Build Phases

### Phase 1: Types + TraceSource + NatsTraceSource + Chain Reconstruction

**Files:**
- `src/trace-analyzer/events.ts` — Types
- `src/trace-analyzer/trace-source.ts` — Interface
- `src/trace-analyzer/nats-trace-source.ts` — NATS implementation + normalization
- `src/trace-analyzer/chain-reconstructor.ts` — Chain reconstruction + dedup
- `src/trace-analyzer/config.ts` — Config types + resolver
- `src/trace-analyzer/index.ts` — Re-exports (stub)
- `src/types.ts` — Add `TraceAnalyzerConfig` to `CortexConfig`
- `src/config.ts` — Add `traceAnalyzer` defaults + resolver

**Tests:**
- `test/trace-analyzer/helpers.ts` — Test helpers
- `test/trace-analyzer/mock-trace-source.ts` — Mock
- `test/trace-analyzer/chain-reconstructor.test.ts` — 20 tests
- `test/trace-analyzer/config.test.ts` — 10 tests
- `test/trace-analyzer/nats-trace-source.test.ts` — 8 tests (integration, optional)

**Deliverable:** Can connect to NATS, fetch events, normalize them, and reconstruct conversation chains. Can be tested independently with mock data.

**Estimated LOC:** ~800 source + ~400 tests

### Phase 2: Signal Detectors

**Files:**
- `src/trace-analyzer/signals/types.ts`
- `src/trace-analyzer/signals/index.ts`
- `src/trace-analyzer/signals/correction.ts`
- `src/trace-analyzer/signals/tool-fail.ts`
- `src/trace-analyzer/signals/doom-loop.ts`
- `src/trace-analyzer/signals/dissatisfied.ts`
- `src/trace-analyzer/signals/repeat-fail.ts`
- `src/trace-analyzer/signals/hallucination.ts`
- `src/trace-analyzer/signals/unverified-claim.ts`

**Tests:**
- `test/trace-analyzer/signals/correction.test.ts` — 12 tests
- `test/trace-analyzer/signals/tool-fail.test.ts` — 10 tests
- `test/trace-analyzer/signals/doom-loop.test.ts` — 10 tests
- `test/trace-analyzer/signals/dissatisfied.test.ts` — 10 tests
- `test/trace-analyzer/signals/repeat-fail.test.ts` — 10 tests
- `test/trace-analyzer/signals/hallucination.test.ts` — 10 tests
- `test/trace-analyzer/signals/unverified-claim.test.ts` — 8 tests

**Deliverable:** Given a `ConversationChain`, all 7 detectors run and produce `FailureSignal[]`. Can be tested with hand-crafted chains from Phase 1 helpers.

**Estimated LOC:** ~750 source + ~600 tests

### Phase 3: Classifier + Output Generator + Report + Redactor

**Files:**
- `src/trace-analyzer/redactor.ts`
- `src/trace-analyzer/classifier.ts`
- `src/trace-analyzer/output-generator.ts`
- `src/trace-analyzer/report.ts`

**Tests:**
- `test/trace-analyzer/redactor.test.ts` — 12 tests
- `test/trace-analyzer/classifier.test.ts` — 15 tests
- `test/trace-analyzer/output-generator.test.ts` — 12 tests
- `test/trace-analyzer/report.test.ts` — 10 tests

**Deliverable:** Full 3-stage pipeline works end-to-end with mock TraceSource and mock LLM. Reports are generated, outputs formatted.

**Estimated LOC:** ~600 source + ~500 tests

### Phase 4: Integration

**Files:**
- `src/trace-analyzer/analyzer.ts` — Orchestrator class
- `src/trace-analyzer/hooks-registration.ts` — Command + schedule registration
- `src/trace-analyzer/index.ts` — Final re-exports
- `src/hooks.ts` — Add `registerTraceAnalyzerHooks()` call

**Tests:**
- `test/trace-analyzer/analyzer.test.ts` — End-to-end with MockTraceSource (~10 tests)
- `test/trace-analyzer/hooks-registration.test.ts` — Command handler tests (~5 tests)

**Deliverable:** `/trace-analyze` and `/trace-status` commands work. Scheduled runs enabled. Full integration with Cortex hooks system.

**Estimated LOC:** ~400 source + ~200 tests

### Phase Summary

| Phase | Source LOC | Test LOC | Files | Key Milestone |
|-------|-----------|----------|-------|---------------|
| 1 | ~800 | ~400 | 10 | Events flow from NATS → normalized chains |
| 2 | ~750 | ~600 | 9 | All 7 signals detected from chains |
| 3 | ~600 | ~500 | 4 | Full pipeline: detect → classify → generate |
| 4 | ~400 | ~200 | 4 | Commands registered, scheduling works |
| **Total** | **~2,550** | **~1,700** | **27** | Production-ready trace analyzer |

---

*End of ARCHITECTURE-005*
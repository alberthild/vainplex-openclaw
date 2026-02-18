# Architecture Addendum: Commitment Tracker Module

> **Version:** 0.2.0-draft  
> **Date:** 2026-02-18  
> **Scope:** Port commitment tracking from standalone Python service into `@vainplex/openclaw-cortex`  
> **Status:** Design — ready for implementation by Forge

---

## 1. Overview

The Commitment Tracker replaces the external Python service (`commitment-tracker-stream.py` + `commitment_extractor.py` + `commitment_store.py`, ~857 LOC) with an integrated TypeScript module that plugs into the existing Cortex hook pipeline.

**What changes:**
- New file: `src/commitment-tracker.ts` (~400-450 LOC)
- Updated: `src/types.ts` — new types
- Updated: `src/config.ts` — new config section + resolver
- Updated: `src/hooks.ts` — wire into message hooks + HookState
- Updated: `src/boot-context.ts` — commitment section in BOOTSTRAP.md
- Updated: `src/pre-compaction.ts` — flush commitments before compaction
- Updated: `src/narrative-generator.ts` — optional commitment section
- Updated: `index.ts` — extend `/cortexstatus` command
- New store: `memory/reboot/commitments.json`

**What does NOT change:**
- No NATS dependency (hooks replace the streaming consumer)
- No new runtime dependencies
- Storage format switches from JSONL to JSON (consistent with threads.json, decisions.json)
- Existing tests remain untouched

---

## 2. New Types (in `types.ts`)

Add these after the `Decision Tracker Types` section:

```typescript
// ============================================================
// Commitment Tracker Types
// ============================================================

export type CommitmentStatus =
  | "detected"      // Low-confidence extraction, not yet confirmed
  | "confirmed"     // High-confidence (≥ 0.7) or manually confirmed
  | "in_progress"   // Explicitly marked as being worked on
  | "fulfilled"     // Completed with evidence
  | "overdue"       // Deadline passed, still open
  | "failed";       // Abandoned or explicitly cancelled

export type CommitmentType =
  | "promise_with_deadline"
  | "assignment_with_deadline"
  | "obligation_with_deadline"
  | "promise"
  | "assignment"
  | "self_assignment"
  | "deadline_only";

export type DeadlineSource = "explicit" | "inferred" | "none";

export type CommitmentStateEntry = {
  /** New status */
  status: CommitmentStatus;
  /** ISO 8601 timestamp of transition */
  ts: string;
  /** Evidence or reason for transition */
  evidence: string;
};

export type Commitment = {
  /** Unique commitment ID (format: cmt-YYYYMMDD-NNN) */
  id: string;
  /** Who made the commitment (e.g., "claudia", "albert") */
  who: string;
  /** Who it's promised to */
  to: string;
  /** What was committed to (max 200 chars) */
  action: string;
  /** ISO 8601 deadline timestamp, or null */
  deadline: string | null;
  /** How the deadline was determined */
  deadlineSource: DeadlineSource;
  /** Current lifecycle status */
  status: CommitmentStatus;
  /** Extraction confidence (0.4–0.9) */
  confidence: number;
  /** Commitment classification */
  type: CommitmentType;
  /** Original source text (max 300 chars) */
  sourceText: string;
  /** ISO 8601 timestamp of creation */
  created: string;
  /** State transition history */
  stateHistory: CommitmentStateEntry[];
  /** Evidence of fulfillment, if fulfilled */
  fulfilledEvidence: string | null;
};

export type CommitmentsData = {
  /** Schema version (current: 1) */
  version: number;
  /** ISO 8601 timestamp of last update */
  updated: string;
  /** All tracked commitments */
  commitments: Commitment[];
};
```

### Design Notes

- **`id` format:** `cmt-YYYYMMDD-NNN` (sequential per day, matching the Python format). This is human-readable in boot context and logs. The sequence counter resets per day and is derived from existing data on load.
- **`camelCase` field names:** The Python version used `snake_case` (`deadline_source`, `source_text`, `state_history`). We switch to camelCase to match the existing TypeScript codebase convention (see `Thread.last_activity` — note: the existing codebase actually uses `snake_case` in Thread for JSON compatibility). **Decision:** Use `camelCase` in the TypeScript interface but the JSON file will use camelCase too. This is a new file with no backwards-compatibility burden. The migration tool (§9) handles the Python JSONL → new JSON conversion.
- **No `thread` field:** The Python version had an optional `thread` field that was never populated. Omitted. If needed later, we can correlate commitments to threads via timestamp proximity.
- **No `source_seq` field:** NATS sequence numbers are meaningless in hook context. Omitted.

---

## 3. Config (in `config.ts`)

### New Config Type (add to `CortexConfig` in `types.ts`)

```typescript
// Add to CortexConfig:
commitmentTracker: {
  enabled: boolean;
  /** Minimum confidence to store (0.0–1.0). Default: 0.4 */
  minConfidence: number;
  /** Confidence threshold for auto-confirm. Default: 0.7 */
  autoConfirmThreshold: number;
  /** Maximum stored commitments. Default: 200 */
  maxCommitments: number;
  /** Hours within which duplicate actions are suppressed. Default: 24 */
  dedupeWindowHours: number;
  /** Days after which fulfilled/failed commitments are pruned. Default: 30 */
  pruneCompletedDays: number;
  /** Max commitments shown in BOOTSTRAP.md. Default: 10 */
  maxInBoot: number;
};
```

### Defaults (add to `DEFAULTS` in `config.ts`)

```typescript
commitmentTracker: {
  enabled: true,
  minConfidence: 0.4,
  autoConfirmThreshold: 0.7,
  maxCommitments: 200,
  dedupeWindowHours: 24,
  pruneCompletedDays: 30,
  maxInBoot: 10,
},
```

### Resolver (add to `resolveConfig()`)

```typescript
const ct = (raw.commitmentTracker ?? {}) as Record<string, unknown>;

// In return object:
commitmentTracker: {
  enabled: bool(ct.enabled, DEFAULTS.commitmentTracker.enabled),
  minConfidence: num(ct.minConfidence, DEFAULTS.commitmentTracker.minConfidence),
  autoConfirmThreshold: num(ct.autoConfirmThreshold, DEFAULTS.commitmentTracker.autoConfirmThreshold),
  maxCommitments: int(ct.maxCommitments, DEFAULTS.commitmentTracker.maxCommitments),
  dedupeWindowHours: int(ct.dedupeWindowHours, DEFAULTS.commitmentTracker.dedupeWindowHours),
  pruneCompletedDays: int(ct.pruneCompletedDays, DEFAULTS.commitmentTracker.pruneCompletedDays),
  maxInBoot: int(ct.maxInBoot, DEFAULTS.commitmentTracker.maxInBoot),
},
```

**Note:** A new `num()` helper is needed (float-safe, unlike `int()` which rounds):

```typescript
function num(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}
```

---

## 4. Module Structure: `commitment-tracker.ts`

The file consolidates extraction, deadline resolution, storage, and fulfillment detection into a single module. This is consistent with how `decision-tracker.ts` and `thread-tracker.ts` are structured (each is a self-contained class with embedded logic).

### 4.1 Deadline Resolution (stays in `commitment-tracker.ts`)

**Decision: Deadline resolution lives in `commitment-tracker.ts`, NOT in `patterns.ts`.**

Rationale:
- `patterns.ts` contains simple RegExp arrays + a mood detector. It's a shared utility for thread/decision extraction.
- Deadline resolution is complex stateful logic (relative date math, locale-aware weekday names, duration parsing). It's exclusively used by commitment tracking.
- Putting it in `patterns.ts` would bloat that file from ~130 LOC to ~250 LOC with commitment-only logic.
- If deadline patterns are ever needed elsewhere, they can be extracted later.

```typescript
// ── Deadline Resolution ─────────────────────────────────────────────

const WEEKDAYS_DE: Record<string, number> = {
  montag: 0, dienstag: 1, mittwoch: 2, donnerstag: 3,
  freitag: 4, samstag: 5, sonntag: 6,
};

const WEEKDAYS_EN: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

const RELATIVE_DE: Record<string, number> = {
  heute: 0, morgen: 1, übermorgen: 2,
  "heute abend": 0, "heute nacht": 0,
};

const RELATIVE_EN: Record<string, number> = {
  today: 0, tomorrow: 1, tonight: 0, eod: 0, "end of day": 0,
};

type DeadlineResolution = {
  iso: string | null;
  source: DeadlineSource;
};

/**
 * Resolve a deadline string to an ISO 8601 timestamp.
 * Supports: relative days (DE/EN), weekdays (DE/EN), durations ("in 3 Tagen"),
 * dates (DD.MM. / DD.MM.YYYY), times (HH:MM / HH:MM Uhr).
 */
export function resolveDeadline(match: string, refTime?: Date): DeadlineResolution {
  // ... (port from Python, same logic, same order of checks)
}
```

Port the full Python `resolve_deadline()` logic faithfully:
1. Relative days (DE) → check `RELATIVE_DE` map
2. Relative days (EN) → check `RELATIVE_EN` map
3. Weekdays (DE + EN) → merged map, same-day = +7 days
4. Duration patterns → regex `(\d+)\s*(stunden?|hours?|tagen?|days?|wochen?|weeks?)`
5. Date patterns → regex `(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?`
6. Time patterns → regex `(\d{1,2})[: h](\d{2})\s*(?:uhr)?`

All deadlines resolve to end-of-day (23:59:00 UTC) for date-level resolution, or exact time for time-level resolution. If the resolved time is in the past for time patterns, add 1 day (same as Python).

### 4.2 Extraction Patterns

All patterns are module-level constants (not exported — internal to commitment-tracker.ts). This is consistent with how `patterns.ts` defines its patterns as module-level constants.

```typescript
// ── Extraction Patterns ─────────────────────────────────────────────

/** Tier 1: Explicit deadline signals */
const DEADLINE_PATTERNS: RegExp[] = [
  // "bis Freitag", "by tomorrow", "deadline: 15.02."
  /(?:bis|until|by|deadline[: ])\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morgen|übermorgen|tomorrow|heute abend|heute|tonight|today|eod|end of day|\d{1,2}\.\d{1,2}\.?\d{0,4}|\d{1,2}[: h]\d{2}\s*(?:uhr)?)/i,
  // "in 3 Tagen", "within 2 hours", "innerhalb von 1 Woche"
  /(?:in|within|innerhalb)\s+(?:von\s+)?(\d+\s*(?:stunden?|hours?|tagen?|days?|wochen?|weeks?))/i,
];

/** Tier 2: Promise signals (agent commits to action) */
const PROMISE_PATTERNS: RegExp[] = [
  /(?:ich|i(?:'ll| will))\s+(?:mach|handle|fix|deploy|build|schreib|kümmere|erledige|checke|prüfe|baue|teste)/i,
  /(?:versprochen|promise|zusage|committed? to|zugesagt)/i,
  /(?:das (?:mach|erledige|baue|fixe|checke) ich)/i,
  /(?:wird? (?:bis|before|vor)\s)/i,
  /(?:mache? (?:ich )?(?:direkt|sofort|gleich|jetzt))/i,
];

/** Tier 3: Assignment signals (human assigns to agent) */
const ASSIGNMENT_PATTERNS: RegExp[] = [
  /(?:kannst du|could you|please|bitte)\s+(?:mal |noch )?\w{3,}/i,
  /(?:TODO|FIXME)[: ]+(.{10,100})/i,
  /(?:nächster schritt|next step)[: ]+(.{10,100})/i,
  /(?:mach|schau|check|fix|deploy|bau|teste|schreib)\s+(?:mal |noch |bitte )?\w{3,}/i,
];

/** Tier 2.5: Obligation signals (implicit via "muss", "should") */
const OBLIGATION_PATTERNS: RegExp[] = [
  /(?:muss|müssen|sollte|should|need to|have to)\s+\w{3,}/i,
];

/** Fulfillment signals */
const FULFILLMENT_PATTERNS: RegExp[] = [
  /(?:erledigt|done|fertig|fixed|deployed|committed|abgeschlossen|migriert|gefixt)/i,
  /[✅👍]/,
  /committed? as [a-f0-9]{7,}/i,
  /pushed to \w+/i,
];

/** Generic confirmation (only matches if sole open commitment) */
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(?:passt|gut|super|danke|perfect|sehr gut|mega|top|nice|ok(?:ay)?|alles klar|läuft)\s*[.!]?\s*$/i,
  /^[👍✅💪🙌]\s*$/,
];

/** Noise filter — skip these messages entirely */
const NOISE_PATTERNS: RegExp[] = [
  /^(?:HEARTBEAT|NO_REPLY|HEARTBEAT_OK)/i,
  /^System: \[/,
  /^Read HEARTBEAT/,
];
```

**Note on language filtering:** Unlike thread/decision patterns which are split by language via `getPatterns(language)`, commitment patterns are inherently bilingual (DE+EN combined in each regex). This is because the Python source mixed languages in single patterns (e.g., `(?:bis|until|by|deadline)`). We keep this approach — filtering by language config would add complexity for zero practical benefit since commitments rely on the combination of deadline + promise/assignment signal, and a user speaking German might still use English keywords like "TODO" or "deploy".

### 4.3 CommitmentTracker Class

```typescript
export type CommitmentTrackerConfig = {
  enabled: boolean;
  minConfidence: number;
  autoConfirmThreshold: number;
  maxCommitments: number;
  dedupeWindowHours: number;
  pruneCompletedDays: number;
  maxInBoot: number;
};

export class CommitmentTracker {
  private commitments: Commitment[] = [];
  private seq = 0;              // Daily sequence counter
  private seqDate = "";         // Date string for sequence reset
  private dirty = false;
  private writeable = true;
  private readonly filePath: string;
  private readonly config: CommitmentTrackerConfig;
  private readonly logger: PluginLogger;

  constructor(
    workspace: string,
    config: CommitmentTrackerConfig,
    logger: PluginLogger,
  ) { ... }
```

#### Public Methods

| Method | Description |
|--------|-------------|
| `processMessage(content: string, sender: string): void` | Main entry point. Extracts commitments + checks fulfillment. Called from hooks. |
| `flush(): boolean` | Force-persist to disk. Called by pre-compaction. |
| `getOpen(): Commitment[]` | Return non-terminal commitments (status not in fulfilled/failed). |
| `getOverdue(): Commitment[]` | Return overdue commitments. |
| `getAll(): Commitment[]` | Return all commitments (copy). |
| `markOverdue(): void` | Scan all open commitments and transition overdue ones. |

#### Internal Methods

| Method | Description |
|--------|-------------|
| `private extract(text: string, sender: string): RawCommitment[]` | Core extraction logic — scans patterns, computes confidence tier. |
| `private checkFulfillment(text: string): void` | Check if text fulfills any open commitment via word overlap. |
| `private nextId(): string` | Generate `cmt-YYYYMMDD-NNN` id. |
| `private isDuplicate(action: string, now: Date): boolean` | Dedup via action substring match within window. |
| `private enforceMax(): void` | Cap at `maxCommitments`, removing oldest fulfilled/failed first. |
| `private pruneCompleted(): void` | Remove fulfilled/failed older than `pruneCompletedDays`. |
| `private persist(): void` | Atomic JSON write via `saveJson()`. |

#### Raw Extraction Type (internal, not exported)

```typescript
type RawCommitment = {
  who: string;
  to: string;
  action: string;
  deadline: string | null;
  deadlineSource: DeadlineSource;
  confidence: number;
  type: CommitmentType;
  sourceText: string;
};
```

### 4.4 Extraction Logic (ported from Python)

The extraction flow in `processMessage()`:

```
1. Skip noise (NOISE_PATTERNS)
2. Check fulfillment against open commitments (FULFILLMENT_PATTERNS + CONFIRMATION_PATTERNS)
3. Mark overdue commitments
4. Extract new commitments:
   a. Scan DEADLINE_PATTERNS → resolve to ISO via resolveDeadline()
   b. Scan PROMISE_PATTERNS
   c. Scan ASSIGNMENT_PATTERNS
   d. Scan OBLIGATION_PATTERNS
   e. Compute confidence tier:
      - deadline + promise  → 0.9  (promise_with_deadline)
      - deadline + assignment → 0.85 (assignment_with_deadline)
      - deadline + obligation → 0.85 (obligation_with_deadline)
      - promise only → 0.6 (promise)
      - assignment (human sender) → 0.55 (assignment)
      - assignment (agent sender) → 0.5 (self_assignment)
      - deadline only → 0.5 (deadline_only)
   f. Skip if confidence < minConfidence
   g. Extract action text (sentence containing match, cleaned, max 200 chars)
   h. Dedup check
   i. Store with initial status = "confirmed" if confidence ≥ autoConfirmThreshold, else "detected"
5. Persist if dirty
```

**Sender determination:** The hook passes the sender. The tracker determines `who`/`to`:
- If sender is `"assistant"` or matches known agent names → `who = "claudia"`, `to = "albert"`
- Otherwise → `who = "albert"`, `to = "claudia"`

This is simpler than the Python version which checked `agent in ("main", "claudia")`. We use:

```typescript
private isAgentSender(sender: string): boolean {
  const agentNames = new Set(["assistant", "main", "claudia", "agent"]);
  return agentNames.has(sender.toLowerCase());
}
```

### 4.5 Fulfillment Detection (ported from Python)

```typescript
private checkFulfillment(text: string): void {
  const openCommitments = this.getOpen();
  if (openCommitments.length === 0) return;

  const hasFulfillment = FULFILLMENT_PATTERNS.some(p => p.test(text));
  const hasConfirmation = CONFIRMATION_PATTERNS.some(p => p.test(text));

  if (!hasFulfillment && !hasConfirmation) return;

  const textWords = new Set(
    text.toLowerCase().match(/\w{4,}/g) ?? [],
  );

  for (const cmt of openCommitments) {
    const actionWords = new Set(
      cmt.action.toLowerCase().match(/\w{4,}/g) ?? [],
    );
    if (actionWords.size === 0) continue;

    const overlap = [...actionWords].filter(w => textWords.has(w));

    // Need ≥ 2 overlapping words OR ≥ 30% of action words
    if (overlap.length >= 2 || overlap.length / actionWords.size >= 0.3) {
      const evidence = `fulfillment signal, matching: ${overlap.slice(0, 5).join(", ")}`;
      this.transition(cmt.id, "fulfilled", evidence);
    } else if (hasConfirmation && openCommitments.length === 1) {
      // Generic confirmation with single open commitment
      const preview = text.slice(0, 50);
      this.transition(cmt.id, "fulfilled", `generic confirmation ('${preview}'), single open commitment`);
    }
  }
}
```

### 4.6 Action Text Extraction

Ported from Python's `_extract_action()`:

```typescript
private extractAction(text: string, match: RegExpExecArray | null): string {
  if (!match) return this.cleanAction(text);

  // Find sentence boundaries around match
  const start = match.index;
  const sentStart = Math.max(
    0,
    text.lastIndexOf(".", start - 1) + 1,
    text.lastIndexOf("\n", start - 1) + 1,
  );

  let sentEnd = text.length;
  for (const delim of [".", "\n", "!"]) {
    const pos = text.indexOf(delim, match.index + match[0].length);
    if (pos !== -1 && pos < sentEnd) sentEnd = pos + 1;
  }

  return this.cleanAction(text.slice(sentStart, sentEnd));
}

private cleanAction(text: string): string {
  let cleaned = text.replace(/[*_`#]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length > 200) cleaned = cleaned.slice(0, 197) + "...";
  return cleaned;
}
```

---

## 5. Hook Integration (in `hooks.ts`)

### 5.1 HookState Extension

```typescript
type HookState = {
  workspace: string | null;
  threadTracker: ThreadTracker | null;
  decisionTracker: DecisionTracker | null;
  commitmentTracker: CommitmentTracker | null;  // ← NEW
  llmEnhancer: LlmEnhancer | null;
};
```

### 5.2 ensureInit Extension

```typescript
import { CommitmentTracker } from "./commitment-tracker.js";

function ensureInit(state: HookState, config: CortexConfig, logger, ctx?): void {
  // ... existing init ...
  if (!state.commitmentTracker && config.commitmentTracker.enabled) {
    state.commitmentTracker = new CommitmentTracker(
      state.workspace!,
      config.commitmentTracker,
      logger,
    );
  }
}
```

### 5.3 Message Handler Extension

In `registerMessageHooks()`, after the existing regex processing block:

```typescript
// Commitment tracking (regex-based, zero cost)
if (config.commitmentTracker.enabled && state.commitmentTracker) {
  state.commitmentTracker.processMessage(content, sender);
}
```

This goes **after** thread and decision processing but **before** LLM enhancement. The commitment tracker is independent — it doesn't consume thread/decision data and doesn't produce data for them.

### 5.4 Compaction Hook Extension

In `registerCompactionHooks()`, within the `before_compaction` handler, add after thread flush:

```typescript
// Flush commitment state
if (state.commitmentTracker) {
  state.commitmentTracker.markOverdue();
  state.commitmentTracker.flush();
}
```

### 5.5 Log Line Extension

Update the registration log:

```typescript
api.logger.info(
  `[cortex] Hooks registered — threads:${config.threadTracker.enabled} decisions:${config.decisionTracker.enabled} commitments:${config.commitmentTracker.enabled} boot:${config.bootContext.enabled} compaction:${config.preCompaction.enabled} llm:${config.llm.enabled}...`,
);
```

### 5.6 Initial State

```typescript
const state: HookState = {
  workspace: null,
  threadTracker: null,
  decisionTracker: null,
  commitmentTracker: null,  // ← NEW
  llmEnhancer: null,
};
```

---

## 6. Storage Format

### File: `memory/reboot/commitments.json`

```json
{
  "version": 1,
  "updated": "2026-02-18T16:30:00.000Z",
  "commitments": [
    {
      "id": "cmt-20260218-001",
      "who": "claudia",
      "to": "albert",
      "action": "Alert Aggregator anpassen für migrierte Timer",
      "deadline": "2026-02-19T23:59:00.000Z",
      "deadlineSource": "explicit",
      "status": "confirmed",
      "confidence": 0.9,
      "type": "promise_with_deadline",
      "sourceText": "ich mach den Alert Aggregator bis morgen fertig",
      "created": "2026-02-18T14:00:00.000Z",
      "stateHistory": [
        {
          "status": "confirmed",
          "ts": "2026-02-18T14:00:00.000Z",
          "evidence": "confidence=0.90"
        }
      ],
      "fulfilledEvidence": null
    }
  ]
}
```

### Storage Consistency

- Uses the same `saveJson()` / `loadJson()` from `storage.ts` (atomic writes via tmp+rename)
- Same directory as `threads.json` and `decisions.json`
- JSON (not JSONL) — consistent with the existing plugin convention
- Version field for future schema migrations

---

## 7. Boot Context Integration (in `boot-context.ts`)

### New Method: `buildCommitments()`

```typescript
private buildCommitments(): string {
  const data = loadJson<Partial<CommitmentsData>>(
    join(rebootDir(this.workspace), "commitments.json"),
  );
  const commitments = Array.isArray(data.commitments) ? data.commitments : [];

  // Filter to open commitments (not fulfilled, not failed)
  const open = commitments.filter(
    c => !["fulfilled", "failed"].includes(c.status),
  );

  if (open.length === 0) return "";

  const overdue = open.filter(c => {
    if (!c.deadline || c.status === "overdue") return c.status === "overdue";
    try { return new Date(c.deadline) < new Date(); } catch { return false; }
  });
  const withDeadline = open.filter(c =>
    c.deadline && !overdue.includes(c),
  );
  const noDeadline = open.filter(c =>
    !c.deadline && !overdue.includes(c),
  );

  const lines: string[] = [`## 📋 Commitments (${open.length} open)`];

  // Overdue first (most urgent)
  for (const c of overdue) {
    lines.push(`- 🔴 **OVERDUE**: ${c.action}`);
  }
  // Deadline-bearing, sorted by deadline ASC
  const sorted = [...withDeadline].sort((a, b) =>
    (a.deadline ?? "").localeCompare(b.deadline ?? ""),
  );
  for (const c of sorted) {
    lines.push(`- 🟡 Due ${formatDeadlineHuman(c.deadline!)}: ${c.action}`);
  }
  // No deadline
  for (const c of noDeadline) {
    lines.push(`- ⚪ Open: ${c.action}`);
  }

  // Limit to maxInBoot from config (applied after priority ordering)
  // Note: bootContext config doesn't have maxInBoot — we read from commitmentTracker config
  // This requires passing the full config or a limit parameter. See §7.1.

  lines.push("");
  return lines.join("\n");
}
```

### 7.1 Config Access

The `BootContextGenerator` currently receives only `CortexConfig["bootContext"]`. To access `commitmentTracker.maxInBoot`, we have two options:

**Option A (recommended): Pass `maxCommitmentsInBoot` through `bootContext` config.**

Add to `CortexConfig.bootContext`:
```typescript
maxCommitmentsInBoot: number;  // default: 10
```

This keeps the BootContextGenerator's interface clean — it only needs its own config slice.

**Option B: Pass full `CortexConfig` to `BootContextGenerator`.**

This would require changing the constructor signature and all call sites.

**Decision: Option A.** Add `maxCommitmentsInBoot` to `bootContext` config with default 10. This follows the existing pattern where `bootContext` already has `maxThreadsInBoot` and `maxDecisionsInBoot`.

Remove the separate `maxInBoot` from `commitmentTracker` config (§3) — it belongs in `bootContext`. Revised commitment config:

```typescript
commitmentTracker: {
  enabled: boolean;
  minConfidence: number;
  autoConfirmThreshold: number;
  maxCommitments: number;
  dedupeWindowHours: number;
  pruneCompletedDays: number;
};
```

And add to `bootContext`:
```typescript
maxCommitmentsInBoot: number;  // default: 10
```

### 7.2 Deadline Formatting Helper

A standalone function (in `commitment-tracker.ts`, exported for boot-context use):

```typescript
/**
 * Format a deadline ISO string to human-readable relative time.
 * Examples: "in 3h", "in 2d (20.02.)", "überfällig (5h)"
 */
export function formatDeadlineHuman(deadline: string): string {
  try {
    const dl = new Date(deadline);
    const now = new Date();
    const deltaMs = dl.getTime() - now.getTime();
    const hours = Math.round(deltaMs / 3_600_000);

    if (hours < 0) {
      const overdueH = Math.abs(hours);
      if (overdueH < 24) return `overdue (${overdueH}h)`;
      return `overdue (${Math.round(overdueH / 24)}d)`;
    }
    if (hours < 1) return `in ${Math.round(deltaMs / 60_000)}min`;
    if (hours < 24) return `in ${hours}h`;
    const dayStr = `${dl.getDate().toString().padStart(2, "0")}.${(dl.getMonth() + 1).toString().padStart(2, "0")}.`;
    return `in ${Math.round(hours / 24)}d (${dayStr})`;
  } catch {
    return deadline;
  }
}
```

### 7.3 Section Placement in BOOTSTRAP.md

In `generate()`, add the commitments section **after decisions and before the footer**:

```
# Context Briefing
## ⚡ State
## 🔥 Last Session Snapshot     (if fresh)
## 📖 Narrative                  (if fresh)
## 🧵 Active Threads
## 🎯 Recent Decisions
## 📋 Commitments               ← NEW
---
_Boot context | X threads | Y decisions | Z commitments_
```

Overdue commitments are high-signal and will naturally appear at the top of the commitments section (ordered: overdue → deadline → open).

### 7.4 Footer Update

```typescript
`_Boot context | ${threads.length} active threads | ${decisions.length} recent decisions | ${openCommitments.length} open commitments_`
```

---

## 8. Narrative Integration

**Decision: Include commitments in narrative.md — but only the summary line.**

In `narrative-generator.ts`, add after the Decisions section:

```typescript
// In generateStructured():
if (commitmentSummary) {
  parts.push("**Commitments:**");
  parts.push(commitmentSummary);
  parts.push("");
}
```

The `commitmentSummary` is a one-line count: `"3 open (1 overdue, 2 with deadline)"`. This is intentionally minimal — the narrative is meant to be a high-level story, not a task list. The detailed commitment list lives in BOOTSTRAP.md.

To generate this, `NarrativeGenerator` loads `commitments.json` directly (same pattern as it loads threads.json and decisions.json):

```typescript
function loadCommitmentSummary(workspace: string): string {
  const data = loadJson<Partial<CommitmentsData>>(
    join(rebootDir(workspace), "commitments.json"),
  );
  const commitments = Array.isArray(data.commitments) ? data.commitments : [];
  const open = commitments.filter(c => !["fulfilled", "failed"].includes(c.status));
  if (open.length === 0) return "";

  const overdue = open.filter(c => c.status === "overdue" || (c.deadline && new Date(c.deadline) < new Date()));
  const withDeadline = open.filter(c => c.deadline && !overdue.includes(c));

  const parts = [`${open.length} open`];
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (withDeadline.length > 0) parts.push(`${withDeadline.length} with deadline`);
  return parts.join(", ");
}
```

---

## 9. Pre-Compaction Integration

**Decision: Include commitment summary in hot-snapshot.**

In `pre-compaction.ts`, after step 1 (thread flush), add:

```typescript
// 1b. Flush commitment tracker state + mark overdue
try {
  if (commitmentTracker) {
    commitmentTracker.markOverdue();
    commitmentTracker.flush();
    logger.info("[cortex] Pre-compaction: commitment state flushed");
  }
} catch (err) {
  warnings.push(`Commitment flush failed: ${err}`);
}
```

The `PreCompaction` constructor needs to accept an optional `CommitmentTracker`:

```typescript
constructor(
  workspace: string,
  config: CortexConfig,
  logger: PluginLogger,
  threadTracker: ThreadTracker,
  commitmentTracker?: CommitmentTracker,  // ← NEW (optional for backwards compat)
)
```

This is passed from the `before_compaction` hook handler in `hooks.ts`.

---

## 10. Command Extension (in `index.ts`)

Extend `/cortexstatus` to include commitment counts:

```typescript
// In the handler:
const cmtData = loadJson<Partial<CommitmentsData>>(
  `${rebootDir(workspace)}/commitments.json`,
);
const cmtAll = cmtData.commitments ?? [];
const cmtOpen = cmtAll.filter(c => !["fulfilled", "failed"].includes(c.status));
const cmtOverdue = cmtOpen.filter(c => c.status === "overdue");

// In the output:
`Commitments: ${cmtOpen.length} open${cmtOverdue.length > 0 ? ` (${cmtOverdue.length} overdue ⚠️)` : ""}, ${cmtAll.length} total`,
```

---

## 11. Decay & Pruning

**Decision: Yes, old completed commitments are pruned.**

The `pruneCompleted()` method runs during `processMessage()` (same timing as thread pruning). It removes commitments where:
- Status is `"fulfilled"` or `"failed"`
- Created date is older than `pruneCompletedDays` (default: 30 days)

This prevents unbounded growth. Active (detected/confirmed/in_progress/overdue) commitments are never auto-pruned.

Additionally, `enforceMax()` caps total commitments at `maxCommitments` (default: 200). When the cap is hit, it removes the oldest fulfilled/failed first, then oldest detected.

---

## 12. Test Plan

### 12.1 Unit Tests: `commitment-tracker.test.ts`

Test structure follows the existing pattern in the repo (describe/it blocks, assert-based).

**Deadline Resolution (12 tests):**
| Test | Input | Expected |
|------|-------|----------|
| DE relative: heute | "heute" | Same day 23:59 |
| DE relative: morgen | "morgen" | Next day 23:59 |
| DE relative: übermorgen | "übermorgen" | +2 days 23:59 |
| EN relative: tomorrow | "tomorrow" | Next day 23:59 |
| EN relative: eod | "eod" | Same day 23:59 |
| DE weekday: Freitag | "Freitag" (ref=Wed) | +2 days |
| EN weekday: Monday | "Monday" (ref=Mon) | +7 days (same-day rule) |
| Duration: hours | "2 Stunden" | +2h from ref |
| Duration: days | "3 Tagen" | +3d from ref |
| Duration: weeks | "1 week" | +7d from ref |
| Date: DD.MM. | "15.02." | Feb 15 current year |
| Date: DD.MM.YYYY | "15.02.2026" | Feb 15 2026 |
| Time: HH:MM | "14:00" | 14:00 today or tomorrow |
| Garbage | "blablabla" | null |

**Extraction (14 tests):**
| Test | Text | Sender | Expected Count | Expected Confidence |
|------|------|--------|----------------|-------------------|
| Promise + deadline DE | "ich mach das bis Freitag" | agent | 1 | 0.9 |
| Promise + deadline EN | "I'll handle deployment by tomorrow" | agent | 1 | 0.9 |
| Assignment DE (human) | "kannst du mal den Server checken" | human | 1 | 0.55 |
| Promise + time | "das erledige ich bis 14:00 Uhr" | agent | 1 | 0.9 |
| Explicit promise + weekday | "versprochen, ist bis Montag fertig" | agent | 1 | 0.9 |
| No commitment | "Das Wetter ist heute schön" | agent | 0 | — |
| Noise filter | "HEARTBEAT_OK" | agent | 0 | — |
| Immediate promise | "mache ich direkt" | agent | 1 | 0.6 |
| Polite assignment | "bitte den Alert Aggregator anpassen" | human | 1 | 0.55 |
| TODO pattern | "TODO: Cross-Session Tracking bauen" | agent | 1 | 0.5 |
| Duration + obligation | "innerhalb von 2 Stunden sollte das laufen" | agent | 1 | 0.85 |
| Date + obligation | "bis 15.02. muss die Migration fertig sein" | agent | 1 | 0.85 |
| Short text (< 10 chars) | "ok" | agent | 0 | — |
| Below min confidence | (construct case with only deadline, no action) | agent | 0 | — |

**Fulfillment Detection (5 tests):**
| Test | Text | Open Commitments | Expected |
|------|------|-----------------|----------|
| Matching words | "Alert Aggregator ist angepasst ✅" | [alert aggregator commitment] | Fulfilled |
| No match | "Das Wetter ist schön" | [alert aggregator commitment] | No change |
| Fulfillment signal + overlap | "erledigt — migrierte Timer gewarnt" | [timer commitment] | Fulfilled |
| Generic confirmation (single) | "passt!" | [1 commitment] | Fulfilled |
| Generic confirmation (multiple) | "passt!" | [2 commitments] | No change |

**Deduplication (3 tests):**
| Test | Description |
|------|-------------|
| Exact duplicate within window | Same action text within 24h → skip |
| Substring duplicate | Action contained in existing → skip |
| After window expires | Same action after 24h+ → create new |

**State Transitions (4 tests):**
| Test | Description |
|------|-------------|
| High confidence → confirmed | conf ≥ 0.7 → initial status "confirmed" |
| Low confidence → detected | conf < 0.7 → initial status "detected" |
| Overdue detection | Deadline in past → "overdue" |
| Fulfill updates evidence | transition to "fulfilled" sets fulfilledEvidence |

**Pruning (3 tests):**
| Test | Description |
|------|-------------|
| Prune old fulfilled | 31-day-old fulfilled commitment → removed |
| Keep recent fulfilled | 5-day-old fulfilled → kept |
| Enforce max cap | 201 commitments → oldest removed |

**Persistence (3 tests):**
| Test | Description |
|------|-------------|
| Load from disk | Constructor reads existing commitments.json |
| Save round-trip | processMessage → file written → new instance loads same data |
| Atomic write | Write uses tmp+rename (inherited from saveJson) |

**Total: ~44 tests**

### 12.2 Integration Tests

**Hook Integration (3 tests):**
| Test | Description |
|------|-------------|
| message_received fires extraction | Send message event → commitments.json created |
| message_sent fires extraction | Agent message → commitment extracted with who=claudia |
| before_compaction flushes | Compaction event → commitments flushed |

**Boot Context Integration (3 tests):**
| Test | Description |
|------|-------------|
| Commitments appear in BOOTSTRAP.md | Write commitments.json → generate() includes section |
| Overdue highlighted | Overdue commitment → 🔴 OVERDUE in output |
| Empty commitments → no section | No commitments.json → no commitments section |

**Total: ~50 tests across the file.**

### 12.3 Test Utilities

Create test commitments via a helper:

```typescript
function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "cmt-20260218-001",
    who: "claudia",
    to: "albert",
    action: "Test commitment action for unit tests",
    deadline: null,
    deadlineSource: "none",
    status: "confirmed",
    confidence: 0.8,
    type: "promise",
    sourceText: "test source",
    created: new Date().toISOString(),
    stateHistory: [],
    fulfilledEvidence: null,
    ...overrides,
  };
}
```

---

## 13. Migration Plan (Python JSONL → TypeScript JSON)

### 13.1 Format Differences

| Aspect | Python (old) | TypeScript (new) |
|--------|-------------|-----------------|
| Format | JSONL (one JSON object per line) | JSON (single array) |
| Location | `~/.cortex/knowledge/commitments.jsonl` | `<workspace>/memory/reboot/commitments.json` |
| Field names | snake_case | camelCase |
| ID format | `cmt-YYYYMMDD-NNN` | `cmt-YYYYMMDD-NNN` (same) |
| Fields | +thread, +source_seq | -thread, -source_seq |
| Index file | `commitments-index.json` (separate) | Not needed (JSON is self-contained) |

### 13.2 Migration Script

A one-time Node.js script: `scripts/migrate-commitments.ts`

```typescript
#!/usr/bin/env node
/**
 * Migrate commitments from Python JSONL format to Cortex JSON format.
 * Usage: npx tsx scripts/migrate-commitments.ts [--source <path>] [--target <workspace>]
 *
 * Defaults:
 *   --source  ~/.cortex/knowledge/commitments.jsonl
 *   --target  current directory (writes to memory/reboot/commitments.json)
 */
```

Field mapping:
```
id              → id              (unchanged)
who             → who             (unchanged)
to              → to              (unchanged)
action          → action          (unchanged)
deadline        → deadline        (unchanged)
deadline_source → deadlineSource  (camelCase)
status          → status          (unchanged)
confidence      → confidence      (unchanged)
source_seq      → (dropped)
source_text     → sourceText      (camelCase)
thread          → (dropped)
created         → created         (unchanged)
state_history   → stateHistory    (camelCase, entries: status→status, ts→ts, evidence→evidence)
fulfilled_evidence → fulfilledEvidence (camelCase)
```

The `type` field doesn't exist in Python JSONL. Infer it from confidence + deadline presence:
- confidence ≥ 0.85 + deadline → `"promise_with_deadline"` or `"assignment_with_deadline"`
- confidence ≈ 0.6 → `"promise"`
- confidence ≈ 0.55 → `"assignment"`
- confidence ≈ 0.5 + deadline → `"deadline_only"`
- Default → `"promise"`

### 13.3 Migration Steps

1. Run migration script (one-time, manual)
2. Verify commitments.json content
3. Disable Python `commitment-tracker-stream.py` service
4. Enable `commitmentTracker` in plugin config (enabled by default)
5. Old JSONL file can be archived/deleted after verification

### 13.4 Coexistence

During transition, both systems can run simultaneously without conflict because:
- Python writes to `~/.cortex/knowledge/commitments.jsonl`
- TypeScript writes to `<workspace>/memory/reboot/commitments.json`
- They never touch each other's files

---

## 14. Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deadline resolution location | `commitment-tracker.ts` | Complex, commitment-specific; would bloat shared `patterns.ts` |
| Commitments in narrative | Summary line only | Narrative is a story, not a task list |
| Decay/pruning | Yes, 30-day default for fulfilled/failed | Prevent unbounded growth |
| Pre-compaction | Yes, flush + markOverdue | Consistent with thread tracker |
| Hot snapshot | No commitment content in snapshot | Snapshot captures raw messages; commitments are structured data |
| Field naming | camelCase | Match TypeScript conventions; new file, no compat burden |
| Storage format | JSON (not JSONL) | Consistent with threads.json, decisions.json |
| Language filtering | All patterns bilingual always | Commitment patterns already mix DE+EN; filtering adds no value |
| Boot context config | `maxCommitmentsInBoot` in `bootContext` | Follows `maxThreadsInBoot` / `maxDecisionsInBoot` pattern |
| Constructor pattern | Same as DecisionTracker | `(workspace, config, logger)` — no language param needed |

---

## 15. File Change Summary

| File | Action | LOC Delta (est.) |
|------|--------|-------------------|
| `src/commitment-tracker.ts` | **NEW** | +400–450 |
| `src/types.ts` | MODIFY | +55 |
| `src/config.ts` | MODIFY | +25 |
| `src/hooks.ts` | MODIFY | +15 |
| `src/boot-context.ts` | MODIFY | +50 |
| `src/narrative-generator.ts` | MODIFY | +20 |
| `src/pre-compaction.ts` | MODIFY | +10 |
| `index.ts` | MODIFY | +10 |
| `tests/commitment-tracker.test.ts` | **NEW** | +600–700 |
| `scripts/migrate-commitments.ts` | **NEW** | +80 |
| **Total** | | +1,265–1,415 |

---

## 16. Open Questions (for implementation)

1. **LLM enhancement for commitments:** Should `LlmEnhancer` also extract commitments? The current LLM analysis returns threads + decisions + closures + mood. Adding commitments would require updating the LLM prompt and analysis types. **Recommendation:** Defer to v0.3.0. Regex extraction is sufficient for commitments (the Python version never used LLM).

2. **Overdue notification:** Should overdue commitments trigger a proactive notification (e.g., via a new hook or message)? **Recommendation:** Defer. The boot context already surfaces overdue items prominently. Active notification would require a new hook type (`commitment_overdue`) which is out of scope.

3. **Manual status commands:** Should there be `/commitments` and `/fulfill <id>` commands? **Recommendation:** Defer to v0.3.0. The regex-based fulfillment detection handles the common case. Manual override can be added later.

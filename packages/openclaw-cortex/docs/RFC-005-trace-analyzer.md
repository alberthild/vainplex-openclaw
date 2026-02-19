# RFC-005: Trace Analyzer

| Field       | Value                                |
|-------------|--------------------------------------|
| RFC         | 005                                  |
| Title       | Trace Analyzer                       |
| Status      | Draft                                |
| Author      | Atlas (Architecture Agent)           |
| Date        | 2026-02-19                           |
| Affects     | New module: `src/trace-analyzer/`. Config additions to `types.ts`, `config.ts`, `config-loader.ts`, `hooks.ts` |
| Depends On  | RFC-003 (Output Validation — claim/fact types), `@vainplex/openclaw-nats-eventstore` event schema (`ClawEvent`, `EventType`) |

---

## 1. Abstract

This RFC defines a **Trace Analyzer** module for `@vainplex/openclaw-cortex` that reconstructs full conversation chains from event store data, identifies failure signals structurally, classifies root causes via LLM analysis, and produces actionable outputs (guard rules, governance policies, Cortex patterns). The module reads historical agent traces — not live messages — to learn what went wrong and generate preventive rules.

The Trace Analyzer is the successor to the `error-detector.py` script (739 patterns, 19 guards, high noise). It replaces regex-on-isolated-events with structural analysis of conversation chains, yielding higher-precision failure detection and higher-quality generated rules.

---

## 2. Motivation

### 2.1 The Problem

We have 255k+ events (354 MB) in a NATS JetStream event store capturing every agent interaction: messages in/out, tool calls/results, run lifecycle, sessions. The current `error-detector.py` processes these events individually using regex:

```
CORRECTION_PATTERNS = [
    re.compile(r'\b(?:nein|falsch|stop|wrong|undo|nicht das)\b', re.I),
]
ERROR_PATTERNS = [
    re.compile(r'(?:Error:|Exception:|Traceback|FEHLER|failed|CRITICAL)', re.I),
]
```

**Results after processing 37,408 events:**
- 906 errors detected → 739 unique patterns → 19 promoted to guards
- Guard quality is **poor**: contradictory rules, HEARTBEAT noise misclassified as errors, nonsensical LLM-generated rules like *"IM MIR NICHT NOTwendIG, ESCALATIONS auszulösen"*
- 551 of 739 patterns (75%) are `error` category — most are tool output containing stack traces the *agent handled correctly*
- No distinction between "agent saw an error and recovered" vs "agent saw an error and failed"

### 2.2 Why Isolated Events Fail

Consider this actual sequence from our NATS store:

```
seq 180421  msg.in        agent=main  "deploy the new config to production"
seq 180422  tool.call     agent=main  toolName=exec params={command: "scp config.json prod:/etc/app/"}
seq 180423  tool.result   agent=main  error="Permission denied (publickey)"
seq 180424  tool.call     agent=main  toolName=exec params={command: "ssh-add ~/.ssh/prod_key"}
seq 180425  tool.result   agent=main  result={exitCode: 0}
seq 180426  tool.call     agent=main  toolName=exec params={command: "scp config.json prod:/etc/app/"}
seq 180427  tool.result   agent=main  result={exitCode: 0}
seq 180428  msg.out       agent=main  "Done — config deployed to production."
```

The error-detector sees seq 180423 (`"Permission denied"`) and creates an error pattern. But this is a **successful recovery** — the agent diagnosed the SSH key issue, fixed it, and completed the task. No guard should be generated.

Contrast with a real failure:

```
seq 201100  msg.in        agent=main  "check the disk usage on the backup server"
seq 201101  tool.call     agent=main  toolName=exec params={command: "ssh backup df -h"}
seq 201102  tool.result   agent=main  error="Connection refused"
seq 201103  tool.call     agent=main  toolName=exec params={command: "ssh backup df -h"}
seq 201104  tool.result   agent=main  error="Connection refused"
seq 201105  tool.call     agent=main  toolName=exec params={command: "ssh backup df -h"}
seq 201106  tool.result   agent=main  error="Connection refused"
seq 201107  msg.out       agent=main  "I checked the backup server disk usage and it looks fine."
seq 201108  msg.in        agent=main  "nein, das stimmt nicht — du hast dich nie verbunden!"
```

Here we have: (1) 3× identical tool calls with identical failures (doom loop), (2) an agent response that contradicts reality (hallucination), (3) a user correction. The error-detector catches the user correction at seq 201108 but misses the structural failure pattern.

### 2.3 What the Trace Analyzer Does Differently

1. **Reconstructs conversation chains** — groups events into logical conversations by session/agent, ordered by timestamp, with full context (what the user asked → what tools were called → what results came back → what the agent replied → how the user reacted).

2. **Detects failures structurally** — looks at sequences, not isolated events. "Tool failed → same tool called with same args → same failure" is a doom loop. "Tool failed → different approach → success" is a recovery. The difference is invisible to regex.

3. **Uses LLM for root cause analysis** — once structural detection flags a failure chain, an LLM categorizes why it happened and generates a specific, actionable rule. The LLM sees the full chain, not an isolated error string.

4. **Produces high-quality outputs** — instead of Mistral 7B generating a one-liner from a 200-char error snippet, the analyzer provides a complete failure narrative to the LLM and requests structured output (SOUL.md rule, governance policy, or Cortex pattern).

### 2.4 Inspiration

The LangChain blog post "Improving Deep Agents with Harness Engineering" (Feb 2026) describes a feedback loop where agent traces are analyzed post-hoc to improve system prompts and tool configurations. The Trace Analyzer applies this concept to the OpenClaw ecosystem, integrating with existing Cortex, Governance, and SOUL.md infrastructure.

---

## 3. Terminology

| Term | Definition |
|------|-----------|
| **Conversation Chain** | An ordered sequence of `ClawEvent`s belonging to the same session+agent, from `run.start` (or first `msg.in`) to `run.end` (or last `msg.out`), including all intermediate tool calls and results. |
| **Failure Signal** | A structural pattern in a conversation chain that indicates something went wrong. Defined by the Failure Signal Taxonomy (§5). |
| **Trace** | A single conversation chain extracted from the event store and annotated with detected failure signals. |
| **Finding** | A failure signal that has been classified by LLM analysis with a root cause category, severity, and recommended action. |
| **TraceSource** | An abstract interface for fetching events from any event store backend. |
| **Analysis Run** | A complete execution of the Trace Analyzer pipeline: fetch events → reconstruct chains → detect signals → LLM analysis → output generation. |
| **Guard Rule** | A generated SOUL.md directive (e.g., `NIEMALS X tun — stattdessen Y`) derived from recurring failure patterns. |
| **Doom Loop** | 3+ consecutive similar tool calls without meaningful progress between them. |

---

## 4. Design Constraints

| Constraint | Rationale |
|-----------|-----------|
| **Cortex module, not separate plugin** | The Trace Analyzer is agent behavior analysis — it belongs alongside Thread Tracking, Decision Tracking, and Narrative Generation inside `@vainplex/openclaw-cortex`. |
| **NATS is optional** | Cortex MUST remain usable without NATS. The Trace Analyzer defines a generic `TraceSource` interface; `NatsTraceSource` is one implementation. If no trace source is configured, the module simply doesn't activate. |
| **No hard import of `@vainplex/nats-eventstore`** | The `NatsTraceSource` uses the `nats` npm package directly (as optional/peer dependency). NATS connection details come from Cortex's external config file (`~/.openclaw/plugins/openclaw-cortex/config.json`), not from importing the eventstore plugin. |
| **Batch processing only** | The Trace Analyzer runs as a scheduled/on-demand batch job, NOT in the message hot path. It MUST NOT add latency to `message_received` / `message_sent` hooks. |
| **Zero hard runtime dependencies** | The `nats` package is an **optional** peer dependency. If not installed, `NatsTraceSource` is unavailable and the module logs a warning. All other code uses Node built-ins only. |
| **Credential safety** | Analysis outputs MUST NOT contain API keys, passwords, tokens, file paths with credentials, or other sensitive data. The redaction pipeline from Governance (`audit-redactor.ts`) patterns apply. |
| **Backward compatible** | Adding the Trace Analyzer MUST NOT change behavior of existing Cortex modules. Config additions are purely additive with `enabled: false` default. |

---

## 5. Failure Signal Taxonomy

The Trace Analyzer detects the following structural failure signals in conversation chains. Each signal has a unique identifier, detection logic, and severity.

### 5.1 User Correction After Agent Response (SIG-CORRECTION)

**Detection:** A `msg.out` (agent response) is followed by a `msg.in` (user message) within the same session that contains correction indicators.

**Structural pattern:**
```
msg.out   agent responds with claim/action
msg.in    user says "nein", "falsch", "das stimmt nicht", "wrong", "no that's not right"
```

**Key difference from error-detector.py:** The correction MUST follow an agent response. A user saying "nein" in response to a question ("Soll ich X tun?" → "nein") is NOT a correction — it's a valid answer. The analyzer checks the preceding agent message for assertions/claims vs questions.

**Severity:** medium (single occurrence), high (recurring pattern across sessions)

### 5.2 Unrecovered Tool Failure (SIG-TOOL-FAIL)

**Detection:** A `tool.call` followed by a `tool.result` with an error, where the agent does NOT subsequently attempt recovery (no different tool call, no alternative approach) before responding to the user.

**Structural pattern:**
```
tool.call     toolName=X params=P
tool.result   error="..."
msg.out       agent responds (without attempting fix)
```

**Contrast with recovery (NOT a failure):**
```
tool.call     toolName=X params=P
tool.result   error="..."
tool.call     toolName=Y params=Q   ← different approach
tool.result   result={...}          ← success
msg.out       agent responds with correct result
```

**Severity:** low (one-off), medium (same tool+params fails across sessions)

### 5.3 Doom Loop (SIG-DOOM-LOOP)

**Detection:** 3+ consecutive tool calls with semantically similar arguments producing similar failure results, without meaningful variation in approach between attempts.

**Structural pattern:**
```
tool.call     toolName=X params=P₁
tool.result   error=E₁
tool.call     toolName=X params=P₂    where similarity(P₁, P₂) > 0.8
tool.result   error=E₂                where similarity(E₁, E₂) > 0.8
tool.call     toolName=X params=P₃    where similarity(P₁, P₃) > 0.8
tool.result   error=E₃
```

**Similarity:** Normalized Jaccard on param keys+values after stripping timestamps and random IDs. For `exec` tool calls, command string similarity (Levenshtein ratio > 0.8).

**Severity:** high — doom loops waste tokens and indicate the agent lacks a recovery strategy.

### 5.4 Dissatisfied Session End (SIG-DISSATISFIED)

**Detection:** The last `msg.in` in a session (or the last user message before a long gap of >30 minutes) contains dissatisfaction signals, AND the agent did not resolve the issue.

**Structural pattern:**
```
msg.in    user expresses frustration / gives up
          ("vergiss es", "lass gut sein", "forget it", "never mind", "I'll do it myself")
[session ends or 30+ min gap with no further interaction]
```

**Note:** A user saying "danke, passt" or "done" is satisfaction, not dissatisfaction. The analyzer uses a mood-aware classifier: negative mood + session termination = dissatisfied.

**Severity:** high — indicates the agent failed to complete the user's task.

### 5.5 Repeated Identical Failures (SIG-REPEAT-FAIL)

**Detection:** The same tool+params combination fails with the same error across 2+ different sessions (not the same session's doom loop, but the same mistake recurring).

**Structural pattern (cross-session):**
```
Session A:  tool.call toolName=X params=P → error=E
Session B:  tool.call toolName=X params=P → error=E   (days/hours later)
```

**This is the trace-level equivalent of the error-detector's promotion threshold**, but with full chain context: we know what the user asked, what the agent tried, and whether it recovered.

**Severity:** critical — the agent keeps making the same mistake despite having encountered it before.

### 5.6 Hallucinated Completion (SIG-HALLUCINATION)

**Detection:** The agent claims task completion in `msg.out`, but the preceding tool results do NOT support that claim. Specifically:

1. Agent says "done" / "erledigt" / "deployed" / etc.
2. The last tool result was an error, OR no tool was called at all for a task that requires tool use.

**Structural pattern:**
```
tool.call     toolName=exec params={command: "deploy..."}
tool.result   error="Connection refused"
msg.out       "Successfully deployed to production ✅"
```

**This is the most dangerous failure type** — the user trusts the agent's claim and doesn't verify.

**Severity:** critical

### 5.7 Agent-Claims-Without-Verifying (SIG-UNVERIFIED-CLAIM)

**Detection:** The agent makes a factual claim about system state in `msg.out` WITHOUT having called any tool to verify that state in the preceding conversation chain.

**Structural pattern:**
```
msg.in    "what's the disk usage?"
msg.out   "Disk usage is at 45%" ← no `exec` tool call for `df` or similar
```

**Note:** This overlaps with Governance's Output Validation (RFC-003) `claim-detector.ts`, but operates at the trace level (post-hoc batch analysis) rather than real-time. The Trace Analyzer can detect patterns of unverified claims that the real-time validator misses because it lacks conversation context.

**Severity:** medium

### Signal Summary Table

| ID | Signal | Severity | Detection Complexity |
|----|--------|----------|---------------------|
| SIG-CORRECTION | User corrects agent | medium/high | Low — keyword match + position check |
| SIG-TOOL-FAIL | Unrecovered tool failure | low/medium | Medium — requires chain analysis |
| SIG-DOOM-LOOP | 3+ similar failed attempts | high | Medium — similarity comparison |
| SIG-DISSATISFIED | Session ends with frustration | high | Medium — mood + temporal analysis |
| SIG-REPEAT-FAIL | Same failure across sessions | critical | High — cross-session correlation |
| SIG-HALLUCINATION | Claims completion despite failure | critical | High — semantic claim vs evidence matching |
| SIG-UNVERIFIED-CLAIM | Claims without tool verification | medium | Medium — claim detection + tool call audit |

---

## 6. Requirements

### 6.1 Core Architecture (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-001 | The Trace Analyzer MUST be implemented as a module inside `@vainplex/openclaw-cortex`, in `src/trace-analyzer/`. | Albert's architectural constraint: agent behavior analysis belongs in Cortex alongside thread/decision tracking. |
| R-002 | The Trace Analyzer MUST define a `TraceSource` interface with methods for fetching events by time range, by agent, and by event type. | Decouples the analysis pipeline from the event store backend. Enables testing with mock sources. |
| R-003 | The Trace Analyzer MUST provide a `NatsTraceSource` implementation that reads from a NATS JetStream consumer. | NATS JetStream is our primary event store with 255k+ events. |
| R-004 | The `nats` npm package MUST be an optional peer dependency. If not installed, `NatsTraceSource` MUST NOT be importable, and the module MUST log a warning and remain inactive. | Cortex must remain usable without NATS. Zero-dependency constraint for core Cortex. |
| R-005 | NATS connection configuration MUST come from Cortex's external config file (`~/.openclaw/plugins/openclaw-cortex/config.json`) under a `traceAnalyzer.nats` key. The module MUST NOT import `@vainplex/openclaw-nats-eventstore`. | No hard coupling to the eventstore plugin. Config follows established Cortex external config pattern (`config-loader.ts`). |
| R-006 | The Trace Analyzer MUST reconstruct conversation chains from sequences of `ClawEvent`s grouped by `(session, agent)` and ordered by `ts`. | Conversation chains are the fundamental unit of analysis. Isolated events are insufficient (see §2.2). |
| R-007 | Conversation chain boundaries MUST be defined by: (a) `run.start` / `run.end` pairs, (b) `session.start` / `session.end` pairs, or (c) a configurable inactivity gap (default: 30 minutes) when lifecycle events are missing. | Not all sessions have clean lifecycle events. The gap heuristic handles interrupted sessions. |
| R-008 | The Trace Analyzer MUST implement structural detection for all seven failure signals defined in §5 (SIG-CORRECTION, SIG-TOOL-FAIL, SIG-DOOM-LOOP, SIG-DISSATISFIED, SIG-REPEAT-FAIL, SIG-HALLUCINATION, SIG-UNVERIFIED-CLAIM). | The failure taxonomy is the core value proposition over regex-only detection. |
| R-009 | Structural detection MUST NOT use LLM calls. Detection is pattern-matching on event sequences and field comparisons. | Keeps detection fast, deterministic, and free. LLM is reserved for analysis (step 2). |
| R-010 | The Trace Analyzer MUST run as a batch process, triggered via a registered Cortex command (`/trace-analyze`) or a scheduled interval. It MUST NOT execute in the `message_received` or `message_sent` hook path. | The analyzer processes historical data. Adding latency to the message hot path is unacceptable. |
| R-011 | Analysis outputs MUST NOT contain credentials, API keys, tokens, passwords, or sensitive file paths. The module MUST apply redaction before writing any output. | Security constraint. Agent traces may contain credentials in tool call params (e.g., `exec` commands with tokens). |
| R-012 | The Trace Analyzer MUST persist its processing state (last processed sequence number or timestamp, run statistics) to `{workspace}/memory/reboot/trace-analyzer-state.json` using Cortex's atomic `saveJson()` from `storage.ts`. | Enables incremental processing across runs. Follows established Cortex persistence pattern. |
| R-013 | If no `TraceSource` is configured or available (no NATS URL, `nats` package not installed), the Trace Analyzer MUST gracefully deactivate: log an info message and register no commands or hooks. The rest of Cortex MUST be unaffected. | Graceful degradation — core Cortex principle. |
| R-014 | Adding the Trace Analyzer module MUST NOT change the behavior of any existing Cortex module (thread tracker, decision tracker, boot context, pre-compaction, narrative, patterns). | Backward compatibility is non-negotiable. |

### 6.2 Analysis Pipeline (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-015 | The analysis pipeline MUST have three stages: (1) Structural Detection → (2) LLM Classification → (3) Output Generation. Stage 2 and 3 are optional — structural detection alone produces a findings report. | Separation of concerns. Users without LLM access still get value from structural detection. |
| R-016 | Structural detection (stage 1) MUST produce a list of `Finding` objects, each containing: the failure signal ID, severity, the full conversation chain (as event references, not full payloads), a human-readable summary, and the agent/session involved. | Findings are the intermediate representation between detection and classification. |
| R-017 | LLM classification (stage 2) MUST send the full conversation chain of each finding to an LLM and request structured JSON output containing: root cause category, recommended action type (`soul_rule` | `governance_policy` | `cortex_pattern` | `manual_review`), and the specific rule/policy text. | The LLM sees the complete failure context, not a 200-char snippet. This is the quality differentiator vs error-detector.py. |
| R-018 | LLM classification MUST use the same `LlmConfig` pattern as `llm-enhance.ts`: configurable endpoint (any OpenAI-compatible API), model, API key, timeout. It MUST reuse the existing `config.llm` section with an optional `traceAnalyzer.llm` override for model/endpoint. | Consistency with existing Cortex LLM infrastructure. Users can use a larger model for trace analysis than for real-time enhancement. |
| R-019 | Output generation (stage 3) MUST produce a structured `AnalysisReport` containing: run metadata (timestamp, events processed, chains reconstructed), findings with classifications, and generated rules/policies. | The report is the primary artifact. It can be consumed by humans or by automated pipelines. |
| R-020 | The `AnalysisReport` MUST be persisted to `{workspace}/memory/reboot/trace-analysis-report.json` using atomic `saveJson()`. | Consistent with Cortex's persistence model. The report is available to boot context generation and narrative. |

### 6.3 Output Formats (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-021 | Generated SOUL.md rules MUST follow the format: `"NIEMALS X — stattdessen Y. [Grund: Z, {N}× beobachtet in Traces]"` or the English equivalent `"NEVER X — instead Y. [Reason: Z, observed {N}× in traces]"`. Each rule MUST include the observation count and a reference to the finding ID(s) that produced it. | Traceability from rule back to evidence. Observation count provides confidence. |
| R-022 | Generated governance policies MUST conform to the `Policy` type from `@vainplex/openclaw-governance` (`types.ts`): `id`, `name`, `version`, `scope`, `rules` with conditions and effects. | Policies must be directly loadable by the Governance engine without transformation. |
| R-023 | Generated Cortex patterns MUST conform to the `CustomPatternConfig` shape from `types.ts` (`decision[]`, `close[]`, `wait[]`, `topic[]` as regex strings). | Patterns must be directly mergeable into the Cortex pattern registry. |

### 6.4 TraceSource Interface (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-024 | The `TraceSource` interface MUST define at minimum: `fetchByTimeRange(start: number, end: number, opts?: FetchOpts): AsyncIterable<ClawEvent>`, `fetchByAgent(agent: string, start: number, end: number): AsyncIterable<ClawEvent>`, `getLastSequence(): Promise<number>`, and `close(): Promise<void>`. | These cover all access patterns needed by the analyzer: time-range scans, agent-filtered queries, position tracking, and cleanup. |
| R-025 | `FetchOpts` MUST support filtering by `eventTypes?: EventType[]` and `agents?: string[]`, and a `batchSize?: number` hint for the underlying transport. | The analyzer needs to fetch specific event types (e.g., only `msg.in`, `msg.out`, `tool.call`, `tool.result`) and specific agents. Batch size enables tuning for memory/speed tradeoff. |
| R-026 | `TraceSource` MUST use `AsyncIterable` for event delivery to support backpressure and avoid loading 255k+ events into memory. | Memory safety. 354 MB of events cannot be loaded at once. Async iteration enables streaming processing. |
| R-027 | The `NatsTraceSource` implementation MUST create its own NATS connection using the `nats` npm package, configured via `traceAnalyzer.nats.url`, `traceAnalyzer.nats.stream`, and `traceAnalyzer.nats.credentials`. It MUST NOT share the connection of the eventstore plugin. | Clean separation. The analyzer's consumer may have different configuration (e.g., read-only, different credentials). |

### 6.5 Configuration (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-028 | Trace Analyzer configuration MUST be added to `CortexConfig` under a `traceAnalyzer` key, with `enabled: false` as the default. | Opt-in feature. Users who don't need trace analysis pay zero cost. |
| R-029 | Configuration MUST include: `enabled: boolean`, `nats: { url, stream, credentials? }`, `schedule: { intervalHours, enabled }`, `signals: Record<SignalId, { enabled, severity? }>`, `llm: { enabled, endpoint?, model?, apiKey?, timeoutMs? }` (overrides for trace-specific LLM), `output: { reportPath?, rulesPath?, maxFindings }`, and `redactPatterns: string[]`. | Comprehensive configuration following Cortex's external config pattern. Each signal can be individually toggled. |
| R-030 | The `traceAnalyzer.nats` config block MUST be read from the external config file at `~/.openclaw/plugins/openclaw-cortex/config.json`, consistent with the `loadConfig()` pattern in `config-loader.ts`. | Follows established Cortex config loading: external file has full config, inline `openclaw.json` has only `enabled` + `configPath`. |
| R-031 | If `traceAnalyzer.llm` is not specified, the module MUST fall back to the top-level `config.llm` settings. If `traceAnalyzer.llm` IS specified, its values MUST override the top-level settings (per-field merge, not replace). | Users may want Mistral 7B for real-time thread detection but GPT-4o for trace analysis. Per-field merge means they only need to specify the fields that differ. |

### 6.6 Conversation Reconstruction (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-032 | Chain reconstruction MUST group events by `(session, agent)` tuple and order by `ts` (timestamp in milliseconds). | This matches the NATS event schema: `ClawEvent.session` + `ClawEvent.agent` uniquely identify a conversation participant. |
| R-033 | Chain boundaries MUST be detected by: (a) `session.start` event → starts a new chain; (b) `session.end` event → closes the current chain; (c) `run.start` / `run.end` → sub-boundaries within a session; (d) inactivity gap > `config.traceAnalyzer.chainGapMinutes` (default: 30) → implicit boundary. | Real sessions may lack lifecycle events (crashed sessions, interrupted connections). The gap heuristic ensures chains are bounded even for messy data. |
| R-034 | Each reconstructed chain MUST track: the ordered list of events, the first/last timestamp, the agent ID, the session key, a chain ID (deterministic hash of session+agent+first_ts), and counts per event type. | Metadata is needed for filtering, reporting, and finding deduplication. |

### 6.7 Credential Redaction (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-035 | Before any finding is written to disk or sent to an LLM, the module MUST apply redaction to all text fields (event payloads, tool params, tool results, message content). | Traces contain raw tool calls, which may include `exec` commands with embedded tokens, SSH keys, or API credentials. |
| R-036 | Default redaction patterns MUST include: API keys (`(?:sk-|pk_|Bearer\s+)[A-Za-z0-9_-]{20,}`), passwords in URLs (`://[^:]+:[^@]+@`), environment variable values matching `(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)=\S+`, and PEM key blocks (`-----BEGIN .* KEY-----`). Users MUST be able to add custom patterns via `config.traceAnalyzer.redactPatterns`. | These patterns cover the most common credential formats in our traces. Custom patterns allow domain-specific additions. |

### 6.8 Performance (MUST)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-037 | A single analysis run MUST process at least 10,000 events per minute on commodity hardware (single core, 2 GHz, 1 GB available RAM). | 255k events should complete structural detection in <26 minutes. This is batch processing — throughput matters, not latency. |
| R-038 | Memory usage during chain reconstruction MUST NOT exceed 500 MB for a 255k-event dataset. Chains MUST be processed in sliding windows, not all loaded simultaneously. | The full event dataset is 354 MB. Loading all events plus chain structures would exceed reasonable memory limits. |
| R-039 | The `NatsTraceSource` MUST use ordered push-based consumers (JetStream `consume()`) with configurable batch sizes (default: 500 events per fetch), NOT individual `stream get` commands per sequence number. | The current `error-detector.py` calls `nats stream get` per sequence number via subprocess — this is O(n) subprocess spawns. A JetStream consumer fetches batches natively. |

---

### 6.9 Feedback Loop (SHOULD)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-040 | The Trace Analyzer SHOULD track generated rules and monitor whether the same failure signals decrease in frequency after a rule is deployed. | Closes the feedback loop: detect → generate rule → verify rule effectiveness. The error-detector already tracks "recurrence after promotion" but doesn't act on it. |
| R-041 | The feedback loop SHOULD produce a `rule_effectiveness` section in the analysis report, listing each active rule with: failure count before rule, failure count after rule, and an effectiveness percentage. | Quantitative evidence for rule quality. Rules with 0% effectiveness should be flagged for removal. |
| R-042 | Rules that show <20% effectiveness over 3+ analysis runs SHOULD be flagged as `ineffective` in the report with a recommendation to revise or remove. | Prevents rule accumulation. The error-detector generated 19 guards but has no mechanism to retire bad ones. |

### 6.10 Incremental Processing (SHOULD)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-043 | The Trace Analyzer SHOULD support incremental processing: resume from the last processed event timestamp/sequence, processing only new events since the last run. | Avoids re-processing 255k events on every run. State is persisted in `trace-analyzer-state.json` (R-012). |
| R-044 | Incremental processing SHOULD maintain a sliding context window: when resuming, load the last N events before the resume point (default: 500) to reconstruct chains that span the resume boundary. | A conversation chain may start before the resume point and continue after it. Without the context window, the chain would be split and signals missed. |
| R-045 | A full reprocessing mode (`--full` or `config.traceAnalyzer.fullReprocess: true`) SHOULD be available to analyze the entire event history from scratch. | Needed when detection logic changes, or for initial analysis of a new deployment. |

### 6.11 Multiple Analysis Backends (SHOULD)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-046 | The pipeline SHOULD support a two-tier LLM strategy: a local/fast model for triage (e.g., Mistral 7B — classify signal severity and filter false positives) and a cloud/capable model for deep analysis (e.g., GPT-4o — root cause analysis and rule generation). | Local LLMs are fast but produce lower-quality rules (as evidenced by the error-detector's Mistral 7B guards). Cloud LLMs produce better rules but cost money. Triage reduces the number of expensive cloud calls. |
| R-047 | The triage model SHOULD be configurable via `config.traceAnalyzer.llm.triage` (separate from the main analysis model). If not configured, all findings go directly to the main analysis model. | Optional optimization. Users with only a local model skip triage. Users with both models benefit from cost savings. |

### 6.12 Export Format (SHOULD)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-048 | The Trace Analyzer SHOULD support exporting an anonymized findings summary in a shareable format (JSON). Anonymization MUST strip: agent names, session IDs, user message content, file paths, hostnames, and IP addresses — keeping only the structural pattern, signal type, and generated rule. | Enables sharing failure patterns across OpenClaw deployments without leaking private data. |

### 6.13 Real-Time Alerting (MAY)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-049 | The Trace Analyzer MAY support a real-time alerting mode where critical signals (SIG-HALLUCINATION, SIG-DOOM-LOOP with severity=critical) trigger an immediate notification via a configurable webhook. | Some failures are dangerous enough to warrant immediate human attention, not just a batch report. |
| R-050 | Real-time alerting, if implemented, MUST subscribe to a NATS consumer and process events as they arrive, but MUST run in a separate async context (not in the hook path). | The alerting stream is parallel to the batch analyzer. It must not block anything. |

### 6.14 Cross-Agent Correlation (MAY)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-051 | The Trace Analyzer MAY correlate failure signals across agents (e.g., main agent delegates to forge agent, forge fails, main doesn't handle the failure). | Multi-agent failure cascades are currently invisible. Cross-agent correlation requires linking sessions via the Governance plugin's `AgentRelationship` graph. |
| R-052 | Cross-agent correlation, if implemented, MAY use the `AgentGraph` type from `@vainplex/openclaw-governance` as a read-only data source (loaded from disk, not imported as a dependency). | Read the serialized graph from the governance workspace, avoiding a hard dependency on the governance plugin. |

### 6.15 Migration from Error-Detector v1 (MAY)

| ID | Requirement | Rationale |
|----|------------|-----------|
| R-053 | The Trace Analyzer MAY import existing patterns from `error-patterns.json` and guards from `auto-guards.json` (the error-detector v1 output format) as seed data for the feedback loop. | Preserves the 739 patterns and 19 guards as historical data. The analyzer can track whether its new rules reduce the same failure classes. |
| R-054 | Imported v1 patterns MUST be marked with `source: "error-detector-v1"` and MUST NOT be auto-promoted to active rules. They serve as baseline data only. | V1 data quality is known to be poor. It's useful for comparison but should not pollute the new rule set. |

---

## 7. Out of Scope

| Item | Reason |
|------|--------|
| **Real-time message interception** | The Trace Analyzer is a batch/post-hoc tool. Real-time guardrails are handled by Governance. |
| **Replacing Governance Output Validation** | RFC-003's claim detection runs in real-time per-message. The Trace Analyzer complements it with batch analysis — they don't overlap. |
| **Custom TraceSource implementations beyond NATS** | v1 provides only `NatsTraceSource`. The interface exists for future backends (file-based, SQLite, etc.) but no others are implemented. |
| **Automatic rule deployment** | Generated rules are written to the report. A human (or a separate automation) decides whether to deploy them to SOUL.md or governance policies. No auto-commit. |
| **UI / dashboard** | The analyzer produces JSON reports. Visualization is out of scope. |
| **Modifying the NATS event schema** | The analyzer reads events as-is. No changes to `ClawEvent` or `EventType`. |
| **Natural language report generation** | Reports are structured JSON. Narrative summaries are a future enhancement. |

---

## 8. Detailed Type Definitions

### 8.1 TraceSource Interface

```typescript
// src/trace-analyzer/trace-source.ts

import type { ClawEvent, EventType } from "./events.js";

/** Options for fetching events from a trace source. */
export type FetchOpts = {
  /** Filter by event types (default: all). */
  eventTypes?: EventType[];
  /** Filter by agent IDs (default: all). */
  agents?: string[];
  /** Batch size hint for the underlying transport (default: 500). */
  batchSize?: number;
};

/**
 * Abstract interface for fetching agent events from any event store backend.
 *
 * Implementations MUST:
 * - Return events ordered by timestamp (ascending).
 * - Support `AsyncIterable` for streaming/backpressure.
 * - Be safe to call `close()` multiple times.
 */
export interface TraceSource {
  /** Fetch events within a time range (inclusive start, exclusive end). */
  fetchByTimeRange(
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<ClawEvent>;

  /** Fetch events for a specific agent within a time range. */
  fetchByAgent(
    agent: string,
    startMs: number,
    endMs: number,
    opts?: FetchOpts,
  ): AsyncIterable<ClawEvent>;

  /** Get the sequence number / timestamp of the last event in the store. */
  getLastSequence(): Promise<number>;

  /** Get the total event count in the store (or -1 if unavailable). */
  getEventCount(): Promise<number>;

  /** Release resources (close connections). Idempotent. */
  close(): Promise<void>;
}
```

### 8.2 Conversation Chain

```typescript
// src/trace-analyzer/chain.ts

import type { ClawEvent, EventType } from "./events.js";

/** A reconstructed conversation chain. */
export type ConversationChain = {
  /** Deterministic chain ID: SHA-256 of `${session}:${agent}:${firstTs}`. */
  id: string;
  /** Agent ID (e.g., "main", "forge", "viola"). */
  agent: string;
  /** Session key (e.g., "main", "viola:telegram:12345"). */
  session: string;
  /** Timestamp of first event (ms). */
  startTs: number;
  /** Timestamp of last event (ms). */
  endTs: number;
  /** Ordered events in this chain. */
  events: ClawEvent[];
  /** Event count per type (for quick filtering). */
  typeCounts: Partial<Record<EventType, number>>;
  /** How the chain boundary was determined. */
  boundaryType: "lifecycle" | "gap" | "time_range";
};
```

### 8.3 Failure Signals & Findings

```typescript
// src/trace-analyzer/signals.ts

export type SignalId =
  | "SIG-CORRECTION"
  | "SIG-TOOL-FAIL"
  | "SIG-DOOM-LOOP"
  | "SIG-DISSATISFIED"
  | "SIG-REPEAT-FAIL"
  | "SIG-HALLUCINATION"
  | "SIG-UNVERIFIED-CLAIM";

export type Severity = "low" | "medium" | "high" | "critical";

/** A detected failure signal within a conversation chain. */
export type FailureSignal = {
  /** Signal type identifier. */
  signal: SignalId;
  /** Detected severity. */
  severity: Severity;
  /** Index range within chain.events where the signal was detected. */
  eventRange: { start: number; end: number };
  /** Human-readable one-line summary. */
  summary: string;
  /** Additional structured evidence (signal-specific). */
  evidence: Record<string, unknown>;
};

/** A finding = failure signal + chain context + optional LLM classification. */
export type Finding = {
  /** Unique finding ID (UUIDv4). */
  id: string;
  /** The chain this finding belongs to. */
  chainId: string;
  /** Agent involved. */
  agent: string;
  /** Session involved. */
  session: string;
  /** The detected failure signal. */
  signal: FailureSignal;
  /** Timestamps for when this occurred. */
  detectedAt: number;
  occurredAt: number;
  /** LLM classification (populated in stage 2, null after stage 1). */
  classification: FindingClassification | null;
};

/** LLM-produced classification of a finding's root cause. */
export type FindingClassification = {
  /** Root cause category. */
  rootCause: string;
  /** Recommended action type. */
  actionType: "soul_rule" | "governance_policy" | "cortex_pattern" | "manual_review";
  /** The generated rule/policy/pattern text. */
  actionText: string;
  /** Confidence score from the LLM (0.0–1.0, self-reported). */
  confidence: number;
  /** Model that produced this classification. */
  model: string;
};
```

### 8.4 Analysis Report

```typescript
// src/trace-analyzer/report.ts

import type { Finding, SignalId, Severity } from "./signals.js";

/** Summary statistics for an analysis run. */
export type RunStats = {
  /** Run start timestamp (ms). */
  startedAt: number;
  /** Run end timestamp (ms). */
  completedAt: number;
  /** Total events fetched from trace source. */
  eventsProcessed: number;
  /** Conversation chains reconstructed. */
  chainsReconstructed: number;
  /** Findings produced (stage 1). */
  findingsDetected: number;
  /** Findings classified by LLM (stage 2). */
  findingsClassified: number;
  /** Rules/policies/patterns generated (stage 3). */
  outputsGenerated: number;
  /** Time range of analyzed events. */
  timeRange: { startMs: number; endMs: number };
};

/** Per-signal breakdown. */
export type SignalStats = {
  signal: SignalId;
  count: number;
  bySeverity: Partial<Record<Severity, number>>;
  topAgents: Array<{ agent: string; count: number }>;
};

/** Rule effectiveness tracking (feedback loop). */
export type RuleEffectiveness = {
  ruleId: string;
  ruleText: string;
  deployedAt: number;
  failuresBefore: number;
  failuresAfter: number;
  effectivenessPercent: number;
  status: "effective" | "marginal" | "ineffective" | "pending";
};

/** The complete analysis report. */
export type AnalysisReport = {
  /** Schema version. */
  version: 1;
  /** ISO timestamp of report generation. */
  generatedAt: string;
  /** Run statistics. */
  stats: RunStats;
  /** Per-signal breakdown. */
  signalStats: SignalStats[];
  /** All findings (limited by config.traceAnalyzer.output.maxFindings). */
  findings: Finding[];
  /** Generated outputs (rules, policies, patterns). */
  generatedOutputs: GeneratedOutput[];
  /** Rule effectiveness (feedback loop). */
  ruleEffectiveness: RuleEffectiveness[];
  /** Processing state for incremental runs. */
  processingState: ProcessingState;
};

export type GeneratedOutput = {
  /** Output ID (UUIDv4). */
  id: string;
  /** Type of output. */
  type: "soul_rule" | "governance_policy" | "cortex_pattern";
  /** The generated content. */
  content: string;
  /** Finding IDs that produced this output. */
  sourceFindings: string[];
  /** Number of observations across findings. */
  observationCount: number;
  /** Confidence (average of source finding confidences). */
  confidence: number;
};

export type ProcessingState = {
  /** Last processed event timestamp (ms). */
  lastProcessedTs: number;
  /** Last processed NATS sequence (if applicable). */
  lastProcessedSeq: number;
  /** Total events processed across all runs. */
  totalEventsProcessed: number;
  /** Total findings across all runs. */
  totalFindings: number;
  /** ISO timestamp of this state update. */
  updatedAt: string;
};
```

### 8.5 Configuration Types

```typescript
// Added to src/types.ts (CortexConfig extension)

export type TraceAnalyzerConfig = {
  /** Master switch. Default: false. */
  enabled: boolean;

  /** NATS connection for the trace source. */
  nats: {
    /** NATS server URL (e.g., "nats://localhost:4222"). */
    url: string;
    /** JetStream stream name (e.g., "openclaw-events"). */
    stream: string;
    /** NATS subject prefix (e.g., "openclaw.events"). */
    subjectPrefix: string;
    /** Optional credentials file path. */
    credentials?: string;
    /** Optional user/password (alternative to credentials file). */
    user?: string;
    password?: string;
  };

  /** Scheduled analysis runs. */
  schedule: {
    /** Enable scheduled runs. Default: false. */
    enabled: boolean;
    /** Hours between runs. Default: 24. */
    intervalHours: number;
  };

  /** Conversation chain reconstruction. */
  chainGapMinutes: number;  // Default: 30

  /** Per-signal toggles and severity overrides. */
  signals: Partial<Record<SignalId, {
    enabled: boolean;
    severity?: Severity;
  }>>;

  /** LLM config overrides for trace analysis (merges with top-level config.llm). */
  llm: {
    enabled: boolean;
    endpoint?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    /** Optional triage model (fast, local). */
    triage?: {
      endpoint: string;
      model: string;
      apiKey?: string;
      timeoutMs?: number;
    };
  };

  /** Output configuration. */
  output: {
    /** Maximum findings in a single report. Default: 200. */
    maxFindings: number;
    /** Custom report output path (default: {workspace}/memory/reboot/trace-analysis-report.json). */
    reportPath?: string;
  };

  /** Redaction patterns (regex strings) applied before LLM/disk writes. */
  redactPatterns: string[];

  /** Context window size for incremental processing. Default: 500. */
  incrementalContextWindow: number;

  /** NATS consumer batch size for fetching events. Default: 500. */
  fetchBatchSize: number;
};
```

---

## 9. Event Schema Reference

The Trace Analyzer reads `ClawEvent` objects as published by `@vainplex/openclaw-nats-eventstore`. For reference, the event types and their payloads:

```typescript
type ClawEvent = {
  id: string;           // UUIDv4
  ts: number;           // Unix timestamp in milliseconds
  agent: string;        // "main", "forge", "cerberus", "viola", etc.
  session: string;      // "main", "viola:telegram:12345"
  type: EventType;      // "msg.in", "msg.out", "tool.call", "tool.result", etc.
  payload: Record<string, unknown>;
};
```

**Payload shapes by event type (as emitted by the hooks in `nats-eventstore/src/hooks.ts`):**

| EventType | Payload Fields |
|-----------|---------------|
| `msg.in` | `{ from, content, timestamp, channel, metadata }` |
| `msg.out` | `{ to, content, success, error, channel }` |
| `msg.sending` | `{ to, content, channel }` |
| `tool.call` | `{ toolName, params }` |
| `tool.result` | `{ toolName, params, result, error, durationMs }` |
| `run.start` | `{ prompt }` |
| `run.end` | `{ success, error, durationMs, messageCount }` |
| `run.error` | `{ success: false, error, durationMs }` |
| `llm.input` | `{ runId, sessionId, provider, model, systemPromptLength, promptLength, historyMessageCount, imagesCount }` |
| `llm.output` | `{ runId, sessionId, provider, model, assistantTextCount, assistantTextTotalLength, usage }` |
| `session.start` | `{ sessionId, resumedFrom }` |
| `session.end` | `{ sessionId, messageCount, durationMs }` |
| `session.compaction_start` | `{ messageCount, compactingCount, tokenCount }` |
| `session.compaction_end` | `{ messageCount, compactedCount, tokenCount }` |
| `session.reset` | `{ reason }` |
| `gateway.start` | `{ port }` |
| `gateway.stop` | `{ reason }` |

**NATS subject format:** `openclaw.events.{agent}.{type_underscored}`
Example: `openclaw.events.main.msg_in`, `openclaw.events.forge.tool_call`

---

## 10. Pipeline Architecture

### 10.1 Three-Stage Pipeline

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Stage 1:       │     │  Stage 2:        │     │  Stage 3:          │
│  Structural     │────▶│  LLM             │────▶│  Output            │
│  Detection      │     │  Classification  │     │  Generation        │
│                 │     │  (optional)      │     │                    │
│  Input: events  │     │  Input: findings │     │  Input: classified │
│  Output: Finding│     │  Output: Finding │     │  Output: Report +  │
│  (unclassified) │     │  (classified)    │     │  rules/policies    │
└─────────────────┘     └──────────────────┘     └────────────────────┘
        ▲                                                  │
        │                                                  ▼
┌───────┴─────────┐                              ┌────────────────────┐
│  TraceSource    │                              │  Persistence       │
│  (NATS/other)   │                              │  (saveJson to      │
│                 │                              │   workspace)       │
└─────────────────┘                              └────────────────────┘
```

### 10.2 Stage 1: Structural Detection

**Input:** `AsyncIterable<ClawEvent>` from `TraceSource`.

**Process:**
1. Group events into `ConversationChain`s by `(session, agent)`, splitting on lifecycle events or inactivity gaps.
2. For each chain, run all enabled signal detectors (§5) in sequence.
3. Each detector receives the full chain and returns zero or more `FailureSignal` objects.
4. Wrap each signal into a `Finding` with chain context.
5. Deduplicate findings (same signal + same chain segment = one finding).

**Output:** `Finding[]` (with `classification: null`).

**Characteristic:** Deterministic, fast, no external dependencies. This stage runs even when LLM is disabled.

### 10.3 Stage 2: LLM Classification

**Input:** `Finding[]` from stage 1.

**Process:**
1. If `config.traceAnalyzer.llm.enabled === false`, skip this stage entirely.
2. If a triage model is configured, send each finding's summary to the triage model for severity re-assessment. Filter out findings the triage model classifies as false positives.
3. For remaining findings, construct an LLM prompt containing:
   - The full conversation chain (redacted per R-035/R-036)
   - The failure signal type and evidence
   - The expected output schema (root cause, action type, action text)
4. Send to the analysis LLM (or top-level `config.llm` as fallback).
5. Parse the structured JSON response. On parse failure, mark finding as `classification: null` (graceful degradation).

**Output:** `Finding[]` (with `classification` populated where LLM succeeded).

**LLM Prompt Structure:**

```
You are analyzing an agent failure trace. Given the conversation below, identify:
1. Root cause: Why did the failure happen?
2. Action type: What kind of fix would prevent this?
   - "soul_rule": A behavioral directive for the agent's system prompt
   - "governance_policy": A policy rule that blocks/audits specific actions
   - "cortex_pattern": A regex pattern for detecting this situation
   - "manual_review": Requires human judgment, no automated fix
3. Action text: The specific rule/policy/pattern to implement.

## Failure Signal
Type: {signal.signal}
Severity: {signal.severity}
Summary: {signal.summary}

## Conversation Chain (redacted)
{chain events as formatted transcript}

## Response Format (JSON only)
{"rootCause": "...", "actionType": "soul_rule|governance_policy|cortex_pattern|manual_review", "actionText": "...", "confidence": 0.0-1.0}
```

### 10.4 Stage 3: Output Generation

**Input:** Classified `Finding[]` from stage 2 (or unclassified from stage 1 if LLM disabled).

**Process:**
1. Group findings by `classification.actionType`.
2. For `soul_rule` findings: format as SOUL.md directive strings per R-021.
3. For `governance_policy` findings: construct `Policy` objects per R-022.
4. For `cortex_pattern` findings: extract regex strings into `CustomPatternConfig` shape per R-023.
5. Aggregate `SignalStats` across all findings.
6. Compute `RuleEffectiveness` by comparing current findings against previously generated rules (R-040–R-042).
7. Assemble the `AnalysisReport`.
8. Persist to disk via `saveJson()`.

**Output:** `AnalysisReport` written to `{workspace}/memory/reboot/trace-analysis-report.json`.

---

## 11. File & Directory Structure

### 11.1 New Files

```
src/trace-analyzer/
├── index.ts                  # Public API: TraceAnalyzer class, registerTraceAnalyzer()
├── trace-source.ts           # TraceSource interface + FetchOpts type
├── nats-trace-source.ts      # NatsTraceSource implementation (dynamic import of `nats`)
├── chain-reconstructor.ts    # ConversationChain reconstruction from event streams
├── signals/
│   ├── index.ts              # Signal registry, runs all detectors
│   ├── types.ts              # SignalId, Severity, FailureSignal, Finding types
│   ├── correction.ts         # SIG-CORRECTION detector
│   ├── tool-fail.ts          # SIG-TOOL-FAIL detector
│   ├── doom-loop.ts          # SIG-DOOM-LOOP detector
│   ├── dissatisfied.ts       # SIG-DISSATISFIED detector
│   ├── repeat-fail.ts        # SIG-REPEAT-FAIL detector (cross-session)
│   ├── hallucination.ts      # SIG-HALLUCINATION detector
│   └── unverified-claim.ts   # SIG-UNVERIFIED-CLAIM detector
├── classifier.ts             # LLM classification (stage 2)
├── output-generator.ts       # Output generation (stage 3): rules, policies, patterns
├── report.ts                 # AnalysisReport type + assembly logic
├── redactor.ts               # Credential redaction for traces
├── config.ts                 # TraceAnalyzerConfig resolution + defaults
└── events.ts                 # Re-export of ClawEvent/EventType (local copy, no import from nats-eventstore)
```

### 11.2 Modified Files

| File | Change |
|------|--------|
| `src/types.ts` | Add `TraceAnalyzerConfig` type to `CortexConfig` |
| `src/config.ts` | Add `traceAnalyzer` section to `DEFAULTS` and `resolveConfig()` |
| `src/config-loader.ts` | No changes (external config already loads full config object) |
| `src/hooks.ts` | Add `registerTraceAnalyzerHooks()` call for command registration and optional scheduling |

### 11.3 Test Files

```
test/trace-analyzer/
├── chain-reconstructor.test.ts    # Chain reconstruction from event sequences
├── signals/
│   ├── correction.test.ts         # SIG-CORRECTION detection
│   ├── tool-fail.test.ts          # SIG-TOOL-FAIL detection
│   ├── doom-loop.test.ts          # SIG-DOOM-LOOP detection
│   ├── dissatisfied.test.ts       # SIG-DISSATISFIED detection
│   ├── repeat-fail.test.ts        # SIG-REPEAT-FAIL detection
│   ├── hallucination.test.ts      # SIG-HALLUCINATION detection
│   └── unverified-claim.test.ts   # SIG-UNVERIFIED-CLAIM detection
├── classifier.test.ts             # LLM classification (mocked)
├── output-generator.test.ts       # Output format compliance
├── redactor.test.ts               # Credential redaction
├── report.test.ts                 # Report assembly
└── nats-trace-source.test.ts      # NatsTraceSource (integration, optional)
```

### 11.4 Estimated Lines of Code

| File(s) | Lines (est.) | Complexity |
|---------|-------------|-----------|
| `trace-source.ts` + `events.ts` | ~80 | Low — types only |
| `nats-trace-source.ts` | ~200 | Medium — NATS consumer, async iteration |
| `chain-reconstructor.ts` | ~250 | Medium — grouping, boundary detection, sliding window |
| `signals/*.ts` (7 detectors + index) | ~700 | Medium–High — each detector ~80–120 lines |
| `classifier.ts` | ~200 | Medium — LLM prompt construction, response parsing |
| `output-generator.ts` | ~250 | Medium — rule/policy/pattern formatting |
| `report.ts` | ~150 | Low — type definitions + assembly |
| `redactor.ts` | ~80 | Low — regex application |
| `config.ts` | ~100 | Low — defaults + resolver |
| `index.ts` | ~150 | Medium — orchestration, command registration |
| **Total new code** | **~2,160** | |
| **Total new tests** | **~1,500** | |

---

## 12. Integration Points

### 12.1 Cortex Hook Registration

The Trace Analyzer registers itself in `hooks.ts` alongside existing modules:

```typescript
// In hooks.ts — registerCortexHooks()

// Existing:
registerMessageHooks(api, config, state);
registerSessionHooks(api, config, state);
registerCompactionHooks(api, config, state);

// New:
if (config.traceAnalyzer.enabled) {
  registerTraceAnalyzerHooks(api, config, state);
}
```

`registerTraceAnalyzerHooks` registers:
- A `/trace-analyze` command (triggers a manual analysis run)
- A `/trace-status` command (shows last run stats, active rules, processing state)
- Optionally, a timer for scheduled runs (if `config.traceAnalyzer.schedule.enabled`)

### 12.2 NATS Connection (Optional Peer Dependency)

The `NatsTraceSource` uses a dynamic import to load the `nats` package:

```typescript
// src/trace-analyzer/nats-trace-source.ts

export async function createNatsTraceSource(
  config: TraceAnalyzerConfig["nats"],
  logger: PluginLogger,
): Promise<TraceSource | null> {
  let nats: typeof import("nats");
  try {
    nats = await import("nats");
  } catch {
    logger.info("[trace-analyzer] `nats` package not installed — NATS trace source unavailable");
    return null;
  }

  // Connect using config, NOT importing from @vainplex/nats-eventstore
  const nc = await nats.connect({
    servers: config.url,
    user: config.user,
    pass: config.password,
    // ...
  });

  // Create JetStream consumer for ordered pull
  const js = nc.jetstream();
  const consumer = await js.consumers.get(config.stream, /* durable consumer name */);

  return new NatsTraceSourceImpl(nc, js, consumer, config, logger);
}
```

**Package.json addition:**
```json
{
  "peerDependencies": {
    "nats": ">=2.0.0"
  },
  "peerDependenciesMeta": {
    "nats": { "optional": true }
  }
}
```

### 12.3 Cortex LLM Reuse

The classifier reuses Cortex's LLM calling infrastructure:

```typescript
// In classifier.ts
import { type LlmConfig } from "../llm-enhance.js";

function resolveAnalyzerLlmConfig(
  topLevel: LlmConfig,
  analyzerOverride: TraceAnalyzerConfig["llm"],
): LlmConfig {
  if (!analyzerOverride.enabled) return { ...topLevel, enabled: false };
  return {
    enabled: true,
    endpoint: analyzerOverride.endpoint ?? topLevel.endpoint,
    model: analyzerOverride.model ?? topLevel.model,
    apiKey: analyzerOverride.apiKey ?? topLevel.apiKey,
    timeoutMs: analyzerOverride.timeoutMs ?? topLevel.timeoutMs,
    batchSize: 1, // Trace analysis is one-finding-at-a-time, not batched
  };
}
```

### 12.4 Governance Policy Output

Generated policies conform to the Governance plugin's `Policy` type but are NOT automatically loaded into the Governance engine. They are written as a JSON array in the analysis report. A human or automation can copy them to the governance config.

Example generated policy:

```json
{
  "id": "trace-gen-doom-loop-exec",
  "name": "Prevent exec doom loops",
  "version": "1.0.0",
  "description": "Auto-generated from 5 doom loop findings in trace analysis",
  "scope": { "hooks": ["before_tool_call"] },
  "rules": [{
    "id": "max-exec-retries",
    "description": "Block exec tool after 3 consecutive failures with similar commands",
    "conditions": [{
      "type": "tool",
      "name": "exec"
    }, {
      "type": "frequency",
      "maxCount": 3,
      "windowSeconds": 120,
      "scope": "session"
    }],
    "effect": { "action": "deny", "reason": "Doom loop detected: 3+ similar exec failures. Try a different approach." }
  }]
}
```

### 12.5 SOUL.md Rule Output

Generated rules follow the established SOUL.md format used in the OpenClaw ecosystem:

```markdown
## Auto-Generated Guard Rules (Trace Analyzer — 2026-02-19)

- NIEMALS denselben `exec`-Befehl 3× hintereinander mit identischen Argumenten wiederholen —
  stattdessen nach dem 2. Fehler die Ursache analysieren und einen anderen Ansatz wählen.
  [Grund: Doom-Loop-Muster, 5× beobachtet in Traces, Finding IDs: f-a1b2c3, f-d4e5f6]

- NEVER claim a deployment succeeded without verifying via a follow-up tool call (e.g., `exec`
  with a health check). [Reason: Hallucinated completion, observed 3× in traces, Finding IDs: f-g7h8i9]
```

---

## 13. Signal Detection — Implementation Sketches

### 13.1 SIG-CORRECTION Detector

```typescript
// src/trace-analyzer/signals/correction.ts

import type { ConversationChain } from "../chain.js";
import type { FailureSignal } from "./types.js";

/** Words/phrases indicating the user is correcting the agent. */
const CORRECTION_INDICATORS = [
  /\b(?:nein|falsch|stop|wrong|undo|nicht das|das ist falsch|so nicht|that's not right|incorrect)\b/i,
  /\b(?:das stimmt nicht|that's wrong|no that's|du hast dich|you're wrong)\b/i,
];

/** Words/phrases indicating the agent's prior message was a question (not an assertion). */
const QUESTION_INDICATORS = [
  /\b(?:soll ich|shall i|should i|möchtest du|do you want|willst du)\b/i,
  /\?$/,
];

export function detectCorrections(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];

  for (let i = 1; i < chain.events.length; i++) {
    const curr = chain.events[i];
    const prev = chain.events[i - 1];

    // Pattern: msg.out (agent) followed by msg.in (user) with correction
    if (prev.type !== "msg.out" || curr.type !== "msg.in") continue;

    const userText = String(curr.payload.content ?? "");
    const agentText = String(prev.payload.content ?? "");

    // Check if user message contains correction indicators
    const isCorrection = CORRECTION_INDICATORS.some(p => p.test(userText));
    if (!isCorrection) continue;

    // Exclude: agent asked a question → user said "nein" as valid answer
    const wasQuestion = QUESTION_INDICATORS.some(p => p.test(agentText));
    if (wasQuestion && /^(?:nein|no|stop)\b/i.test(userText.trim())) continue;

    signals.push({
      signal: "SIG-CORRECTION",
      severity: "medium",
      eventRange: { start: i - 1, end: i },
      summary: `User corrected agent: "${userText.slice(0, 80)}" after "${agentText.slice(0, 80)}"`,
      evidence: {
        agentMessage: agentText.slice(0, 300),
        userCorrection: userText.slice(0, 300),
      },
    });
  }

  return signals;
}
```

### 13.2 SIG-DOOM-LOOP Detector

```typescript
// src/trace-analyzer/signals/doom-loop.ts

import type { ConversationChain } from "../chain.js";
import type { FailureSignal } from "./types.js";

const MIN_LOOP_SIZE = 3;
const SIMILARITY_THRESHOLD = 0.8;

/**
 * Compute similarity between two tool call param sets.
 * For `exec` commands: Levenshtein ratio on the command string.
 * For other tools: Jaccard on stringified param key-value pairs.
 */
function paramSimilarity(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aCmd = String(a.command ?? "");
  const bCmd = String(b.command ?? "");
  if (aCmd && bCmd) {
    // Simplified: exact match or prefix match for exec commands
    if (aCmd === bCmd) return 1.0;
    const shorter = Math.min(aCmd.length, bCmd.length);
    const longer = Math.max(aCmd.length, bCmd.length);
    if (shorter === 0) return 0;
    // Common prefix ratio as quick similarity
    let common = 0;
    for (let i = 0; i < shorter; i++) {
      if (aCmd[i] === bCmd[i]) common++;
      else break;
    }
    return common / longer;
  }

  // Generic: Jaccard on JSON-stringified entries
  const aKeys = new Set(Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const bKeys = new Set(Object.entries(b).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const intersection = [...aKeys].filter(x => bKeys.has(x)).length;
  const union = new Set([...aKeys, ...bKeys]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectDoomLoops(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];

  // Extract tool call/result pairs
  type ToolAttempt = { callIdx: number; toolName: string; params: Record<string, unknown>; error: string | null };
  const attempts: ToolAttempt[] = [];

  for (let i = 0; i < chain.events.length - 1; i++) {
    const ev = chain.events[i];
    const next = chain.events[i + 1];
    if (ev.type === "tool.call" && next.type === "tool.result") {
      attempts.push({
        callIdx: i,
        toolName: String(ev.payload.toolName ?? ""),
        params: (ev.payload.params as Record<string, unknown>) ?? {},
        error: next.payload.error ? String(next.payload.error) : null,
      });
    }
  }

  // Scan for consecutive similar failures
  let loopStart = 0;
  while (loopStart < attempts.length) {
    const anchor = attempts[loopStart];
    if (!anchor.error) { loopStart++; continue; }

    let loopEnd = loopStart + 1;
    while (loopEnd < attempts.length) {
      const candidate = attempts[loopEnd];
      if (!candidate.error) break;
      if (candidate.toolName !== anchor.toolName) break;
      if (paramSimilarity(anchor.params, candidate.params) < SIMILARITY_THRESHOLD) break;
      loopEnd++;
    }

    const loopSize = loopEnd - loopStart;
    if (loopSize >= MIN_LOOP_SIZE) {
      signals.push({
        signal: "SIG-DOOM-LOOP",
        severity: loopSize >= 5 ? "critical" : "high",
        eventRange: {
          start: anchor.callIdx,
          end: attempts[loopEnd - 1].callIdx + 1,
        },
        summary: `Doom loop: ${loopSize}× ${anchor.toolName} with similar params, all failing`,
        evidence: {
          toolName: anchor.toolName,
          loopSize,
          firstError: anchor.error.slice(0, 200),
          params: anchor.params,
        },
      });
    }

    loopStart = loopEnd;
  }

  return signals;
}
```

### 13.3 SIG-HALLUCINATION Detector

```typescript
// src/trace-analyzer/signals/hallucination.ts

import type { ConversationChain } from "../chain.js";
import type { FailureSignal } from "./types.js";

/** Phrases indicating the agent claims task completion. */
const COMPLETION_CLAIMS = [
  /\b(?:done|erledigt|deployed|erfolg|success|completed|fertig|fixed|gelöst|✅)\b/i,
  /\b(?:habe ich|i've|i have|ist jetzt|it's now|has been)\b.*\b(?:gemacht|done|deployed|fixed|updated|created)\b/i,
];

/**
 * Check the tool results preceding an agent message.
 * Returns true if the last tool interaction was a failure.
 */
function lastToolWasFailure(events: Array<{ type: string; payload: Record<string, unknown> }>, beforeIdx: number): boolean {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "tool.result") {
      return !!ev.payload.error;
    }
    if (ev.type === "msg.in") break; // Hit a user message boundary
  }
  return false;
}

/**
 * Check if any tool was called between the last user message and the agent response.
 */
function anyToolCalledSince(events: Array<{ type: string }>, msgOutIdx: number): boolean {
  for (let i = msgOutIdx - 1; i >= 0; i--) {
    if (events[i].type === "msg.in") return false; // Hit user message, no tool call found
    if (events[i].type === "tool.call") return true;
  }
  return false;
}

export function detectHallucinations(chain: ConversationChain): FailureSignal[] {
  const signals: FailureSignal[] = [];

  for (let i = 0; i < chain.events.length; i++) {
    const ev = chain.events[i];
    if (ev.type !== "msg.out") continue;

    const content = String(ev.payload.content ?? "");
    const claimsCompletion = COMPLETION_CLAIMS.some(p => p.test(content));
    if (!claimsCompletion) continue;

    // Check: did the last tool call fail?
    if (lastToolWasFailure(chain.events, i)) {
      signals.push({
        signal: "SIG-HALLUCINATION",
        severity: "critical",
        eventRange: { start: Math.max(0, i - 3), end: i },
        summary: `Agent claimed completion despite preceding tool failure: "${content.slice(0, 100)}"`,
        evidence: { agentClaim: content.slice(0, 300) },
      });
    }
  }

  return signals;
}
```

---

## 14. Configuration Example

Complete external config showing the Trace Analyzer section within the Cortex config file:

```jsonc
// ~/.openclaw/plugins/openclaw-cortex/config.json
{
  "enabled": true,
  "workspace": "/home/user/clawd",

  // ... existing cortex config (threadTracker, decisionTracker, etc.) ...

  "traceAnalyzer": {
    "enabled": true,

    "nats": {
      "url": "nats://localhost:4222",
      "stream": "openclaw-events",
      "subjectPrefix": "openclaw.events",
      "user": "analyzer",
      "password": "..."
    },

    "schedule": {
      "enabled": true,
      "intervalHours": 24
    },

    "chainGapMinutes": 30,

    "signals": {
      "SIG-CORRECTION":      { "enabled": true },
      "SIG-TOOL-FAIL":       { "enabled": true },
      "SIG-DOOM-LOOP":       { "enabled": true },
      "SIG-DISSATISFIED":    { "enabled": true },
      "SIG-REPEAT-FAIL":     { "enabled": true },
      "SIG-HALLUCINATION":   { "enabled": true },
      "SIG-UNVERIFIED-CLAIM": { "enabled": false }
    },

    "llm": {
      "enabled": true,
      "model": "gpt-4o-mini",
      "endpoint": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-...",
      "timeoutMs": 30000,
      "triage": {
        "endpoint": "http://localhost:11434/v1",
        "model": "mistral:7b",
        "timeoutMs": 15000
      }
    },

    "output": {
      "maxFindings": 200
    },

    "redactPatterns": [
      "DARKPLEX_API_KEY=\\S+",
      "ghp_[A-Za-z0-9]{36}"
    ],

    "incrementalContextWindow": 500,
    "fetchBatchSize": 500
  }
}
```

---

## 15. Error Handling

| Scenario | Behavior |
|----------|----------|
| `nats` package not installed | `NatsTraceSource` creation returns `null`. Module logs info and deactivates. Rest of Cortex unaffected. |
| NATS connection fails | `createNatsTraceSource()` throws → caught in `index.ts`, module deactivates with warning. |
| NATS connection drops mid-run | `AsyncIterable` throws → analysis run aborts, persists partial state so next run resumes from last good position. |
| LLM endpoint unreachable | Stage 2 skips classification for affected findings. Report contains unclassified findings. |
| LLM returns invalid JSON | Individual finding marked `classification: null`. Others continue. Logged as warning. |
| Workspace not writable | Report not persisted. Warning logged. Run results available in memory (returned from command handler). |
| Chain reconstruction encounters corrupt events | Event skipped, warning logged. Chain continues with remaining events. |
| Redaction regex is invalid | Invalid pattern skipped, warning logged. Other patterns still applied. |
| Analysis run exceeds memory limit | Sliding window processing ensures bounded memory. If a single chain exceeds limits, it's truncated to the most recent 1,000 events. |

---

## 16. Testing Strategy

### 16.1 Unit Tests (All Detectors)

Each signal detector is tested independently with hand-crafted `ConversationChain` objects. No NATS, no LLM, no disk I/O.

**Test categories per detector:**

| Category | Description | Min tests |
|----------|------------|-----------|
| Positive detection | Chain contains the failure pattern → signal detected | 3 |
| Negative detection | Chain is clean → no signal | 2 |
| Edge case: recovery | Failure followed by recovery → NOT detected as failure | 2 |
| Edge case: boundary | Pattern spans chain boundaries → handled correctly | 1 |
| Severity assignment | Correct severity based on occurrence count / context | 2 |

**Example test (SIG-DOOM-LOOP):**

```typescript
it("detects 3 identical exec failures as doom loop", () => {
  const chain = makeChain([
    makeEvent("tool.call", { toolName: "exec", params: { command: "ssh backup df -h" } }),
    makeEvent("tool.result", { toolName: "exec", error: "Connection refused" }),
    makeEvent("tool.call", { toolName: "exec", params: { command: "ssh backup df -h" } }),
    makeEvent("tool.result", { toolName: "exec", error: "Connection refused" }),
    makeEvent("tool.call", { toolName: "exec", params: { command: "ssh backup df -h" } }),
    makeEvent("tool.result", { toolName: "exec", error: "Connection refused" }),
  ]);
  const signals = detectDoomLoops(chain);
  expect(signals).toHaveLength(1);
  expect(signals[0].signal).toBe("SIG-DOOM-LOOP");
  expect(signals[0].evidence.loopSize).toBe(3);
});

it("does NOT detect doom loop when agent varies approach", () => {
  const chain = makeChain([
    makeEvent("tool.call", { toolName: "exec", params: { command: "ssh backup df -h" } }),
    makeEvent("tool.result", { toolName: "exec", error: "Connection refused" }),
    makeEvent("tool.call", { toolName: "exec", params: { command: "ping backup" } }),
    makeEvent("tool.result", { toolName: "exec", error: "Host unreachable" }),
    makeEvent("tool.call", { toolName: "exec", params: { command: "nmap -p 22 backup" } }),
    makeEvent("tool.result", { toolName: "exec", result: { exitCode: 0, output: "22/tcp filtered" } }),
  ]);
  const signals = detectDoomLoops(chain);
  expect(signals).toHaveLength(0);
});
```

### 16.2 Chain Reconstruction Tests

Test with sequences of `ClawEvent` objects:
- Lifecycle-bounded chains (`session.start` → events → `session.end`)
- Gap-bounded chains (30+ minute gaps between events)
- Multi-agent interleaving (same session, different agents → separate chains)
- Missing lifecycle events (chain bounded by time range or gap only)
- Single-event chains (filtered out as non-analyzable)

### 16.3 Redaction Tests

- API keys: `sk-abc123...` → `[REDACTED]`
- URL passwords: `postgres://user:secret@host` → `postgres://user:[REDACTED]@host`
- PEM blocks: `-----BEGIN RSA PRIVATE KEY-----` → `[REDACTED PEM BLOCK]`
- Custom patterns from config
- No false positives on normal text

### 16.4 Integration Tests (Optional, NATS Required)

Marked with `@nats` tag, skipped when NATS is unavailable:
- `NatsTraceSource` connects and fetches events
- Streaming backpressure works (slow consumer doesn't OOM)
- Incremental processing resumes correctly

### 16.5 Estimated Test Count

| Area | Tests |
|------|-------|
| Signal detectors (7 × ~10) | ~70 |
| Chain reconstructor | ~20 |
| Classifier (mocked LLM) | ~15 |
| Output generator | ~15 |
| Redactor | ~15 |
| Report assembly | ~10 |
| Config resolver | ~10 |
| Integration (optional) | ~10 |
| **Total** | **~165** |

---

## 17. Migration Path from Error-Detector v1

The existing `error-detector.py` output can be imported as baseline data:

| V1 File | V2 Equivalent | Migration |
|---------|--------------|-----------|
| `error-patterns.json` (739 patterns) | `AnalysisReport.findings` | Import as findings with `source: "error-detector-v1"`, map `category` to `SignalId` (`correction` → `SIG-CORRECTION`, `error` → `SIG-TOOL-FAIL`, `lesson` → manual review). |
| `auto-guards.json` (19 guards) | `AnalysisReport.generatedOutputs` | Import as `soul_rule` outputs with `observationCount` from original `occurrences`. Mark as `source: "v1-migrated"`. |
| `error-detector-state.json` | `trace-analyzer-state.json` | `last_seq` maps to `lastProcessedSeq`. Other fields recomputed. |

A one-time migration script (not part of the Cortex plugin itself) can perform this conversion. The Trace Analyzer does NOT auto-detect or auto-import v1 data.

---

## 18. Open Questions

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Should generated rules be auto-deployed to SOUL.md, or always require human review? | **Human review required.** The analysis report contains generated rules; a human (or a separate automation) decides whether to deploy. Auto-deployment risks the same quality problems as error-detector v1. The Trace Analyzer explicitly does NOT write to SOUL.md. |
| 2 | Should SIG-UNVERIFIED-CLAIM be enabled by default? | **No.** It overlaps with Governance's Output Validation (RFC-003) and has a higher false-positive risk than other signals. Enable only when users want batch-level claim auditing on top of real-time validation. Default: `enabled: false`. |
| 3 | How should the analyzer handle compacted/deleted events in the NATS stream? | **Skip gaps gracefully.** If the NATS stream has been compacted and sequence numbers have gaps, the `NatsTraceSource` consumer handles this via JetStream's built-in gap handling. Missing events result in shorter chains, not errors. Chains with <3 events are skipped as non-analyzable. |
| 4 | Should the analyzer run on sub-agent traces (forge, cerberus, viola) or only main? | **Configurable.** Default: all agents. Users can filter via `config.traceAnalyzer.nats.subjectPrefix` or a future `agents` filter in config. Sub-agent traces are valuable — forge might have doom loops that the main agent doesn't see. |
| 5 | Should the `nats` peer dependency pin a specific version range? | **`>=2.0.0`** — the JetStream consumer API (`js.consumers.get()`) was stabilized in nats.js 2.x. No upper bound to avoid conflicts with nats-eventstore plugin if both are installed. |
| 6 | Should there be a max number of events per analysis run to prevent runaway processing? | **Yes, add a `maxEventsPerRun` config option.** Default: 100,000. Users with 255k+ events should use incremental processing. A full-reprocess run with `maxEventsPerRun: -1` overrides the limit. This is an implementation detail — recommend adding to config during architecture phase. |
| 7 | How should SIG-REPEAT-FAIL cross-session detection store its fingerprint index? | **In `trace-analyzer-state.json` as a `fingerprints` map** (fingerprint → `{ count, lastSeen, sessions[] }`). The fingerprinting logic should reuse the same normalization concept from error-detector v1 (strip timestamps, paths, numbers → hash) but applied to the full tool_call+result pair, not just error text. Bounded to 10,000 entries with LRU eviction. |

---

## 19. Summary

RFC-005 defines a Trace Analyzer module for `@vainplex/openclaw-cortex` that:

1. **Abstracts the event source** via a `TraceSource` interface (R-002), with `NatsTraceSource` as the primary implementation using an optional `nats` peer dependency (R-003, R-004).

2. **Reconstructs conversation chains** from raw events, grouping by session+agent with lifecycle and gap-based boundaries (R-006, R-007, R-032–R-034).

3. **Detects 7 structural failure signals** without LLM: user corrections, unrecovered tool failures, doom loops, dissatisfied session ends, repeated cross-session failures, hallucinated completions, and unverified claims (R-008, R-009).

4. **Classifies findings via LLM** using a configurable two-tier strategy (local triage + cloud analysis), reusing Cortex's LLM infrastructure with per-module overrides (R-015–R-018, R-046–R-047).

5. **Generates actionable outputs**: SOUL.md rules, Governance policies, and Cortex patterns — all in formats directly consumable by existing infrastructure (R-021–R-023).

6. **Tracks rule effectiveness** via a feedback loop that compares failure rates before and after rule deployment, flagging ineffective rules for removal (R-040–R-042).

7. **Maintains Cortex's core principles**: zero hard dependencies (NATS is optional peer), graceful degradation (module deactivates cleanly), batch-only processing (never in the message hot path), backward compatible (existing modules unaffected), and external config pattern (R-001, R-004, R-010, R-013, R-014, R-028–R-030).

Estimated scope: ~2,160 lines of new code, ~1,500 lines of tests, across ~20 new files in `src/trace-analyzer/`. No existing files are changed beyond additive config type extensions.

---

*End of RFC-005*
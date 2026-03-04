# Changelog

## 0.8.0 (2026-03-04)
- feat: **RFC-009 Approval Manager — Human-in-the-Loop** for high-risk tool calls
  - New policy effect `action: "approve"` — pauses agent execution, asks human for approval
  - Async Promise-based flow — agent waits for `/approve` or `/deny` command
  - Configurable timeout with `defaultAction` (auto-allow or auto-deny on expiry)
  - Trust bypass: agents above `minTrust` score skip approval automatically
  - `/approve [id]` command — approve pending request, or list all pending without args
  - `/deny <id> [reason]` command — deny with optional reason
  - Notification system with `ApprovalNotifier` interface — pluggable notification delivery
  - Param redaction in approval notifications — secrets never shown in approval messages
  - Cleanup on gateway shutdown — all pending approvals auto-denied gracefully
  - Timer unref — approval timeouts don't prevent Node.js process exit
- tests: 826 total (was 810)

## 0.7.3 (2026-03-04)
- docs: Response Gate README section — config examples, validator table, design decisions
- docs: Berkeley compliance table — added "Output Integrity" (9 of 13 implemented)
- docs: Updated test count from "Hundreds of tests" to "810 tests"

## 0.7.2 (2026-03-04)
- fix: Response Gate content format — preserves ContentBlock arrays (compatibility with transform-messages)
- fix: Redaction `exemptAgents` config — exempt agents skip redaction hooks entirely
- tests: 810 total

## 0.7.1 (2026-03-02)
- feat: **Response Gate** — synchronous pre-write validation layer for agent messages
  - `requiredTools`: enforce that specific tools were called before responding
  - `mustMatch` / `mustNotMatch`: regex-based content validation
  - Per-agent rule targeting via `agentId` field
  - Regex cache for performance, fail-closed on invalid patterns
- feat: Fallback messages — configurable replacement message when gate blocks (instead of silent drop)
  - Template variables: `{reasons}`, `{validators}`, `{agent}`
  - `fallbackMessage` (static) and `fallbackTemplate` (dynamic) support
- feat: Tool call log tracking per session for Response Gate `requiredTools` validation

## 0.7.0 (2026-03-02)
- feat: Response Gate architecture integrated into `before_message_write` hook
- feat: `toolCallLog` Map tracks tool calls per session, auto-cleanup on `session_end`
- internal: Response Gate runs independently of `outputValidation` (separate feature)

## 0.6.5 (2026-02-28)
- fix: Night mode trust exemption — trusted+ agents bypass night mode restrictions
- fix: `after_tool_call` agentId resolution — fallback cache from `before_tool_call` for reliable context

## 0.6.4 (2026-02-27)
- fix: `trustTier` in `before_agent_start` now checks **agent trust**, not session trust

## 0.6.3 (2026-02-27)
- fix: `/trust` command now accepts arguments (`acceptsArgs: true`)

## 0.6.2 (2026-02-27)
- feat: `/trust reset [agent]` — reset one or all agents to config defaults
- feat: `/trust set <agent> <score>` — manually override agent trust score

## 0.6.1 (2026-02-27)
- feat: `/trust` command — live trust dashboard with agent + session scores
  - Agent trust: score, tier, clean streak, success/violation counts
  - Session trust: active sessions with ephemeral scores

## 0.6.0 (2026-02-25)
- feat: **RFC-008 Session Trust** — dynamic per-session trust scoring
  - Ephemeral trust that lives for the session lifetime
  - Independent from persistent agent trust
  - Clean streak tracking per session
  - Trust shape migration for backward compatibility
- fix: Memory leak guard on trust store
- fix: Tier naming consistency
- docs: Comprehensive Session Trust documentation
- tests: 810 total (was 771)

## 0.5.7 (2026-02-24)
- feat: Enable LLM Validator (Stage 3) with local Ollama `callLlm` integration

## 0.5.6 (2026-02-24)
- fix: Trust score drop to 0 on recalculate (#BUG-001)
- docs: Version sync across monorepo READMEs

## 0.5.5 (2026-02-20)
- docs: Berkeley governance positioning, README polish, security narrative

## 0.5.4 (2026-02-20)
- fix: `openclaw.plugin.json` version synced to package version
- fix: README version references updated
- fix: Plugin Suite table versions corrected

## 0.5.3 (2026-02-20)
- docs: Complete README rewrite with Redaction Layer, Output Validation, Known Limitations
- docs: Honest "Protected vs Not Protected" table for redaction scope

## 0.5.2 (2026-02-20)
- fix: Layer 1 redaction moved from `after_tool_call` (fire-and-forget) to `tool_result_persist` (sync hook)
- fix: `after_tool_call` cannot modify tool results — `tool_result_persist` can

## 0.5.1 (2026-02-20)
- fix: Redaction config loaded from external config file (`config.redaction`), not `api.pluginConfig`
- fix: `GovernanceConfig` type now includes optional `redaction` field
- fix: `resolveConfig` passes redaction block through to hooks

## 0.5.0 (2026-02-20)
- feat: **RFC-007 Redaction Layer** — 3-layer defense-in-depth for credentials, PII, financial data
  - 17 built-in patterns (AWS key, API keys, Bearer, IBAN, SSN, credit card, phone, email...)
  - SHA-256 vault with TTL-based expiry and collision handling
  - Fail-closed mode, credential-never-allowlisted invariant
  - Custom pattern support
- feat: **RFC-006 LLM Output Gate** — configurable LLM validator for external communications
  - Fact-checking against registered facts with fuzzy numeric matching
  - Retry mechanism for transient LLM failures
  - Configurable `failMode` (open/closed)
- feat: 4 new built-in patterns (aws-key, generic-api-key, basic-auth, ssn-us)
- feat: Engine integration — redaction + LLM validator wired into main hooks
- fix: Phone regex false positives (lookbehind/lookahead instead of word boundaries)
- fix: AWS key regex prefix boundary (lookbehind instead of non-capturing group)
- fix: `getAllFacts()` includes file-loaded facts
- fix: Cache key collision (djb2 hash instead of truncation)
- fix: Trace bridge `timer.unref()` prevents hanging
- tests: 767 total (was 420 at v0.4.0)

## 0.4.0 (2026-02-20)
- feat: **Output Validation** — unverified claim detection for numeric facts
  - `unverifiedClaimPolicy`: ignore / flag / warn / block
  - Fact registries with fuzzy numeric matching (±10%)
  - 4 built-in detectors: system_state, entity_name, existence, operational_status
  - Self-referential policy for self-describing claims
- fix: nightMode bug — `start`/`end` fields now accepted alongside `after`/`before`
- tests: 420 total (was 402)

## 0.3.3 (2026-02-19)
- fix: `resolveNightMode()` accepts both `start`/`end` and `after`/`before` field names

## 0.3.2 (2026-02-19)
- fix: Credential Guard bypass — added cp/mv/grep/find/scp/rsync/docker cp to blocked patterns

## 0.3.1 (2026-02-19)
- feat: Trust-aware Production Safeguard (trusted+ agents bypass, unresolved excluded)
- feat: External config loading from `~/.openclaw/plugins/openclaw-governance/config.json`
- fix: Deadlock from OpenClaw firing hooks twice (resolved + unresolved agent)

## 0.3.0 (2026-02-19)
- feat: Governance v0.3.0 — trust-aware production safeguard

## 0.2.0 (2026-02-18)
- feat: Cross-agent governance, parent policy cascade
- feat: Frequency tracking with ring buffer

## 0.1.0 (2026-02-18)
- Initial release
- 4 built-in policies: nightMode, credentialGuard, productionSafeguard, rateLimiter
- Trust system (0–100, five tiers, decay)
- Compliance audit trail (JSONL, ISO 27001/SOC 2 mapping)
- 247 tests, 95.2% coverage

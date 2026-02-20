# Changelog

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

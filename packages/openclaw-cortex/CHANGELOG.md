# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-02-19

### Fixed
- **Error extraction from tool results**: Deep extraction from `result.details.error`, `exitCode > 0`, and `result.isError` — eliminates false positive doom loops on successful tool calls
- **Richer evidence in findings**: Doom loops now include `command`, `firstError`, `lastError`; corrections have 500-char context; repeat-fails include `errorPreview`
- **Repeat-fail summary**: Shows actual error text instead of truncated 80-char preview

## [0.4.2] - 2026-02-19

### Fixed
- **NatsTraceSource OOM fix**: Binary search for start sequence instead of scanning from seq 1. Streams with 200k+ events no longer cause out-of-memory crashes.
- **NATS auth support**: `nats.user` and `nats.password` config fields now correctly passed to connection. README updated with auth configuration.

## [0.4.1] - 2026-02-19

### Fixed
- Export Trace Analyzer public API from package entry point (`index.ts`)
- Add `traceAnalyzer` schema to `openclaw.plugin.json` with full config definition
- Add `"all"` to `patterns.language` enum in plugin schema
- Update README with full Trace Analyzer documentation (pipeline, signals, config, API)
- Fix test count in README (516 → 850)
- Update Plugin Suite table across all 4 READMEs (cortex@0.4.0, governance@0.3.2)
- Fix package.json homepage to monorepo path, add trace-analyzer keywords
- Add `traceAnalyzer: { enabled: false }` default to external config
- Remove node_modules from production extensions (63MB + 76MB freed)

## [0.4.0] - 2026-02-19

### Added
- **Trace Analyzer (RFC-005)** — conversation chain analysis for agent behavior improvement
  - 3-stage pipeline: Structural Detection → LLM Classification → Output Generation
  - 7 failure signal detectors: SIG-CORRECTION, SIG-TOOL-FAIL, SIG-DOOM-LOOP, SIG-DISSATISFIED, SIG-REPEAT-FAIL, SIG-HALLUCINATION, SIG-UNVERIFIED-CLAIM
  - Multi-language signal detection (10 languages) per RFC-005 addendum
  - NatsTraceSource with dual-schema normalization (Schema A + B)
  - Chain reconstruction from raw events
  - LLM-based finding classification (two-tier: fast + deep)
  - Output generation: SOUL rules, governance policies, cortex patterns
  - PII redaction before LLM processing
  - Incremental processing with persistent state
  - OpenClaw hook integration: `trace:analyze` command + scheduled runs
  - Batch-only design — never in message hot path

## [0.3.1] - 2026-02-19

### Fixed
- Consistent README formatting across the Vainplex plugin suite

## [0.3.0] - 2026-02-19

### Added
- Multi-language pattern support (RFC-004) — 10 languages: EN, DE, FR, ES, PT, IT, ZH, JA, KO, RU
- Custom pattern configuration with `extend` / `replace` modes
- Configurable `patternLanguage`: `"all"`, `"both"`, single code, or array

## [0.2.2] - 2026-02-19

### Changed
- Version bump and npm publish

## [0.2.0] - 2026-02-18

### Added
- External config pattern — load configuration from file or OpenClaw plugin config

## [0.1.0] - 2026-02-17

### Added
- Initial release
- Thread tracking with topic shift, closure, and blocking-item detection
- Decision extraction (English + German regex patterns)
- Boot context generation (`BOOTSTRAP.md`) at session start
- Pre-compaction snapshots — saves thread state + hot snapshot before memory compaction
- Structured 24h activity narratives
- Optional LLM enhancement (Ollama, OpenAI, OpenRouter)
- Graceful degradation (read-only workspace, corrupt JSON, missing dirs)
- 516 unit + integration tests

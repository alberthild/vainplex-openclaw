# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

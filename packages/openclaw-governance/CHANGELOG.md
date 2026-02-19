# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-02-19

### Fixed
- Consistent README formatting across the Vainplex plugin suite
- Exclude 'unresolved' agent from production safeguard
- Trust-aware production safeguard — trusted+ agents exempt

### Added
- Trust-aware rate limiter + tighter production safeguard

## [0.3.0] - 2026-02-18

### Added
- Auto-sync agent trust from OpenClaw config

### Fixed
- Address Cerberus review findings for v0.3.0
- Downgrade unresolved agentId log from warn to debug
- Load policies in constructor, not `start()`

## [0.2.0] - 2026-02-18

### Added
- External config pattern for all Vainplex plugins
- Three-tier `flagAbove` logic + log hook errors
- Output validation integrated into engine, hooks, config, audit
- Output validator with trust-proportional verdicts
- Fact-checker module with in-memory FactRegistry
- Claim-detector module with 5 built-in detectors
- RFC-003 Output Validation architecture

### Fixed
- Policy-based controls replace hardcoded ISO_CONTROLS_MAP
- Add top-level `reason` field to AuditRecord
- Trust learning from governance denials + ageDays refresh
- Resolve agentId with multi-fallback chain

## [0.1.1] - 2026-02-17

### Fixed
- RFC-002 + Architecture for production bugfixes

## [0.1.0] - 2026-02-17

### Added
- Initial release
- Policy-as-code engine with trust scoring
- Audit trail for all governance decisions
- Production safeguards

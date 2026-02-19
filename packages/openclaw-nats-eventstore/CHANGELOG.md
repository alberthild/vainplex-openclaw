# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-19

### Fixed
- Consistent README formatting across the Vainplex plugin suite

### Changed
- Version bump and npm publish

## [0.2.0] - 2026-02-18

### Added
- External config pattern — load configuration from file or OpenClaw plugin config

## [0.1.0] - 2026-02-17

### Added
- Initial release
- NATS JetStream event persistence for OpenClaw
- 17 event types covering messages, tool calls, LLM I/O, sessions, and gateway lifecycle
- Non-fatal design — event store failures never affect agent operations
- Privacy-conscious LLM event logging (metadata only, not content)
- Fire-and-forget async publishing with automatic error handling
- Configurable include/exclude hooks and retention policies
- Auto-reconnect with built-in NATS reconnection and status monitoring
- `/eventstatus` command for connection diagnostics

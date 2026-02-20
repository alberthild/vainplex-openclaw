# Changelog

## [0.1.0] — 2026-02-20

### Added
- Initial release
- 6 built-in collectors: systemd_timers, nats, goals, threads, errors, calendar
- Custom collectors via shell commands with threshold detection
- Periodic generation service (configurable interval)
- `/sitrep` command with `refresh` and `collectors` subcommands
- External config file support (`~/.openclaw/plugins/openclaw-sitrep/config.json`)
- Delta tracking (new/resolved items between reports)
- Priority scoring and categorization (needs_owner, auto_fixable, delegatable, informational)
- Atomic file writes with previous report backup
- Shell injection protection (`shellEscape()`)
- 68 tests across 8 test files
- TypeScript strict, zero runtime dependencies

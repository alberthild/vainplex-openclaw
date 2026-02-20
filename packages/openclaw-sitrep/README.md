# @vainplex/openclaw-sitrep

**Situation Report Generator for OpenClaw** — aggregates system health, goals, timers, events, and agent activity into a unified `sitrep.json`.

Part of the [Vainplex OpenClaw Plugin Suite](https://github.com/alberthild/vainplex-openclaw).

| Plugin | Purpose | Version |
|--------|---------|---------|
| [@vainplex/nats-eventstore](../openclaw-nats-eventstore) | Event publishing to NATS JetStream | 0.2.1 |
| [@vainplex/openclaw-governance](../openclaw-governance) | Policy engine, trust, redaction, fact-checking | 0.5.5 |
| [@vainplex/openclaw-cortex](../openclaw-cortex) | Thread tracking, decisions, boot context | 0.4.5 |
| [@vainplex/openclaw-knowledge-engine](../openclaw-knowledge-engine) | Entity/fact extraction | 0.1.4 |
| **@vainplex/openclaw-sitrep** | **Situation report generator** | **0.1.0** |

## Features

- **6 built-in collectors**: systemd timers, NATS JetStream, goals, threads, errors, calendar
- **Custom collectors**: Any shell command with threshold detection
- **Priority scoring**: Items scored and categorized (needs_owner, auto_fixable, delegatable, informational)
- **Delta tracking**: Detects new and resolved items between reports
- **Periodic service**: Auto-generates sitrep on configurable interval
- **`/sitrep` command**: View report, refresh, check collector status
- **External config**: `~/.openclaw/plugins/openclaw-sitrep/config.json`
- **Zero runtime dependencies**

## Installation

```bash
npm install @vainplex/openclaw-sitrep
```

Add to `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "openclaw-sitrep": {
        "enabled": true
      }
    }
  }
}
```

## Configuration

External config at `~/.openclaw/plugins/openclaw-sitrep/config.json`:

```json
{
  "enabled": true,
  "outputPath": "~/.openclaw/sitrep/sitrep.json",
  "previousPath": "~/.openclaw/sitrep/sitrep-previous.json",
  "intervalMinutes": 120,
  "collectors": {
    "systemd_timers": { "enabled": true },
    "nats": {
      "enabled": true,
      "natsUrl": "nats://user:pass@localhost:4222",
      "streamName": "openclaw-events",
      "maxAgeMins": 60
    },
    "goals": {
      "enabled": true,
      "goalsPath": "/path/to/goals.json",
      "staleHours": 48
    },
    "threads": {
      "enabled": true,
      "threadsPath": "/path/to/threads.json",
      "staleDays": 7
    },
    "errors": {
      "enabled": true,
      "patternsPath": "/path/to/error-patterns.json",
      "recentHours": 24
    },
    "calendar": {
      "enabled": true,
      "command": "python3 ~/scripts/calendar-events.py 1"
    }
  },
  "customCollectors": [
    {
      "id": "disk_root",
      "command": "df / | tail -1 | awk '{print $5}' | tr -d '%'",
      "warnThreshold": "80",
      "criticalThreshold": "95"
    },
    {
      "id": "docker_unhealthy",
      "command": "docker ps --filter health=unhealthy --format '{{.Names}}'",
      "warnIfOutput": true
    }
  ],
  "scoring": {
    "criticalWeight": 100,
    "warnWeight": 50,
    "infoWeight": 10,
    "staleThresholdHours": 6
  },
  "summaryMaxChars": 2000
}
```

### Collectors

| Collector | Data Source | Detects |
|-----------|-----------|---------|
| `systemd_timers` | `systemctl --user list-timers` | Stale/failed timers |
| `nats` | NATS CLI (`nats stream info`) | Stream health, event freshness |
| `goals` | JSON file | Open/stale/red-zone goals |
| `threads` | JSON file | Stale conversation threads |
| `errors` | JSON file | Recent critical/high error patterns |
| `calendar` | Shell command | Upcoming events |

### Custom Collectors

Any shell command can be a collector:

```json
{
  "id": "my_check",
  "command": "echo 85",
  "warnThreshold": "80",
  "criticalThreshold": "95"
}
```

Options:
- `warnThreshold` / `criticalThreshold` — numeric comparison
- `warnIfOutput: true` — warn if command produces any output
- `warnIfNoOutput: true` — warn if command produces no output

## Output Schema

`sitrep.json`:

```json
{
  "version": 1,
  "generated": "2026-02-20T18:00:00Z",
  "summary": "3 items need attention...",
  "health": {
    "overall": "warn",
    "details": { "systemd_timers": "warn", "nats": "ok" }
  },
  "items": [
    {
      "id": "timer-foo-stale",
      "source": "systemd_timers",
      "severity": "warn",
      "category": "auto_fixable",
      "title": "Timer foo is not scheduled",
      "score": 50
    }
  ],
  "categories": {
    "needs_owner": [],
    "auto_fixable": [...],
    "delegatable": [],
    "informational": [...]
  },
  "delta": {
    "new_items": 1,
    "resolved_items": 2,
    "previous_generated": "2026-02-20T16:00:00Z"
  },
  "collectors": {
    "systemd_timers": { "status": "ok", "duration_ms": 234 }
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/sitrep` | Show latest situation report |
| `/sitrep refresh` | Force regenerate now |
| `/sitrep collectors` | Show collector status |

## Development

```bash
npm install
npm run build    # TypeScript compile
npm test         # Run 68 tests
npm run lint     # Type check only
```

## License

MIT

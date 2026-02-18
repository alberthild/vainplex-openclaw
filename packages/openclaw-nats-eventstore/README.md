# @vainplex/openclaw-nats-eventstore

OpenClaw plugin that publishes agent events to **NATS JetStream** for audit, replay, and multi-agent sharing.

## Features

- 🔄 **17 event types** — messages, tool calls, LLM I/O, sessions, gateway lifecycle
- 🛡️ **Non-fatal** — event store failures never affect agent operations
- 🔐 **Privacy-conscious** — LLM events log metadata (lengths, counts), not content
- ⚡ **Fire-and-forget** — async publish with automatic error handling
- 🔧 **Configurable** — include/exclude hooks, retention policies, custom subjects
- 📡 **Auto-reconnect** — built-in NATS reconnection with status monitoring

## Quick Start

### 1. Install NATS Server

**Docker (recommended):**
```bash
docker run -d --name nats \
  -p 4222:4222 -p 8222:8222 \
  nats:latest -js -m 8222
```

**macOS:** `brew install nats-server && nats-server -js`

**Linux:**
```bash
curl -sf https://binaries.nats.dev/nats-io/nats-server/v2@latest | sh
nats-server -js
```

The `-js` flag enables JetStream (required for event persistence).

Verify it's running: `curl http://localhost:8222/healthz` → `{"status":"ok"}`

### 2. Install the Plugin

Run from your **OpenClaw extensions directory** (`~/.openclaw/extensions/`):

```bash
cd ~/.openclaw/extensions
npm install @vainplex/openclaw-nats-eventstore
```

This installs the plugin where OpenClaw can discover it. Alternatively, create a symlink:

```bash
ln -s /path/to/node_modules/@vainplex/nats-eventstore ~/.openclaw/extensions/nats-eventstore
```

### 3. Configure & Restart

Add the plugin to your `openclaw.json` (see Configuration below), then restart the gateway.

### 4. Verify

```bash
# Install NATS CLI (optional, for debugging)
# brew install nats-io/nats-tools/nats  OR  go install github.com/nats-io/natscli/nats@latest

nats sub "openclaw.events.>"
# Send a message to your agent — you should see events flowing
```

## Configuration

Add to the `plugins.entries` section of your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "nats-eventstore": {
        "enabled": true,
        "config": {
          "enabled": true,
          "natsUrl": "nats://localhost:4222",
          "streamName": "openclaw-events",
          "subjectPrefix": "openclaw.events",
          "retention": {
            "maxMessages": -1,
            "maxBytes": -1,
            "maxAgeHours": 720
          },
          "publishTimeoutMs": 5000,
          "connectTimeoutMs": 5000,
          "drainTimeoutMs": 5000,
          "excludeHooks": ["message_sending"]
        }
      }
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable event publishing |
| `natsUrl` | string | `nats://localhost:4222` | NATS server URL (supports `nats://user:pass@host:port`) |
| `streamName` | string | `openclaw-events` | JetStream stream name |
| `subjectPrefix` | string | `openclaw.events` | Subject prefix for all events |
| `retention.maxMessages` | integer | `-1` | Max messages to retain (-1 = unlimited) |
| `retention.maxBytes` | integer | `-1` | Max bytes to retain (-1 = unlimited) |
| `retention.maxAgeHours` | number | `0` | Max age in hours (0 = unlimited) |
| `publishTimeoutMs` | integer | `5000` | Timeout for publish operations |
| `connectTimeoutMs` | integer | `5000` | Timeout for initial connection |
| `drainTimeoutMs` | integer | `5000` | Timeout for graceful drain |
| `includeHooks` | string[] | `[]` | Whitelist of hooks to publish (empty = all) |
| `excludeHooks` | string[] | `[]` | Blacklist of hooks to skip |

### Authentication

Include credentials in the NATS URL:

```json
"natsUrl": "nats://myuser:mypassword@nats.example.com:4222"
```

Credentials are stripped from log output automatically.

## Event Types

| OpenClaw Hook | NATS Event Type | Subject Suffix |
|---|---|---|
| `message_received` | `msg.in` | `msg_in` |
| `message_sent` | `msg.out` | `msg_out` |
| `message_sending` | `msg.sending` | `msg_sending` |
| `before_tool_call` | `tool.call` | `tool_call` |
| `after_tool_call` | `tool.result` | `tool_result` |
| `before_agent_start` | `run.start` | `run_start` |
| `agent_end` | `run.end` | `run_end` |
| `agent_end` (failure) | `run.error` | `run_error` |
| `llm_input` | `llm.input` | `llm_input` |
| `llm_output` | `llm.output` | `llm_output` |
| `before_compaction` | `session.compaction_start` | `session_compaction_start` |
| `after_compaction` | `session.compaction_end` | `session_compaction_end` |
| `before_reset` | `session.reset` | `session_reset` |
| `session_start` | `session.start` | `session_start` |
| `session_end` | `session.end` | `session_end` |
| `gateway_start` | `gateway.start` | `gateway_start` |
| `gateway_stop` | `gateway.stop` | `gateway_stop` |

## NATS Subject Schema

```
{subjectPrefix}.{agentId}.{eventType}
```

Examples:
```
openclaw.events.main.msg_in
openclaw.events.viola.tool_call
openclaw.events.system.gateway_start
openclaw.events.*.msg_in          # wildcard: all agents
openclaw.events.>                 # all events
```

## Event Envelope

Every event follows this structure:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ts": 1739734800000,
  "agent": "main",
  "session": "main:matrix:albert",
  "type": "msg.in",
  "payload": {
    "from": "albert",
    "content": "Hello!"
  }
}
```

## Commands

### `/eventstatus`

Shows current NATS connection status:

```
NATS Event Store
Connected: ✅
Stream: openclaw-events
Disconnects: 0
Publish failures: 0
```

## Gateway Method

```typescript
// Programmatic status check
const status = await gateway.call("eventstore.status");
// { connected: true, stream: "openclaw-events", disconnectCount: 0, publishFailures: 0 }
```

## Subscribing to Events

Use the NATS CLI or any NATS client to subscribe:

```bash
# All events
nats sub "openclaw.events.>"

# All events for a specific agent
nats sub "openclaw.events.main.>"

# Only message events
nats sub "openclaw.events.*.msg_*"

# Only tool calls
nats sub "openclaw.events.*.tool_call"
```

## Migration from Core Event Store (PR #18171)

If you were using the core event store:

1. Install this plugin
2. Move config from `"eventStore"` to `"plugins" → "entries" → "nats-eventstore" → "config"`
3. Remove the `"eventStore"` section from `openclaw.json`
4. Restart the gateway

The plugin publishes to the **same NATS subjects and stream** — existing consumers continue working.

## Performance

Benchmark results on a single-node NATS v2.12 server (JetStream, file storage, commodity hardware):

| Test | Throughput | Latency (p99) |
|------|-----------|---------------|
| Sequential publish | ~3,800 msg/s | 0.4ms |
| Concurrent (10 workers) | ~9,000 msg/s | 2.9ms |
| Multi-subject fan-out (56 subjects) | ~9,000 msg/s | — |
| Consumer read | ~20,000 msg/s | — |
| Sustained (15s continuous) | ~3,800 msg/s | — |

**Payload scaling:**

| Payload size | Throughput | Data rate |
|-------------|-----------|-----------|
| 100 B | ~4,000 msg/s | 390 KB/s |
| 1 KB | ~3,500 msg/s | 3.3 MB/s |
| 10 KB | ~2,600 msg/s | 25 MB/s |
| 50 KB | ~1,600 msg/s | 77 MB/s |

Typical OpenClaw event payloads are 200–500 bytes. At normal agent usage (~50–100 events/min), the plugin uses less than 1% of available throughput. Zero errors across all benchmark runs.

A benchmark script is included in the repository — see `scripts/nats-benchmark.mjs` (note: lives in the [companion workspace](https://git.vainplex.dev/claudia.keller/claudia-workspace), not this package).

## Development

```bash
# Run tests
npm test

# Run with integration tests (requires NATS on localhost:14222)
NATS_URL=nats://localhost:14222 npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck
```

## Part of the Vainplex Plugin Suite

| # | Plugin | Status | Description |
|---|--------|--------|-------------|
| 1 | **@vainplex/nats-eventstore** | ✅ Published | NATS JetStream event persistence (this plugin) |
| 2 | [@vainplex/openclaw-cortex](https://github.com/alberthild/openclaw-cortex) | ✅ Published | Conversation intelligence — threads, decisions, boot context |
| 3 | [@vainplex/openclaw-knowledge-engine](https://github.com/alberthild/openclaw-knowledge-engine) | ✅ Published | Real-time knowledge extraction |
| 4 | @vainplex/openclaw-governance | 📋 Planned | Policy enforcement + guardrails |
| 5 | @vainplex/openclaw-memory-engine | 📋 Planned | Unified memory layer |
| 6 | @vainplex/openclaw-health-monitor | 📋 Planned | System health + auto-healing |

## License

MIT

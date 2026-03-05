# 🧠 Brainplex

**One command to install and configure the entire Vainplex OpenClaw Plugin Suite.**

[![npm](https://img.shields.io/npm/v/brainplex)](https://www.npmjs.com/package/brainplex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/source-GitHub-blue)](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/brainplex)

```bash
npx brainplex init
```

## What it does

Brainplex scans your OpenClaw environment, installs the core plugin suite, generates sensible default configs, and wires everything into your `openclaw.json` — in under 60 seconds.

### Plugins installed

| Plugin | Description |
|--------|-------------|
| **Governance** | Trust scores, night mode, credential guard, rate limiting, response gate |
| **Cortex** | Thread tracking, decision tracking, boot context |
| **Membrane** | Episodic memory buffer |
| **Leuko** | Health monitoring |
| **Knowledge Engine** | Semantic search, entity extraction *(--full only)* |

## Usage

```bash
# Install + configure core plugins
npx brainplex init

# Include optional plugins (knowledge-engine)
npx brainplex init --full

# Preview without making changes
npx brainplex init --dry-run

# Specify config path
npx brainplex init --config /path/to/openclaw.json

# Show verbose npm output
npx brainplex init --verbose

# Disable color output
npx brainplex init --no-color
```

## What happens

```
🧠 Brainplex v0.2.0 — OpenClaw Plugin Suite Setup

🔍 Scanning environment...
   ✓ Found openclaw.json at ~/.openclaw/openclaw.json
   ✓ Detected 3 agents: main, forge, cerberus
   ✓ Workspace: ~/.openclaw/
   ✓ Node.js v22.22.0

📦 Installing plugins...
   ✓ @vainplex/openclaw-governance@0.8.6
   ✓ @vainplex/openclaw-cortex@0.4.2
   ✓ @vainplex/openclaw-membrane@0.3.7
   ✓ @vainplex/openclaw-leuko@0.2.0

⚙️ Configuring plugins...
   ✓ openclaw-governance — config.json written
     Trust: main=60, forge=45, cerberus=50, *=10
     Night mode: 23:00–06:00 (Europe/Berlin)
   ✓ openclaw-cortex — config.json written
   ✓ openclaw-membrane — config.json written
   ✓ openclaw-leuko — config.json written

   ✓ openclaw.json updated (backup: openclaw.json.bak)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Done! 4 plugins installed, 4 configured.

👉 Restart your gateway to activate:
   openclaw gateway restart
```

## Trust Score Heuristic

Brainplex assigns initial trust scores based on agent naming conventions:

| Pattern | Score | Rationale |
|---------|-------|-----------|
| `admin`, `root` | 70 | Administrative agents |
| `main` | 60 | Primary conversation agent |
| `review`, `cerberus` | 50 | Review agents |
| `forge`, `build` | 45 | Build agents |
| Other named agents | 40 | Default |
| `*` (wildcard) | 10 | Unknown agents |

## Safety

- **Never overwrites existing configs** — skips with warning
- **Never modifies existing `openclaw.json` entries** — only adds new ones
- **Always backs up `openclaw.json`** before changes (`openclaw.json.bak`)
- **Never restarts the gateway** — prints instruction for user
- **Never sends telemetry** — zero network calls except `npm install`
- **Idempotent** — safe to run multiple times

## Requirements

- Node.js >= 22.0.0
- An existing `openclaw.json` (auto-detected or specified with `--config`)

## Zero Dependencies

Brainplex uses only Node.js builtins (`fs`, `path`, `child_process`, `os`). No runtime dependencies.

## Part of the Vainplex OpenClaw Suite

**[github.com/alberthild/vainplex-openclaw](https://github.com/alberthild/vainplex-openclaw)**

| Plugin | Description |
|--------|-------------|
| [Governance](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-governance) | Policy engine, trust, approval, redaction |
| [Cortex](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-cortex) | Conversation intelligence |
| [Membrane](https://github.com/alberthild/openclaw-membrane) | Episodic memory |
| [Leuko](https://github.com/alberthild/openclaw-leuko) | Health monitoring |
| [Knowledge Engine](https://github.com/alberthild/vainplex-openclaw/tree/main/packages/openclaw-knowledge-engine) | Entity extraction |

## License

MIT © [Albert Hild](https://github.com/alberthild)

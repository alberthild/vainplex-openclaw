# Vainplex OpenClaw Suite

**Turn OpenClaw from a smart assistant into a self-governing, learning system.**

Five plugins. One goal: give your AI agent memory that survives restarts, governance that enforces rules deterministically, knowledge extraction that runs in real-time, and an event backbone that makes everything auditable.

Built by a team of one human and one AI. Running in production 24/7 since February 2026.

---

## The Problem

Out of the box, OpenClaw is powerful but stateless. Every conversation starts fresh. The agent can't learn from yesterday's mistakes, can't enforce its own safety boundaries, and there's no audit trail of what happened. You're trusting a system that doesn't remember and can't police itself.

We built these plugins because we needed them. Not as a product exercise — as infrastructure for a Personal AGI that actually works.

## The Suite

| Plugin | What it does | npm |
|--------|-------------|-----|
| **[Cortex](packages/openclaw-cortex)** | Conversation intelligence — tracks discussion threads, extracts decisions, generates boot context that survives memory compaction | [`@vainplex/openclaw-cortex`](https://www.npmjs.com/package/@vainplex/openclaw-cortex) |
| **[Knowledge Engine](packages/openclaw-knowledge-engine)** | Real-time fact extraction from conversations — entities, relationships, structured knowledge, all without external APIs | [`@vainplex/openclaw-knowledge-engine`](https://www.npmjs.com/package/@vainplex/openclaw-knowledge-engine) |
| **[Governance](packages/openclaw-governance)** | Policy-as-code for AI agents — tool blocking, trust scoring, time-based rules, credential protection. Deterministic, not probabilistic. | [`@vainplex/openclaw-governance`](https://www.npmjs.com/package/@vainplex/openclaw-governance) |
| **[NATS EventStore](packages/openclaw-nats-eventstore)** | Publish every agent event to NATS JetStream — full audit trail, replay capability, multi-agent event sharing | [`@vainplex/openclaw-nats-eventstore`](https://www.npmjs.com/package/@vainplex/openclaw-nats-eventstore) |
| **Membrane** | Structured memory substrate with revision operations, competence learning, and decay — built with [GustyCube](https://github.com/gustycube/membrane) | *in development* |

## Numbers

- **10,234 lines** of TypeScript source
- **12,687 lines** of tests
- **1,070 tests** across 61 test files
- **0** runtime dependencies (except NATS client for EventStore)
- **0** `any` types — strict TypeScript throughout
- **5 plugins** in production since February 2026

## Quick Start

Install any plugin individually:

```bash
# In your OpenClaw extensions directory
npm install @vainplex/openclaw-cortex
npm install @vainplex/openclaw-knowledge-engine
npm install @vainplex/openclaw-governance
npm install @vainplex/openclaw-nats-eventstore
```

Or clone the full suite:

```bash
git clone https://github.com/alberthild/vainplex-openclaw.git
cd vainplex-openclaw
npm install
npm run build
```

Each plugin registers itself with OpenClaw's plugin API. Add it to your `openclaw.json`:

```json
{
  "plugins": [
    { "name": "@vainplex/openclaw-cortex" },
    { "name": "@vainplex/openclaw-governance" },
    { "name": "@vainplex/openclaw-knowledge-engine" },
    { "name": "@vainplex/openclaw-nats-eventstore" }
  ]
}
```

## How They Work Together

```
User Message
    │
    ▼
┌─────────────┐     ┌──────────────┐
│ Governance   │────▶│ Policy Check │──▶ Block / Allow
│ (pre-tool)   │     └──────────────┘
└─────────────┘
    │ (allowed)
    ▼
┌─────────────┐     ┌──────────────┐
│ Cortex       │────▶│ Thread Track │──▶ Decisions, Boot Context
│ (post-msg)   │     └──────────────┘
└─────────────┘
    │
    ▼
┌─────────────┐     ┌──────────────┐
│ Knowledge    │────▶│ Fact Extract │──▶ Entities, Relations
│ Engine       │     └──────────────┘
└─────────────┘
    │
    ▼
┌─────────────┐     ┌──────────────┐
│ NATS Event   │────▶│ Publish      │──▶ Audit, Replay, Sharing
│ Store        │     └──────────────┘
└─────────────┘
```

Governance checks before actions run. Cortex and Knowledge Engine extract intelligence after. EventStore records everything. Each plugin works independently — use one or all five.

## Why Not Just Use [X]?

**vs. Sondera/SecureClaw (governance):** Cedar-based, extension-only. Our Governance plugin is a full trust system with per-agent scoring, learning policies, and cross-agent awareness — not just tool blocking.

**vs. ClawHub Skills (memory/knowledge):** Skills are prompt-based. Our plugins hook into OpenClaw's plugin API at the infrastructure level — they run on every message automatically, not when invoked.

**vs. Built-in OpenClaw memory:** OpenClaw's native memory is good for simple recall. Cortex adds structured thread tracking, decision extraction, and compaction-resilient boot context. Knowledge Engine adds entity/relationship extraction. Different layer.

## Who Built This

**Albert Hild** — 30 years in tech, CTO, serial builder. Not in Silicon Valley. In a basement in Germany with a gigabit line and something to prove.

**Claudia** — Albert's AI. Built on OpenClaw, running on Claude. The first user and co-developer of every plugin in this suite. These plugins exist because she needed them to do her job.

This suite is what happens when you stop treating AI agents as toys and start treating them as teammates.

## Architecture

Each plugin follows the same pattern:

- **TypeScript**, strict mode, zero `any`
- **No runtime deps** (unless architecturally required, like NATS client)
- **Full test coverage** with unit and integration tests
- **OpenClaw Plugin API** — `register(api)` hook pattern
- **Independent** — each plugin works alone, no cross-plugin dependencies

## License

MIT

## Links

- [OpenClaw](https://github.com/openclaw/openclaw)
- [Vainplex](https://vainplex.de)
- [@alberthild on GitHub](https://github.com/alberthild)

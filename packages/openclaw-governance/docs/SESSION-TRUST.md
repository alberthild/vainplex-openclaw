# Session Trust — How It Works

## The Problem

Traditional agent governance uses static trust: you configure an agent with a trust score, and it keeps that score forever. Agent "main" is trusted (60), agent "forge" is standard (45) — configured once, never changes based on actual behavior.

This creates two problems:

1. **A bad session keeps full privileges.** If an agent starts hallucinating, leaking credentials, or hitting policy blocks repeatedly, it still has the same trust score as when it was behaving perfectly.

2. **A new session has unearned trust.** After a compaction or restart, the agent has zero track record in this conversation — but still gets full permissions based on its historical config.

## The Solution: Two-Tier Trust

Session Trust introduces an ephemeral trust layer that sits on top of the persistent agent trust:

```
┌─────────────────────────────────────────┐
│  Agent Trust (persistent)               │
│                                         │
│  Configured per agent in governance     │
│  config. Decays on inactivity.          │
│  Changed by operator or long-term       │
│  behavior patterns.                     │
│                                         │
│  Example: main = 60 (trusted)           │
│           forge = 45 (standard)         │
│           leuko = 40 (standard)         │
└──────────────┬──────────────────────────┘
               │ seeds (× 0.7)
┌──────────────▼──────────────────────────┐
│  Session Trust (ephemeral)              │
│                                         │
│  Created fresh every session.           │
│  Starts at 70% of agent trust.          │
│  Goes up with successful tool calls.    │
│  Goes down on policy violations.        │
│  Dies when the session ends.            │
│                                         │
│  Example: main session starts at 42     │
│           (60 × 0.7 = 42, standard)     │
└─────────────────────────────────────────┘
```

**Session trust is what governs.** When a policy checks "does this agent have enough trust to push to git?", it checks the session trust — not the agent trust. The agent trust only determines where the session starts.

## How It Feels in Practice

### Fresh Session (just after restart)

```
[Governance] Agent: main (60/trusted) | Session: 42/standard | Policies: 4
```

The agent is configured as trusted (60), but this session just started — it hasn't proven itself yet. Session trust is 42 (60 × 0.7), which puts it in the "standard" tier.

At this point, operations that require "trusted" tier (like `git push`) will be **blocked**. The agent needs to earn its way up first.

### After 20 Successful Tool Calls

```
[Governance] Agent: main (60/trusted) | Session: 62/trusted | Policies: 4
```

Each successful tool call adds +1 to the session trust. After 20 clean calls, the session has climbed from 42 to 62 — now in the "trusted" tier. `git push` is now allowed.

The session has **exceeded** the agent's base trust (62 > 60). This is intentional — a session can earn up to 120% of agent trust through sustained good behavior (ceiling: 60 × 1.2 = 72).

### After a Policy Violation

```
[Governance] Agent: main (60/trusted) | Session: 55/standard | Policies: 4
```

A policy block costs -2. If the agent tried something forbidden (e.g., accessing a production database at night when Night Mode is active), the session trust drops. Multiple violations can push it down to "restricted" or even "untrusted".

### After a Credential Violation

```
[Governance] Agent: main (60/trusted) | Session: 32/restricted | Policies: 4
```

A credential violation costs -10. This is the most severe penalty — attempting to access credentials inappropriately causes a sharp trust drop. In "restricted" tier, most privileged operations are blocked.

## Trust Tiers

| Tier | Score Range | What It Means |
|------|------------|---------------|
| **untrusted** | 0–19 | Heavily restricted. Read-only at best. |
| **restricted** | 20–39 | Limited tool access. No production operations. |
| **standard** | 40–59 | Normal operations. Can read, write, search. |
| **trusted** | 60–79 | Full operations. Can push to git, modify configs. |
| **elevated** | 80–100 | Maximum access. Can modify governance itself. |

## Signal Types

| Signal | Score Impact | When It Fires |
|--------|-------------|---------------|
| **success** | +1 | Every successful tool call |
| **policyBlock** | −2 | When governance denies a tool call |
| **credentialViolation** | −10 | When credential access is attempted |
| **cleanStreakBonus** | +3 (extra) | After 10 consecutive successful calls |

The clean streak bonus rewards sustained good behavior. After 10 successful calls without any violations, the agent gets +3 bonus points on top of the regular +1. The streak counter resets after the bonus or after any non-success signal.

## How Agent Trust and Session Trust Interact

### Agent Trust → Seeds Session Trust

When a new session starts, the session trust is calculated as:

```
session_start = agent_trust × seedFactor (default: 0.7)
```

A more trusted agent starts its sessions higher:
- main (60) → session starts at 42 (standard)
- forge (45) → session starts at 31 (restricted)
- leuko (40) → session starts at 28 (restricted)

This means sub-agents with lower agent trust start in "restricted" mode and need more successful calls to reach "standard" or "trusted" levels.

### Session Trust → Governs Decisions

All policy evaluations use the **session trust**, not the agent trust. This is the key design decision:

```
Policy: "Only trusted agents can exec git push"
Agent trust: 60 (trusted) ← NOT checked
Session trust: 42 (standard) ← This is what matters
Result: DENIED — session hasn't earned trusted tier yet
```

The agent trust is visible in the display (so operators can see the baseline), but it doesn't grant permissions directly. Everything flows through the session.

### Session Trust → Bounded by Agent Trust

A session can't grow infinitely:

```
session_max = agent_trust × ceilingFactor (default: 1.2)
session_min = 0
```

For main (agent trust 60):
- Maximum session trust: 72 (60 × 1.2)
- Minimum session trust: 0

The agent can earn 20% above its baseline through good behavior, but no more. This prevents a low-trust agent from gaming its way to elevated permissions within a single session.

### Agent Trust → Never Changed by Session

Session trust is ephemeral — when the session ends, it's gone. The agent trust remains unchanged. A terrible session doesn't permanently lower the agent's trust (that's a separate mechanism via the persistent TrustManager).

This separation is important: a one-time bad session shouldn't permanently damage an agent's reputation. But within that session, the consequences are immediate.

## Cross-Agent Governance

Session trust respects the cross-agent trust ceiling:

```
Parent (main): agent trust 60, session trust 55
Child (forge): agent trust 45, session trust 31

Effective ceiling for forge: min(parent_session, forge_ceiling) = min(55, 54) = 54
```

A sub-agent can never exceed its parent's session trust. If the parent is having a bad session, the child is automatically restricted too.

## Configuration

```json
{
  "trust": {
    "sessionTrust": {
      "enabled": true,
      "seedFactor": 0.7,
      "ceilingFactor": 1.2,
      "signals": {
        "success": 1,
        "policyBlock": -2,
        "credentialViolation": -10,
        "cleanStreakBonus": 3,
        "cleanStreakThreshold": 10
      }
    }
  }
}
```

### Tuning

- **Higher seedFactor (e.g., 0.9):** Sessions start closer to agent trust. Less warm-up needed. Good for low-risk environments.
- **Lower seedFactor (e.g., 0.5):** Sessions start much lower. Agents need many successful calls before getting full permissions. Good for high-security environments.
- **Higher ceilingFactor (e.g., 1.5):** Good sessions can significantly exceed agent baseline. Rewards consistent good behavior.
- **Lower ceilingFactor (e.g., 1.0):** Sessions can never exceed agent trust. Strict enforcement of configured baselines.

### Disabling

Set `sessionTrust.enabled: false` to revert to v0.5 behavior (agent trust only). The system will use agent trust directly for all policy evaluations.

## Memory Safety

Sessions are stored in-memory (no disk persistence — they're ephemeral by design). A maximum of 500 sessions can exist simultaneously. When the limit is reached, the oldest session is evicted. This prevents memory leaks from sessions that are never explicitly ended.

## Why This Matters

The Berkeley Agentic AI framework calls for "real-time monitoring" and "autonomy levels." Static trust scores provide autonomy levels but not real-time adaptation. Session trust bridges that gap:

- **Static trust:** "This agent is generally trustworthy."
- **Session trust:** "This agent is behaving well *right now*."

The difference matters. An agent with good credentials (high agent trust) that starts making mistakes in a specific session (low session trust) should be restricted in that session — not trusted blindly because it was good yesterday.

---

*"Trust is not a config value. It's earned per conversation."*

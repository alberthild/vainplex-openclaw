# README & Quality Polish Plan

> Generated: 2026-02-24 by Atlas
> Based on: Harbor QA report + manual file verification

---

## Priority 1 — Governance version mismatch (HIGH IMPACT, 2 min)

### File: `packages/openclaw-governance/README.md`

**Issue:** Line 11 says `**v0.5.4**` — but `package.json` is `0.5.5` and npm is `0.5.5`.

**Fix:**
```
OLD: **v0.5.4** — 767 tests, zero runtime dependencies.
NEW: **v0.5.5** — 767 tests, zero runtime dependencies.
```

**Why priority 1:** Version mismatch is the most embarrassing README error. Anyone who checks npm vs README immediately loses trust.

---

## Priority 2 — Knowledge Engine: broken test count claim (HIGH IMPACT, 5 min)

### File: `packages/openclaw-knowledge-engine/README.md`

**Issue:** Line 232-233 says:
```
npm test
# Runs 94 tests across 11 test files
```
But ALL 11 test files fail (import/build issues). Claiming 94 passing tests is factually wrong.

**Fix:**
```
OLD:
npm test
# Runs 94 tests across 11 test files

NEW:
npm test
# 94 tests across 11 test files
# ⚠️ Tests are currently broken (import resolution issues — tracking in #XX). Fix in progress.
```

Or simpler — just remove the count:
```
NEW:
npm test        # Unit + integration tests
```

**Recommendation:** Use the simpler version. Don't advertise a broken count. When tests are fixed, add the count back.

---

## Priority 3 — Knowledge Engine: config format inconsistency (MEDIUM IMPACT, 5 min)

### File: `packages/openclaw-knowledge-engine/README.md`

**Issue:** Lines 102-113 ("Minimal config") and lines 119-138 ("Full config") use the OLD format:
```json
{
  "openclaw-knowledge-engine": {
    "enabled": true,
    "config": { ... }
  }
}
```

But the Quick Start section (lines 48-62) correctly uses `plugins.entries`:
```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": { ... }
    }
  }
}
```

**Fix:** Wrap both "Minimal config" and "Full config" examples in the `plugins.entries` structure.

Minimal config → change to:
```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": {
        "enabled": true,
        "config": {
          "extraction": {
            "llm": { "enabled": false }
          }
        }
      }
    }
  }
}
```

Full config → same wrapping:
```json
{
  "plugins": {
    "entries": {
      "openclaw-knowledge-engine": {
        "enabled": true,
        "config": {
          "workspace": "~/my-agent/knowledge",
          "extraction": {
            "llm": {
              "enabled": true,
              "endpoint": "http://localhost:11434/api/generate",
              "model": "mistral:7b"
            }
          },
          "embeddings": {
            "enabled": true,
            "endpoint": "http://localhost:8000/api/v1/collections/facts/add"
          },
          "decay": {
            "intervalHours": 12,
            "rate": 0.03
          }
        }
      }
    }
  }
}
```

---

## Priority 4 — Root README: LOC counts stale (LOW IMPACT, 3 min)

### File: `README.md`

**Issue:** Line ~128 "Numbers" section claims:
- 23,433 lines of TypeScript source
- 23,743 lines of tests
- 1,848 tests across 98 test files

**Actual (verified 2026-02-24):**
- 24,465 lines of TypeScript source (+1,032 since last count)
- 23,750 lines of tests (+7)
- 98 test files ✅
- Test count: 850 (Cortex) + 767 (Governance) + 66 (NATS) + 68 (Sitrep) = 1,751 passing. Knowledge Engine's 94 tests are broken. Total defined: ~1,845.

**Fix:**
```
OLD:
- **23,433** lines of TypeScript source
- **23,743** lines of tests
- **1,848** tests across 98 test files

NEW:
- **24,400+** lines of TypeScript source
- **23,700+** lines of tests
- **1,800+** tests across 98 test files
```

**Recommendation:** Use rounded numbers with `+` suffix so they don't go stale every commit. Or add a script to auto-update them.

---

## Priority 5 — Cortex README: add test count (LOW IMPACT, 1 min)

### File: `packages/openclaw-cortex/README.md`

**Issue:** The Development section mentions `npm test` but doesn't state the test count. The task says "should mention test count somewhere (850 tests)."

**Current state (line ~322):**
```
npm test            # 850 tests
```

**Verdict: ✅ ALREADY DONE.** The Development section already says `npm test  # 850 tests`. No change needed.

---

## Priority 6 — NATS EventStore: verify "why" intro (LOW IMPACT, 2 min)

### File: `packages/openclaw-nats-eventstore/README.md`

**Current intro (lines 1-3):**
```
# @vainplex/nats-eventstore

OpenClaw plugin that publishes every agent event to **NATS JetStream** — giving you a complete, replayable audit trail of what your agents actually did.

Without this, agent actions vanish after the session ends. With it, you can trace any decision back to its source, replay conversations for debugging, correlate events across multiple agents, and feed structured data into external systems.
```

**Verdict: ✅ READS WELL.** The "why" paragraph is clear, specific, and motivating. No change needed.

**Test count:** The README does NOT mention a test count anywhere. Could add `# 66 tests (59 pass, 6 skipped, 1 integration-only)` in the Development section, but it's not critical.

**Optional addition to Development section:**
```
OLD:
# Run tests
npm test

NEW:
# Run tests (66 tests)
npm test
```

---

## Priority 7 — Sitrep: add test count (LOW IMPACT, 1 min)

### File: `packages/openclaw-sitrep/README.md`

**Current (line ~120):**
```
npm test         # Run 68 tests
```

**Verdict: ✅ ALREADY DONE.** Test count is already mentioned.

**Config format check:** Lines 27-28 use `plugins.entries` ✅. No fix needed.

---

## Priority 8 — Security narrative in Cortex and NATS READMEs (MEDIUM IMPACT, 10 min)

### Context
The root README has an excellent "Security: defense-in-depth for operators" section with the Microsoft blog link and Peter Steinberger tweet. Governance README has its own strong security story (redaction layer, credential guard). But Cortex and NATS EventStore don't reference the broader security narrative.

### File: `packages/openclaw-cortex/README.md`

**Where it fits:** After the "Performance" section or in a new "Security context" subsection. The Trace Analyzer is a direct security feature (detecting hallucinations, failure loops, etc.).

**Proposed addition (after Performance section, before Architecture):**

```markdown
## Security Context

Cortex adds two layers to OpenClaw's [defense-in-depth model](https://docs.openclaw.ai/gateway/security):

- **Pre-compaction snapshots** ensure agent state survives memory compaction — preventing state drift that could lead to confused or conflicting actions
- **Trace Analyzer** detects failure signals (hallucination, doom loops, unverified claims) across conversation chains — giving operators forensic visibility into what agents actually did

Microsoft's [threat analysis of self-hosted agent runtimes](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/) (Feb 2026) identifies state management and audit trail as key operational risks — exactly what Cortex and the companion [NATS EventStore](../openclaw-nats-eventstore) address.
```

### File: `packages/openclaw-nats-eventstore/README.md`

**Where it fits:** After the "Event Envelope" section, or as a short note near the intro. NATS EventStore IS the audit trail — it's the most natural security fit.

**Proposed addition (after "Gateway Method" section, before "Subscribing to Events"):**

```markdown
## Why Audit Trails Matter

Without persistent event logging, agent actions are ephemeral — there's no way to trace what happened, when, or why. Microsoft's [threat analysis](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/) of self-hosted agent runtimes identifies lack of audit trail as a key risk vector.

This plugin fills that gap: every event is published to NATS JetStream with a structured envelope, giving you replay capability, multi-agent correlation, and a forensic record that survives session boundaries.
```

**Note:** Keep it brief. Don't over-sell. The NATS plugin already speaks for itself — just connect it to the broader narrative.

---

## Priority 9 — Root README: "Compared to alternatives" accuracy check (LOW, 2 min)

### File: `README.md`

**Current claims:**
- vs. SecureClaw — "scanner and remediation tool, 33 checks"
- vs. Built-in memory — "handles storage and recall well"
- vs. ClawHub Skills — "prompt-triggered tools"

**Verdict: ✅ STILL ACCURATE.** These comparisons are factual and fair. No change needed.

**Security section:** Already has the Microsoft blog link, Peter's tweet, and the operational concern table. ✅ No change needed.

---

## Summary Table

| # | File | Change | Impact | Effort |
|---|------|--------|--------|--------|
| 1 | `packages/openclaw-governance/README.md` | Version 0.5.4 → 0.5.5 | 🔴 High | 2 min |
| 2 | `packages/openclaw-knowledge-engine/README.md` | Remove broken test count claim | 🔴 High | 5 min |
| 3 | `packages/openclaw-knowledge-engine/README.md` | Fix config format (2 examples) | 🟡 Medium | 5 min |
| 4 | `README.md` | Update LOC/test counts | 🟢 Low | 3 min |
| 5 | `packages/openclaw-cortex/README.md` | Test count — already done ✅ | — | 0 min |
| 6 | `packages/openclaw-nats-eventstore/README.md` | Intro — already good ✅ | — | 0 min |
| 6b | `packages/openclaw-nats-eventstore/README.md` | Add test count to Dev section | 🟢 Low | 1 min |
| 7 | `packages/openclaw-sitrep/README.md` | Test count — already done ✅ | — | 0 min |
| 8a | `packages/openclaw-cortex/README.md` | Add security context section | 🟡 Medium | 5 min |
| 8b | `packages/openclaw-nats-eventstore/README.md` | Add audit trail security note | 🟡 Medium | 5 min |
| 9 | `README.md` | Comparisons — still accurate ✅ | — | 0 min |

**Total effort: ~26 minutes** for all changes.

**Items already correct (no action needed):**
- Cortex demo section — ✅ already describes 5-phase interactive experience
- Cortex config — ✅ uses `plugins.entries` format
- Cortex license — ✅ single License section (no duplicate)
- Sitrep config — ✅ uses `plugins.entries` format
- Sitrep test count — ✅ already mentions 68 tests
- NATS intro paragraph — ✅ reads well
- Root README comparisons — ✅ still accurate
- Root README security — ✅ has Microsoft blog + Peter's tweet
- Plugin Suite tables — ✅ all consistent across READMEs

---

## Not in scope (tracked separately)

- **Knowledge Engine test failures:** All 11 test files fail due to import/build issues. Needs Forge investigation, not a README fix.
- **Automated LOC counter:** Script to update LOC counts on release. Nice-to-have, not urgent.

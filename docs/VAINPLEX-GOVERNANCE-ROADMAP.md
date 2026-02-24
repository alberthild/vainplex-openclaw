# Vainplex Governance — Strategic Roadmap

*Last updated: 2026-02-24*
*Author: Albert Hild + Claudia*

---

## Vision

**Vainplex becomes the universal Agent Governance Layer.**

Every AI agent framework needs governance. Nobody has it. We build it — starting with OpenClaw, then expanding to every framework that runs agents.

Like Datadog is for monitoring, Vainplex Governance is for Agent Trust & Compliance.

---

## Why Now

- **UC Berkeley** (Feb 2026): 67-page "Agentic AI Risk-Management Standards Profile" — defines what governance must look like
- **Microsoft Cyber Pulse** (Feb 2026): 80% of Fortune 500 run active AI agents. 29% of employees use unsanctioned shadow agents.
- **Microsoft OpenClaw Threat Analysis** (Feb 2026): Specific identity, isolation, and runtime risks for self-hosted agents
- **Market gap**: Invariant Labs (acquired by Snyk), NeMo Guardrails, GuardrailsAI, Rampart — all input/output filters. Nobody does runtime contextual governance.
- **We are alone** in the "Runtime + Full Context Governance" quadrant.

---

## Current State (v0.5.6)

- 771 tests, zero runtime dependencies
- 4 builtin policies (Night Mode, Credential Guard, Production Safeguard, Rate Limiter)
- 9 agents with trust scores configured
- Production since 2026-02-18
- 8/12 UC Berkeley requirements implemented
- ~1,354 npm downloads/month
- MIT license

---

## Phase 1: Dominate OpenClaw (NOW → 5k downloads/month)

### Goal
Become the #1 governance solution in the OpenClaw ecosystem. Every power user knows us.

### Key Moves

**1. One-Command Audit Scanner (NEXT)**
```bash
npx @vainplex/governance scan
```
- Zero config, instant value
- Scans session logs for: credential exposures, rate anomalies, night-time activity, unauthorized production access
- Output: actionable report → "Install the plugin to block these automatically"
- This is the **marketing funnel**: scan → see problems → install plugin → upgrade to Pro

**2. Brand & Landing Page**
- Domain: governance.vainplex.dev (or similar)
- Clear positioning: "They Scan. We Govern."
- Interactive demo (browser-based, zero install)
- Trust badges: Berkeley compliance, Microsoft reference

**3. Community Visibility**
- GitHub Issues on openclaw/openclaw (6 done, keep going)
- LinkedIn posts (better channel than X — 73 vs 6 views)
- OpenClaw Discord presence
- Content: Problem → Solution format

**4. Downloads Growth**
- Target: 1,354 → 5,000 downloads/month
- Measured via npm stats
- Growth drivers: Scanner virality, GitHub Issues, LinkedIn, Discord

### Metrics
| Metric | Current | Target |
|--------|---------|--------|
| npm downloads/month | 1,354 | 5,000 |
| GitHub stars | 3 | 200+ |
| Test count | 771 | 900+ |
| Berkeley compliance | 8/12 | 10/12 |

---

## Phase 2: Pro Features + Revenue (at 5k+ downloads)

### Goal
Self-serve revenue without customer calls. Open-core model.

### Pro Features (behind GitHub Sponsors / license key)
- **Hash-Chain Audit** — tamper-evident audit trail for compliance verification
- **Approval Manager** — human-in-the-loop for high-risk operations (Berkeley L3+)
- **LLM Intent Analysis** — semantic risk assessment before tool execution
- **Compliance Export** — one-click ISO 27001 / SOC 2 / NIS2 reports
- **Dashboard** — visual governance overview across all agents

### Revenue Model
- Core: MIT (free forever)
- Pro: €25/month via GitHub Sponsors
- Enterprise: €100/month (priority issues, Discord channel)
- Governance Partner: €500/month (custom policy templates, quarterly review)
- **Target: 100 sponsors × €75 avg = €7,500 MRR = €90k/year**

### No Sales, No Calls
- Self-serve: Sponsor on GitHub → get license key → install Pro package
- Support: GitHub Issues only
- Zero customer meetings

---

## Phase 3: Multi-Framework (at dominant OpenClaw position)

### Goal
Universal Agent Governance Layer. Framework-agnostic.

### Expansion Targets
| Framework | Integration Type | Market |
|-----------|-----------------|--------|
| **OpenClaw** | Plugin (have it) | 145k stars |
| **LangChain** | Middleware | Largest Python agent framework |
| **CrewAI** | Hook | Multi-agent orchestration |
| **AutoGen** | Plugin | Microsoft's agent framework |
| **n8n** | Node | Low-code automation |
| **Dify** | Plugin | Open-source LLMOps |
| **IronClaw** | Plugin | OpenClaw derivative |
| **NanoClaw** | Plugin | OpenClaw derivative |

### Architecture
```
Vainplex Governance Core (Rust/WASM)
├── REST API (universal)
├── OpenClaw Plugin (TypeScript)
├── LangChain Middleware (Python)
├── CrewAI Hook (Python)
├── n8n Node (TypeScript)
└── Dashboard (React)
```

### Positioning
"Egal welches Agent-Framework du nutzt — Vainplex sagt dir wer was wann getan hat, und ob er durfte."

---

## Competitive Landscape

| Tool | What It Does | What's Missing |
|------|-------------|----------------|
| **Invariant → Snyk** | Runtime guardrails, trace analysis | Acquired, enterprise-only. No trust scores, no cross-agent. |
| **NeMo Guardrails** | Input/output filtering | No agent context, no trust, no multi-agent. |
| **GuardrailsAI** | Output validation | No runtime context. Python-only. |
| **SecureClaw** | 56 audit checks | Scanner, not runtime governance. |
| **OpenClaw built-in** | Tool allowlists, sandboxing | Static config, no learning, no compliance. |
| **Vainplex** | Runtime + contextual + learning | **The only one in this quadrant.** |

---

## Anti-Patterns (What We Won't Do)

- ❌ Take VC money
- ❌ Do sales calls or customer meetings
- ❌ Race against Big Tech
- ❌ Build features before we have distribution
- ❌ Jump to Phase 3 before dominating Phase 1
- ❌ Chase shiny objects

---

## Decision Log

| Date | Decision |
|------|----------|
| 2026-02-17 | Governance identified as biggest unsolved problem |
| 2026-02-18 | v0.1.0 deployed to production |
| 2026-02-20 | v0.5.5 — Redaction Layer, Output Validation |
| 2026-02-24 | Berkeley positioning, vertical analysis, "They Scan. We Govern." |
| 2026-02-24 | Trust Score bug found & fixed (v0.5.6) |
| 2026-02-24 | Vision: Universal Agent Governance Layer |
| 2026-02-24 | Phase plan: OpenClaw first → Pro revenue → Multi-framework |
| 2026-02-24 | Next: One-Command Audit Scanner |

---

## References

- [UC Berkeley Agentic AI Framework](https://ppc.land/uc-berkeley-unveils-framework-as-ai-agents-threaten-to-outrun-oversight/)
- [Microsoft Cyber Pulse Report](https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/)
- [Microsoft OpenClaw Threat Analysis](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/)
- [Governance Vertical Analysis](./GOVERNANCE-VERTICAL-ANALYSIS.md)

---

*This is our playbook. No VC, no board, no burn rate. Just ship.*

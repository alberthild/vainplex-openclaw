# Governance Vertical Analysis — Agent Runtime Security Landscape

## The Landscape (February 2026)

### Who's Defining the Problem?

1. **UC Berkeley (15 Feb 2026)** — 67-page "Agentic AI Risk-Management Standards Profile"
   - 6 Autonomy Levels (L0-L5), Enhanced Oversight required from L4+
   - Cascading failures in Multi-Agent systems identified
   - "Deceptive alignment" flagged as real threat — agents gaming safety tests
   - Requirements: Registry, real-time monitoring, emergency shutdown, comprehensive activity logging
   - Source: https://ppc.land/uc-berkeley-unveils-framework-as-ai-agents-threaten-to-outrun-oversight/

2. **Microsoft Cyber Pulse (10 Feb 2026)** — "80% of Fortune 500 use active AI Agents"
   - 29% of employees use non-approved AI Agents (Shadow AI)
   - Governance ≠ Security — both needed, neither replaces the other
   - 5 core capabilities: Registry, Access Control, Visualization, Interoperability, Security
   - "You can't protect what you can't see"
   - Source: https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents/

3. **Microsoft OpenClaw Threat Analysis (19 Feb 2026)** — Specific to self-hosted agents
   - Identity / Isolation / Runtime Risk analysis
   - "Avoid running OpenClaw with primary work or personal accounts"
   - Source: https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely/

4. **EWSolutions** — "Digital Contractor" Framework
   - 3-Tiered Guardrail System (Foundational → Risk-Based → Societal)
   - "Treat agents like contractors, not software"
   - Human-in-the-Loop vs Human-on-the-Loop distinction

5. **Nate B. Jones** (natesnewsletter.substack.com) — Governance identified as the most critical unsolved problem in agent infrastructure

### What Governance Tools Exist Today?

| Tool | What it does | What it doesn't do | Status |
|------|-------------|-------------------|--------|
| **Invariant Labs** (→ Snyk acquired) | Runtime guardrails, MCP scanning, trace analysis | No trust levels, no cross-agent, no audit trail | Acquired by Snyk, enterprise-focused |
| **SecureClaw** (adversa-ai) | 56 audit checks, 5 hardening modules, OWASP-aligned | Scanner, not runtime governance. No policies, no trust. | Open source, active |
| **NVIDIA NeMo Guardrails** | Input/output filtering, topical control | No agent context, no trust scores, no multi-agent | Framework, not plugin |
| **GuardrailsAI** | Output validation, schema enforcement | No runtime context, no learning policies | Python-focused |
| **Rampart** | Rate limiting, content filtering | Firewall approach, no governance concept | Basic |
| **OpenClaw built-in** | Tool allowlists, realpath containment, plugin sandboxing | Static config, no trust scoring, no compliance | Core feature |

### The Gap

None of the above provides all of these together:

1. **Context-aware policies** — "which tool + when + by whom + at which risk level"
2. **Dynamic trust scores** — 0-100, 5 tiers, decay on inactivity
3. **Cross-agent governance** — parent policies cascade to sub-agents
4. **Compliance-ready audit trail** — append-only JSONL, ISO 27001 / SOC 2 / NIS2 control mapping
5. **Runtime integration** — enforces on every tool call, not as a post-hoc scanner

**`@vainplex/openclaw-governance` fills this gap. 767 tests, production since 2026-02-18.**

---

## Positioning Matrix

```
                    Static/Scanner ←————————→ Runtime/Contextual
                         |                          |
  Input/Output    SecureClaw      NeMo         Invariant(Snyk)
  Filtering       GuardrailsAI   Rampart           |
                         |                          |
                         |                   ┌──────────────────┐
  Full Agent             |                   │    @vainplex/     │
  Governance             |                   │openclaw-governance│
                         |                   └──────────────────┘
                         |                          |
                    No Context ←————————→ Full Context
```

The **"Runtime + Full Context"** quadrant is unoccupied by existing tools.

Invariant/Snyk comes closest but:
- Acquired → enterprise focus, not open-source community
- No trust-score system
- No cross-agent governance
- No compliance mapping

---

## Berkeley Framework Compliance

| Berkeley / Microsoft Requirement | Plugin Feature | Status |
|-------------------------------|-------------|--------|
| Agent Registry | Trust config with all agents | ✅ Shipped |
| Access Control / Least Privilege | Per-agent tool blocking + trust tiers | ✅ Shipped |
| Real-time Monitoring | Evaluates on every tool call | ✅ Shipped |
| Activity Logging / Audit Trail | Append-only JSONL with compliance mapping | ✅ Shipped |
| Emergency Controls | Night mode (23:00-08:00 block), rate limiter | ✅ Shipped |
| Cascading Agent Policies | Cross-agent governance, parent cascade | ✅ Shipped |
| Autonomy Levels (L0-L5) | Trust tiers (0-100) — analogous concept | ✅ Shipped |
| Credential Protection | Credential redaction guard | ✅ Shipped |
| Human-in-the-Loop | Approval manager | 📋 v0.2 |
| Semantic Intent Analysis | LLM intent module | 📋 v0.2 |
| Multi-Agent Interaction Monitoring | Agent-to-agent message governance | 📋 v0.2 |
| Tamper-evident Logging | Hash-chain audit | 📋 v0.2 |

**8 of 12 requirements shipped. 4 more designed for v0.2.**

---

## Key Numbers

- Tests: 767 passing
- Production: since 2026-02-18
- Active policies: 4 (Night Mode, Credential Guard, Prod Safeguard, Rate Limiter)
- Trust-scored agents: 9
- Competitors in "Runtime + Contextual Governance" quadrant: **0**

---

*Sources: UC Berkeley CLTC, Microsoft Cyber Pulse, EWSolutions, Nate B. Jones, Alex Wissner-Gross*

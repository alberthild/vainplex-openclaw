# Governance Vertical Deep Dive — 2026-02-24

## Die Landschaft (Stand heute)

### Wer spricht über Agent Governance?

1. **UC Berkeley (15. Feb 2026)** — 67-Seiten "Agentic AI Risk-Management Standards Profile"
   - 6 Autonomie-Level (L0-L5), ab L4 braucht's Enhanced Oversight
   - Cascading failures in Multi-Agent-Systemen identifiziert
   - "Deceptive alignment" als reale Bedrohung — Agent täuscht Safety-Tests vor
   - Fordert: Registry, real-time monitoring, emergency shutdown, comprehensive activity logging
   - URL: https://ppc.land/uc-berkeley-unveils-framework-as-ai-agents-threaten-to-outrun-oversight/

2. **Microsoft Cyber Pulse (10. Feb 2026)** — "80% of Fortune 500 use active AI Agents"
   - 29% der Mitarbeiter nutzen NICHT-genehmigte AI Agents (Shadow AI)
   - Governance ≠ Security — beides nötig, keins ersetzt das andere
   - 5 Kernfähigkeiten: Registry, Access Control, Visualization, Interoperability, Security
   - "You can't protect what you can't see"
   - URL: https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents/

3. **Microsoft OpenClaw Threat Analysis (19. Feb 2026)** — Spezifisch für self-hosted Agents
   - Identity/Isolation/Runtime Risk
   - "Avoid running OpenClaw with primary work or personal accounts"
   - URL: https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely/

4. **EWSolutions** — "Digital Contractor" Framework
   - 3-Tiered Guardrail System (Foundational → Risk-Based → Societal)
   - "Treat agents like contractors, not software"
   - Human-in-the-Loop vs Human-on-the-Loop distinction

5. **Nate B. Jones** (natesnewsletter.substack.com) — Governance als kritischstes ungelöstes Problem
   - Unabhängige Validierung unserer These

6. **Alex Wissner-Gross** (24. Feb 2026) — Wochenrückblick zeigt Agents die Wohnungen verwalten, 
   Dates buchen, Megastrukturen finanzieren. Null Governance außer "VM löschen".

### Wer baut tatsächlich Governance-Tools?

| Tool | Was es macht | Was es NICHT macht | Status |
|------|-------------|-------------------|--------|
| **Invariant Labs** (→ Snyk acquired) | Runtime guardrails, MCP scanning, trace analysis | Keine Trust-Levels, kein Cross-Agent, kein Audit Trail | Acquired by Snyk, jetzt enterprise-fokussiert |
| **SecureClaw** (adversa-ai) | 56 Audit Checks, 5 Hardening Modules, OWASP-aligned | Scanner, nicht Runtime-Governance. Keine Policies, kein Trust. | Open Source, aktiv |
| **NVIDIA NeMo Guardrails** | Input/Output-Filter, Topical Control | Kein Agent-Kontext, keine Trust-Scores, kein Multi-Agent | Framework, nicht Plugin |
| **GuardrailsAI** | Output Validation, Schema Enforcement | Kein Runtime-Kontext, keine lernenden Policies | Python-fokussiert |
| **Rampart** | Rate Limiting, Content Filtering | Firewall-Ansatz, kein Governance-Konzept | Basic |
| **OpenClaw built-in** | Tool allowlists, realpath containment, plugin sandboxing | Static config, kein Trust-Scoring, keine Compliance | Core-Feature |

### Was FEHLT im Markt (die Lücke die wir füllen)

Keiner der oben genannten macht ALL das:

1. **Kontextbewusste Policies** — "welches Tool + wann + von wem + bei welchem Risk Level"
2. **Lernende Trust-Scores** — 0-100, 5 Tiers, Decay bei Inaktivität
3. **Cross-Agent Governance** — Parent-Policies kaskadieren zu Sub-Agents
4. **Compliance-ready Audit Trail** — Append-only JSONL, ISO 27001/SOC 2/NIS2 Control Mapping
5. **Runtime-Integration** — Greift bei JEDEM Tool-Call, nicht als nachgelagerter Scanner

**Unser Plugin macht genau das. v0.5.5, 767 Tests, Production seit 18.02.2026.**

---

## Positionierungs-Matrix

```
                    Static/Scanner ←————————→ Runtime/Contextual
                         |                          |
  Input/Output    SecureClaw      NeMo         Invariant(Snyk)
  Filtering       GuardrailsAI   Rampart           |
                         |                          |
                         |                   ┌──────┴──────┐
  Full Agent             |                   │  VAINPLEX    │
  Governance             |                   │  GOVERNANCE  │
                         |                   └──────────────┘
                         |                          |
                    No Context ←————————→ Full Context
```

Wir sind **allein im Quadrant "Runtime + Full Context"**.

Invariant/Snyk kommt am nächsten, aber:
- Sie wurden acquired → Enterprise-Fokus, nicht Open-Source-Community
- Kein Trust-Score-System
- Kein Cross-Agent Governance
- Kein Compliance Mapping

---

## Was Berkeley + Microsoft fordern vs. was wir liefern

| Forderung (Berkeley/Microsoft) | Unser Plugin | Status |
|-------------------------------|-------------|--------|
| Agent Registry | ✅ Trust-Config mit allen Agents | ✅ v0.5.5 |
| Access Control / Least Privilege | ✅ Per-Agent Tool Blocking + Trust Tiers | ✅ v0.5.5 |
| Real-time Monitoring | ✅ Evaluiert bei jedem Tool-Call | ✅ v0.5.5 |
| Activity Logging / Audit Trail | ✅ Append-only JSONL mit Compliance Mapping | ✅ v0.5.5 |
| Emergency Controls | ✅ Night Mode (23-08 Block), Rate Limiter | ✅ v0.5.5 |
| Cascading Agent Policies | ✅ Cross-Agent Governance, Parent-Kaskade | ✅ v0.5.5 |
| Autonomy Levels (L0-L5) | ⚡ Trust Tiers (0-100) — ähnliches Konzept | ✅ v0.5.5 |
| Credential Protection | ✅ Credential Redaction Guard | ✅ v0.5.5 |
| Human-in-the-Loop | 🟡 Approval Manager (in v0.2 Architecture) | 📋 Planned |
| Semantic Intent Analysis | 🟡 LLM Intent Module (in v0.2 Architecture) | 📋 Planned |
| Multi-Agent Interaction Monitoring | 🟡 Agent-to-Agent Message Gov (v0.2) | 📋 Planned |
| Hash-Chain Audit | 🟡 Tamper-evident Audit (v0.2) | 📋 Planned |

**Ergebnis: 8/12 Forderungen bereits implementiert. 4 weitere designed (v0.2 Architektur liegt ready).**

---

## Strategische Empfehlung

### Hebel 1: Positionierung (höchster ROI, 0 Code-Aufwand)
- README + Landing Page als "The first OpenClaw plugin that implements UC Berkeley's Agentic AI governance framework"
- Konkrete Mapping-Tabelle: Berkeley-Forderung → Unser Feature
- Microsoft Cyber Pulse zitieren: "80% of F500 use agents, 29% shadow AI"
- Differenzierung gegen Invariant/Snyk: "They scan. We govern."

### Hebel 2: v0.2 Features priorisieren nach Berkeley-Framework
1. **Approval Manager** (Human-in-the-Loop) — Berkeley L3+ braucht das
2. **Hash-Chain Audit** — Tamper-evidence für Compliance
3. **LLM Intent** — Semantic Risk Assessment
4. Agent-to-Agent Gov → Multi-Agent-Sicherheit

### Hebel 3: Community
- GitHub Issue auf openclaw/openclaw: "RFC: Governance hooks in PluginRuntime"
- HackerNoon Artikel: "We built what UC Berkeley asks for — here's how"
- OpenClaw Discord: Share Berkeley-Framework + Plugin als Implementierung

### Hebel 4: Referenzierbarkeit
- Nate B. Jones zitieren (extern, unabhängig)
- Berkeley-Paper verlinken (akademisch, autoritativ)
- Microsoft Cyber Pulse (Enterprise, Fortune 500)
- Peter Steinberger (OpenClaw-Community, respected)

---

## Zahlen die zählen

- Downloads: 1,354/month (Governance)
- Tests: 767 passing
- Production uptime: seit 18.02.2026
- Policies aktiv: 4 (Night Mode, Credential Guard, Prod Safeguard, Rate Limiter)
- Trust Scores: 9 Agents konfiguriert
- Wettbewerber im "Runtime + Contextual Governance" Quadrant: **0**

---

*Generiert: 2026-02-24 15:30 durch Claudia*
*Quellen: UC Berkeley CLTC, Microsoft Cyber Pulse, EWSolutions, Nate B. Jones, Alex Wissner-Gross*

# Darkplex.io — AI Portal Architecture

| Status | Draft |
| :--- | :--- |
| **Date** | 2026-02-20 |
| **Authors** | Albert + Claudia |

## 1. Vision

**Darkplex.io** = Managed AI Assistant Service mit Full-Stack Governance.

Nicht "ChatGPT Reseller". Sondern: **ChatGPT + Claude + Gemini mit Governance, Memory, Trust und Audit als Managed Service.** Das kann niemand sonst.

Users melden sich an, bekommen ihren eigenen AI-Assistenten, powered by der Vainplex Plugin Suite. Wir verdienen am Premium auf die API-Kosten.

## 2. Core Value Proposition

| Feature | ChatGPT/Claude.ai | Darkplex.io |
| :--- | :--- | :--- |
| Chat | ✅ | ✅ |
| Memory (persistent, across sessions) | ❌/basic | ✅ (Cortex Plugin) |
| Governance (night mode, claim validation) | ❌ | ✅ (Governance Plugin) |
| Audit Trail (who said what, why) | ❌ | ✅ (NATS Event Store) |
| Knowledge Base (personal RAG) | ❌/basic | ✅ (Knowledge Engine) |
| Credential Redaction | ❌ | ✅ (RFC-007) |
| Multi-Model (switch Anthropic/OpenAI/Gemini) | ❌ | ✅ (OpenClaw native) |
| Custom Plugins | ❌ | ✅ (OpenClaw ecosystem) |
| Self-hostable | ❌ | ✅ (open source core) |

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                   darkplex.io                        │
│              (Next.js / Remix Frontend)              │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐    │
│  │  Auth    │  │ Billing │  │   User Dashboard  │    │
│  │ (OAuth)  │  │(Stripe) │  │  (Chat, Settings) │    │
│  └────┬─────┘  └────┬────┘  └────────┬─────────┘    │
│       │              │                │               │
│  ┌────▼──────────────▼────────────────▼─────────┐    │
│  │              API Gateway                       │    │
│  │        (Auth middleware, rate limiting)         │    │
│  └──────────────────┬────────────────────────────┘    │
│                     │                                  │
│  ┌──────────────────▼────────────────────────────┐    │
│  │          Tenant Orchestrator                    │    │
│  │   (spawn/manage per-user OpenClaw instances)    │    │
│  │                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │    │
│  │  │ User A   │  │ User B   │  │ User C   │      │    │
│  │  │ OpenClaw │  │ OpenClaw │  │ OpenClaw │      │    │
│  │  │ Instance │  │ Instance │  │ Instance │      │    │
│  │  └──────────┘  └──────────┘  └──────────┘      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Plugin Suite (shared)             │    │
│  │  Governance | Cortex | Event Store | Knowledge │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │           LLM Provider Proxy                   │    │
│  │  Anthropic | OpenAI | Google | Ollama (local)  │    │
│  │  (Usage tracking per tenant, rate limiting)     │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## 4. Multi-Tenancy Strategy

### 4.1 Option A: Process-per-Tenant (Recommended for MVP)

Each user gets a separate OpenClaw process (or Docker container).

**Pro:**
- Complete isolation (security, memory, crash containment)
- Simple — OpenClaw already works as a single-user system
- Each tenant has their own config, plugins, memory
- Can set per-tenant API key limits

**Con:**
- Resource overhead (~50-100MB per idle instance)
- Need orchestration layer (start/stop/health check)
- 100 users = 100 processes

**Scale limit:** ~50-100 concurrent users per VPS (4GB RAM). Fine for MVP.

### 4.2 Option B: Shared Process, Isolated Sessions (Phase 2)

Single OpenClaw instance, sessions isolated by tenant.

**Pro:** Much more resource-efficient
**Con:** Harder to implement, plugin state leakage risk, requires deep OpenClaw changes
**When:** After MVP proves demand, before scaling past ~200 users

### 4.3 Recommended: Option A for MVP

- Docker containers with resource limits
- Spin up on first login, pause after 30min inactivity
- Resume on next request (cold start ~3-5s acceptable)

## 5. Tech Stack

### 5.1 Frontend
- **Framework:** Next.js 14 (App Router) or Remix
- **Chat UI:** Custom (markdown rendering, streaming, file upload)
- **Auth:** NextAuth.js / Auth.js (Google, GitHub, Email)
- **Styling:** Tailwind CSS + shadcn/ui

### 5.2 Backend
- **API:** Next.js API routes or Express
- **Tenant Orchestrator:** Custom Node service
- **Container Runtime:** Docker (via Docker SDK)
- **Database:** PostgreSQL (users, billing, usage) or SQLite (MVP)
- **Message Queue:** NATS (already in stack)

### 5.3 Billing
- **Provider:** Stripe
- **Model:** Prepaid credits OR monthly subscription
  - **Option 1 — Credits:** Buy $10/$25/$50 credit packs, deducted per API call (transparent)
  - **Option 2 — Subscription:** €29/€49/€99 per month, includes X tokens (simpler)
- **Usage Tracking:** LLM Provider Proxy logs every API call with cost
- **Markup:** 20-30% on raw API costs

### 5.4 LLM Provider Proxy
- Sits between OpenClaw instances and LLM APIs
- Tracks per-tenant usage
- Enforces rate limits and budget caps
- Routes to configured provider (user can choose Anthropic/OpenAI/Gemini)
- Already solved: OpenClaw's provider config

## 6. Pricing Strategy

| Tier | Price | Included | Target |
| :--- | :--- | :--- | :--- |
| **Free** | €0 | 50 messages/day, Sonnet only | Try it out |
| **Pro** | €29/mo | 2000 messages/day, all models, plugins | Individual power users |
| **Team** | €99/mo | 10k messages/day, shared knowledge base, admin dashboard | Small teams |
| **Enterprise** | Custom | Self-hosted, SLA, custom plugins | Businesses |

### 6.1 Cost Model (Pro tier, 2000 msgs/day)

Assuming avg 800 input + 400 output tokens per message:
- Sonnet 3.5: ~$3/1M input, $15/1M output = ~$0.008/msg = ~$16/day = ~$480/mo
- **Too expensive at scale for €29.** Need token budgets.

Revised: Pro = €29/mo, includes 500k input + 250k output tokens/month (≈500 substantial messages with Sonnet). Overage at €0.02/1k tokens.

Or: Use Gemini Flash as default (10x cheaper), Opus/Sonnet as premium models.

### 6.2 IMPORTANT: Unit Economics Must Work

| Item | Cost per Pro user/month |
| :--- | :--- |
| LLM API (avg) | ~€15-20 |
| Infrastructure (per user share) | ~€2-3 |
| **Total COGS** | **~€18-23** |
| **Revenue** | **€29** |
| **Margin** | **~€6-11 (~25-35%)** |

Margins are thin. Strategy: Push Gemini Flash as default model. Charge premium for Opus/Sonnet.

## 7. MVP Scope (2 weeks)

### Week 1: Core
- [ ] Landing page (darkplex.io)
- [ ] Auth (Google + GitHub + Email)
- [ ] User DB (SQLite for MVP)
- [ ] Docker-based tenant spawner (OpenClaw image)
- [ ] Chat UI (WebSocket to tenant OpenClaw)
- [ ] Basic usage tracking

### Week 2: Polish + Launch
- [ ] Stripe integration (Pro tier only)
- [ ] Model selection (Sonnet/Flash/Opus)
- [ ] Governance plugin pre-configured per tenant
- [ ] Memory plugin pre-configured per tenant
- [ ] 10 beta invites (manual)
- [ ] Basic admin dashboard (usage stats)

### NOT in MVP
- Team features
- Custom plugins
- Knowledge Base upload
- Self-hosting documentation
- Mobile app

## 8. Infrastructure

### 8.1 Hosting
- **darkplex.io Frontend:** Hetzner VPS or Vercel
- **Tenant OpenClaw instances:** Hetzner Cloud (scalable VPS)
- **Database:** Same VPS (SQLite for MVP, Postgres later)
- **Domain:** darkplex.io (already owned)

### 8.2 Security
- All tenant data isolated (separate Docker volumes)
- No cross-tenant data access
- Governance plugin active by default (credential guard, audit trail)
- Redaction layer (RFC-007) active by default
- GDPR compliant: user data deletion on account closure
- No customer data leaves the VPS (DarkPlex isolation principle)

## 9. Relationship: Vainplex Plugin Suite ↔ Darkplex.io

```
GitHub (open source)              Darkplex.io (commercial service)
┌─────────────────────┐          ┌──────────────────────────┐
│ vainplex-openclaw    │          │ Managed AI Assistant      │
│                      │          │                          │
│ - Governance Plugin  │ ────────▶│ Pre-installed plugins    │
│ - Cortex Plugin      │          │ + Hosting + Auth         │
│ - Event Store Plugin │          │ + Billing + Support      │
│ - Knowledge Engine   │          │ + Multi-tenancy          │
│                      │          │                          │
│ Free, self-hostable  │          │ Paid, managed service    │
└─────────────────────┘          └──────────────────────────┘
        ▲                                    │
        │          Users who want more       │
        └────────────────────────────────────┘
             (GitHub = on-ramp to service)
```

- **Vainplex Plugin Suite** = the free coffee at the dealership
- **Darkplex.io** = the car
- Plugins build credibility + community → funnel to managed service
- Enterprise customers who want self-hosted get the plugins + consulting

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Anthropic/OpenAI lower prices → margin squeeze | High | Multi-model, push local models (Ollama) |
| User expects 24/7 uptime | Medium | Start with "beta" label, SLA only for Enterprise |
| Governance bug lets credential leak | Critical | RFC-007 defense-in-depth, 3 layers |
| Scale past 100 users | Medium | Move to Option B (shared process) |
| Legal/GDPR | Medium | All data on EU servers, deletion API, DPA ready |
| OpenClaw breaking change | Medium | Pin versions, test before upgrade |

## 11. Next Steps

1. ☐ Albert: Confirm pricing model (subscription vs credits)
2. ☐ Albert: Confirm MVP scope (2 weeks realistic?)
3. ☐ Claudia: Create OpenClaw Docker image with Plugin Suite pre-installed
4. ☐ Claudia: Scaffold Next.js project for darkplex.io
5. ☐ Together: Design chat UI (reference: ChatGPT, Claude.ai, but with governance overlay)
6. ☐ Together: Define tenant config template (default plugins, default model, limits)

---
*This is a living document. Will be updated as decisions are made.*

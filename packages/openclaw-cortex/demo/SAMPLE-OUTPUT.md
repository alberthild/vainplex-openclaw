
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🧠  @vainplex/openclaw-cortex — Interactive Demo           ║
║                                                              ║
║   Conversation Intelligence for OpenClaw                     ║
║   Thread Tracking · Decision Extraction · Boot Context       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Workspace: /tmp/cortex-demo-O6qhjF


━━━ Phase 1: Live Conversation Processing ━━━

  Cortex listens to every message via OpenClaw hooks.
  Here we simulate a bilingual dev conversation (EN/DE).

  👤 Albert: Let's get back to the auth migration. We need to switch from JWT to OAuth2.
  🤖 Claudia: I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks.
  👤 Albert: Agreed. We decided to use Auth0 as the provider.
  👤 Albert: Also, jetzt zu dem Performance-Bug. Die API braucht 3 Sekunden für simple Queries.
  🤖 Claudia: Ich hab den Profiler laufen lassen. Das Problem ist der N+1 Query im User-Resolver.
  👤 Albert: Mist, das ist nervig. Wir brauchen das bis Freitag gefixt.
  🤖 Claudia: Wir machen Batched DataLoader. Der plan ist erst den User-Resolver zu fixen, dann die restlichen.
  👤 Albert: Beschlossen. Und wir warten auf den Review von Alexey bevor wir deployen.
  🤖 Claudia: Auth migration is done ✅ All tests green, backward compat verified.
  👤 Albert: Nice! Perfekt gelaufen. 🚀
  👤 Albert: Now about the Kubernetes cluster — we need to plan the migration from Docker Compose.
  🤖 Claudia: I'll draft an architecture doc. Waiting for the cost estimate from Hetzner first.
  👤 Albert: Guter Fortschritt heute. Lass uns morgen mit dem K8s-Plan weitermachen.

━━━ Phase 2: Thread Tracking Results ━━━

  Found 3 threads (2 open, 1 closed)

  ○ 🟠 the auth migration
    Status: closed
    Priority: high
    Mood: neutral

  ● 🟡 dem Performance-Bug
    Status: open
    Priority: medium
    Mood: neutral

  ● 🟡 the Kubernetes cluster
    Status: open
    Priority: medium
    Mood: neutral


━━━ Phase 3: Decision Extraction ━━━

  Extracted 4 decisions from the conversation:

  🎯 I'll start with the token validation layer. The plan is to keep backward compati
    Impact: medium
    Who: claudia
    Date: 2026-02-17

  🎯 Agreed. We decided to use Auth0 as the provider.
    Impact: medium
    Who: albert
    Date: 2026-02-17

  🎯 Wir machen Batched DataLoader. Der plan ist erst den User-Resolver zu fixen, dan
    Impact: medium
    Who: claudia
    Date: 2026-02-17

  🎯 Beschlossen. Und wir warten auf den Review von Alexey bevor wir deployen.
    Impact: high
    Who: albert
    Date: 2026-02-17


━━━ Phase 4: Mood Detection ━━━

  Session mood: 🔥 excited
  (Detected from conversation patterns — last mood match wins)


━━━ Phase 5: Pre-Compaction Snapshot ━━━

  When OpenClaw compacts the session, Cortex saves everything first.

    Success: yes
    Messages snapshotted: 13
    Warnings: none

  ▸ Hot Snapshot (memory/reboot/hot-snapshot.md):
    # Hot Snapshot — 2026-02-17T11:30:02Z
    ## Last conversation before compaction
    
    **Recent messages:**
    - [user] Let's get back to the auth migration. We need to switch from JWT to OAuth2.
    - [assistant] I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks.
    - [user] Agreed. We decided to use Auth0 as the provider.
    - [user] Also, jetzt zu dem Performance-Bug. Die API braucht 3 Sekunden für simple Queries.
    - [assistant] Ich hab den Profiler laufen lassen. Das Problem ist der N+1 Query im User-Resolver.
    - [user] Mist, das ist nervig. Wir brauchen das bis Freitag gefixt.


━━━ Phase 6: Boot Context (BOOTSTRAP.md) ━━━

  On next session start, Cortex assembles a dense briefing from all state.

  │ # Context Briefing
  │ Generated: 2026-02-17T11:30:02Z | Local: 12:30
  │ 
  │ ## ⚡ State
  │ Mode: Afternoon — execution mode
  │ Last session mood: excited 🔥
  │ 
  │ ## 🔥 Last Session Snapshot
  │ # Hot Snapshot — 2026-02-17T11:30:02Z
  │ ## Last conversation before compaction
  │ 
  │ **Recent messages:**
  │ - [user] Let's get back to the auth migration. We need to switch from JWT to OAuth2.
  │ - [assistant] I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks.
  │ - [user] Agreed. We decided to use Auth0 as the provider.
  │ - [user] Also, jetzt zu dem Performance-Bug. Die API braucht 3 Sekunden für simple Queries.
  │ - [assistant] Ich hab den Profiler laufen lassen. Das Problem ist der N+1 Query im User-Resolver.
  │ - [user] Mist, das ist nervig. Wir brauchen das bis Freitag gefixt.
  │ - [assistant] Wir machen Batched DataLoader. Der plan ist erst den User-Resolver zu fixen, dann die restlichen.
  │ - [user] Beschlossen. Und wir warten auf den Review von Alexey bevor wir deployen.
  │ - [assistant] Auth migration is done ✅ All tests green, backward compat verified.
  │ - [user] Nice! Perfekt gelaufen. 🚀
  │ - [user] Now about the Kubernetes cluster — we need to plan the migration
  │ 
  │ ## 📖 Narrative (last 24h)
  │ *Tuesday, 17. February 2026 — Narrative*
  │ 
  │ **Completed:**
  │ - ✅ the auth migration: Topic detected from albert
  │ 
  │ **Open:**
  │ - 🟡 dem Performance-Bug: Topic detected from albert
  │ - 🟡 the Kubernetes cluster: Topic detected from albert
  │ 
  │ **Decisions:**
  │ ... (27 more lines)

    Total chars: 3143
    Approx tokens: 786

━━━ Phase 7: Generated Files ━━━

  All output lives in {workspace}/memory/reboot/ — plain JSON + Markdown.

    memory/reboot/threads.json: 1354 bytes
    memory/reboot/decisions.json: 1619 bytes
    memory/reboot/narrative.md: 866 bytes
    memory/reboot/hot-snapshot.md: 1199 bytes
    BOOTSTRAP.md: 3143 bytes

━━━ Demo Complete ━━━

All files written to: /tmp/cortex-demo-O6qhjF
Explore them: ls -la /tmp/cortex-demo-O6qhjF/memory/reboot/

Install:  npm install @vainplex/openclaw-cortex
GitHub:   https://github.com/alberthild/openclaw-cortex
Docs:     docs/ARCHITECTURE.md


import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditRecord,
  GovernanceConfig,
  TrustStore,
  DashboardState,
  NotableEvent,
  NotableEventType,
  ShieldFeature,
  ShieldScore,
} from "./types.js";
import type { GovernanceEngine } from "./engine.js";

// ── Constants ──

const NOTABLE_SEEN_CAP = 200;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_EMOJI: Record<NotableEventType, string> = {
  night_denial: "🚫",
  rate_spike: "⚡",
  new_tool: "🆕",
  trust_jump: "📈",
  trust_drop: "📉",
  clean_streak: "🎉",
  first_denial: "🔔",
  while_you_were_away: "👀",
};

// ── State Management ──

const DEFAULT_STATE: DashboardState = {
  lastCheck: 0,
  streak: 0,
  notableSeen: [],
};

export function loadDashboardState(statePath: string): DashboardState {
  try {
    if (existsSync(statePath)) {
      const raw = readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<DashboardState>;
      return {
        lastCheck: typeof parsed.lastCheck === "number" ? parsed.lastCheck : 0,
        streak: typeof parsed.streak === "number" ? parsed.streak : 0,
        notableSeen: Array.isArray(parsed.notableSeen) ? parsed.notableSeen : [],
      };
    }
  } catch {
    // Corrupted state — reset
  }
  return { ...DEFAULT_STATE, notableSeen: [] };
}

export function saveDashboardState(statePath: string, state: DashboardState): void {
  const dir = join(statePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Cap notableSeen at FIFO limit
  const capped: DashboardState = {
    ...state,
    notableSeen: state.notableSeen.slice(-NOTABLE_SEEN_CAP),
  };
  writeFileSync(statePath, JSON.stringify(capped, null, 2) + "\n");
}

// ── Detector Context ──

type DetectorContext = {
  config: GovernanceConfig;
  trustStore: TrustStore;
  state: DashboardState;
  now: number;
};

type DetectorFn = (records: AuditRecord[], ctx: DetectorContext) => NotableEvent[];

// ── Helper: create deterministic event ID ──

function eventId(type: NotableEventType, agentId: string, detail: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${type}:${agentId}:${day}:${detail}`;
}

function makeEvent(
  type: NotableEventType,
  message: string,
  agentId?: string,
  timestamp?: number,
  id?: string,
): NotableEvent {
  return {
    id: id ?? eventId(type, agentId ?? "system", message.slice(0, 40)),
    type,
    emoji: EVENT_EMOJI[type],
    message,
    agentId,
    timestamp: timestamp ?? Date.now(),
  };
}

// ── 8 Pattern Detectors ──

function detectNightDenial(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  const nightConfig = ctx.config.builtinPolicies.nightMode;
  if (!nightConfig) return events;

  let startHour = 23;
  let endHour = 6;
  if (typeof nightConfig === "object") {
    const startStr = nightConfig.start ?? nightConfig.after ?? "23:00";
    const endStr = nightConfig.end ?? nightConfig.before ?? "06:00";
    startHour = parseInt(startStr.split(":")[0] ?? "23", 10);
    endHour = parseInt(endStr.split(":")[0] ?? "6", 10);
  }

  for (const rec of records) {
    if (rec.verdict !== "deny") continue;
    const hour = new Date(rec.timestamp).getUTCHours();
    const isNight = startHour > endHour
      ? (hour >= startHour || hour < endHour)
      : (hour >= startHour && hour < endHour);
    if (isNight) {
      const toolName = rec.context.toolName ?? "unknown";
      events.push(makeEvent(
        "night_denial",
        `${rec.context.agentId} tried \`${toolName}\` at ${new Date(rec.timestamp).toISOString().slice(11, 16)} — DENIED (night mode)`,
        rec.context.agentId,
        rec.timestamp,
        eventId("night_denial", rec.context.agentId, `${toolName}:${rec.id}`),
      ));
    }
  }
  return events;
}

function detectRateSpike(records: AuditRecord[], _ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  // Group records by agentId
  const byAgent = new Map<string, AuditRecord[]>();
  for (const rec of records) {
    const agentId = rec.context.agentId;
    const list = byAgent.get(agentId) ?? [];
    list.push(rec);
    byAgent.set(agentId, list);
  }

  for (const [agentId, agentRecords] of byAgent) {
    if (agentRecords.length < 4) continue;

    // Calculate rolling average calls per minute over the full window
    const sorted = [...agentRecords].sort((a, b) => a.timestamp - b.timestamp);
    const spanMs = sorted[sorted.length - 1]!.timestamp - sorted[0]!.timestamp;
    if (spanMs < 60_000) continue;
    const avgPerMin = agentRecords.length / (spanMs / 60_000);

    // Check 1-minute windows for spikes
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = sorted[i]!.timestamp;
      const windowEnd = windowStart + 60_000;
      let count = 0;
      for (let j = i; j < sorted.length && sorted[j]!.timestamp < windowEnd; j++) {
        count++;
      }
      if (count > avgPerMin * 3 && count >= 5) {
        events.push(makeEvent(
          "rate_spike",
          `${agentId} had ${count} calls/min (avg: ${Math.round(avgPerMin)}/min)`,
          agentId,
          windowStart,
          eventId("rate_spike", agentId, `${windowStart}`),
        ));
        break; // One spike per agent
      }
    }
  }
  return events;
}

function detectNewTool(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];

  // Split records into older (history) and recent (since lastCheck or last 24h)
  const checkSince = ctx.state.lastCheck > 0 ? ctx.state.lastCheck : ctx.now - ONE_DAY_MS;
  const byAgent = new Map<string, { history: Set<string>; recent: AuditRecord[] }>();

  for (const rec of records) {
    const agentId = rec.context.agentId;
    const toolName = rec.context.toolName;
    if (!toolName) continue;

    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, { history: new Set(), recent: [] });
    }
    const agent = byAgent.get(agentId)!;

    if (rec.timestamp < checkSince) {
      agent.history.add(toolName);
    } else {
      agent.recent.push(rec);
    }
  }

  // Also populate history from records before checkSince
  for (const rec of records) {
    const agentId = rec.context.agentId;
    const toolName = rec.context.toolName;
    if (!toolName || rec.timestamp >= checkSince) continue;
    const agent = byAgent.get(agentId);
    if (agent) agent.history.add(toolName);
  }

  for (const [agentId, agent] of byAgent) {
    const seen = new Set<string>();
    for (const rec of agent.recent) {
      const toolName = rec.context.toolName;
      if (!toolName) continue;
      if (!agent.history.has(toolName) && !seen.has(toolName)) {
        seen.add(toolName);
        events.push(makeEvent(
          "new_tool",
          `${agentId} used tool '${toolName}' for the first time`,
          agentId,
          rec.timestamp,
          eventId("new_tool", agentId, toolName),
        ));
      }
    }
  }
  return events;
}

function detectTrustJump(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  const cutoff = ctx.now - ONE_DAY_MS;

  const byAgent = new Map<string, AuditRecord[]>();
  for (const rec of records) {
    if (rec.timestamp < cutoff) continue;
    const agentId = rec.context.agentId;
    const list = byAgent.get(agentId) ?? [];
    list.push(rec);
    byAgent.set(agentId, list);
  }

  for (const [agentId, agentRecords] of byAgent) {
    if (agentRecords.length < 2) continue;
    const sorted = [...agentRecords].sort((a, b) => a.timestamp - b.timestamp);
    const oldest = sorted[0]!.trust.score;
    const newest = sorted[sorted.length - 1]!.trust.score;
    const delta = newest - oldest;
    if (delta > 10) {
      events.push(makeEvent(
        "trust_jump",
        `${agentId} trust ↑${Math.round(delta)} in 24h (${Math.round(oldest)} → ${Math.round(newest)})`,
        agentId,
        sorted[sorted.length - 1]!.timestamp,
        eventId("trust_jump", agentId, `${Math.round(delta)}`),
      ));
    }
  }
  return events;
}

function detectTrustDrop(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  const cutoff = ctx.now - ONE_DAY_MS;

  const byAgent = new Map<string, AuditRecord[]>();
  for (const rec of records) {
    if (rec.timestamp < cutoff) continue;
    const agentId = rec.context.agentId;
    const list = byAgent.get(agentId) ?? [];
    list.push(rec);
    byAgent.set(agentId, list);
  }

  for (const [agentId, agentRecords] of byAgent) {
    if (agentRecords.length < 2) continue;
    const sorted = [...agentRecords].sort((a, b) => a.timestamp - b.timestamp);
    const oldest = sorted[0]!.trust.score;
    const newest = sorted[sorted.length - 1]!.trust.score;
    const delta = newest - oldest;
    if (delta < -10) {
      events.push(makeEvent(
        "trust_drop",
        `${agentId} trust ↓${Math.round(Math.abs(delta))} in 24h (${Math.round(oldest)} → ${Math.round(newest)})`,
        agentId,
        sorted[sorted.length - 1]!.timestamp,
        eventId("trust_drop", agentId, `${Math.round(Math.abs(delta))}`),
      ));
    }
  }
  return events;
}

function detectCleanStreak(_records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  const thresholds = [30, 14, 7, 3];

  // Only show streak for agents with meaningful activity (>= 10 successes)
  const activeAgents = Object.values(ctx.trustStore.agents).filter(
    a => a.signals.successCount >= 10
  );

  // Show only the agent with the longest streak to avoid noise
  if (activeAgents.length === 0) return events;
  const best = activeAgents.reduce((a, b) =>
    a.signals.cleanStreak > b.signals.cleanStreak ? a : b
  );

  const streak = best.signals.cleanStreak;
  for (const threshold of thresholds) {
    if (streak >= threshold) {
      events.push(makeEvent(
        "clean_streak",
        `Clean streak: ${streak} days without a single denial (${best.agentId})`,
        best.agentId,
        ctx.now,
        eventId("clean_streak", best.agentId, `${threshold}`),
      ));
      break;
    }
  }
  return events;
}

function detectFirstDenial(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  const checkSince = ctx.state.lastCheck > 0 ? ctx.state.lastCheck : 0;
  const sortedAsc = [...records].sort((a, b) => a.timestamp - b.timestamp);

  // Build set of agents that had denials BEFORE the check window
  const agentsWithPriorDenials = new Set<string>();
  for (const rec of sortedAsc) {
    if (rec.verdict === "deny" && rec.timestamp <= checkSince) {
      agentsWithPriorDenials.add(rec.context.agentId);
    }
  }

  // Find agents whose first-ever denial is in the new window
  const emitted = new Set<string>();
  for (const rec of sortedAsc) {
    if (rec.verdict !== "deny") continue;
    if (rec.timestamp <= checkSince) continue;
    const agentId = rec.context.agentId;
    if (agentsWithPriorDenials.has(agentId)) continue; // had denials before
    if (emitted.has(agentId)) continue; // already reported this agent
    const toolName = rec.context.toolName ?? "unknown";
    events.push(makeEvent(
      "first_denial",
      `${agentId}'s first-ever denial: \`${toolName}\``,
      agentId,
      rec.timestamp,
      eventId("first_denial", agentId, "first"),
    ));
    emitted.add(agentId);
  }

  return events;
}

function detectWhileYouWereAway(records: AuditRecord[], ctx: DetectorContext): NotableEvent[] {
  const events: NotableEvent[] = [];
  if (ctx.state.lastCheck <= 0) return events;

  const sinceLast = records.filter(r => r.timestamp > ctx.state.lastCheck);
  if (sinceLast.length === 0) return events;

  let allowCount = 0;
  let denyCount = 0;
  for (const rec of sinceLast) {
    if (rec.verdict === "allow") allowCount++;
    else if (rec.verdict === "deny") denyCount++;
  }

  const elapsed = ctx.now - ctx.state.lastCheck;
  const hoursAgo = Math.round(elapsed / (60 * 60 * 1000));
  const timeStr = hoursAgo >= 24 ? `${Math.round(hoursAgo / 24)}d` : `${hoursAgo}h`;

  const parts: string[] = [];
  if (allowCount > 0) parts.push(`+${allowCount} governed`);
  if (denyCount > 0) parts.push(`+${denyCount} denied`);

  if (parts.length > 0) {
    events.push(makeEvent(
      "while_you_were_away",
      `Since last check (${timeStr} ago): ${parts.join(" · ")}`,
      undefined,
      ctx.now,
      eventId("while_you_were_away", "system", `${ctx.state.lastCheck}`),
    ));
  }
  return events;
}

// ── Detector Registry ──

const DETECTORS: DetectorFn[] = [
  detectNightDenial,
  detectRateSpike,
  detectNewTool,
  detectTrustJump,
  detectTrustDrop,
  detectCleanStreak,
  detectFirstDenial,
  detectWhileYouWereAway,
];

// ── Public API: Notable Events ──

export function detectNotableEvents(
  records: AuditRecord[],
  trustStore: TrustStore,
  state: DashboardState,
  config: GovernanceConfig,
): NotableEvent[] {
  const ctx: DetectorContext = {
    config,
    trustStore,
    state,
    now: Date.now(),
  };

  const all: NotableEvent[] = [];
  for (const detector of DETECTORS) {
    all.push(...detector(records, ctx));
  }

  // Deduplicate against already-seen events
  const seenSet = new Set(state.notableSeen);
  const fresh = all.filter(e => !seenSet.has(e.id));

  // Sort by timestamp descending (newest first)
  fresh.sort((a, b) => b.timestamp - a.timestamp);

  return fresh;
}

// ── Shield Score ──

function isFeatureEnabled(val: unknown): boolean {
  if (val === true) return true;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return obj["enabled"] !== false;
  }
  return false;
}

export function calculateShieldScore(config: GovernanceConfig): ShieldScore {
  const features: ShieldFeature[] = [
    {
      name: "Credential Guard",
      points: isFeatureEnabled(config.builtinPolicies.credentialGuard) ? 20 : 0,
      maxPoints: 20,
      enabled: isFeatureEnabled(config.builtinPolicies.credentialGuard),
    },
    {
      name: "Night Mode",
      points: isFeatureEnabled(config.builtinPolicies.nightMode) ? 20 : 0,
      maxPoints: 20,
      enabled: isFeatureEnabled(config.builtinPolicies.nightMode),
    },
    {
      name: "Rate Limiter",
      points: isFeatureEnabled(config.builtinPolicies.rateLimiter) ? 15 : 0,
      maxPoints: 15,
      enabled: isFeatureEnabled(config.builtinPolicies.rateLimiter),
    },
    {
      name: "Trust Scoring",
      points: config.trust.enabled ? 15 : 0,
      maxPoints: 15,
      enabled: config.trust.enabled,
    },
    {
      name: "Response Gate",
      points: config.responseGate?.enabled ? 15 : 0,
      maxPoints: 15,
      enabled: !!config.responseGate?.enabled,
    },
    {
      name: "Approval Manager",
      points: config.approvalManager?.enabled ? 15 : 0,
      maxPoints: 15,
      enabled: !!config.approvalManager?.enabled,
    },
  ];

  const total = features.reduce((sum, f) => sum + f.points, 0);
  const max = features.reduce((sum, f) => sum + f.maxPoints, 0);

  return {
    total,
    max,
    features,
    percentage: max > 0 ? Math.round((total / max) * 100) : 0,
  };
}

// ── Streak Counter ──

export function calculateStreak(records: AuditRecord[]): number {
  const now = new Date();
  let streak = 0;

  for (let daysAgo = 0; daysAgo < 365; daysAgo++) {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - daysAgo);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + ONE_DAY_MS;

    const dayRecords = records.filter(r =>
      r.timestamp >= dayStartMs && r.timestamp < dayEndMs,
    );

    // Days with no records: skip (don't break, don't count)
    if (dayRecords.length === 0) continue;

    // If any denial on this day → streak broken
    if (dayRecords.some(r => r.verdict === "deny")) {
      break;
    }

    streak++;
  }

  return streak;
}

// ── Renderers ──

export function renderTrustBar(score: number, width: number = 10): string {
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round(clamped / (100 / width));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function tierEmoji(tier: string): string {
  const map: Record<string, string> = {
    untrusted: "🔴",
    restricted: "🟠",
    standard: "🟡",
    trusted: "🟢",
    elevated: "🔵",
  };
  return map[tier] ?? "⚪";
}

export function renderCompactLine(stats: {
  agentCount: number;
  avgTrust: number;
  totalGoverned: number;
  totalDenied: number;
  shieldScore: number;
  shieldMax: number;
}): string {
  const bar = renderTrustBar(stats.avgTrust);
  return `🧠 brainplex | ${stats.agentCount} agents · trust ${bar} ${Math.round(stats.avgTrust)} · ${stats.totalGoverned} governed · ${stats.totalDenied} denied · shield ${stats.shieldScore}/${stats.shieldMax}`;
}

// ── Main Render ──

export type DashboardRenderOptions = {
  notableEvents: NotableEvent[];
  shieldScore: ShieldScore;
  streak: number;
  trustStore: TrustStore;
  stats: { totalEvaluations: number; allowCount: number; denyCount: number };
  lastCheck: number;
  records: AuditRecord[];
};

export function renderDashboard(options: DashboardRenderOptions): string {
  const {
    notableEvents,
    shieldScore,
    streak,
    trustStore,
    stats,
    lastCheck,
    records,
  } = options;

  const lines: string[] = ["🧠 **Brainplex Dashboard**", ""];

  // ── Notable Events ──
  if (notableEvents.length > 0) {
    lines.push("⚡ NOTABLE");
    for (const evt of notableEvents.slice(0, 8)) {
      lines.push(`· ${evt.emoji} ${evt.message}`);
    }
    lines.push("");
  }

  // ── Shield Score ──
  lines.push(`🛡️ SHIELD SCORE: ${shieldScore.total}/${shieldScore.max}`);
  const featureItems: string[] = [];
  for (const f of shieldScore.features) {
    if (f.enabled) {
      featureItems.push(`✅ ${f.name} (+${f.points})`);
    } else {
      featureItems.push(`⬜ ${f.name} (+0/${f.maxPoints})`);
    }
  }
  lines.push(featureItems.join("  "));
  lines.push("");

  // ── Streak ──
  lines.push(`🔥 STREAK: ${streak} days clean`);
  lines.push("");

  // ── Delta ──
  if (lastCheck > 0) {
    const sinceLast = records.filter(r => r.timestamp > lastCheck);
    const governed = sinceLast.length;
    const denied = sinceLast.filter(r => r.verdict === "deny").length;
    const elapsed = Date.now() - lastCheck;
    const hoursAgo = Math.round(elapsed / (60 * 60 * 1000));
    const timeStr = hoursAgo >= 24 ? `${Math.round(hoursAgo / 24)}d ago` : `${hoursAgo}h ago`;
    lines.push(`📊 DELTA (since last check, ${timeStr})`);
    lines.push(`+${governed} governed · +${denied} denied`);
  } else {
    lines.push("📊 DELTA (first check)");
    lines.push(`${stats.totalEvaluations} governed · ${stats.denyCount} denied`);
  }
  lines.push("");

  // ── Agent Map ──
  const agents = Object.values(trustStore.agents).sort(
    (a, b) => b.score - a.score,
  );
  if (agents.length > 0) {
    lines.push("🗺️ AGENT MAP");
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      const prefix = i < agents.length - 1 ? "├─" : "└─";
      const emoji = tierEmoji(agent.tier);
      const bar = renderTrustBar(agent.score);
      const name = agent.agentId.padEnd(10);
      const score = String(Math.round(agent.score)).padStart(3);
      const tier = `(${agent.tier})`.padEnd(14);
      const success = `✅${agent.signals.successCount}`;
      const deny = `❌${agent.signals.violationCount}`;
      const streakStr = `🔥${agent.signals.cleanStreak}`;
      lines.push(`${prefix} ${emoji} ${name} ${bar} ${score} ${tier} ${success} ${deny} ${streakStr}`);
    }
  } else {
    lines.push("🗺️ AGENT MAP");
    lines.push("_No agents registered_");
  }

  // ── Compact One-Liner ──
  lines.push("");
  lines.push("───");
  const agentCount = agents.length;
  const avgTrust = agentCount > 0
    ? agents.reduce((sum, a) => sum + a.score, 0) / agentCount
    : 0;
  lines.push(renderCompactLine({
    agentCount,
    avgTrust,
    totalGoverned: stats.totalEvaluations,
    totalDenied: stats.denyCount,
    shieldScore: shieldScore.total,
    shieldMax: shieldScore.max,
  }));

  return lines.join("\n");
}

// ── Entry Point for /brainplex command ──

export function renderBrainplex(
  engine: GovernanceEngine,
  config: GovernanceConfig,
): { text: string } {
  const workspace = engine.getWorkspace();
  const statePath = join(workspace, "governance", "dashboard-state.json");

  // Load state
  const state = loadDashboardState(statePath);

  // Query audit records (last 7 days, up to 10k)
  const after = Date.now() - SEVEN_DAYS_MS;
  const records = engine.queryAudit({ after, limit: 10000 });

  // Get trust data
  const trustStore = engine.getTrust() as TrustStore;

  // Get stats
  const engineStatus = engine.getStatus();

  // Detect notable events
  const notableEvents = detectNotableEvents(records, trustStore, state, config);

  // Calculate shield score
  const shieldScore = calculateShieldScore(config);

  // Calculate streak
  const streak = calculateStreak(records);

  // Render dashboard
  const text = renderDashboard({
    notableEvents,
    shieldScore,
    streak,
    trustStore,
    stats: engineStatus.stats,
    lastCheck: state.lastCheck,
    records,
  });

  // Update state
  const updatedState: DashboardState = {
    lastCheck: Date.now(),
    streak,
    notableSeen: [
      ...state.notableSeen,
      ...notableEvents.map(e => e.id),
    ].slice(-NOTABLE_SEEN_CAP),
  };
  saveDashboardState(statePath, updatedState);

  return { text };
}

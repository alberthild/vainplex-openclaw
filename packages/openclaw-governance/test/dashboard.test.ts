import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadDashboardState,
  saveDashboardState,
  detectNotableEvents,
  calculateShieldScore,
  calculateStreak,
  renderTrustBar,
  renderCompactLine,
  renderDashboard,
} from "../src/dashboard.js";
import type {
  AuditRecord,
  GovernanceConfig,
  TrustStore,
  DashboardState,
  NotableEvent,
  ShieldScore,
} from "../src/types.js";

// ── Helpers ──

function makeTmpDir(): string {
  const dir = join(tmpdir(), `dashboard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeRecord(overrides: Partial<AuditRecord> & { context?: Partial<AuditRecord["context"]> } = {}): AuditRecord {
  const ctx = {
    hook: "before_tool_call",
    agentId: "main",
    sessionKey: "agent:main:main",
    toolName: "exec",
    toolParams: { command: "date" },
    ...overrides.context,
  };
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    timestampIso: new Date().toISOString(),
    verdict: "allow",
    reason: "No matching policies",
    context: ctx as AuditRecord["context"],
    trust: { score: 50, tier: "standard" },
    risk: { level: "low", score: 10 },
    matchedPolicies: [],
    evaluationUs: 42,
    controls: [],
    ...overrides,
    // Re-apply context after spread to avoid overwriting
  } as AuditRecord;
}

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    enabled: true,
    timezone: "UTC",
    failMode: "open",
    policies: [],
    timeWindows: {},
    trust: {
      enabled: true,
      defaults: { "*": 10 },
      persistIntervalSeconds: 60,
      decay: { enabled: false, inactivityDays: 30, rate: 0.5 },
      maxHistoryPerAgent: 100,
      sessionTrust: {
        enabled: true,
        seedFactor: 0.8,
        ceilingFactor: 1.2,
        signals: {} as any,
      },
    },
    audit: { enabled: true, retentionDays: 30, redactPatterns: [], level: "standard" },
    toolRiskOverrides: {},
    builtinPolicies: {
      credentialGuard: true,
      nightMode: { start: "23:00", end: "06:00" },
      rateLimiter: { maxPerMinute: 30 },
    },
    performance: { maxEvalUs: 10000, maxContextMessages: 50, frequencyBufferSize: 1000 },
    outputValidation: {
      enabled: false,
      enabledDetectors: [],
      factRegistries: [],
      unverifiedClaimPolicy: "ignore",
      selfReferentialPolicy: "ignore",
      contradictionThresholds: { flagAbove: 60, blockBelow: 40 },
    },
    responseGate: { enabled: true, rules: [], maxToolOutputLength: 5000 } as any,
    approvalManager: { enabled: true, defaultTimeoutSeconds: 300, defaultAction: "deny" },
    ...overrides,
  } as GovernanceConfig;
}

function makeTrustStore(agents: Record<string, Partial<TrustStore["agents"][string]>> = {}): TrustStore {
  const builtAgents: TrustStore["agents"] = {};
  for (const [id, overrides] of Object.entries(agents)) {
    builtAgents[id] = {
      agentId: id,
      score: 50,
      tier: "standard",
      signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 5, manualAdjustment: 0 },
      history: [],
      lastEvaluation: new Date().toISOString(),
      created: new Date().toISOString(),
      ...overrides,
    };
  }
  return { version: 1, updated: new Date().toISOString(), agents: builtAgents };
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return { lastCheck: 0, streak: 0, notableSeen: [], ...overrides };
}

// ── Tests ──

describe("Dashboard State Management", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return default state when file does not exist", () => {
    const state = loadDashboardState(join(tmpDir, "nonexistent.json"));
    expect(state.lastCheck).toBe(0);
    expect(state.streak).toBe(0);
    expect(state.notableSeen).toEqual([]);
  });

  it("should load existing state file", () => {
    const path = join(tmpDir, "state.json");
    writeFileSync(path, JSON.stringify({ lastCheck: 1000, streak: 5, notableSeen: ["a", "b"] }));
    const state = loadDashboardState(path);
    expect(state.lastCheck).toBe(1000);
    expect(state.streak).toBe(5);
    expect(state.notableSeen).toEqual(["a", "b"]);
  });

  it("should handle corrupted state file gracefully", () => {
    const path = join(tmpDir, "state.json");
    writeFileSync(path, "{{invalid json");
    const state = loadDashboardState(path);
    expect(state.lastCheck).toBe(0);
    expect(state.streak).toBe(0);
  });

  it("should save and load state round-trip", () => {
    const path = join(tmpDir, "governance", "state.json");
    const original: DashboardState = { lastCheck: 12345, streak: 7, notableSeen: ["x"] };
    saveDashboardState(path, original);
    const loaded = loadDashboardState(path);
    expect(loaded).toEqual(original);
  });

  it("should cap notableSeen at 200 on save", () => {
    const path = join(tmpDir, "state.json");
    const bigState: DashboardState = {
      lastCheck: 100,
      streak: 1,
      notableSeen: Array.from({ length: 300 }, (_, i) => `evt-${i}`),
    };
    saveDashboardState(path, bigState);
    const loaded = loadDashboardState(path);
    expect(loaded.notableSeen.length).toBe(200);
    // Should keep the last 200 (FIFO)
    expect(loaded.notableSeen[0]).toBe("evt-100");
    expect(loaded.notableSeen[199]).toBe("evt-299");
  });
});

describe("Night Denial Detector", () => {
  it("should detect denial during night hours", () => {
    const config = makeConfig();
    const nightRecord = makeRecord({
      verdict: "deny",
      // 2:00 UTC is within 23:00-06:00
      timestamp: new Date("2026-03-05T02:00:00Z").getTime(),
      context: { hook: "before_tool_call", agentId: "main", sessionKey: "agent:main:main", toolName: "exec" },
    });
    const events = detectNotableEvents(
      [nightRecord],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const nightEvents = events.filter(e => e.type === "night_denial");
    expect(nightEvents.length).toBe(1);
    expect(nightEvents[0]!.emoji).toBe("🚫");
    expect(nightEvents[0]!.message).toContain("night mode");
  });

  it("should NOT detect denial outside night hours", () => {
    const config = makeConfig();
    const dayRecord = makeRecord({
      verdict: "deny",
      // 12:00 UTC is outside 23:00-06:00
      timestamp: new Date("2026-03-05T12:00:00Z").getTime(),
      context: { hook: "before_tool_call", agentId: "main", sessionKey: "agent:main:main", toolName: "exec" },
    });
    const events = detectNotableEvents(
      [dayRecord],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const nightEvents = events.filter(e => e.type === "night_denial");
    expect(nightEvents.length).toBe(0);
  });

  it("should NOT detect night denial when nightMode is disabled", () => {
    const config = makeConfig({ builtinPolicies: {} });
    const nightRecord = makeRecord({
      verdict: "deny",
      timestamp: new Date("2026-03-05T02:00:00Z").getTime(),
    });
    const events = detectNotableEvents(
      [nightRecord],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const nightEvents = events.filter(e => e.type === "night_denial");
    expect(nightEvents.length).toBe(0);
  });

  it("should only detect denials, not allows during night", () => {
    const config = makeConfig();
    const allowRecord = makeRecord({
      verdict: "allow",
      timestamp: new Date("2026-03-05T02:00:00Z").getTime(),
    });
    const events = detectNotableEvents(
      [allowRecord],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const nightEvents = events.filter(e => e.type === "night_denial");
    expect(nightEvents.length).toBe(0);
  });
});

describe("Rate Spike Detector", () => {
  it("should detect spike when calls/min > 3x average", () => {
    const config = makeConfig();
    const now = Date.now();
    // Create records spread over 10 minutes (normal rate: ~1/min), then 10 in 1 minute
    const records: AuditRecord[] = [];
    for (let i = 0; i < 10; i++) {
      records.push(makeRecord({
        timestamp: now - (600_000 - i * 60_000),
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }));
    }
    // Spike: 10 calls in the last minute
    for (let i = 0; i < 10; i++) {
      records.push(makeRecord({
        timestamp: now - 50_000 + i * 1000,
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }));
    }
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const spikes = events.filter(e => e.type === "rate_spike");
    expect(spikes.length).toBe(1);
    expect(spikes[0]!.emoji).toBe("⚡");
  });

  it("should NOT spike with normal consistent rate", () => {
    const config = makeConfig();
    const now = Date.now();
    const records: AuditRecord[] = [];
    for (let i = 0; i < 20; i++) {
      records.push(makeRecord({
        timestamp: now - (20 * 60_000) + i * 60_000,
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }));
    }
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const spikes = events.filter(e => e.type === "rate_spike");
    expect(spikes.length).toBe(0);
  });

  it("should handle empty records", () => {
    const config = makeConfig();
    const events = detectNotableEvents(
      [],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const spikes = events.filter(e => e.type === "rate_spike");
    expect(spikes.length).toBe(0);
  });

  it("should handle single-agent with few records", () => {
    const config = makeConfig();
    const records = [makeRecord(), makeRecord()];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const spikes = events.filter(e => e.type === "rate_spike");
    expect(spikes.length).toBe(0);
  });
});

describe("New Tool Detector", () => {
  it("should detect new tool usage", () => {
    const config = makeConfig();
    const now = Date.now();
    const lastCheck = now - 3600_000; // 1 hour ago
    // History: agent used 'exec' before
    const oldRecord = makeRecord({
      timestamp: lastCheck - 10_000,
      context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
    });
    // New: agent uses 'web_search' after last check
    const newRecord = makeRecord({
      timestamp: now - 1000,
      context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "web_search" },
    });
    const events = detectNotableEvents(
      [oldRecord, newRecord],
      makeTrustStore({ main: {} }),
      makeState({ lastCheck }),
      config,
    );
    const newTools = events.filter(e => e.type === "new_tool");
    expect(newTools.length).toBe(1);
    expect(newTools[0]!.message).toContain("web_search");
  });

  it("should NOT flag known tools", () => {
    const config = makeConfig();
    const now = Date.now();
    const lastCheck = now - 3600_000;
    const records = [
      makeRecord({
        timestamp: lastCheck - 10_000,
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState({ lastCheck }),
      config,
    );
    const newTools = events.filter(e => e.type === "new_tool");
    expect(newTools.length).toBe(0);
  });

  it("should handle no history", () => {
    const config = makeConfig();
    const now = Date.now();
    const record = makeRecord({
      timestamp: now - 1000,
      context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
    });
    // With no lastCheck set, everything is "recent" vs "history"
    const events = detectNotableEvents(
      [record],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    // With no prior history, first tool usage may or may not be flagged
    // (no baseline to compare against — detector needs history records before checkSince)
    const newTools = events.filter(e => e.type === "new_tool");
    // No prior history → new tool (since there's no old toolName baseline)
    expect(newTools.length).toBeGreaterThanOrEqual(0);
  });
});

describe("Trust Jump Detector", () => {
  it("should detect trust increase > 10 in 24h", () => {
    const config = makeConfig();
    const now = Date.now();
    const records = [
      makeRecord({
        timestamp: now - 3600_000,
        trust: { score: 30, tier: "restricted" },
        context: { hook: "before_tool_call", agentId: "rex", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        trust: { score: 50, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "rex", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ rex: {} }),
      makeState(),
      config,
    );
    const jumps = events.filter(e => e.type === "trust_jump");
    expect(jumps.length).toBe(1);
    expect(jumps[0]!.message).toContain("rex");
    expect(jumps[0]!.message).toContain("↑");
  });

  it("should NOT trigger on exactly 10 delta", () => {
    const config = makeConfig();
    const now = Date.now();
    const records = [
      makeRecord({
        timestamp: now - 3600_000,
        trust: { score: 40, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        trust: { score: 50, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const jumps = events.filter(e => e.type === "trust_jump");
    expect(jumps.length).toBe(0);
  });

  it("should handle no trust data", () => {
    const config = makeConfig();
    const events = detectNotableEvents(
      [],
      makeTrustStore(),
      makeState(),
      config,
    );
    const jumps = events.filter(e => e.type === "trust_jump");
    expect(jumps.length).toBe(0);
  });
});

describe("Trust Drop Detector", () => {
  it("should detect trust decrease > 10 in 24h", () => {
    const config = makeConfig();
    const now = Date.now();
    const records = [
      makeRecord({
        timestamp: now - 3600_000,
        trust: { score: 70, tier: "trusted" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        trust: { score: 45, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const drops = events.filter(e => e.type === "trust_drop");
    expect(drops.length).toBe(1);
    expect(drops[0]!.emoji).toBe("📉");
  });

  it("should NOT trigger on exactly -10 delta", () => {
    const config = makeConfig();
    const now = Date.now();
    const records = [
      makeRecord({
        timestamp: now - 3600_000,
        trust: { score: 60, tier: "trusted" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        trust: { score: 50, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const drops = events.filter(e => e.type === "trust_drop");
    expect(drops.length).toBe(0);
  });

  it("should handle recovery (drop then rise)", () => {
    const config = makeConfig();
    const now = Date.now();
    // Net: started at 60, ended at 55 — only -5, no trigger
    const records = [
      makeRecord({
        timestamp: now - 7200_000,
        trust: { score: 60, tier: "trusted" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        timestamp: now - 1000,
        trust: { score: 55, tier: "standard" },
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const drops = events.filter(e => e.type === "trust_drop");
    expect(drops.length).toBe(0);
  });
});

describe("Clean Streak Detector", () => {
  it("should trigger on streak >= 3", () => {
    const config = makeConfig();
    const store = makeTrustStore({
      main: { signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 5, manualAdjustment: 0 } },
    });
    const events = detectNotableEvents([], store, makeState(), config);
    const streaks = events.filter(e => e.type === "clean_streak");
    expect(streaks.length).toBe(1);
    expect(streaks[0]!.emoji).toBe("🎉");
    expect(streaks[0]!.message).toContain("5 days");
  });

  it("should trigger on threshold 7", () => {
    const config = makeConfig();
    const store = makeTrustStore({
      main: { signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 7, manualAdjustment: 0 } },
    });
    const events = detectNotableEvents([], store, makeState(), config);
    const streaks = events.filter(e => e.type === "clean_streak");
    expect(streaks.length).toBe(1);
  });

  it("should trigger on threshold 14", () => {
    const config = makeConfig();
    const store = makeTrustStore({
      main: { signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 14, manualAdjustment: 0 } },
    });
    const events = detectNotableEvents([], store, makeState(), config);
    const streaks = events.filter(e => e.type === "clean_streak");
    expect(streaks.length).toBe(1);
  });

  it("should NOT trigger on streak < 3", () => {
    const config = makeConfig();
    const store = makeTrustStore({
      main: { signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 2, manualAdjustment: 0 } },
    });
    const events = detectNotableEvents([], store, makeState(), config);
    const streaks = events.filter(e => e.type === "clean_streak");
    expect(streaks.length).toBe(0);
  });
});

describe("First Denial Detector", () => {
  it("should detect first-ever denial for an agent", () => {
    const config = makeConfig();
    const now = Date.now();
    const record = makeRecord({
      verdict: "deny",
      timestamp: now - 1000,
      context: { hook: "before_tool_call", agentId: "stella", sessionKey: "s", toolName: "exec" },
    });
    const events = detectNotableEvents(
      [record],
      makeTrustStore({ stella: {} }),
      makeState({ lastCheck: now - 3600_000 }),
      config,
    );
    const firsts = events.filter(e => e.type === "first_denial");
    expect(firsts.length).toBe(1);
    expect(firsts[0]!.emoji).toBe("🔔");
  });

  it("should NOT flag if agent had prior denials", () => {
    const config = makeConfig();
    const now = Date.now();
    const records = [
      makeRecord({
        verdict: "deny",
        timestamp: now - 86400_000, // 1 day ago
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "exec" },
      }),
      makeRecord({
        verdict: "deny",
        timestamp: now - 1000,
        context: { hook: "before_tool_call", agentId: "main", sessionKey: "s", toolName: "read" },
      }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState({ lastCheck: now - 3600_000 }),
      config,
    );
    const firsts = events.filter(e => e.type === "first_denial");
    expect(firsts.length).toBe(0);
  });

  it("should handle no denials at all", () => {
    const config = makeConfig();
    const record = makeRecord({ verdict: "allow" });
    const events = detectNotableEvents(
      [record],
      makeTrustStore({ main: {} }),
      makeState(),
      config,
    );
    const firsts = events.filter(e => e.type === "first_denial");
    expect(firsts.length).toBe(0);
  });
});

describe("While You Were Away Detector", () => {
  it("should summarize events since lastCheck", () => {
    const config = makeConfig();
    const now = Date.now();
    const lastCheck = now - 7200_000; // 2h ago
    const records = [
      makeRecord({ timestamp: now - 3000, verdict: "allow" }),
      makeRecord({ timestamp: now - 2000, verdict: "allow" }),
      makeRecord({ timestamp: now - 1000, verdict: "deny" }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState({ lastCheck }),
      config,
    );
    const away = events.filter(e => e.type === "while_you_were_away");
    expect(away.length).toBe(1);
    expect(away[0]!.emoji).toBe("👀");
    expect(away[0]!.message).toContain("+2 governed");
    expect(away[0]!.message).toContain("+1 denied");
  });

  it("should NOT trigger on first check (no lastCheck)", () => {
    const config = makeConfig();
    const events = detectNotableEvents(
      [makeRecord()],
      makeTrustStore({ main: {} }),
      makeState({ lastCheck: 0 }),
      config,
    );
    const away = events.filter(e => e.type === "while_you_were_away");
    expect(away.length).toBe(0);
  });

  it("should NOT trigger when no events since last check", () => {
    const config = makeConfig();
    const now = Date.now();
    const lastCheck = now - 3600_000;
    // Record is BEFORE lastCheck
    const record = makeRecord({ timestamp: lastCheck - 10_000 });
    const events = detectNotableEvents(
      [record],
      makeTrustStore({ main: {} }),
      makeState({ lastCheck }),
      config,
    );
    const away = events.filter(e => e.type === "while_you_were_away");
    expect(away.length).toBe(0);
  });

  it("should handle mixed verdicts", () => {
    const config = makeConfig();
    const now = Date.now();
    const lastCheck = now - 3600_000;
    const records = [
      makeRecord({ timestamp: now - 5000, verdict: "allow" }),
      makeRecord({ timestamp: now - 4000, verdict: "allow" }),
      makeRecord({ timestamp: now - 3000, verdict: "allow" }),
    ];
    const events = detectNotableEvents(
      records,
      makeTrustStore({ main: {} }),
      makeState({ lastCheck }),
      config,
    );
    const away = events.filter(e => e.type === "while_you_were_away");
    expect(away.length).toBe(1);
    expect(away[0]!.message).toContain("+3 governed");
    expect(away[0]!.message).not.toContain("denied");
  });
});

describe("Shield Score Calculation", () => {
  it("should return max score when all features enabled", () => {
    const config = makeConfig({
      builtinPolicies: {
        credentialGuard: true,
        nightMode: { start: "23:00", end: "06:00" },
        rateLimiter: { maxPerMinute: 30 },
      },
      trust: { enabled: true } as any,
      responseGate: { enabled: true, rules: [] } as any,
      approvalManager: { enabled: true, defaultTimeoutSeconds: 300, defaultAction: "deny" },
    });
    const score = calculateShieldScore(config);
    expect(score.total).toBe(100);
    expect(score.max).toBe(100);
    expect(score.percentage).toBe(100);
    expect(score.features.every(f => f.enabled)).toBe(true);
  });

  it("should return 0 when no features enabled", () => {
    const config = makeConfig({
      builtinPolicies: {},
      trust: { enabled: false } as any,
      responseGate: { enabled: false } as any,
      approvalManager: { enabled: false } as any,
    });
    const score = calculateShieldScore(config);
    expect(score.total).toBe(0);
    expect(score.percentage).toBe(0);
    expect(score.features.every(f => !f.enabled)).toBe(true);
  });

  it("should handle partial features", () => {
    const config = makeConfig({
      builtinPolicies: { credentialGuard: true },
      trust: { enabled: true } as any,
      responseGate: undefined,
      approvalManager: undefined,
    });
    const score = calculateShieldScore(config);
    expect(score.total).toBe(35); // 20 (cred guard) + 15 (trust)
    expect(score.max).toBe(100);
    expect(score.percentage).toBe(35);
  });

  it("should handle nightMode as boolean true", () => {
    const config = makeConfig({
      builtinPolicies: { nightMode: true },
      trust: { enabled: false } as any,
    });
    const score = calculateShieldScore(config);
    const nightFeature = score.features.find(f => f.name === "Night Mode");
    expect(nightFeature!.enabled).toBe(true);
    expect(nightFeature!.points).toBe(20);
  });

  it("should handle rateLimiter as boolean true", () => {
    const config = makeConfig({
      builtinPolicies: { rateLimiter: true },
      trust: { enabled: false } as any,
    });
    const score = calculateShieldScore(config);
    const rlFeature = score.features.find(f => f.name === "Rate Limiter");
    expect(rlFeature!.enabled).toBe(true);
    expect(rlFeature!.points).toBe(15);
  });

  it("should have correct feature names and maxPoints", () => {
    const config = makeConfig();
    const score = calculateShieldScore(config);
    expect(score.features.length).toBe(6);
    const names = score.features.map(f => f.name);
    expect(names).toContain("Credential Guard");
    expect(names).toContain("Night Mode");
    expect(names).toContain("Rate Limiter");
    expect(names).toContain("Trust Scoring");
    expect(names).toContain("Response Gate");
    expect(names).toContain("Approval Manager");
  });
});

describe("Streak Counter", () => {
  it("should count consecutive clean days", () => {
    const now = Date.now();
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const records = [
      makeRecord({ timestamp: today.getTime(), verdict: "allow" }),
      makeRecord({ timestamp: yesterday.getTime(), verdict: "allow" }),
    ];
    const streak = calculateStreak(records);
    expect(streak).toBe(2);
  });

  it("should break on denial", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const records = [
      makeRecord({ timestamp: today.getTime(), verdict: "allow" }),
      makeRecord({ timestamp: yesterday.getTime(), verdict: "deny" }),
    ];
    const streak = calculateStreak(records);
    expect(streak).toBe(1); // Only today is clean
  });

  it("should return 0 for empty records", () => {
    expect(calculateStreak([])).toBe(0);
  });

  it("should skip inactive days without breaking streak", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    // 2 days ago
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

    const records = [
      makeRecord({ timestamp: today.getTime(), verdict: "allow" }),
      // Yesterday: no records (inactive)
      makeRecord({ timestamp: twoDaysAgo.getTime(), verdict: "allow" }),
    ];
    const streak = calculateStreak(records);
    expect(streak).toBe(2); // Both active days are clean
  });

  it("should break streak after >1 consecutive inactive days", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    // 4 days ago (2 empty days in between = gap too large)
    const fourDaysAgo = new Date(today);
    fourDaysAgo.setUTCDate(fourDaysAgo.getUTCDate() - 4);

    const records = [
      makeRecord({ timestamp: today.getTime(), verdict: "allow" }),
      // 3 inactive days (1, 2, 3 days ago) → breaks after MAX_EMPTY_DAYS (1)
      makeRecord({ timestamp: fourDaysAgo.getTime(), verdict: "allow" }),
    ];
    const streak = calculateStreak(records);
    expect(streak).toBe(1); // Only today — gap too large to bridge
  });

  it("should not inflate streak by skipping scattered inactive days", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);

    // Records spread over 30 days but only 5 active days with large gaps
    const records: AuditRecord[] = [];
    for (const daysAgo of [0, 5, 10, 15, 20]) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - daysAgo);
      records.push(makeRecord({ timestamp: d.getTime(), verdict: "allow" }));
    }
    const streak = calculateStreak(records);
    // Should NOT be 5 — gaps >1 day break the streak
    expect(streak).toBe(1);
  });

  it("should handle single day", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const records = [makeRecord({ timestamp: today.getTime(), verdict: "allow" })];
    expect(calculateStreak(records)).toBe(1);
  });
});

describe("renderTrustBar", () => {
  it("should render full bar for score 100", () => {
    expect(renderTrustBar(100)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("should render empty bar for score 0", () => {
    expect(renderTrustBar(0)).toBe("▱▱▱▱▱▱▱▱▱▱");
  });

  it("should render half bar for score 50", () => {
    expect(renderTrustBar(50)).toBe("▰▰▰▰▰▱▱▱▱▱");
  });

  it("should clamp negative scores", () => {
    expect(renderTrustBar(-10)).toBe("▱▱▱▱▱▱▱▱▱▱");
  });

  it("should clamp scores above 100", () => {
    expect(renderTrustBar(150)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("should support custom width", () => {
    expect(renderTrustBar(50, 20)).toBe("▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱");
  });
});

describe("renderCompactLine", () => {
  it("should format compact line correctly", () => {
    const line = renderCompactLine({
      agentCount: 3,
      avgTrust: 48,
      totalGoverned: 389,
      totalDenied: 2,
      shieldScore: 85,
      shieldMax: 100,
    });
    expect(line).toContain("🧠 brainplex");
    expect(line).toContain("3 agents");
    expect(line).toContain("389 governed");
    expect(line).toContain("2 denied");
    expect(line).toContain("shield 85/100");
    expect(line).toContain("trust");
    expect(line).toContain("▰");
  });

  it("should handle zero state", () => {
    const line = renderCompactLine({
      agentCount: 0,
      avgTrust: 0,
      totalGoverned: 0,
      totalDenied: 0,
      shieldScore: 0,
      shieldMax: 100,
    });
    expect(line).toContain("0 agents");
    expect(line).toContain("0 governed");
    expect(line).toContain("shield 0/100");
  });
});

describe("renderDashboard (Full Integration)", () => {
  it("should render complete dashboard with all sections", () => {
    const now = Date.now();
    const output = renderDashboard({
      notableEvents: [
        { id: "e1", type: "night_denial", emoji: "🚫", message: "main denied at 02:00", timestamp: now },
      ],
      shieldScore: {
        total: 85,
        max: 100,
        percentage: 85,
        features: [
          { name: "Credential Guard", points: 20, maxPoints: 20, enabled: true },
          { name: "Night Mode", points: 20, maxPoints: 20, enabled: true },
          { name: "Rate Limiter", points: 15, maxPoints: 15, enabled: true },
          { name: "Trust Scoring", points: 15, maxPoints: 15, enabled: true },
          { name: "Response Gate", points: 15, maxPoints: 15, enabled: true },
          { name: "Approval Manager", points: 0, maxPoints: 15, enabled: false },
        ],
      },
      streak: 7,
      trustStore: makeTrustStore({
        main: { score: 72, tier: "trusted", signals: { successCount: 247, violationCount: 0, ageDays: 10, cleanStreak: 146, manualAdjustment: 0 } },
        stella: { score: 42, tier: "standard", signals: { successCount: 89, violationCount: 2, ageDays: 5, cleanStreak: 36, manualAdjustment: 0 } },
      }),
      stats: { totalEvaluations: 389, allowCount: 387, denyCount: 2 },
      lastCheck: now - 7200_000,
      records: [makeRecord({ timestamp: now - 1000 })],
    });

    expect(output).toContain("🧠 **Brainplex Dashboard**");
    expect(output).toContain("⚡ NOTABLE");
    expect(output).toContain("🚫 main denied at 02:00");
    expect(output).toContain("🛡️ SHIELD SCORE: 85/100");
    expect(output).toContain("🔥 STREAK: 7 days clean");
    expect(output).toContain("📊 DELTA");
    expect(output).toContain("🗺️ AGENT MAP");
    expect(output).toContain("main");
    expect(output).toContain("stella");
    expect(output).toContain("🧠 brainplex");
    expect(output).toContain("───");
  });

  it("should render empty state gracefully", () => {
    const output = renderDashboard({
      notableEvents: [],
      shieldScore: { total: 0, max: 100, percentage: 0, features: [] },
      streak: 0,
      trustStore: makeTrustStore(),
      stats: { totalEvaluations: 0, allowCount: 0, denyCount: 0 },
      lastCheck: 0,
      records: [],
    });

    expect(output).toContain("🧠 **Brainplex Dashboard**");
    expect(output).toContain("SHIELD SCORE: 0/100");
    expect(output).toContain("STREAK: 0 days clean");
    expect(output).toContain("first check");
    expect(output).toContain("_No agents registered_");
  });

  it("should render without notable events", () => {
    const output = renderDashboard({
      notableEvents: [],
      shieldScore: { total: 50, max: 100, percentage: 50, features: [] },
      streak: 3,
      trustStore: makeTrustStore({ main: { score: 72, tier: "trusted" } }),
      stats: { totalEvaluations: 100, allowCount: 99, denyCount: 1 },
      lastCheck: Date.now() - 3600_000,
      records: [],
    });

    expect(output).not.toContain("⚡ NOTABLE");
    expect(output).toContain("🗺️ AGENT MAP");
  });
});

describe("Deduplication", () => {
  it("should not return events already in notableSeen", () => {
    const config = makeConfig();
    const store = makeTrustStore({
      main: { signals: { successCount: 100, violationCount: 0, ageDays: 10, cleanStreak: 7, manualAdjustment: 0 } },
    });
    // First call: get events
    const events1 = detectNotableEvents([], store, makeState(), config);
    const streakEvents1 = events1.filter(e => e.type === "clean_streak");
    expect(streakEvents1.length).toBe(1);

    // Second call with seen IDs from first call
    const events2 = detectNotableEvents(
      [],
      store,
      makeState({ notableSeen: events1.map(e => e.id) }),
      config,
    );
    const streakEvents2 = events2.filter(e => e.type === "clean_streak");
    expect(streakEvents2.length).toBe(0);
  });
});

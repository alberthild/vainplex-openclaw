import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  AgentTrust,
  PluginLogger,
  TrustConfig,
  TrustEvent,
  TrustSignals,
  TrustStore,
  TrustTier,
  TrustWeights,
} from "./types.js";
import { clamp, scoreToTier } from "./util.js";

const DEFAULT_WEIGHTS: TrustWeights = {
  agePerDay: 0.5,
  ageMax: 20,
  successPerAction: 0.1,
  successMax: 30,
  violationPenalty: -2,
  cleanStreakPerDay: 0.3,
  cleanStreakMax: 20,
};

function mergeWeights(partial?: Partial<TrustWeights>): TrustWeights {
  if (!partial) return { ...DEFAULT_WEIGHTS };
  return { ...DEFAULT_WEIGHTS, ...partial };
}

function computeScore(signals: TrustSignals, weights: TrustWeights): number {
  const base = Math.min(signals.ageDays * weights.agePerDay, weights.ageMax);
  const success = Math.min(
    signals.successCount * weights.successPerAction,
    weights.successMax,
  );
  const violations = signals.violationCount * weights.violationPenalty;
  const streak = Math.min(
    signals.cleanStreak * weights.cleanStreakPerDay,
    weights.cleanStreakMax,
  );
  const raw = base + success + violations + streak + signals.manualAdjustment;
  return clamp(raw, 0, 100);
}

function createAgentTrust(
  agentId: string,
  initialScore: number,
): AgentTrust {
  const now = new Date().toISOString();
  return {
    agentId,
    score: clamp(initialScore, 0, 100),
    tier: scoreToTier(initialScore),
    signals: {
      successCount: 0,
      violationCount: 0,
      ageDays: 0,
      cleanStreak: 0,
      manualAdjustment: 0,
    },
    history: [],
    lastEvaluation: now,
    created: now,
  };
}

export class TrustManager {
  private readonly config: TrustConfig;
  private readonly filePath: string;
  private readonly logger: PluginLogger;
  private readonly weights: TrustWeights;
  private store: TrustStore;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(config: TrustConfig, workspace: string, logger: PluginLogger) {
    this.config = config;
    this.filePath = join(workspace, "governance", "trust.json");
    this.logger = logger;
    this.weights = mergeWeights(config.weights);
    this.store = { version: 1, updated: new Date().toISOString(), agents: {} };
  }

  load(): void {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as TrustStore;
        this.store = parsed;
        this.applyDecay();
        this.logger.info(
          `[governance] Trust store loaded: ${Object.keys(this.store.agents).length} agents`,
        );
      } catch (e) {
        this.logger.error(
          `[governance] Failed to load trust store: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private applyDecay(): void {
    if (!this.config.decay.enabled) return;

    const now = Date.now();
    for (const agent of Object.values(this.store.agents)) {
      const lastEval = new Date(agent.lastEvaluation).getTime();
      const daysSince = (now - lastEval) / (1000 * 60 * 60 * 24);
      if (daysSince > this.config.decay.inactivityDays) {
        agent.score = clamp(
          agent.score * this.config.decay.rate,
          agent.floor ?? 0,
          100,
        );
        agent.tier = agent.locked ?? scoreToTier(agent.score);
        this.dirty = true;
      }
    }
  }

  getAgentTrust(agentId: string): AgentTrust {
    const existing = this.store.agents[agentId];
    if (existing) return existing;

    const defaultScore = this.resolveDefault(agentId);
    const agent = createAgentTrust(agentId, defaultScore);
    this.store.agents[agentId] = agent;
    this.dirty = true;
    return agent;
  }

  private resolveDefault(agentId: string): number {
    const explicit = this.config.defaults[agentId];
    if (explicit !== undefined) return explicit;
    const wildcard = this.config.defaults["*"];
    if (wildcard !== undefined) return wildcard;
    return 10;
  }

  getStore(): TrustStore {
    return this.store;
  }

  recordSuccess(agentId: string, reason?: string): void {
    const agent = this.getAgentTrust(agentId);
    agent.signals.successCount++;
    agent.signals.cleanStreak++;
    this.addEvent(agent, "success", 1, reason);
    this.recalculate(agent);
  }

  recordViolation(agentId: string, reason?: string): void {
    const agent = this.getAgentTrust(agentId);
    agent.signals.violationCount++;
    agent.signals.cleanStreak = 0;
    this.addEvent(agent, "violation", -2, reason);
    this.recalculate(agent);
  }

  setScore(agentId: string, score: number): void {
    const agent = this.getAgentTrust(agentId);
    const clamped = clamp(score, agent.floor ?? 0, 100);
    const delta = clamped - agent.score;

    // Compute what the formula would produce without the new adjustment
    const currentComputed = computeScore(agent.signals, this.weights);
    // Set manualAdjustment so that computeScore yields the desired score
    agent.signals.manualAdjustment = clamped - (currentComputed - agent.signals.manualAdjustment);

    this.addEvent(agent, "manual_adjustment", delta, `Manual set to ${clamped}`);
    this.recalculate(agent);
  }

  lockTier(agentId: string, tier: TrustTier): void {
    const agent = this.getAgentTrust(agentId);
    agent.locked = tier;
    agent.tier = tier;
    this.dirty = true;
  }

  unlockTier(agentId: string): void {
    const agent = this.getAgentTrust(agentId);
    agent.locked = undefined;
    agent.tier = scoreToTier(agent.score);
    this.dirty = true;
  }

  setFloor(agentId: string, floor: number): void {
    const agent = this.getAgentTrust(agentId);
    agent.floor = clamp(floor, 0, 100);
    if (agent.score < agent.floor) {
      agent.score = agent.floor;
      agent.tier = agent.locked ?? scoreToTier(agent.score);
    }
    this.dirty = true;
  }

  resetHistory(agentId: string): void {
    const agent = this.getAgentTrust(agentId);
    agent.history = [];
    agent.signals = {
      successCount: 0,
      violationCount: 0,
      ageDays: 0,
      cleanStreak: 0,
      manualAdjustment: 0,
    };
    this.recalculate(agent);
  }

  private addEvent(
    agent: AgentTrust,
    type: TrustEvent["type"],
    delta: number,
    reason?: string,
  ): void {
    agent.history.push({
      timestamp: new Date().toISOString(),
      type,
      delta,
      reason,
    });
    // Trim history
    if (agent.history.length > this.config.maxHistoryPerAgent) {
      agent.history = agent.history.slice(-this.config.maxHistoryPerAgent);
    }
  }

  private recalculate(agent: AgentTrust): void {
    agent.signals.ageDays = Math.floor(
      (Date.now() - new Date(agent.created).getTime()) / (1000 * 60 * 60 * 24),
    );
    agent.score = computeScore(agent.signals, this.weights);
    if (agent.floor !== undefined && agent.score < agent.floor) {
      agent.score = agent.floor;
    }
    agent.tier = agent.locked ?? scoreToTier(agent.score);
    agent.lastEvaluation = new Date().toISOString();
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.store.updated = new Date().toISOString();
      writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
      this.dirty = false;
    } catch (e) {
      this.logger.error(
        `[governance] Failed to flush trust store: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  startPersistence(): void {
    if (this.persistTimer) return;
    this.persistTimer = setInterval(
      () => this.flush(),
      this.config.persistIntervalSeconds * 1000,
    );
    this.persistTimer.unref();
  }

  stopPersistence(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    this.flush();
  }
}

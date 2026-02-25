import type {
  AgentTrust,
  SessionTrust,
  SessionTrustConfig,
  TrustTier,
} from "./types.js";
import type { TrustManager } from "./trust-manager.js";
import { scoreToTier } from "./util.js";

type Signal = keyof SessionTrustConfig["signals"];

export class SessionTrustManager {
  readonly #config: SessionTrustConfig;
  readonly #agentTrustManager: TrustManager;
  readonly #sessions = new Map<string, SessionTrust>();

  constructor(config: SessionTrustConfig, agentTrustManager: TrustManager) {
    this.#config = config;
    this.#agentTrustManager = agentTrustManager;
  }

  /**
   * Initializes a new session trust object. Called on session_start hook.
   * If session trust is disabled, it returns a shell object with agent's trust.
   */
  initializeSession(sessionId: string, agentId: string): SessionTrust {
    if (!this.#config.enabled) {
      const agentTrust = this.#agentTrustManager.getAgentTrust(agentId);
      const fallback: SessionTrust = {
        sessionId,
        agentId,
        score: agentTrust.score,
        tier: agentTrust.tier,
        cleanStreak: 0,
        createdAt: Date.now(),
      };
      this.#sessions.set(sessionId, fallback);
      return fallback;
    }

    // Per RFC-008 and task instruction correction:
    // Use wildcard default for unresolved agents.
    const agentTrust = this.#agentTrustManager.getAgentTrust(agentId);

    const score = Math.floor(agentTrust.score * this.#config.seedFactor);

    const sessionTrust: SessionTrust = {
      sessionId,
      agentId,
      score,
      tier: scoreToTier(score),
      cleanStreak: 0,
      createdAt: Date.now(),
    };

    this.#sessions.set(sessionId, sessionTrust);
    return sessionTrust;
  }

  /**
   * Retrieves the trust object for a session. If not found, initializes it.
   */
  getSessionTrust(sessionId: string, agentId: string): SessionTrust {
    if (this.#sessions.has(sessionId)) {
      return this.#sessions.get(sessionId)!;
    }
    return this.initializeSession(sessionId, agentId);
  }

  /**
   * Applies a signal to a session, adjusting its trust score.
   */
  applySignal(
    sessionId: string,
    agentId: string,
    signal: Signal,
  ): SessionTrust {
    if (!this.#config.enabled) {
      return this.getSessionTrust(sessionId, agentId);
    }

    const session = this.getSessionTrust(sessionId, agentId);
    const agentTrust = this.#agentTrustManager.getAgentTrust(agentId);

    let delta = this.#config.signals[signal] ?? 0;

    if (signal === "success") {
      session.cleanStreak += 1;
      if (session.cleanStreak >= this.#config.signals.cleanStreakThreshold) {
        delta += this.#config.signals.cleanStreakBonus;
        session.cleanStreak = 0; // Reset streak after bonus
      }
    } else {
      // Any non-success signal breaks the streak
      session.cleanStreak = 0;
    }

    const newScore = session.score + delta;
    this.setScore(sessionId, agentId, newScore);

    return session;
  }

  /**
   * Directly sets the trust score for a session, respecting floor and ceiling.
   */
  setScore(sessionId: string, agentId: string, newScore: number): SessionTrust {
    if (!this.#config.enabled) {
      return this.getSessionTrust(sessionId, agentId);
    }

    const session = this.getSessionTrust(sessionId, agentId);
    const agentTrust = this.#agentTrustManager.getAgentTrust(agentId);

    const floor = 0;
    const ceiling = Math.min(
      100,
      Math.floor(agentTrust.score * this.#config.ceilingFactor),
    );

    const clampedScore = Math.max(floor, Math.min(newScore, ceiling));

    session.score = clampedScore;
    session.tier = scoreToTier(clampedScore);

    return session;
  }

  /**
   * Removes a session's trust object from memory. Called on session_end.
   */
  destroySession(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  /**
   * For testing purposes: get the raw session map.
   */
  _getSessions(): Map<string, SessionTrust> {
    return this.#sessions;
  }
}

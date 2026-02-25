import type {
  SessionTrust,
  SessionTrustConfig,
} from "./types.js";
import type { TrustManager } from "./trust-manager.js";
import { scoreToTier } from "./util.js";

type Signal = keyof SessionTrustConfig["signals"];

const MAX_SESSIONS = 500;

export class SessionTrustManager {
  readonly #config: SessionTrustConfig;
  readonly #agentTrustManager: TrustManager;
  readonly #sessions = new Map<string, SessionTrust>();

  constructor(config: SessionTrustConfig, agentTrustManager: TrustManager) {
    this.#config = config;
    this.#agentTrustManager = agentTrustManager;
  }

  /** Evict oldest sessions when exceeding MAX_SESSIONS to prevent memory leaks. */
  private evictIfNeeded(): void {
    if (this.#sessions.size <= MAX_SESSIONS) return;
    let oldest: string | undefined;
    let oldestTime = Infinity;
    for (const [id, s] of this.#sessions) {
      if (s.createdAt < oldestTime) {
        oldestTime = s.createdAt;
        oldest = id;
      }
    }
    if (oldest) this.#sessions.delete(oldest);
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
    this.evictIfNeeded();
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
   * For testing purposes: get a shallow copy of the session map.
   */
  _getSessions(): ReadonlyMap<string, SessionTrust> {
    return new Map(this.#sessions);
  }
}

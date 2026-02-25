import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionTrustManager } from "../src/session-trust-manager";
import type { SessionTrustConfig, AgentTrust } from "../src/types";
import { TrustManager } from "../src/trust-manager";
import { scoreToTier } from "../src/util";

// Mock TrustManager
vi.mock("../src/trust-manager");
vi.mock("../src/util", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/util")>();
  return {
    ...original,
    scoreToTier: vi.fn((score: number) => {
      if (score < 20) return "untrusted";
      if (score < 40) return "restricted";
      if (score < 60) return "standard";
      if (score < 80) return "trusted";
      return "elevated";
    }),
  };
});

const mockAgentTrustManager = {
  getAgentTrust: vi.fn(),
};

const defaultConfig: SessionTrustConfig = {
  enabled: true,
  seedFactor: 0.7,
  ceilingFactor: 1.2,
  signals: {
    success: 1,
    policyBlock: -2,
    credentialViolation: -10,
    cleanStreakBonus: 3,
    cleanStreakThreshold: 10,
  },
};

const createMockAgentTrust = (score: number): AgentTrust => ({
  agentId: "test-agent",
  score,
  tier: "standard",
  signals: {} as any,
  history: [],
  lastEvaluation: "",
  created: "",
});

describe("SessionTrustManager", () => {
  let manager: SessionTrustManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionTrustManager(
      defaultConfig,
      mockAgentTrustManager as any,
    );
  });

  it("should initialize a session with a seed factor", () => {
    const agentTrust = createMockAgentTrust(60);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    const sessionTrust = manager.initializeSession("session-1", "test-agent");

    expect(sessionTrust.score).toBe(42); // 60 * 0.7
    expect(sessionTrust.tier).toBe("standard");
    expect(sessionTrust.cleanStreak).toBe(0);
    expect(mockAgentTrustManager.getAgentTrust).toHaveBeenCalledWith("test-agent");
  });

  it("should handle unresolved agent ID by using wildcard trust", () => {
    // 'unresolved' is the agentId when it can't be determined
    const wildcardTrust = createMockAgentTrust(10);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(wildcardTrust);

    const sessionTrust = manager.initializeSession("session-1", "unresolved");

    expect(sessionTrust.score).toBe(7); // 10 * 0.7
    expect(sessionTrust.tier).toBe("untrusted");
    expect(mockAgentTrustManager.getAgentTrust).toHaveBeenCalledWith("unresolved");
  });

  it("should apply a success signal and increment clean streak", () => {
    const agentTrust = createMockAgentTrust(60);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent");
    const updatedSession = manager.applySignal(
      "session-1",
      "test-agent",
      "success",
    );

    expect(updatedSession.score).toBe(43); // 42 + 1
    expect(updatedSession.cleanStreak).toBe(1);
  });

  it("should apply a policyBlock signal and reset clean streak", () => {
    const agentTrust = createMockAgentTrust(60);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent");
    manager.applySignal("session-1", "test-agent", "success"); // Streak is 1
    const updatedSession = manager.applySignal(
      "session-1",
      "test-agent",
      "policyBlock",
    );

    expect(updatedSession.score).toBe(41); // 43 - 2
    expect(updatedSession.cleanStreak).toBe(0);
  });

  it("should apply a clean streak bonus", () => {
    const agentTrust = createMockAgentTrust(80); // Higher score to avoid ceiling
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent"); // Starts at 56

    for (let i = 0; i < 9; i++) {
      manager.applySignal("session-1", "test-agent", "success");
    }
    // Score is 56 + 9 = 65. Streak is 9.
    const streakSession = manager.getSessionTrust("session-1", "test-agent");
    expect(streakSession.score).toBe(65);
    expect(streakSession.cleanStreak).toBe(9);

    // 10th success triggers bonus
    const bonusSession = manager.applySignal(
      "session-1",
      "test-agent",
      "success",
    );

    // 65 + 1 (success) + 3 (bonus) = 69
    expect(bonusSession.score).toBe(69);
    expect(bonusSession.cleanStreak).toBe(0); // Resets
  });

  it("should enforce the score ceiling", () => {
    const agentTrust = createMockAgentTrust(80); // Ceiling = 80 * 1.2 = 96
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent"); // Starts at 56
    const session = manager.setScore("session-1", "test-agent", 200);

    expect(session.score).toBe(96);
  });

  it("should enforce the score floor of 0", () => {
    const agentTrust = createMockAgentTrust(20);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent"); // Starts at 14
    const session = manager.applySignal(
      "session-1",
      "test-agent",
      "credentialViolation",
    ); // 14 - 10 = 4
    expect(session.score).toBe(4);

    const finalSession = manager.applySignal(
      "session-1",
      "test-agent",
      "credentialViolation",
    ); // 4 - 10 = -6 -> 0
    expect(finalSession.score).toBe(0);
  });

  it("should destroy a session and remove it from memory", () => {
    const agentTrust = createMockAgentTrust(60);
    mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

    manager.initializeSession("session-1", "test-agent");
    expect(manager._getSessions().has("session-1")).toBe(true);

    manager.destroySession("session-1");
    expect(manager._getSessions().has("session-1")).toBe(false);
  });

  describe("when session trust is disabled", () => {
    beforeEach(() => {
      const disabledConfig = { ...defaultConfig, enabled: false };
      manager = new SessionTrustManager(
        disabledConfig,
        mockAgentTrustManager as any,
      );
    });

    it("should initialize with the agent's full trust score", () => {
      const agentTrust = createMockAgentTrust(60);
      agentTrust.tier = "trusted";
      mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

      const sessionTrust = manager.initializeSession("session-1", "test-agent");

      expect(sessionTrust.score).toBe(60);
      expect(sessionTrust.tier).toBe("trusted");
    });

    it("should not apply signals", () => {
      const agentTrust = createMockAgentTrust(60);
      mockAgentTrustManager.getAgentTrust.mockReturnValue(agentTrust);

      manager.initializeSession("session-1", "test-agent");
      const updatedSession = manager.applySignal(
        "session-1",
        "test-agent",
        "success",
      );

      expect(updatedSession.score).toBe(60); // Unchanged
    });
  });
});

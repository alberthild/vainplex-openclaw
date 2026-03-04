import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApprovalManager } from "../src/approval-manager.js";
import type { ApprovalManagerConfig, PluginLogger } from "../src/types.js";

function mockLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function defaultConfig(overrides?: Partial<ApprovalManagerConfig>): ApprovalManagerConfig {
  return {
    enabled: true,
    defaultTimeoutSeconds: 5,
    defaultAction: "deny",
    notifyChannel: "test-channel",
    ...overrides,
  };
}

describe("ApprovalManager", () => {
  let manager: ApprovalManager;
  let logger: PluginLogger;
  let notifier: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = mockLogger();
    notifier = vi.fn();
    manager = new ApprovalManager(defaultConfig(), logger, notifier);
  });

  afterEach(() => {
    manager.cleanup();
    vi.useRealTimers();
  });

  describe("requestApproval", () => {
    it("should create a pending approval and return a promise", () => {
      const promise = manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: { command: "npm publish" },
        reason: "Production deployment",
      });

      expect(promise).toBeInstanceOf(Promise);
      expect(manager.pendingCount).toBe(1);
      expect(manager.getPending()).toHaveLength(1);

      const pending = manager.getPending()[0]!;
      expect(pending.agentId).toBe("forge");
      expect(pending.toolName).toBe("exec");
      expect(pending.status).toBe("pending");
    });

    it("should send notification via notifier", () => {
      manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: { command: "git push" },
        reason: "Push to main",
      });

      expect(notifier).toHaveBeenCalledTimes(1);
      const msg = notifier.mock.calls[0]![0] as string;
      expect(msg).toContain("Approval Required");
      expect(msg).toContain("forge");
      expect(msg).toContain("exec");
      expect(msg).toContain("/approve");
    });

    it("should log notification when no notifier configured", () => {
      const managerNoNotify = new ApprovalManager(defaultConfig(), logger);
      managerNoNotify.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No notifier configured"),
      );
      managerNoNotify.cleanup();
    });

    it("should redact secret-looking params in notification", () => {
      manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: { command: "echo sk_test_abc123456" },
        reason: "test",
      });

      const msg = notifier.mock.calls[0]![0] as string;
      expect(msg).toContain("[REDACTED]");
      expect(msg).not.toContain("sk_test_abc123456");
    });
  });

  describe("approve", () => {
    it("should resolve the promise with block: false", async () => {
      const promise = manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "npm_publish",
        toolParams: {},
        reason: "Release",
      });

      const id = manager.getPending()[0]!.id;
      const approveResult = manager.approve(id, "albert");

      expect(approveResult.found).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const result = await promise;
      expect(result).toEqual({ block: false });
    });

    it("should return found:false for unknown id", () => {
      const result = manager.approve("unknown-id");
      expect(result.found).toBe(false);
      expect(result.reason).toContain("No pending");
    });

    it("should block self-approval", () => {
      manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });
      const id = manager.getPending()[0]!.id;
      const result = manager.approve(id, "forge");
      expect(result.found).toBe(false);
      expect(result.reason).toContain("Self-approval");
      // Pending should still exist
      expect(manager.pendingCount).toBe(1);
    });

    it("should reject unauthorized approver when approvers list configured", () => {
      const managerWithApprovers = new ApprovalManager(
        defaultConfig({ approvers: ["albert", "claudia"] }),
        logger,
        notifier,
      );
      managerWithApprovers.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });
      const id = managerWithApprovers.getPending()[0]!.id;

      // Unauthorized approver
      const r1 = managerWithApprovers.approve(id, "random-user");
      expect(r1.found).toBe(false);
      expect(r1.reason).toContain("not authorized");

      // Authorized approver
      const r2 = managerWithApprovers.approve(id, "albert");
      expect(r2.found).toBe(true);
      managerWithApprovers.cleanup();
    });

    it("should log the approval", () => {
      manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });
      const id = manager.getPending()[0]!.id;
      manager.approve(id, "albert");

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("GRANTED"),
      );
    });
  });

  describe("deny", () => {
    it("should resolve the promise with block: true", async () => {
      const promise = manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "Dangerous",
      });

      const id = manager.getPending()[0]!.id;
      const found = manager.deny(id, "albert", "Too risky");

      expect(found).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const result = await promise;
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("Too risky");
    });

    it("should return false for unknown id", () => {
      expect(manager.deny("unknown-id")).toBe(false);
    });
  });

  describe("timeout", () => {
    it("should auto-deny after timeout (default action: deny)", async () => {
      const promise = manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
        timeoutSeconds: 2,
      });

      expect(manager.pendingCount).toBe(1);

      // Advance time past timeout
      vi.advanceTimersByTime(2100);

      const result = await promise;
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("timed out");
      expect(manager.pendingCount).toBe(0);
    });

    it("should auto-allow after timeout when defaultAction is allow", async () => {
      const managerAllow = new ApprovalManager(
        defaultConfig({ defaultAction: "allow" }),
        logger,
        notifier,
      );

      const promise = managerAllow.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
        timeoutSeconds: 2,
        defaultAction: "allow",
      });

      vi.advanceTimersByTime(2100);

      const result = await promise;
      expect(result.block).toBe(false);
      managerAllow.cleanup();
    });

    it("should use per-request timeout over global config", async () => {
      const promise = manager.requestApproval({
        agentId: "forge",
        sessionKey: "session-1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
        timeoutSeconds: 1,
      });

      // At 1.1s, should have timed out (not at 5s from config)
      vi.advanceTimersByTime(1100);

      const result = await promise;
      expect(result.block).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should resolve all pending with block: true", async () => {
      const p1 = manager.requestApproval({
        agentId: "forge",
        sessionKey: "s1",
        toolName: "exec",
        toolParams: {},
        reason: "test1",
      });
      const p2 = manager.requestApproval({
        agentId: "rex",
        sessionKey: "s2",
        toolName: "npm_publish",
        toolParams: {},
        reason: "test2",
      });

      expect(manager.pendingCount).toBe(2);
      manager.cleanup();
      expect(manager.pendingCount).toBe(0);

      const r1 = await p1;
      const r2 = await p2;
      expect(r1.block).toBe(true);
      expect(r2.block).toBe(true);
      expect(r1.blockReason).toContain("shutting down");
    });
  });

  describe("getPendingById", () => {
    it("should return the pending approval by id", () => {
      manager.requestApproval({
        agentId: "forge",
        sessionKey: "s1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });

      const id = manager.getPending()[0]!.id;
      const entry = manager.getPendingById(id);
      expect(entry).toBeDefined();
      expect(entry!.agentId).toBe("forge");
    });

    it("should return undefined for unknown id", () => {
      expect(manager.getPendingById("nope")).toBeUndefined();
    });
  });

  describe("multiple concurrent approvals", () => {
    it("should track multiple pending approvals independently", async () => {
      const p1 = manager.requestApproval({
        agentId: "forge",
        sessionKey: "s1",
        toolName: "exec",
        toolParams: {},
        reason: "r1",
      });
      const p2 = manager.requestApproval({
        agentId: "rex",
        sessionKey: "s2",
        toolName: "npm_publish",
        toolParams: {},
        reason: "r2",
      });

      expect(manager.pendingCount).toBe(2);

      const id1 = manager.getPending()[0]!.id;
      manager.approve(id1, "albert");

      expect(manager.pendingCount).toBe(1);
      const r1 = await p1;
      expect(r1.block).toBe(false);

      const id2 = manager.getPending()[0]!.id;
      manager.deny(id2);

      const r2 = await p2;
      expect(r2.block).toBe(true);
    });
  });

  describe("notification failure safety", () => {
    it("should auto-deny when notification fails and defaultAction is allow", async () => {
      const failingNotifier = vi.fn(() => { throw new Error("notification failed"); });
      const managerFailAllow = new ApprovalManager(
        defaultConfig({ defaultAction: "allow" }),
        logger,
        failingNotifier,
      );

      const promise = managerFailAllow.requestApproval({
        agentId: "forge",
        sessionKey: "s1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
        defaultAction: "allow",
      });

      // Should have been auto-denied immediately for safety
      const result = await promise;
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("notification failed");
      expect(managerFailAllow.pendingCount).toBe(0);
    });

    it("should keep pending when notification fails but defaultAction is deny", () => {
      const failingNotifier = vi.fn(() => { throw new Error("notification failed"); });
      const managerFailDeny = new ApprovalManager(
        defaultConfig({ defaultAction: "deny" }),
        logger,
        failingNotifier,
      );

      managerFailDeny.requestApproval({
        agentId: "forge",
        sessionKey: "s1",
        toolName: "exec",
        toolParams: {},
        reason: "test",
      });

      // Should still be pending — timeout will handle it safely (deny)
      expect(managerFailDeny.pendingCount).toBe(1);
      managerFailDeny.cleanup();
    });
  });

  describe("maxPending limit", () => {
    it("should auto-deny when max pending reached", async () => {
      // Fill up to 100 pending
      for (let i = 0; i < 100; i++) {
        manager.requestApproval({
          agentId: "forge",
          sessionKey: `s-${i}`,
          toolName: "exec",
          toolParams: {},
          reason: `test-${i}`,
        });
      }
      expect(manager.pendingCount).toBe(100);

      // 101st should be auto-denied
      const overflow = await manager.requestApproval({
        agentId: "forge",
        sessionKey: "s-overflow",
        toolName: "exec",
        toolParams: {},
        reason: "overflow",
      });

      expect(overflow.block).toBe(true);
      expect(overflow.blockReason).toContain("Too many pending");
      expect(manager.pendingCount).toBe(100); // still 100, not 101
    });
  });
});

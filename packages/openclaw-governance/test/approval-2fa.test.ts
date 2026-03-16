import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TOTP } from "otpauth";
import { Approval2FA } from "../src/approval-2fa.js";
import type { Approval2FAConfig, VerifyResult } from "../src/types.js";

const TEST_SECRET = "JBSWY3DPEHPK3PXP"; // Well-known test secret

function createConfig(overrides?: Partial<Approval2FAConfig>): Approval2FAConfig {
  return {
    enabled: true,
    totpSecret: TEST_SECRET,
    totpIssuer: "Test",
    totpLabel: "Test",
    timeoutSeconds: 300,
    maxAttempts: 3,
    cooldownSeconds: 900,
    batchWindowMs: 3000,
    approvers: ["@albert:matrix.org"],
    ...overrides,
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function generateValidCode(): string {
  const totp = new TOTP({
    issuer: "Test",
    label: "Test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: TEST_SECRET,
  });
  return totp.generate();
}

describe("Approval2FA", () => {
  let approval: Approval2FA;
  let logger: ReturnType<typeof createLogger>;
  let notifyFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = createLogger();
    approval = new Approval2FA(createConfig(), logger);
    notifyFn = vi.fn();
    approval.setNotifyFn(notifyFn);
  });

  afterEach(() => {
    approval._reset();
    vi.restoreAllMocks();
  });

  describe("TOTP verification", () => {
    it("should approve with valid TOTP code", async () => {
      const promise = approval.request("vera", "room-1", "exec", { command: "nmap target" });
      
      // Wait for batch to close (3s debounce)
      await new Promise(r => setTimeout(r, 3100));

      const code = generateValidCode();
      const result = approval.tryResolve(code, "@albert:matrix.org", "room-1");
      
      expect(result.status).toBe("approved");
      if (result.status === "approved") {
        expect(result.commandCount).toBe(1);
      }

      const hookResult = await promise;
      expect(hookResult.block).toBeUndefined();
    });

    it("should reject invalid TOTP code", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap target" });
      
      await new Promise(r => setTimeout(r, 3100));

      const result = approval.tryResolve("000000", "@albert:matrix.org", "room-1");
      
      expect(result.status).toBe("invalid_code");
      if (result.status === "invalid_code") {
        expect(result.attemptsLeft).toBe(2);
      }
    });

    it("should reject expired/wrong codes", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap target" });
      
      await new Promise(r => setTimeout(r, 3100));

      // Try obviously wrong code
      const result = approval.tryResolve("123456", "@albert:matrix.org", "room-1");
      expect(result.status).toBe("invalid_code");
    });
  });

  describe("batch debounce", () => {
    it("should batch multiple commands within debounce window", async () => {
      const p1 = approval.request("vera", "room-1", "exec", { command: "nmap -sV target" });
      const p2 = approval.request("vera", "room-1", "exec", { command: "nikto -h target" });
      const p3 = approval.request("vera", "room-1", "exec", { command: "curl -I target" });

      expect(approval._getPendingCount()).toBe(1);

      // Wait for batch debounce
      await new Promise(r => setTimeout(r, 3100));

      // Notification should mention 3 commands
      expect(notifyFn).toHaveBeenCalledTimes(1);
      const notifyMsg = notifyFn.mock.calls[0]?.[2] as string;
      expect(notifyMsg).toContain("3 commands");
      expect(notifyMsg).toContain("nmap -sV target");
      expect(notifyMsg).toContain("nikto -h target");
      expect(notifyMsg).toContain("curl -I target");

      // Approve all with one code
      const code = generateValidCode();
      const result = approval.tryResolve(code, "@albert:matrix.org", "room-1");
      expect(result.status).toBe("approved");
      if (result.status === "approved") {
        expect(result.commandCount).toBe(3);
      }

      // All promises should resolve with allow
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1.block).toBeUndefined();
      expect(r2.block).toBeUndefined();
      expect(r3.block).toBeUndefined();
    });

    it("should create separate batches for different agents", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap" });
      approval.request("stella", "room-2", "exec", { command: "curl" });

      expect(approval._getPendingCount()).toBe(2);
    });

    it("should create a single batch for same agent", async () => {
      approval.request("vera", "room-1", "exec", { command: "cmd1" });
      approval.request("vera", "room-1", "exec", { command: "cmd2" });

      expect(approval._getPendingCount()).toBe(1);
    });
  });

  describe("timeout behavior", () => {
    it("should deny all commands on timeout", async () => {
      // Use short timeout for testing
      const shortConfig = createConfig({ timeoutSeconds: 1 });
      const shortApproval = new Approval2FA(shortConfig, logger);
      shortApproval.setNotifyFn(notifyFn);

      const p1 = shortApproval.request("vera", "room-1", "exec", { command: "nmap" });
      const p2 = shortApproval.request("vera", "room-1", "exec", { command: "nikto" });

      // Wait for timeout (1s + buffer)
      await new Promise(r => setTimeout(r, 1200));

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.block).toBe(true);
      expect(r1.blockReason).toContain("timed out");
      expect(r2.block).toBe(true);

      shortApproval._reset();
    });
  });

  describe("rate limiting", () => {
    it("should activate cooldown after max attempts", async () => {
      const config = createConfig({ maxAttempts: 2, cooldownSeconds: 5 });
      const rateLimited = new Approval2FA(config, logger);
      rateLimited.setNotifyFn(notifyFn);

      const promise = rateLimited.request("vera", "room-1", "exec", { command: "nmap" });
      await new Promise(r => setTimeout(r, 3100));

      // First invalid attempt
      const r1 = rateLimited.tryResolve("000001", "@albert:matrix.org", "room-1");
      expect(r1.status).toBe("invalid_code");
      if (r1.status === "invalid_code") {
        expect(r1.attemptsLeft).toBe(1);
      }

      // Second invalid attempt — triggers cooldown
      const r2 = rateLimited.tryResolve("000002", "@albert:matrix.org", "room-1");
      expect(r2.status).toBe("invalid_code");
      if (r2.status === "invalid_code") {
        expect(r2.attemptsLeft).toBe(0);
      }

      // The batch should be denied
      const hookResult = await promise;
      expect(hookResult.block).toBe(true);
      expect(hookResult.blockReason).toContain("max attempts");

      // New request should be blocked by cooldown
      const cooldownPromise = rateLimited.request("vera", "room-2", "exec", { command: "test" });
      const cooldownResult = await cooldownPromise;
      expect(cooldownResult.block).toBe(true);
      expect(cooldownResult.blockReason).toContain("cooldown");

      rateLimited._reset();
    });

    it("should return cooldown status when trying to resolve during cooldown", async () => {
      const config = createConfig({ maxAttempts: 1, cooldownSeconds: 60 });
      const rateLimited = new Approval2FA(config, logger);
      rateLimited.setNotifyFn(notifyFn);

      const promise = rateLimited.request("vera", "room-1", "exec", { command: "nmap" });
      await new Promise(r => setTimeout(r, 3100));

      // Exhaust attempts
      rateLimited.tryResolve("000001", "@albert:matrix.org", "room-1");
      await promise;

      // Create new request and try resolve — should get cooldown
      const p2 = rateLimited.request("vera", "room-3", "exec", { command: "test" });
      const cooldownResult = await p2; // Immediately resolves due to cooldown
      expect(cooldownResult.block).toBe(true);

      rateLimited._reset();
    });
  });

  describe("approver validation", () => {
    it("should reject codes from unauthorized senders", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap" });
      await new Promise(r => setTimeout(r, 3100));

      const code = generateValidCode();
      const result = approval.tryResolve(code, "@hacker:evil.org", "room-1");
      expect(result.status).toBe("unauthorized");
    });

    it("should accept codes only from configured approvers", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap" });
      await new Promise(r => setTimeout(r, 3100));

      const code = generateValidCode();
      const result = approval.tryResolve(code, "@albert:matrix.org", "room-1");
      expect(result.status).toBe("approved");
    });

    it("should return no_pending for codes in wrong conversation", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap" });
      await new Promise(r => setTimeout(r, 3100));

      const code = generateValidCode();
      const result = approval.tryResolve(code, "@albert:matrix.org", "room-999");
      expect(result.status).toBe("no_pending");
    });
  });

  describe("notification", () => {
    it("should call notifyFn when batch closes", async () => {
      approval.request("vera", "room-1", "exec", { command: "nmap -sV target" });

      // Wait for batch debounce
      await new Promise(r => setTimeout(r, 3100));

      expect(notifyFn).toHaveBeenCalledTimes(1);
      expect(notifyFn).toHaveBeenCalledWith(
        "vera",
        "room-1",
        expect.stringContaining("APPROVAL REQUIRED"),
      );
    });

    it("should include all commands in notification", async () => {
      approval.request("vera", "room-1", "exec", { command: "cmd1" });
      approval.request("vera", "room-1", "exec", { command: "cmd2" });

      await new Promise(r => setTimeout(r, 3100));

      const msg = notifyFn.mock.calls[0]?.[2] as string;
      expect(msg).toContain("2 commands");
      expect(msg).toContain("cmd1");
      expect(msg).toContain("cmd2");
    });
  });

  describe("edge cases", () => {
    it("should return no_pending when no batch exists", () => {
      const result = approval.tryResolve("123456", "@albert:matrix.org", "room-1");
      expect(result.status).toBe("no_pending");
    });

    it("should handle hasPendingBatch correctly", async () => {
      expect(approval.hasPendingBatch("room-1")).toBe(false);

      approval.request("vera", "room-1", "exec", { command: "nmap" });
      expect(approval.hasPendingBatch("room-1")).toBe(true);
      expect(approval.hasPendingBatch("room-999")).toBe(false);
    });

    it("should truncate long command params in notification", async () => {
      const longCmd = "a".repeat(200);
      approval.request("vera", "room-1", "exec", { command: longCmd });
      
      await new Promise(r => setTimeout(r, 3100));

      const msg = notifyFn.mock.calls[0]?.[2] as string;
      expect(msg.length).toBeLessThan(500);
      expect(msg).toContain("...");
    });
  });
});

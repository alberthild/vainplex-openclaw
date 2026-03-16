/**
 * Approval 2FA — TOTP-based Human-in-the-Loop for Agent Tool Calls
 * v0.11.0
 *
 * Flow:
 * 1. before_tool_call → verdict "2fa" → request() creates/joins a pending batch
 * 2. After 3s debounce → notification sent to chat via subagent
 * 3. message_received → 6-digit code → tryResolve() validates TOTP
 * 4. On valid: all commands in batch resolve with allow
 * 5. On invalid/timeout: batch resolves with deny
 */

import { TOTP } from "otpauth";
import { randomUUID } from "node:crypto";
import type {
  Approval2FAConfig,
  HookBeforeToolCallResult,
  PendingBatch,
  PendingCommand,
  PluginLogger,
  VerifyResult,
} from "./types.js";

// Rate-limiting cooldown tracker: agentId → cooldown expiry timestamp
const cooldowns = new Map<string, number>();

// Pending batches keyed by agentId (one active batch per agent at a time)
const pendingBatches = new Map<string, PendingBatch>();

// Session approval: agentId → expiry timestamp
// Once a TOTP code is accepted, all subsequent exec calls from that agent
// are auto-approved until the session expires.
const sessionApprovals = new Map<string, number>();

/** Default session approval duration: 10 minutes */
const DEFAULT_SESSION_DURATION_MS = 10 * 60 * 1000;

/** Cleanup interval for expired entries (5 minutes) */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export type NotifyFn = (
  agentId: string,
  conversationId: string,
  message: string,
) => void;

export class Approval2FA {
  private readonly config: Approval2FAConfig;
  private readonly totp: TOTP;
  private readonly logger: PluginLogger;
  private notifyFn: NotifyFn | null = null;
  /** Replay protection: last used TOTP delta + period */
  private lastUsedToken: { delta: number; period: number } | null = null;

  constructor(config: Approval2FAConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;

    // Start periodic cleanup for expired cooldowns + sessions
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, expiry] of cooldowns) {
        if (now >= expiry) cooldowns.delete(key);
      }
      for (const [key, expiry] of sessionApprovals) {
        if (now >= expiry) sessionApprovals.delete(key);
      }
    }, 300_000); // 5 min

    this.totp = new TOTP({
      issuer: config.totpIssuer,
      label: config.totpLabel,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: config.totpSecret,
    });
  }

  setNotifyFn(fn: NotifyFn): void {
    this.notifyFn = fn;
  }

  /**
   * Called from before_tool_call when verdict.action === "2fa".
   * Returns a Promise that resolves when the batch is approved/denied/timed out.
   *
   * CRITICAL: Batch lookup and creation is fully synchronous (no await between has/set).
   */
  request(
    agentId: string,
    conversationId: string,
    toolName: string,
    toolParams: Record<string, unknown>,
  ): Promise<HookBeforeToolCallResult> {
    // Check session approval — if an active session exists, auto-approve
    const sessionExpiry = sessionApprovals.get(agentId);
    if (sessionExpiry !== undefined && Date.now() < sessionExpiry) {
      const remainingMin = Math.ceil((sessionExpiry - Date.now()) / 60000);
      this.logger.info(
        `[governance/2fa] Auto-approved ${toolName} for ${agentId} (session has ${remainingMin}min left)`,
      );
      return Promise.resolve({}); // allow
    }
    // Clean up expired sessions
    if (sessionExpiry !== undefined) {
      sessionApprovals.delete(agentId);
    }

    // Check cooldown (synchronous)
    const cooldownExpiry = cooldowns.get(agentId);
    if (cooldownExpiry !== undefined && Date.now() < cooldownExpiry) {
      const retryAfter = Math.ceil((cooldownExpiry - Date.now()) / 1000);
      return Promise.resolve({
        block: true,
        blockReason: `2FA cooldown active. Retry in ${retryAfter}s after too many failed attempts.`,
      });
    }

    // Synchronous batch lookup-or-create (NO await between has/set!)
    let batch = pendingBatches.get(agentId);
    let isNewBatch = false;

    if (!batch || batch.batchClosed) {
      // Fix: Resolve orphaned commands from previous closed batch before creating new one
      if (batch && batch.batchClosed) {
        for (const cmd of batch.commands) {
          cmd.resolve({
            block: true,
            blockReason: "2FA batch superseded by new batch",
          });
        }
        if (batch.batchTimer) {
          clearTimeout(batch.batchTimer);
          batch.batchTimer = null;
        }
        this.logger.warn(
          `[governance/2fa] Orphaned batch ${batch.id} resolved (superseded) — ${batch.commands.length} command(s) denied`,
        );
      }

      const now = Date.now();
      batch = {
        id: randomUUID(),
        agentId,
        conversationId,
        commands: [],
        createdAt: now,
        expiresAt: now + this.config.timeoutSeconds * 1000,
        attempts: 0,
        batchTimer: null,
        batchClosed: false,
      };
      pendingBatches.set(agentId, batch);
      isNewBatch = true;
    }

    // Create the promise for this specific command
    const currentBatch = batch;
    const promise = new Promise<HookBeforeToolCallResult>((resolve) => {
      const cmd: PendingCommand = { toolName, params: toolParams, resolve };
      currentBatch.commands.push(cmd);
    });

    // Start/restart the batch debounce timer if this is a new batch
    if (isNewBatch) {
      const batchRef = currentBatch;
      batchRef.batchTimer = setTimeout(() => {
        this.closeBatch(batchRef);
      }, this.config.batchWindowMs);

      // Start the overall timeout for the batch
      setTimeout(() => {
        this.timeoutBatch(batchRef);
      }, this.config.timeoutSeconds * 1000);
    }

    return promise;
  }

  /**
   * Close the batch window and send notification.
   */
  private closeBatch(batch: PendingBatch): void {
    if (batch.batchClosed) return;
    batch.batchClosed = true;

    const commandList = batch.commands
      .map((c, i) => `${i + 1}. ${c.toolName}: ${summarizeParams(c.params)}`)
      .join("\n");

    const timeoutMin = Math.round(this.config.timeoutSeconds / 60);
    const sessionMin = this.config.sessionDurationMinutes ?? 10;
    const message = [
      `🔒 APPROVAL REQUIRED (${batch.commands.length} command${batch.commands.length > 1 ? "s" : ""})`,
      `Agent: ${batch.agentId}`,
      commandList,
      `Enter TOTP code (${timeoutMin}min timeout)`,
      `✨ One code approves ALL commands for ${sessionMin} minutes`,
    ].join("\n");

    this.logger.info(
      `[governance/2fa] Batch ${batch.id} closed with ${batch.commands.length} command(s) for agent ${batch.agentId}`,
    );

    if (this.notifyFn) {
      try {
        this.notifyFn(batch.agentId, batch.conversationId, message);
      } catch (e) {
        this.logger.error(
          `[governance/2fa] Notification failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /**
   * Timeout handler — deny all commands in the batch if still pending.
   */
  private timeoutBatch(batch: PendingBatch): void {
    // Only act if the batch is still in the map and hasn't been resolved
    const current = pendingBatches.get(batch.agentId);
    if (current !== batch) return;

    pendingBatches.delete(batch.agentId);
    if (batch.batchTimer) {
      clearTimeout(batch.batchTimer);
      batch.batchTimer = null;
    }

    this.logger.warn(
      `[governance/2fa] Batch ${batch.id} timed out for agent ${batch.agentId}`,
    );

    for (const cmd of batch.commands) {
      cmd.resolve({
        block: true,
        blockReason: "2FA approval timed out",
      });
    }
  }

  /**
   * Called from message_received hook when a 6-digit code is detected.
   * Validates the TOTP code and resolves or denies the batch.
   */
  tryResolve(
    code: string,
    senderId: string,
    conversationId: string,
  ): VerifyResult {
    // Find a batch matching the conversationId
    let matchedBatch: PendingBatch | null = null;
    for (const batch of pendingBatches.values()) {
      if (batch.conversationId === conversationId) {
        matchedBatch = batch;
        break;
      }
    }

    if (!matchedBatch) {
      return { status: "no_pending" };
    }

    // Check approver authorization
    if (!this.config.approvers.includes(senderId)) {
      this.logger.warn(
        `[governance/2fa] Unauthorized approval attempt by ${senderId} for batch ${matchedBatch.id}`,
      );
      return { status: "unauthorized" };
    }

    // Check cooldown
    const cooldownExpiry = cooldowns.get(matchedBatch.agentId);
    if (cooldownExpiry !== undefined && Date.now() < cooldownExpiry) {
      const retryAfter = Math.ceil((cooldownExpiry - Date.now()) / 1000);
      return { status: "cooldown", retryAfterSeconds: retryAfter };
    }

    // Validate TOTP code (with replay protection)
    const delta = this.totp.validate({ token: code, window: 1 });
    const currentPeriod = Math.floor(Date.now() / 30_000);

    // Replay protection: reject if same delta+period was already used
    if (delta !== null && this.lastUsedToken
        && delta === this.lastUsedToken.delta
        && currentPeriod === this.lastUsedToken.period) {
      this.logger.warn(
        `[governance/2fa] TOTP replay detected for batch ${matchedBatch.id}`,
      );
      matchedBatch.attempts++;
      const attemptsLeft = this.config.maxAttempts - matchedBatch.attempts;
      return { status: "invalid_code", attemptsLeft };
    }

    if (delta !== null) {
      // Track used token for replay protection
      this.lastUsedToken = { delta, period: currentPeriod };
      // Valid code — approve all commands AND start a session
      const batch = matchedBatch;
      pendingBatches.delete(batch.agentId);
      if (batch.batchTimer) {
        clearTimeout(batch.batchTimer);
        batch.batchTimer = null;
      }

      // Start session approval — all future exec calls auto-approved for N minutes
      const sessionDurationMs =
        (this.config.sessionDurationMinutes ?? 10) * 60 * 1000 ||
        DEFAULT_SESSION_DURATION_MS;
      const sessionExpiry = Date.now() + sessionDurationMs;
      sessionApprovals.set(batch.agentId, sessionExpiry);
      const sessionMin = Math.round(sessionDurationMs / 60000);

      this.logger.info(
        `[governance/2fa] Batch ${batch.id} APPROVED by ${senderId} (${batch.commands.length} commands) — session started (${sessionMin}min)`,
      );

      for (const cmd of batch.commands) {
        cmd.resolve({}); // empty = allow (no block, no modification)
      }

      // Notify about session start
      if (this.notifyFn) {
        try {
          this.notifyFn(
            batch.agentId,
            batch.conversationId,
            `✅ Approved! Session active for ${sessionMin} minutes.\nAll exec commands from ${batch.agentId} are auto-approved until expiry.`,
          );
        } catch {
          // notification is best-effort
        }
      }

      return {
        status: "approved",
        batchId: batch.id,
        commandCount: batch.commands.length,
      };
    }

    // Invalid code
    matchedBatch.attempts++;
    const attemptsLeft = this.config.maxAttempts - matchedBatch.attempts;

    this.logger.warn(
      `[governance/2fa] Invalid TOTP for batch ${matchedBatch.id} by ${senderId} (${attemptsLeft} attempts left)`,
    );

    if (attemptsLeft <= 0) {
      // Max attempts reached — deny all and activate cooldown
      const batch = matchedBatch;
      pendingBatches.delete(batch.agentId);
      if (batch.batchTimer) {
        clearTimeout(batch.batchTimer);
        batch.batchTimer = null;
      }

      cooldowns.set(
        batch.agentId,
        Date.now() + this.config.cooldownSeconds * 1000,
      );

      this.logger.warn(
        `[governance/2fa] Batch ${batch.id} DENIED — max attempts reached, cooldown ${this.config.cooldownSeconds}s`,
      );

      for (const cmd of batch.commands) {
        cmd.resolve({
          block: true,
          blockReason: "2FA max attempts exceeded. Cooldown activated.",
        });
      }

      return { status: "invalid_code", attemptsLeft: 0 };
    }

    return { status: "invalid_code", attemptsLeft };
  }

  /**
   * Try to resolve a TOTP code against ANY pending batch.
   * Used when the approver sends the code from a different conversation
   * (e.g., main DM) than the agent's session that created the batch.
   * Security: still checks approver list and TOTP validity.
   */
  tryResolveAny(code: string, senderId: string): VerifyResult {
    // Check approver authorization first
    if (!this.config.approvers.includes(senderId)) {
      this.logger.warn(
        `[governance/2fa] Unauthorized approval attempt by ${senderId}`,
      );
      return { status: "unauthorized" };
    }

    // Try all pending batches (typically just one)
    if (pendingBatches.size === 0) {
      return { status: "no_pending" };
    }

    // Pick the oldest pending batch
    let oldestBatch: PendingBatch | null = null;
    for (const batch of pendingBatches.values()) {
      if (!oldestBatch || batch.createdAt < oldestBatch.createdAt) {
        oldestBatch = batch;
      }
    }

    if (!oldestBatch) {
      return { status: "no_pending" };
    }

    // Delegate to tryResolve with the batch's conversationId
    return this.tryResolve(code, senderId, oldestBatch.conversationId);
  }

  /** Check if there's a pending batch for a given conversationId */
  hasPendingBatch(conversationId: string): boolean {
    for (const batch of pendingBatches.values()) {
      if (batch.conversationId === conversationId) return true;
    }
    return false;
  }

  /** Check if there's ANY pending batch */
  hasAnyPendingBatch(): boolean {
    return pendingBatches.size > 0;
  }

  /** For testing: clear all state */
  _reset(): void {
    for (const batch of pendingBatches.values()) {
      if (batch.batchTimer) clearTimeout(batch.batchTimer);
    }
    pendingBatches.clear();
    cooldowns.clear();
    sessionApprovals.clear();
    this.lastUsedToken = null;
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  /** For testing: get pending batch count */
  _getPendingCount(): number {
    return pendingBatches.size;
  }
}

/** Summarize tool params for notification (truncated) */
function summarizeParams(params: Record<string, unknown>): string {
  const cmd = params["command"];
  if (typeof cmd === "string") {
    return cmd.length > 80 ? cmd.substring(0, 77) + "..." : cmd;
  }
  const json = JSON.stringify(params);
  return json.length > 80 ? json.substring(0, 77) + "..." : json;
}

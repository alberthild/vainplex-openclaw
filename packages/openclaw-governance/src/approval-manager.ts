import { randomUUID } from "node:crypto";
import type {
  ApprovalManagerConfig,
  HookBeforeToolCallResult,
  PendingApproval,
  PluginLogger,
} from "./types.js";

export type ApprovalNotifier = (message: string, channel?: string) => void | Promise<void>;

export class ApprovalManager {
  private readonly config: ApprovalManagerConfig;
  private readonly pending: Map<string, PendingApproval> = new Map();
  private readonly logger: PluginLogger;
  private readonly notifier?: ApprovalNotifier;

  constructor(
    config: ApprovalManagerConfig,
    logger: PluginLogger,
    notifier?: ApprovalNotifier,
  ) {
    this.config = config;
    this.logger = logger;
    this.notifier = notifier;
  }

  /**
   * Create a pending approval and return a Promise that resolves
   * when the human approves/denies or timeout fires.
   */
  requestApproval(opts: {
    agentId: string;
    sessionKey: string;
    toolName: string;
    toolParams: Record<string, unknown>;
    reason: string;
    timeoutSeconds?: number;
    defaultAction?: "allow" | "deny";
    notifyChannel?: string;
  }): Promise<HookBeforeToolCallResult> {
    // Bounded queue: prevent unbounded Map growth from rapid approval requests
    const MAX_PENDING = 100;
    if (this.pending.size >= MAX_PENDING) {
      this.logger.error(
        `[governance] Max pending approvals (${MAX_PENDING}) reached — auto-denying ${opts.toolName} by ${opts.agentId}`,
      );
      return Promise.resolve({
        block: true,
        blockReason: `Too many pending approvals (${MAX_PENDING}) — auto-denied`,
      });
    }

    const id = randomUUID().slice(0, 8);
    const timeoutSeconds =
      opts.timeoutSeconds ?? this.config.defaultTimeoutSeconds;
    const defaultAction =
      opts.defaultAction ?? this.config.defaultAction;
    const now = Date.now();

    return new Promise<HookBeforeToolCallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.handleTimeout(id);
      }, timeoutSeconds * 1000);
      // Don't block Node process exit
      if (timer.unref) timer.unref();

      const entry: PendingApproval = {
        id,
        agentId: opts.agentId,
        sessionKey: opts.sessionKey,
        toolName: opts.toolName,
        toolParams: opts.toolParams,
        reason: opts.reason,
        status: "pending",
        createdAt: now,
        expiresAt: now + timeoutSeconds * 1000,
        defaultAction,
        resolve,
        timer,
      };

      this.pending.set(id, entry);

      this.logger.info(
        `[governance] Approval requested: ${id} — ${opts.agentId} wants to call ${opts.toolName} (timeout: ${timeoutSeconds}s)`,
      );

      // Send notification
      this.sendNotification(entry, opts.notifyChannel);
    });
  }

  /**
   * Approve a pending request.
   * Returns { found: true } on success, or { found: false, reason } on failure.
   * Blocks self-approval (agent cannot approve its own request).
   * Validates approver against config.approvers allowlist if configured.
   */
  approve(id: string, approver?: string): { found: boolean; reason?: string } {
    const entry = this.pending.get(id);
    if (!entry) return { found: false, reason: "No pending approval with this ID" };

    // Self-approval prevention: agent cannot approve its own request
    if (approver && approver === entry.agentId) {
      this.logger.warn(
        `[governance] Self-approval BLOCKED: ${id} — ${approver} tried to approve their own request`,
      );
      return { found: false, reason: "Self-approval is not allowed" };
    }

    // Approver allowlist check
    if (this.config.approvers && this.config.approvers.length > 0) {
      if (!approver || !this.config.approvers.includes(approver)) {
        this.logger.warn(
          `[governance] Approval REJECTED: ${id} — ${approver ?? "unknown"} is not in the approvers list`,
        );
        return { found: false, reason: `${approver ?? "unknown"} is not authorized to approve` };
      }
    }

    clearTimeout(entry.timer);
    entry.status = "resolved";
    this.pending.delete(id);

    this.logger.info(
      `[governance] Approval GRANTED: ${id} — ${entry.toolName} by ${entry.agentId} (approver: ${approver ?? "unknown"})`,
    );

    entry.resolve({ block: false });
    return { found: true };
  }

  /**
   * Deny a pending request. Returns true if found, false if not.
   * Any caller can deny (deny is always safe).
   */
  deny(id: string, approver?: string, reason?: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    entry.status = "resolved";
    this.pending.delete(id);

    const denyReason =
      reason ?? `Denied by ${approver ?? "human"}: ${entry.reason}`;

    this.logger.info(
      `[governance] Approval DENIED: ${id} — ${entry.toolName} by ${entry.agentId} (approver: ${approver ?? "unknown"})`,
    );

    entry.resolve({ block: true, blockReason: denyReason });
    return true;
  }

  /**
   * Get all pending approvals.
   */
  getPending(): PendingApproval[] {
    return [...this.pending.values()];
  }

  /**
   * Get a specific pending approval by ID.
   */
  getPendingById(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  /**
   * Clean up all pending approvals (gateway shutdown).
   */
  cleanup(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        block: true,
        blockReason: "Governance gateway shutting down — approval cancelled",
      });
      this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private handleTimeout(id: string): void {
    const entry = this.pending.get(id);
    if (!entry || entry.status === "resolved") return;

    entry.status = "resolved";
    this.pending.delete(id);

    if (entry.defaultAction === "allow") {
      this.logger.warn(
        `[governance] Approval TIMEOUT (auto-allow): ${id} — ${entry.toolName} by ${entry.agentId}`,
      );
      entry.resolve({ block: false });
    } else {
      this.logger.warn(
        `[governance] Approval TIMEOUT (auto-deny): ${id} — ${entry.toolName} by ${entry.agentId}`,
      );
      entry.resolve({
        block: true,
        blockReason: `Approval timed out for ${entry.toolName} — auto-denied`,
      });
    }
  }

  private sendNotification(
    entry: PendingApproval,
    channel?: string,
  ): void {
    const targetChannel =
      channel ?? this.config.notifyChannel ?? undefined;

    // Redact sensitive params
    const safeParams = this.redactParams(entry.toolParams);

    const message = [
      `⚠️ **Approval Required** [${entry.id}]`,
      ``,
      `**Agent:** ${entry.agentId}`,
      `**Tool:** ${entry.toolName}`,
      `**Params:** \`${JSON.stringify(safeParams).slice(0, 200)}\``,
      `**Reason:** ${entry.reason}`,
      `**Timeout:** ${Math.round((entry.expiresAt - entry.createdAt) / 1000)}s`,
      `**Default:** ${entry.defaultAction}`,
      ``,
      `Reply: \`/approve ${entry.id}\` or \`/deny ${entry.id}\``,
    ].join("\n");

    if (this.notifier) {
      try {
        const result = this.notifier(message, targetChannel);
        // Handle async notifiers
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            this.handleNotificationFailure(entry, err);
          });
        }
      } catch (err) {
        this.handleNotificationFailure(entry, err);
      }
    } else {
      // Fallback: log the notification
      this.logger.warn(`[governance] No notifier configured. Approval notification:\n${message}`);
    }
  }

  /**
   * Basic param redaction — remove values that look like secrets.
   */
  private redactParams(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && this.looksLikeSecret(value)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private looksLikeSecret(value: string): boolean {
    // Quick check for common secret patterns
    return /(?:sk[-_]|pk[-_]|AKIA|ghp_|ghs_|glpat-|Bearer |-----BEGIN)/i.test(
      value,
    );
  }

  /**
   * Handle notification delivery failure.
   * If defaultAction is "allow", this is dangerous — nobody knows about the approval
   * and it would silently auto-allow on timeout. Fail safe: auto-deny immediately.
   */
  private handleNotificationFailure(entry: PendingApproval, err: unknown): void {
    // Guard: entry may already be resolved (timeout race with async notifier rejection)
    if (!this.pending.has(entry.id) || entry.status === "resolved") return;

    this.logger.error(
      `[governance] Failed to send approval notification for ${entry.id}: ${err}`,
    );

    if (entry.defaultAction === "allow") {
      // SAFETY: If notification fails and default is allow, deny immediately
      // to prevent silent auto-approval without human knowledge
      this.logger.error(
        `[governance] SAFETY: Auto-denying ${entry.id} because notification failed and defaultAction=allow`,
      );
      clearTimeout(entry.timer);
      entry.status = "resolved";
      this.pending.delete(entry.id);
      entry.resolve({
        block: true,
        blockReason: "Approval notification failed — auto-denied for safety (defaultAction was allow)",
      });
    }
    // If defaultAction is "deny", timeout will handle it safely
  }
}

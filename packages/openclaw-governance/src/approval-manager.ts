import { randomUUID } from "node:crypto";
import type {
  ApprovalManagerConfig,
  HookBeforeToolCallResult,
  PendingApproval,
  PluginLogger,
} from "./types.js";

export type ApprovalNotifier = (message: string, channel?: string) => void;

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
   * Approve a pending request. Returns true if found, false if not.
   */
  approve(id: string, approver?: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(id);

    this.logger.info(
      `[governance] Approval GRANTED: ${id} — ${entry.toolName} by ${entry.agentId} (approver: ${approver ?? "unknown"})`,
    );

    entry.resolve({ block: false });
    return true;
  }

  /**
   * Deny a pending request. Returns true if found, false if not.
   */
  deny(id: string, approver?: string, reason?: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
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
    if (!entry) return;

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
        this.notifier(message, targetChannel);
      } catch (err) {
        this.logger.error(
          `[governance] Failed to send approval notification: ${err}`,
        );
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
}

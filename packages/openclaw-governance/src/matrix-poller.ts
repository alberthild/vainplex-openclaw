/**
 * Lightweight Matrix Room Poller for Governance 2FA
 *
 * Polls a single Matrix room for TOTP codes using the governance bot's token.
 * Independent of OpenClaw's Matrix sync — no backoff issues.
 * Only reads new messages, processes 6-digit TOTP codes.
 */

import type { Approval2FA } from "./approval-2fa.js";
import type { PluginLogger } from "./types.js";

const TOTP_CODE_RE = /^\d{6}$/;
const POLL_INTERVAL_MS = 2_000; // 2 seconds

interface MatrixMessage {
  type: string;
  sender: string;
  content?: {
    msgtype?: string;
    body?: string;
  };
  event_id: string;
  origin_server_ts: number;
}

interface MatrixMessagesResponse {
  chunk: MatrixMessage[];
  end?: string;
}

export class MatrixPoller {
  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private readonly roomId: string;
  private readonly approval2fa: Approval2FA;
  private readonly logger: PluginLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sinceToken: string | null = null;
  private lastEventId: string | null = null;

  constructor(opts: {
    homeserverUrl: string;
    accessToken: string;
    roomId: string;
    approval2fa: Approval2FA;
    logger: PluginLogger;
    approvers: string[];
  }) {
    this.homeserverUrl = opts.homeserverUrl.replace(/\/$/, "");
    this.accessToken = opts.accessToken;
    this.roomId = opts.roomId;
    this.approval2fa = opts.approval2fa;
    this.logger = opts.logger;
    void opts.approvers; // approver check happens in tryResolveAny
  }

  start(): void {
    if (this.timer) return;

    this.logger.info(
      `[governance/poller] Starting Matrix room poller (room=${this.roomId.substring(0, 20)}..., interval=${POLL_INTERVAL_MS}ms)`,
    );

    // Initial sync to get the "since" token (skip historical messages)
    this.initSync().then(() => {
      this.timer = setInterval(() => {
        this.poll().catch((err) => {
          this.logger.error(
            `[governance/poller] Poll error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, POLL_INTERVAL_MS);
    }).catch((err) => {
      this.logger.error(
        `[governance/poller] Init sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("[governance/poller] Stopped");
    }
  }

  /**
   * Initial sync: get the latest "end" token so we only process NEW messages.
   */
  private async initSync(): Promise<void> {
    const url = `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(this.roomId)}/messages?dir=b&limit=1`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`Init sync failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as MatrixMessagesResponse;
    this.sinceToken = data.end ?? null;

    if (data.chunk && data.chunk.length > 0) {
      this.lastEventId = data.chunk[0]!.event_id;
    }

    this.logger.info(
      `[governance/poller] Init sync complete (token=${this.sinceToken?.substring(0, 20)}...)`,
    );
  }

  /**
   * Poll for new messages since the last token.
   */
  private async poll(): Promise<void> {
    if (!this.sinceToken) return;

    // Only poll if there are pending batches
    if (!this.approval2fa.hasAnyPendingBatch()) return;

    const url = `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(this.roomId)}/messages?dir=f&from=${encodeURIComponent(this.sinceToken)}&limit=10`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        // Rate limited — back off silently
        return;
      }
      throw new Error(`Poll failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as MatrixMessagesResponse;

    if (data.end) {
      this.sinceToken = data.end;
    }

    for (const msg of data.chunk) {
      // Skip if we've already seen this event
      if (msg.event_id === this.lastEventId) continue;
      this.lastEventId = msg.event_id;

      // Only process text messages
      if (msg.type !== "m.room.message") continue;
      if (msg.content?.msgtype !== "m.text") continue;

      const body = msg.content.body?.trim();
      if (!body || !TOTP_CODE_RE.test(body)) continue;

      // Normalize sender (Matrix format is already @user:server)
      const senderId = msg.sender;

      this.logger.info(
        `[governance/poller] TOTP code received from ${senderId} in governance room`,
      );

      const result = this.approval2fa.tryResolveAny(body, senderId);

      switch (result.status) {
        case "approved":
          this.logger.info(
            `[governance/poller] ✅ Approved batch ${result.batchId} (${result.commandCount} commands)`,
          );
          break;
        case "invalid_code":
          this.logger.warn(
            `[governance/poller] ❌ Invalid TOTP code (${result.attemptsLeft} attempts left)`,
          );
          break;
        case "unauthorized":
          this.logger.warn(
            `[governance/poller] ⛔ Unauthorized: ${senderId} is not an approver`,
          );
          break;
        case "no_pending":
          this.logger.info(
            `[governance/poller] Code received but no pending batch`,
          );
          break;
        case "cooldown":
          this.logger.warn(
            `[governance/poller] Cooldown active, retry in ${result.retryAfterSeconds}s`,
          );
          break;
      }
    }
  }
}

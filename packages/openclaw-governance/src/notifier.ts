/**
 * Approval notification delivery for Governance.
 *
 * Channel-agnostic: supports webhook (any messenger), Matrix direct,
 * and console fallback. Uses native fetch() — zero dependencies.
 *
 * Config in governance config.json:
 *   "approvalManager": {
 *     "notifyMethod": "webhook" | "matrix" | "console",
 *
 *     // For webhook (works with Telegram, Slack, Discord, ntfy, etc.):
 *     "notifyWebhook": "https://ntfy.sh/governance-approvals",
 *
 *     // For matrix (direct Matrix API):
 *     "notifyChannel": "!roomId:homeserver",
 *     "notifyHomeserver": "https://matrix.example.com",
 *     "notifyToken": "syt_..."    // or GOVERNANCE_NOTIFY_TOKEN env
 *   }
 */

import type { PluginLogger } from "./types.js";
import type { ApprovalNotifier } from "./approval-manager.js";

// ── Webhook Notifier (channel-agnostic) ──

export interface WebhookNotifierConfig {
  /** Webhook URL to POST notifications to */
  url: string;
  /** Optional HTTP headers (e.g., for auth) */
  headers?: Record<string, string>;
}

/**
 * Create a notifier that POSTs to a webhook URL.
 * Works with ntfy.sh, Telegram Bot API, Slack webhooks, Discord webhooks,
 * or any HTTP endpoint that accepts POST requests.
 */
function createWebhookNotifier(
  config: WebhookNotifierConfig,
  logger: PluginLogger,
): ApprovalNotifier {
  logger.info(`[governance] Webhook notifier configured → ${config.url}`);

  return async (message: string): Promise<void> => {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...config.headers,
      },
      body: message,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Webhook notification failed: ${response.status} ${response.statusText} — ${body}`,
      );
    }
  };
}

// ── Matrix Notifier (direct API) ──

export interface MatrixNotifierConfig {
  /** Matrix room ID (e.g. "!abc:matrix.example.com") */
  roomId: string;
  /** Matrix homeserver base URL */
  homeserver: string;
  /** Matrix access token */
  accessToken: string;
}

/**
 * Create a notifier that sends to a Matrix room via Client-Server API.
 */
function createMatrixNotifier(
  config: MatrixNotifierConfig,
  logger: PluginLogger,
): ApprovalNotifier {
  const hs = config.homeserver.replace(/\/$/, "");
  logger.info(
    `[governance] Matrix notifier configured → ${config.roomId} via ${hs}`,
  );

  return async (message: string, channelOverride?: string): Promise<void> => {
    const targetRoom = channelOverride ?? config.roomId;
    const txnId = `gov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const url = `${hs}/_matrix/client/v3/rooms/${encodeURIComponent(targetRoom)}/send/m.room.message/${txnId}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msgtype: "m.text",
        body: message,
        format: "org.matrix.custom.html",
        formatted_body: markdownToBasicHtml(message),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Matrix send failed: ${response.status} ${response.statusText} — ${body}`,
      );
    }
  };
}

// ── Factory ──

export interface NotifierFactoryConfig {
  notifyMethod?: "webhook" | "matrix" | "console";
  notifyWebhook?: string;
  notifyWebhookHeaders?: Record<string, string>;
  notifyChannel?: string;
  notifyHomeserver?: string;
  notifyToken?: string;
}

/**
 * Create the appropriate notifier based on config.
 * Auto-detects method if not explicitly set:
 *   - If notifyWebhook is set → webhook
 *   - If notifyChannel + notifyHomeserver → matrix
 *   - Otherwise → undefined (console fallback in ApprovalManager)
 */
export function createNotifier(
  config: NotifierFactoryConfig,
  logger: PluginLogger,
): ApprovalNotifier | undefined {
  const method = config.notifyMethod ?? autoDetectMethod(config);

  switch (method) {
    case "webhook": {
      if (!config.notifyWebhook) {
        logger.warn("[governance] notifyMethod=webhook but no notifyWebhook URL configured");
        return undefined;
      }
      return createWebhookNotifier(
        { url: config.notifyWebhook, headers: config.notifyWebhookHeaders },
        logger,
      );
    }

    case "matrix": {
      const accessToken = config.notifyToken || process.env.GOVERNANCE_NOTIFY_TOKEN;
      if (!config.notifyChannel || !config.notifyHomeserver || !accessToken) {
        logger.warn(
          "[governance] notifyMethod=matrix but missing notifyChannel, notifyHomeserver, or notifyToken",
        );
        return undefined;
      }
      return createMatrixNotifier(
        {
          roomId: config.notifyChannel,
          homeserver: config.notifyHomeserver,
          accessToken,
        },
        logger,
      );
    }

    case "console":
      logger.info("[governance] Notification method: console (notifications only in logs)");
      return undefined;

    default:
      logger.warn(
        "[governance] No notification method configured. Approval notifications will only appear in logs. " +
          "Set notifyWebhook (easiest) or notifyMethod + credentials in governance config.",
      );
      return undefined;
  }
}

function autoDetectMethod(
  config: NotifierFactoryConfig,
): "webhook" | "matrix" | undefined {
  if (config.notifyWebhook) return "webhook";
  if (config.notifyChannel && config.notifyHomeserver) return "matrix";
  return undefined;
}

/**
 * Minimal markdown → HTML for Matrix formatted_body.
 */
function markdownToBasicHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

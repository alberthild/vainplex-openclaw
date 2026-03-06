/**
 * Approval notification delivery for Governance.
 *
 * Uses OpenClaw's native `api.runtime.system.enqueueSystemEvent()` to
 * inject approval notifications directly into the agent's session.
 * No external services, no webhooks, no tokens. Zero configuration.
 *
 * Fallback transports (webhook, matrix) available for edge cases.
 */

import type { PluginLogger } from "./types.js";
import type { ApprovalNotifier } from "./approval-manager.js";

// ── Types ──

/** OpenClaw runtime system interface (subset) */
export interface OpenClawRuntimeSystem {
  enqueueSystemEvent: (text: string, options: { sessionKey: string; contextKey?: string }) => boolean;
}

export interface NotifierFactoryConfig {
  notifyMethod?: "native" | "webhook" | "matrix" | "console";
  notifyWebhook?: string;
  notifyWebhookHeaders?: Record<string, string>;
  notifyChannel?: string;
  notifyHomeserver?: string;
  notifyToken?: string;
}

// ── Native Notifier (preferred) ──

/**
 * Create a notifier that injects messages into the agent's session
 * via OpenClaw's native system event queue. Zero config needed.
 */
function createNativeNotifier(
  runtimeSystem: OpenClawRuntimeSystem,
  logger: PluginLogger,
): ApprovalNotifier {
  logger.info("[governance] Native notifier active — approval notifications via system events");

  return (message: string, sessionKey?: string): void => {
    if (!sessionKey) {
      logger.warn("[governance] Native notifier: no sessionKey — notification only in logs");
      logger.warn(`[governance] ${message}`);
      return;
    }
    runtimeSystem.enqueueSystemEvent(message, { sessionKey });
  };
}

// ── Webhook Notifier ──

export interface WebhookNotifierConfig {
  url: string;
  headers?: Record<string, string>;
}

function createWebhookNotifier(
  config: WebhookNotifierConfig,
  logger: PluginLogger,
): ApprovalNotifier {
  logger.info(`[governance] Webhook notifier configured → ${config.url}`);

  return async (message: string): Promise<void> => {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...config.headers },
      body: message,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Webhook notification failed: ${response.status} ${response.statusText} — ${body}`);
    }
  };
}

// ── Matrix Notifier ──

export interface MatrixNotifierConfig {
  roomId: string;
  homeserver: string;
  accessToken: string;
}

function createMatrixNotifier(
  config: MatrixNotifierConfig,
  logger: PluginLogger,
): ApprovalNotifier {
  const hs = config.homeserver.replace(/\/$/, "");
  logger.info(`[governance] Matrix notifier configured → ${config.roomId} via ${hs}`);

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
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        msgtype: "m.text",
        body: message,
        format: "org.matrix.custom.html",
        formatted_body: markdownToBasicHtml(message),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Matrix send failed: ${response.status} ${response.statusText} — ${body}`);
    }
  };
}

// ── Factory ──

/**
 * Create the appropriate notifier. Priority:
 * 1. Native (api.runtime.system.enqueueSystemEvent) — zero config, preferred
 * 2. Webhook — if notifyWebhook configured
 * 3. Matrix — if notifyChannel + notifyHomeserver configured
 * 4. Console — fallback (logs only)
 */
export function createNotifier(
  config: NotifierFactoryConfig,
  logger: PluginLogger,
  runtimeSystem?: OpenClawRuntimeSystem,
): ApprovalNotifier | undefined {
  const method = config.notifyMethod ?? autoDetectMethod(config, runtimeSystem);

  switch (method) {
    case "native": {
      if (!runtimeSystem) {
        logger.warn("[governance] notifyMethod=native but runtime.system not available — falling back to console");
        return undefined;
      }
      return createNativeNotifier(runtimeSystem, logger);
    }

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
        logger.warn("[governance] notifyMethod=matrix but missing notifyChannel, notifyHomeserver, or notifyToken");
        return undefined;
      }
      return createMatrixNotifier(
        { roomId: config.notifyChannel, homeserver: config.notifyHomeserver, accessToken },
        logger,
      );
    }

    case "console":
      logger.info("[governance] Notification method: console (notifications only in logs)");
      return undefined;

    default:
      logger.warn("[governance] No notification method configured. Notifications only in logs.");
      return undefined;
  }
}

function autoDetectMethod(
  config: NotifierFactoryConfig,
  runtimeSystem?: OpenClawRuntimeSystem,
): "native" | "webhook" | "matrix" | undefined {
  if (runtimeSystem) return "native";
  if (config.notifyWebhook) return "webhook";
  if (config.notifyChannel && config.notifyHomeserver) return "matrix";
  return undefined;
}

function markdownToBasicHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

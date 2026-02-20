/**
 * Redaction Hook Handlers (RFC-007 §5)
 *
 * Integrates the redaction engine into OpenClaw's hook system:
 * - after_tool_call (Layer 1): Redact tool output before LLM sees it
 * - before_tool_call (Vault resolution): Inject real values back into params
 * - message_sending (Layer 2): Final safety scan on outbound messages
 * - before_message_write (Layer 2, sync): Credential + financial scan
 *
 * These hooks are registered separately from the main governance hooks.
 */

import type {
  CustomPatternConfig,
  HookAfterToolCallEvent,
  HookBeforeToolCallEvent,
  HookBeforeToolCallResult,
  HookMessageContext,
  HookMessageSendingEvent,
  HookMessageSendingResult,
  OpenClawPluginApi,
  PluginLogger,
  RedactionAllowlist,
  RedactionCategory,
  RedactionConfig,
} from "../types.js";
import { resolveAgentId } from "../util.js";
import { evaluateAllowlist, isToolExempt } from "./allowlist.js";
import { RedactionEngine } from "./engine.js";
import { PatternRegistry } from "./registry.js";
import { RedactionVault } from "./vault.js";

/** Default redaction config */
export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  enabled: false,
  categories: ["credential", "pii", "financial"],
  vaultExpirySeconds: 3600,
  failMode: "closed",
  customPatterns: [],
  allowlist: {
    piiAllowedChannels: [],
    financialAllowedChannels: [],
    exemptTools: [],
    exemptAgents: [],
  },
  performanceBudgetMs: 5,
};

/**
 * State container for the redaction layer.
 * Exposed for testing.
 */
export type RedactionState = {
  registry: PatternRegistry;
  vault: RedactionVault;
  engine: RedactionEngine;
  config: RedactionConfig;
  credentialOnlyEngine: RedactionEngine;
};

/**
 * Initialize the redaction layer and return its state.
 */
export function initRedaction(
  config: RedactionConfig,
  logger: PluginLogger,
): RedactionState {
  const registry = new PatternRegistry(
    config.categories,
    config.customPatterns,
    logger,
  );

  const vault = new RedactionVault(logger, config.vaultExpirySeconds);
  vault.start();

  const engine = new RedactionEngine(registry, vault);

  // Pre-create credential-only registry+engine for exempt tool scanning (S1 perf fix)
  const credentialOnlyRegistry = new PatternRegistry(["credential"], [], logger);
  const credentialOnlyEngine = new RedactionEngine(credentialOnlyRegistry, vault);

  return { registry, vault, engine, config, credentialOnlyEngine };
}

/**
 * Register all redaction hooks on the OpenClaw plugin API.
 * Uses lower priority numbers than main governance hooks (which use 1000)
 * so redaction runs AFTER governance policy checks.
 *
 * Priority layout:
 * - after_tool_call: 800 (run after governance's 900, to redact post-audit)
 * - before_tool_call: 950 (run before governance's 1000, to resolve placeholders first)
 * - message_sending: 900 (run before governance's 1000, as safety net)
 * - before_message_write: 900 (same rationale)
 */
export function registerRedactionHooks(
  api: OpenClawPluginApi,
  state: RedactionState,
): void {
  const logger = api.logger;
  const { engine, vault, config, credentialOnlyEngine } = state;

  // Layer 1: Tool Output Redaction (uses tool_result_persist — synchronous hook
  // that can modify tool results before they reach the LLM context.
  // after_tool_call is fire-and-forget and cannot modify results.)
  api.on(
    "tool_result_persist" as string,
    handleToolResultPersist(engine, credentialOnlyEngine, config, logger),
    { priority: 800 },
  );

  // Keep after_tool_call for audit logging (fire-and-forget is fine for logging)
  api.on(
    "after_tool_call",
    handleAfterToolCall(engine, credentialOnlyEngine, config, logger),
    { priority: 800 },
  );

  // Vault Resolution: Inject real values into tool params
  api.on(
    "before_tool_call",
    handleBeforeToolCall(vault, config, logger),
    { priority: 950 },
  );

  // Layer 2: Outbound Message Redaction
  api.on(
    "message_sending",
    handleMessageSending(engine, config, logger),
    { priority: 900 },
  );

  // Layer 2 (sync): Before message write
  api.on(
    "before_message_write",
    handleBeforeMessageWrite(engine, config, logger),
    { priority: 900 },
  );

  logger.info("[redaction] Hooks registered (Layer 1 + Layer 2)");
}

/**
 * Cleanup: stop vault timer, clear entries.
 */
export function stopRedaction(state: RedactionState): void {
  state.vault.stop();
}

// ── Hook Handlers ──

/**
 * Layer 1 (synchronous): Redact tool results before they reach the LLM context.
 * Uses tool_result_persist hook which runs synchronously and can return
 * { message } to replace the persisted tool result.
 */
function handleToolResultPersist(
  engine: RedactionEngine,
  credentialOnlyEngine: RedactionEngine,
  config: RedactionConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    _hookCtx: unknown,
  ): { message: unknown } | undefined => {
    try {
      const ev = event as { message: unknown; toolName?: string };
      const toolName = ev.toolName ?? "unknown";
      const message = ev.message;

      if (message === undefined || message === null) return undefined;

      // Determine which engine to use based on tool exemption
      const activeEngine = isToolExempt(toolName, config.allowlist)
        ? credentialOnlyEngine
        : engine;

      const scanInput =
        typeof message === "string" ? message : JSON.stringify(message);
      const result = activeEngine.scan(scanInput);

      if (result.redactionCount > 0) {
        const cats = [...result.categories].join(", ");
        logger.info(
          `[redaction] L1: Redacted ${result.redactionCount} item(s) [${cats}] from tool "${toolName}" (${result.elapsedMs.toFixed(1)}ms)`,
        );
        return { message: result.output };
      }

      return undefined;
    } catch (e) {
      logger.error(
        `[redaction] L1 persist error: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (config.failMode === "closed") {
        return {
          message:
            "[REDACTION ERROR: Tool output suppressed (fail-closed)]",
        };
      }
      return undefined;
    }
  };
}

function handleAfterToolCall(
  engine: RedactionEngine,
  credentialOnlyEngine: RedactionEngine,
  config: RedactionConfig,
  logger: PluginLogger,
) {
  return (event: unknown, _hookCtx: unknown): void => {
    try {
      const ev = event as HookAfterToolCallEvent;

      // Skip exempt tools (but still redact credentials in their output)
      if (isToolExempt(ev.toolName, config.allowlist)) {
        // Even exempt tools get credential-only scanning (pre-created for perf)
        if (ev.result !== undefined && ev.result !== null) {
          const result = credentialOnlyEngine.scan(ev.result);
          if (result.redactionCount > 0) {
            (ev as Record<string, unknown>)["result"] = result.output;
            logger.info(
              `[redaction] L1: Redacted ${result.redactionCount} credential(s) from exempt tool "${ev.toolName}"`,
            );
          }
        }
        return;
      }

      if (ev.result === undefined || ev.result === null) return;

      const result = engine.scan(ev.result);

      if (result.redactionCount > 0) {
        // Mutate event result in-place
        (ev as Record<string, unknown>)["result"] = result.output;

        const cats = [...result.categories].join(", ");
        logger.info(
          `[redaction] L1: Redacted ${result.redactionCount} item(s) [${cats}] from tool "${ev.toolName}" (${result.elapsedMs.toFixed(1)}ms)`,
        );
      }
    } catch (e) {
      logger.error(
        `[redaction] L1 error: ${e instanceof Error ? e.message : String(e)}`,
      );
      // On error in fail-closed mode, clear the result to prevent leaks
      if (config.failMode === "closed") {
        const ev = event as HookAfterToolCallEvent;
        (ev as Record<string, unknown>)["result"] =
          "[REDACTION ERROR: Tool output suppressed (fail-closed)]";
      }
    }
  };
}

function handleBeforeToolCall(
  vault: RedactionVault,
  config: RedactionConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    _hookCtx: unknown,
  ): HookBeforeToolCallResult | undefined => {
    try {
      const ev = event as HookBeforeToolCallEvent;

      // Scan params for placeholders and resolve them
      const resolvedParams = resolveParamsDeep(ev.params, vault);

      if (!resolvedParams.hasPlaceholders) return undefined;

      // Check for unresolved placeholders
      if (resolvedParams.unresolvedHashes.length > 0) {
        const reason =
          `Unresolvable redacted value(s): ${resolvedParams.unresolvedHashes.length} ` +
          `placeholder(s) could not be resolved (expired or unknown)`;
        logger.warn(`[redaction] Vault resolution blocked: ${reason}`);
        return { block: true, blockReason: reason };
      }

      // Log resolution (without the actual values!)
      logger.info(
        `[redaction] Vault: Resolved ${resolvedParams.resolvedCount} placeholder(s) for tool "${ev.toolName}"`,
      );

      // Inject resolved values back into params
      return { params: resolvedParams.params };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[redaction] Vault resolution error: ${msg}`);
      if (config.failMode === "closed") {
        return {
          block: true,
          blockReason: `Redaction vault error (fail-closed): ${msg}`,
        };
      }
      return undefined;
    }
  };
}

function handleMessageSending(
  engine: RedactionEngine,
  config: RedactionConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    hookCtx: unknown,
  ): HookMessageSendingResult | undefined => {
    try {
      const ev = event as HookMessageSendingEvent;
      const ctx = hookCtx as HookMessageContext;

      if (!ev.content) return undefined;

      const agentId = resolveAgentId(
        ctx as { agentId?: string; sessionKey?: string; sessionId?: string },
        ev as { metadata?: Record<string, unknown> },
        logger,
      );

      // Full scan of outbound content
      const scanResult = engine.scanString(ev.content);

      if (scanResult.redactionCount === 0) return undefined;

      // Apply allowlist: credentials always redacted, PII/financial check channel
      let finalContent = ev.content;
      let appliedRedactions = 0;

      // We need to re-scan with allowlist awareness per category
      // Since the engine already did the full scan, we check if any
      // allowlisted categories should be restored. But it's simpler and
      // safer to just let the scan stand for credentials and re-evaluate
      // for PII/financial via allowlist.
      //
      // For simplicity and security, we always apply the full redaction
      // for credentials. For PII and financial, we check the allowlist.
      const context = { channel: ctx.channelId, agentId };

      // Check if ALL detected categories are allowlisted
      let hasNonAllowlisted = false;
      for (const cat of scanResult.categories) {
        const decision = evaluateAllowlist(cat, context, config.allowlist);
        if (!decision.allowed) {
          hasNonAllowlisted = true;
          break;
        }
      }

      if (!hasNonAllowlisted) {
        // All categories allowlisted — log the bypass and pass through
        logger.info(
          `[redaction] L2: Allowlist bypass for agent "${agentId}" on channel "${ctx.channelId}"`,
        );
        return undefined;
      }

      // Apply redaction
      finalContent = scanResult.output;
      appliedRedactions = scanResult.redactionCount;

      // Also scan metadata if present
      let updatedMetadata: Record<string, unknown> | undefined;
      if (ev.metadata) {
        const metaScan = engine.scan(ev.metadata);
        if (metaScan.redactionCount > 0) {
          updatedMetadata = metaScan.output as Record<string, unknown>;
          appliedRedactions += metaScan.redactionCount;
        }
      }

      if (appliedRedactions > 0) {
        logger.info(
          `[redaction] L2: Redacted ${appliedRedactions} item(s) from outbound message to "${ev.to}"`,
        );

        // Mutate metadata in-place if needed
        if (updatedMetadata && ev.metadata) {
          Object.assign(ev.metadata, updatedMetadata);
        }

        return { content: finalContent };
      }

      return undefined;
    } catch (e) {
      logger.error(
        `[redaction] L2 error: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (config.failMode === "closed") {
        return { cancel: true };
      }
      return undefined;
    }
  };
}

function handleBeforeMessageWrite(
  engine: RedactionEngine,
  config: RedactionConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    _hookCtx: unknown,
  ): { block?: boolean; blockReason?: string; content?: string } | undefined => {
    try {
      const ev = event as { content?: string };
      if (!ev.content) return undefined;

      // Only credential + financial patterns for before_message_write
      // (PII may be needed in conversation context per RFC-007 §5.4)
      const scanResult = engine.scanString(ev.content);

      if (scanResult.redactionCount === 0) return undefined;

      // Only enforce for credential and financial categories
      const hasCritical = scanResult.categories.has("credential") ||
        scanResult.categories.has("financial");

      if (!hasCritical) return undefined;

      logger.info(
        `[redaction] L2-sync: Redacted ${scanResult.redactionCount} item(s) from message write`,
      );

      // Return modified content
      return { content: scanResult.output };
    } catch (e) {
      logger.error(
        `[redaction] L2-sync error: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (config.failMode === "closed") {
        return {
          block: true,
          blockReason: "Redaction error (fail-closed)",
        };
      }
      return undefined;
    }
  };
}

// ── Helpers ──

type ResolvedParams = {
  params: Record<string, unknown>;
  resolvedCount: number;
  unresolvedHashes: string[];
  /** Whether any placeholder patterns were found at all */
  hasPlaceholders: boolean;
};

/** Regex to detect any redaction placeholder in a string */
const PLACEHOLDER_DETECT = /\[REDACTED:(?:credential|pii|financial|custom):[a-f0-9]{8,12}\]/;

/**
 * Deep-scan tool params for redaction placeholders and resolve them.
 */
function resolveParamsDeep(
  params: Record<string, unknown>,
  vault: RedactionVault,
): ResolvedParams {
  let resolvedCount = 0;
  let hasPlaceholders = false;
  const unresolvedHashes: string[] = [];

  function resolveValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      // Quick check: does this string contain any placeholders?
      if (!PLACEHOLDER_DETECT.test(value)) return value;

      hasPlaceholders = true;
      const { resolved, unresolvedHashes: unresolved } = vault.resolveAll(value);
      if (resolved !== value) {
        resolvedCount += 1;
      }
      unresolvedHashes.push(...unresolved);
      return resolved;
    }

    if (Array.isArray(value)) {
      return value.map((item) => resolveValue(item));
    }

    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = resolveValue(v);
      }
      return result;
    }

    return value;
  }

  const resolved = resolveValue(params) as Record<string, unknown>;
  return { params: resolved, resolvedCount, unresolvedHashes, hasPlaceholders };
}

/**
 * Parse redaction config from governance plugin config.
 * Returns default config if not configured.
 */
export function parseRedactionConfig(
  pluginConfig: Record<string, unknown> | undefined,
): RedactionConfig {
  if (!pluginConfig) return { ...DEFAULT_REDACTION_CONFIG };

  const redaction = pluginConfig["redaction"];
  if (!redaction || typeof redaction !== "object") {
    return { ...DEFAULT_REDACTION_CONFIG };
  }

  const r = redaction as Record<string, unknown>;

  const categories = Array.isArray(r["categories"])
    ? (r["categories"] as string[]).filter(
        (c): c is RedactionCategory =>
          c === "credential" || c === "pii" || c === "financial" || c === "custom",
      )
    : DEFAULT_REDACTION_CONFIG.categories;

  const customPatterns = Array.isArray(r["customPatterns"])
    ? (r["customPatterns"] as Record<string, unknown>[])
        .filter(
          (p) =>
            typeof p["name"] === "string" &&
            typeof p["regex"] === "string" &&
            typeof p["category"] === "string",
        )
        .map((p) => ({
          name: p["name"] as string,
          regex: p["regex"] as string,
          category: p["category"] as RedactionCategory,
        }))
    : [];

  const allowlistRaw =
    r["allowlist"] && typeof r["allowlist"] === "object"
      ? (r["allowlist"] as Record<string, unknown>)
      : {};

  const allowlist: RedactionAllowlist = {
    piiAllowedChannels: Array.isArray(allowlistRaw["piiAllowedChannels"])
      ? (allowlistRaw["piiAllowedChannels"] as string[])
      : [],
    financialAllowedChannels: Array.isArray(
      allowlistRaw["financialAllowedChannels"],
    )
      ? (allowlistRaw["financialAllowedChannels"] as string[])
      : [],
    exemptTools: Array.isArray(allowlistRaw["exemptTools"])
      ? (allowlistRaw["exemptTools"] as string[])
      : [],
    exemptAgents: Array.isArray(allowlistRaw["exemptAgents"])
      ? (allowlistRaw["exemptAgents"] as string[])
      : [],
  };

  return {
    enabled: r["enabled"] === true,
    categories,
    vaultExpirySeconds:
      typeof r["vaultExpirySeconds"] === "number"
        ? r["vaultExpirySeconds"]
        : DEFAULT_REDACTION_CONFIG.vaultExpirySeconds,
    failMode:
      r["failMode"] === "open" || r["failMode"] === "closed"
        ? r["failMode"]
        : DEFAULT_REDACTION_CONFIG.failMode,
    customPatterns: customPatterns as CustomPatternConfig[],
    allowlist,
    performanceBudgetMs:
      typeof r["performanceBudgetMs"] === "number"
        ? r["performanceBudgetMs"]
        : DEFAULT_REDACTION_CONFIG.performanceBudgetMs,
  };
}

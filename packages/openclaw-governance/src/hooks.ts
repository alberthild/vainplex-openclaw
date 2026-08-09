import type {
  GovernanceConfig,
  HookAfterToolCallEvent,
  HookAgentContext,
  HookBeforeAgentStartResult,
  HookBeforeToolCallEvent,
  HookBeforeToolCallResult,
  HookMessageContext,
  HookMessageSendingEvent,
  HookMessageSendingResult,
  HookSessionContext,
  HookToolContext,
  OpenClawPluginApi,
  PluginCommand,
  PluginLogger,
  VerifyResult,
} from "./types.js";
import type { GovernanceEngine } from "./engine.js";
import { getCurrentTime, resolveAgentId } from "./util.js";
import { ResponseGate } from "./response-gate.js";
import { Approval2FA } from "./approval-2fa.js";
import { MatrixPoller } from "./matrix-poller.js";
import { loadMatrixNotifyConfig, sendMatrixNotification } from "./matrix-notify.js";

import {
  initRedaction,
  parseRedactionConfig,
  registerRedactionHooks,
  stopRedaction,
  type RedactionState,
} from "./redaction/hooks.js";
import { LlmValidator, type CallLlmFn } from "./llm-validator.js";
import { getGovernanceNotifySecretsPath } from "./runtime-env.js";
import { ERC8004Provider } from "./security/erc8004-provider.js";

function buildToolEvalContext(
  event: HookBeforeToolCallEvent,
  hookCtx: HookToolContext,
  config: GovernanceConfig,
  engine: GovernanceEngine,
  logger: PluginLogger,
) {
  const agentId = resolveAgentId(hookCtx, undefined, logger);
  const sessionId = hookCtx.sessionKey ?? (hookCtx as any).sessionId ?? `agent:${agentId}`;
  const trust = engine.getTrust(agentId, sessionId);

  return {
    hook: "before_tool_call" as const,
    agentId,
    sessionKey: sessionId,
    toolName: event.toolName,
    toolParams: event.params,
    timestamp: Date.now(),
    time: getCurrentTime(config.timezone),
    trust,
  };
}

function buildMessageEvalContext(
  event: HookMessageSendingEvent,
  hookCtx: HookMessageContext,
  config: GovernanceConfig,
  engine: GovernanceEngine,
  logger: PluginLogger,
) {
  const agentId = resolveAgentId(
    hookCtx as { agentId?: string; sessionKey?: string; sessionId?: string },
    event as { metadata?: Record<string, unknown> },
    logger,
  );
  const sessionId = `agent:${agentId}`; // Message sending is not always in a session context
  const trust = engine.getTrust(agentId, sessionId);

  return {
    hook: "message_sending" as const,
    agentId,
    sessionKey: sessionId,
    channel: hookCtx.channelId,
    messageContent: event.content,
    messageTo: event.to,
    timestamp: Date.now(),
    time: getCurrentTime(config.timezone),
    trust,
    metadata: event.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Detect if a tool call targets external communication.
 * Returns the text content to validate if external, or null.
 *
 * Detection covers:
 * - `message` tool with channel in externalChannels
 * - `exec` tool with command matching externalCommands
 * - `sessions_send` to external-facing sessions (if configured)
 * - Any tool whose name matches externalCommands patterns
 */
function detectExternalComm(
  ev: HookBeforeToolCallEvent,
  config: GovernanceConfig,
): string | null {
  const llmConfig = config.outputValidation.llmValidator;
  if (!llmConfig?.enabled) return null;

  // 1. message tool with channel in externalChannels
  if (ev.toolName === "message") {
    const channel = ev.params["channel"];
    if (typeof channel === "string" && llmConfig.externalChannels.includes(channel)) {
      return extractTextParam(ev.params);
    }
    // Also check action=send with target containing external channel names
    const action = ev.params["action"];
    const target = ev.params["target"] ?? ev.params["to"];
    if (action === "send" && typeof target === "string") {
      for (const ch of llmConfig.externalChannels) {
        if (target.toLowerCase().includes(ch)) {
          return extractTextParam(ev.params);
        }
      }
    }
  }

  // 2. exec tool with command matching externalCommands
  if (ev.toolName === "exec" && typeof ev.params["command"] === "string") {
    const cmd = ev.params["command"];
    for (const pattern of llmConfig.externalCommands) {
      if (cmd.includes(pattern)) {
        return cmd;
      }
    }
  }

  // 3. sessions_send — could forward content to external-facing agents
  if (ev.toolName === "sessions_send") {
    const message = ev.params["message"];
    if (typeof message === "string" && message.length > 0) {
      // Check if the target session/label suggests external comms
      const label = String(ev.params["label"] ?? ev.params["sessionKey"] ?? "");
      for (const ch of llmConfig.externalChannels) {
        if (label.toLowerCase().includes(ch)) {
          return message;
        }
      }
    }
  }

  return null;
}

/** Extract text content from tool params (multiple possible field names) */
function extractTextParam(params: Record<string, unknown>): string | null {
  for (const key of ["message", "text", "content", "body"]) {
    const val = params[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

/**
 * Cache of recently resolved agentIds from before_tool_call.
 * Used by after_tool_call as a fallback when OpenClaw's hookCtx
 * doesn't include agentId/sessionKey (known upstream limitation).
 * Keyed by toolName — imperfect but sufficient for sequential tool calls.
 */
const recentAgentCtx = new Map<string, { agentId: string; sessionId: string }>();
const MAX_AGENT_CTX_ENTRIES = 64;

function handleBeforeToolCall(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
  approval2fa: Approval2FA | null,
) {
  return async (
    event: unknown,
    hookCtx: unknown,
  ): Promise<HookBeforeToolCallResult | undefined> => {
    try {
      const ev = event as HookBeforeToolCallEvent;
      const ctx = hookCtx as HookToolContext;
      const evalCtx = buildToolEvalContext(ev, ctx, config, engine, logger);

      // Cache resolved agentId for after_tool_call fallback
      recentAgentCtx.set(ev.toolName, {
        agentId: evalCtx.agentId,
        sessionId: evalCtx.sessionKey,
      });
      if (recentAgentCtx.size > MAX_AGENT_CTX_ENTRIES) {
        const oldest = recentAgentCtx.keys().next().value;
        if (oldest) recentAgentCtx.delete(oldest);
      }
      const verdict = await engine.evaluate(evalCtx);

      if (verdict.action === "deny") {
        return { block: true, blockReason: verdict.reason };
      }

      // 2FA approval flow
      if (verdict.action === "2fa" && approval2fa) {
        const conversationId = (ctx as unknown as { conversationId?: string }).conversationId
          ?? evalCtx.sessionKey;
        return approval2fa.request(
          evalCtx.agentId,
          conversationId,
          ev.toolName,
          ev.params,
        );
      }

      // External communication detection (RFC-006)
      if (config.outputValidation.enabled) {
        const externalText = detectExternalComm(ev, config);
        if (externalText) {
          const ovResult = await engine.validateOutput(
            externalText,
            evalCtx.agentId,
            { isExternal: true },
          );
          if (ovResult.verdict === "block") {
            logger.warn(
              `[governance] External comm blocked for ${evalCtx.agentId}: ${ovResult.reason}`,
            );
            return { block: true, blockReason: ovResult.reason };
          }
          if (ovResult.verdict === "flag") {
            logger.warn(
              `[governance] External comm flagged for ${evalCtx.agentId}: ${ovResult.reason}`,
            );
          }
        }
      }

      return undefined;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (config.failMode === "closed") {
        return {
          block: true,
          blockReason: `Governance error (fail-closed): ${msg}`,
        };
      }
      return undefined;
    }
  };
}

function handleMessageSending(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return async (
    event: unknown,
    hookCtx: unknown,
  ): Promise<HookMessageSendingResult | undefined> => {
    try {
      const ev = event as HookMessageSendingEvent;
      const ctx = hookCtx as HookMessageContext;
      const evalCtx = buildMessageEvalContext(ev, ctx, config, engine, logger);

      // Policy evaluation
      const verdict = await engine.evaluate(evalCtx);
      if (verdict.action === "deny") {
        return { cancel: true };
      }

      // Output validation (if enabled)
      if (config.outputValidation.enabled && ev.content) {
        const ovResultOrPromise = engine.validateOutput(ev.content, evalCtx.agentId);
        const ovResult = ovResultOrPromise instanceof Promise
          ? await ovResultOrPromise
          : ovResultOrPromise;
        if (ovResult.verdict === "block") {
          logger.warn(
            `[governance] Output blocked for ${evalCtx.agentId}: ${ovResult.reason}`,
          );
          return { cancel: true };
        }
        if (ovResult.verdict === "flag") {
          logger.warn(
            `[governance] Output flagged for ${evalCtx.agentId}: ${ovResult.reason}`,
          );
        }
      }

      return undefined;
    } catch (err) {
      logger.error(`[governance] message_sending hook error: ${err}`);
      return undefined;
    }
  };
}

/**
 * Hook: before_message_write (synchronous for Stage 1+2)
 * Validates agent output before it's written to conversation.
 * Returns { block: true } if output should be blocked.
 */
function handleBeforeMessageWrite(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
  responseGate: ResponseGate | null,
  toolCallLog: Map<string, Array<{ toolName: string; output: string }>>,
) {
  return (
    event: unknown,
    hookCtx: unknown,
  ): { block?: boolean; blockReason?: string } | undefined => {
    try {
      const ev = event as { message?: { role?: string; content?: string | unknown[] } };
      const ctx = hookCtx as { agentId?: string; sessionKey?: string; sessionId?: string };
      // Extract text content from AgentMessage
      const msgContent = typeof ev.message?.content === "string"
        ? ev.message.content
        : Array.isArray(ev.message?.content)
          ? ev.message.content
              .filter((b: unknown) => typeof b === "object" && b !== null && (b as Record<string,unknown>).type === "text")
              .map((b: unknown) => (b as Record<string,unknown>).text as string)
              .join("\n")
          : undefined;
      if (!msgContent) return undefined;

      const agentId = resolveAgentId(
        ctx as { agentId?: string; sessionKey?: string; sessionId?: string },
        undefined,
        logger,
      );

      // ── Response Gate (v0.7.0) — runs independently of outputValidation ──
      if (responseGate) {
        const sessionId = (ctx as { sessionKey?: string; sessionId?: string }).sessionKey
          ?? (ctx as { sessionId?: string }).sessionId
          ?? `agent:${agentId}`;
        const sessionTools = toolCallLog?.get(sessionId) || [];
        const gateResult = responseGate.validate(msgContent, agentId, sessionTools);
        if (!gateResult.passed) {
          const reason = `Response Gate blocked: ${gateResult.reasons.join("; ")}`;
          logger.warn(`[governance] ${reason} (agent=${agentId}, failed=${gateResult.failedValidators.join(",")})`);

          // v0.7.1: If fallback configured, replace message content instead of silent block
          // Must preserve content format: pi-ai's transform-messages.js expects content
          // as an array of ContentBlocks, not a plain string.
          if (gateResult.fallbackMessage) {
            const originalMsg = (event as { message?: Record<string, unknown> }).message;
            if (originalMsg) {
              const fallbackContent = Array.isArray(originalMsg.content)
                ? [{ type: "text", text: gateResult.fallbackMessage }]
                : gateResult.fallbackMessage;
              const fallbackMsg = { ...originalMsg, content: fallbackContent };
              return { message: fallbackMsg } as { block?: boolean; message?: unknown };
            }
          }
          return { block: true, blockReason: reason };
        }
      }

      // Stage 1-4 output validation (separate feature from Response Gate)
      if (!config.outputValidation.enabled) return undefined;

      // before_message_write is synchronous — only Stage 1+2 (no isExternal)
      const resultOrPromise = engine.validateOutput(msgContent, agentId);
      // This should be synchronous (no isExternal), but guard against Promise
      if (resultOrPromise instanceof Promise) {
        logger.warn("[governance] before_message_write got async result, skipping");
        return undefined;
      }

      const result = resultOrPromise;

      if (result.verdict === "block") {
        logger.warn(
          `[governance] Output write blocked for ${agentId}: ${result.reason}`,
        );
        return { block: true, blockReason: result.reason };
      }

      if (result.verdict === "flag") {
        logger.warn(
          `[governance] Output write flagged for ${agentId}: ${result.reason}`,
        );
      }

      return undefined;
    } catch (err) {
      // Don't break message writing on output validation errors — but log it
      logger.error(`[governance] before_message_write hook error: ${err}`);
      return undefined;
    }
  };
}

function handleAfterToolCall(engine: GovernanceEngine, logger: PluginLogger, toolCallLog: Map<string, Array<{ toolName: string; output: string }>>) {
  return (event: unknown, hookCtx: unknown): void => {
    try {
      const ev = event as HookAfterToolCallEvent;
      const ctx = hookCtx as HookToolContext;

      // Primary resolution from hookCtx
      let agentId = resolveAgentId(ctx, undefined, logger);
      let sessionId = ctx.sessionKey ?? (ctx as any).sessionId ?? `agent:${agentId}`;

      // Fallback: use cached context from before_tool_call
      // OpenClaw's after_tool_call hookCtx often lacks agentId/sessionKey
      if (agentId === "unresolved") {
        const cached = recentAgentCtx.get(ev.toolName);
        if (cached) {
          agentId = cached.agentId;
          sessionId = cached.sessionId;
        }
      }

      const success = !ev.error;
      engine.recordOutcome(agentId, sessionId, success);

      // Track tool calls for Response Gate (v0.7.0)
      if (success && ev.result !== undefined) {
        const output = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result);
        let log = toolCallLog.get(sessionId);
        if (!log) { log = []; toolCallLog.set(sessionId, log); }
        log.push({ toolName: ev.toolName, output });
        if (log.length > 50) log.splice(0, log.length - 50);
      }

      // Detect sub-agent spawn
      if (
        ev.toolName === "sessions_spawn" &&
        success &&
        ev.result &&
        typeof ev.result === "object"
      ) {
        const result = ev.result as Record<string, unknown>;
        const childSessionId = result["sessionId"] ?? result["sessionKey"];
        if (typeof childSessionId === "string" && sessionId) {
          engine.registerSubAgent(sessionId, childSessionId);
        }
      }
    } catch {
      // Don't break on after_tool_call errors
    }
  };
}

function handleBeforeAgentStart(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
  erc8004Provider: ERC8004Provider | null,
) {
  return async (
    _event: unknown,
    hookCtx: unknown,
  ): Promise<HookBeforeAgentStartResult | undefined> => {
    try {
      const ctx = hookCtx as HookAgentContext;
      const agentId = resolveAgentId(ctx, undefined, logger);
      const sessionId = ctx.sessionKey ?? (ctx as any).sessionId ?? `agent:${agentId}`;
      const trust = engine.getTrust(agentId, sessionId);

      // ── ERC-8004 reputation lookup (RFC §14.5) ──
      if (config.erc8004?.enabled && erc8004Provider) {
        const mapping = config.erc8004.agentMapping;
        const onChainId = mapping[agentId];
        if (typeof onChainId === "number") {
          try {
            const rep = await erc8004Provider.lookupReputation(onChainId);
            if (rep) {
              // TODO: Apply trust impact via engine.adjustInitialTrust(agentId, sessionId, impact)
              // when that method is implemented. For now, log the result.
              logger.info(
                `[firewall] ERC-8004 reputation for agent ${agentId}: ` +
                `${rep.tier} (score=${rep.reputationScore}, feedback=${rep.feedbackCount}, source=${rep.source})`,
              );
            }
          } catch (e) {
            // Fail-open: don't block agent start on reputation lookup failure
            logger.warn(
              `[firewall] ERC-8004 lookup failed for agent ${agentId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }

      const status = engine.getStatus();
      const agentTrustText = `${agentId} (${trust.agent.score}/${trust.agent.tier})`;
      const sessionTrustText = `${trust.session.score}/${trust.session.tier}`;

      const context = [
        `\n[Governance] Agent: ${agentTrustText}`,
        `Session: ${sessionTrustText}`,
        `Policies: ${status.policyCount}`,
      ].join(" | ");

      return { prependContext: context };
    } catch (e) {
      logger.error(`[governance] Error in before_agent_start: ${e}`);
      return undefined;
    }
  };
}

function handleSessionStart(engine: GovernanceEngine, logger: PluginLogger) {
  return (_event: unknown, hookCtx: unknown): void => {
    try {
      const ctx = hookCtx as HookSessionContext;
      const agentId = resolveAgentId(ctx, undefined, logger);
      engine.handleSessionStart((ctx as any).sessionId, agentId);
    } catch {
      // Don't break on session_start errors
    }
  };
}

function handleSessionEnd(
  engine: GovernanceEngine,
  toolCallLog: Map<string, Array<{ toolName: string; output: string }>>,
) {
  return (_event: unknown, hookCtx: unknown): void => {
    try {
      const ctx = hookCtx as HookSessionContext;
      engine.handleSessionEnd((ctx as any).sessionId);
      toolCallLog.delete((ctx as any).sessionId);
    } catch {
      // Don't break on session_end errors
    }
  };
}

function handleGatewayStart(engine: GovernanceEngine) {
  return (): void => {
    // Engine should already be started via service, but this is a safety net
    engine.getStatus();
  };
}

function handleGatewayStop(engine: GovernanceEngine, redactionState?: RedactionState) {
  return async (): Promise<void> => {
    if (redactionState) {
      stopRedaction(redactionState);
    }
    await engine.stop();
  };
}

function handleTrustReset(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  targetAgent?: string,
): { text: string } {
  const defaults = config.trust.defaults;
  const store = engine.getTrust() as import("./types.js").TrustStore;
  const lines: string[] = ["🔄 **Trust Reset**", ""];

  const agentsToReset = targetAgent
    ? [targetAgent]
    : Object.keys(store.agents);

  for (const agentId of agentsToReset) {
    const defaultScore = defaults[agentId] ?? defaults["*"] ?? 10;
    engine.resetAgentTrust(agentId, defaultScore);
    const updated = engine.getTrust(agentId, `agent:${agentId}`);
    lines.push(`✅ **${agentId}**: → ${updated.agent.score}/${updated.agent.tier}`);
  }

  return { text: lines.join("\n") };
}

function registerCommands(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
  config: GovernanceConfig,
): void {
  const commands: PluginCommand[] = [
    {
      name: "governance",
      description: "Show governance engine status",
      handler: () => {
        const status = engine.getStatus();
        return {
          text: [
            "🛡️ **Governance Engine**",
            `Enabled: ${status.enabled}`,
            `Policies: ${status.policyCount}`,
            `Trust: ${status.trustEnabled ? "enabled" : "disabled"}`,
            `Audit: ${status.auditEnabled ? "enabled" : "disabled"}`,
            `Fail mode: ${status.failMode}`,
            `Evaluations: ${status.stats.totalEvaluations} (${status.stats.allowCount} allow, ${status.stats.denyCount} deny, ${status.stats.errorCount} errors)`,
            `Avg latency: ${Math.round(status.stats.avgEvaluationUs)}μs`,
          ].join("\n"),
        };
      },
    },
    {
      name: "trust",
      description: "Show trust scores, or manage: /trust reset [agent], /trust set <agent> <score>",
      acceptsArgs: true,
      handler: (ctx?: unknown) => {
        const args = (ctx as { args?: string })?.args?.trim() ?? "";

        // /trust reset [agentId] — reset one or all agents to config defaults
        if (args.startsWith("reset")) {
          const targetAgent = args.replace("reset", "").trim() || undefined;
          return handleTrustReset(engine, config, targetAgent);
        }

        // /trust set <agentId> <score> — manually set an agent's score
        if (args.startsWith("set ")) {
          const parts = args.replace("set ", "").trim().split(/\s+/);
          const agentId = parts[0];
          const score = parseInt(parts[1] ?? "", 10);
          if (!agentId || Number.isNaN(score)) {
            return { text: "Usage: `/trust set <agentId> <score>`" };
          }
          engine.setTrustScore(agentId, score);
          const updated = engine.getTrust(agentId, `agent:${agentId}`);
          return {
            text: `✅ **${agentId}** score set to ${updated.agent.score} (${updated.agent.tier})`,
          };
        }

        const store = engine.getTrust() as import("./types.js").TrustStore;
        const sessionMap = engine.getSessionTrustMap();
        const tierEmoji: Record<string, string> = {
          untrusted: "🔴",
          restricted: "🟠",
          standard: "🟡",
          trusted: "🟢",
          elevated: "🔵",
        };

        const lines: string[] = ["🛡️ **Trust Dashboard**", ""];

        // Agent Trust (persistent)
        lines.push("**Agent Trust** (persistent)");
        const agents = Object.values(store.agents).sort(
          (a, b) => b.score - a.score,
        );
        for (const agent of agents) {
          const emoji = tierEmoji[agent.tier] ?? "⚪";
          const streak = agent.signals.cleanStreak > 0
            ? ` 🔥${agent.signals.cleanStreak}`
            : "";
          lines.push(
            `${emoji} **${agent.agentId}**: ${agent.score}/100 (${agent.tier})${streak}` +
            ` — ✅${agent.signals.successCount} ❌${agent.signals.violationCount}`,
          );
        }

        // Session Trust (ephemeral)
        if (sessionMap.size > 0) {
          lines.push("", "**Session Trust** (active sessions)");
          for (const [sessionId, session] of sessionMap) {
            const emoji = tierEmoji[session.tier] ?? "⚪";
            const shortId = sessionId.length > 30
              ? `...${sessionId.slice(-25)}`
              : sessionId;
            lines.push(
              `${emoji} ${shortId}: ${session.score}/100 (${session.tier})` +
              ` 🔥${session.cleanStreak}`,
            );
          }
        } else {
          lines.push("", "_No active sessions_");
        }

        return { text: lines.join("\n") };
      },
    },
  ];

  for (const cmd of commands) {
    api.registerCommand(cmd);
  }
}

/** 6-digit TOTP code pattern */
const TOTP_CODE_RE = /^\d{6}$/;

function handleMessageReceived(
  approval2fa: Approval2FA,
  _config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (event: unknown, hookCtx: unknown): void => {
    try {
      const ev = event as { content?: string; from?: string };
      const ctx = hookCtx as { channelId?: string; conversationId?: string };

      const content = ev.content?.trim();
      if (!content || !TOTP_CODE_RE.test(content)) return;

      // Normalize senderId: strip channel prefix (e.g., "matrix:@user:server" → "@user:server")
      // Check both raw and normalized forms against the approvers list
      const rawSenderId = ev.from;
      const senderId = rawSenderId?.replace(/^(matrix|telegram|discord|signal|whatsapp):/, "") || rawSenderId;
      void ctx.conversationId; // available for future per-room scoping
      if (!senderId) return;

      // Try to resolve TOTP code against ANY pending batch (not just this conversation).
      // The approver sends the code in THEIR chat (e.g., main DM), but the batch was created
      // in the agent's session (e.g., vera subagent). ConversationIds won't match.
      // Security is maintained because tryResolveAny still checks the approver list.
      const result: VerifyResult = approval2fa.tryResolveAny(content, senderId);

      switch (result.status) {
        case "approved":
          logger.info(
            `[governance/2fa] ✅ Approved batch ${result.batchId} (${result.commandCount} commands)`,
          );
          break;
        case "invalid_code":
          logger.warn(
            `[governance/2fa] ❌ Invalid code from ${senderId} (${result.attemptsLeft} attempts left)`,
          );
          break;
        case "cooldown":
          logger.warn(
            `[governance/2fa] ⏳ Cooldown active, retry in ${result.retryAfterSeconds}s`,
          );
          break;
        case "unauthorized":
          logger.warn(`[governance/2fa] 🚫 Unauthorized sender: ${senderId}`);
          break;
        case "no_pending":
          break;
      }
    } catch (e) {
      logger.error(
        `[governance/2fa] message_received error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

export function registerGovernanceHooks(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
  config: GovernanceConfig,
  opts?: { callLlm?: CallLlmFn },
): void {
  const logger = api.logger;

  // ── Response Gate (v0.7.0) ──
  const responseGate = config.responseGate?.enabled
    ? new ResponseGate(config.responseGate)
    : null;
  const toolCallLog = new Map<string, Array<{ toolName: string; output: string }>>();
  if (responseGate) {
    logger.info(`[governance] Response Gate initialized with ${config.responseGate!.rules.length} rule(s)`);
  }

  // ── Redaction Subsystem ──
  // Read from GovernanceConfig.redaction (loaded from external config file),
  // not api.pluginConfig (which is just { enabled: true } from openclaw.json)
  const redactionConfig = config.redaction
    ? parseRedactionConfig({ redaction: config.redaction } as Record<string, unknown>)
    : parseRedactionConfig(undefined);
  let redactionState: RedactionState | undefined;

  if (redactionConfig.enabled) {
    redactionState = initRedaction(redactionConfig, logger);
    registerRedactionHooks(api, redactionState);
    logger.info("[governance] Redaction subsystem initialized");
  }

  // ── LLM Validator (Stage 3) ──
  const llmConfig = config.outputValidation.llmValidator;
  if (llmConfig?.enabled && opts?.callLlm) {
    const llmValidator = new LlmValidator(llmConfig, opts.callLlm, logger);
    engine.setLlmValidator(llmValidator);
    logger.info("[governance] LLM validator initialized for Stage 3 output validation");
  }

  // ── Approval 2FA (v0.11.0) ──
  let approval2fa: Approval2FA | null = null;
  if (config.approval2fa?.enabled) {
    approval2fa = new Approval2FA(config.approval2fa, logger);

    // Set up notification via direct Matrix Client-Server API
    // Extract Matrix credentials from the OpenClaw config (channels.matrix)
    // Read notification config
    const notifyChannel = config.approval2fa?.notifyChannel || "";
    const roomId = notifyChannel.startsWith("room:") ? notifyChannel.slice(5) : notifyChannel;

    // Read Matrix credentials from a dedicated secrets file (not from OpenClaw config,
    // which correctly does not expose channel tokens to plugins).
    // File format: JSON { "homeserverUrl": "...", "accessToken": "..." }
    const secretsPath = getGovernanceNotifySecretsPath();
    const notifyConfig = loadMatrixNotifyConfig(secretsPath);
    const matrixHomeserver = notifyConfig?.homeserverUrl || "";
    const matrixToken = notifyConfig?.accessToken || "";

    if (!matrixToken || !roomId) {
      logger.warn(
        `[governance/2fa] Notification not configured — ` +
        `${!matrixToken ? "missing matrix-notify.json" : ""}${!roomId ? " missing notifyChannel" : ""}`,
      );
    } else {
      logger.info(`[governance/2fa] Notifications → Matrix room ${roomId.substring(0, 20)}...`);
    }

    approval2fa.setNotifyFn((_agentId, _conversationId, message) => {
      if (!matrixToken || !roomId) {
        logger.warn("[governance/2fa] No Matrix credentials — notification skipped");
        return;
      }
      try {
        sendMatrixNotification({
          homeserverUrl: matrixHomeserver,
          accessToken: matrixToken,
          roomId,
          message,
        })
          .then((resp) => {
            if (resp.ok) {
              logger.info(`[governance/2fa] Notification delivered to Matrix room`);
            } else {
              resp.text().then((text: string) => {
                logger.error(`[governance/2fa] Matrix notification failed (${resp.status}): ${text}`);
              });
            }
          })
          .catch((err: unknown) => {
            logger.error(
              `[governance/2fa] Matrix notification fetch error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } catch (e) {
        logger.error(
          `[governance/2fa] Notify dispatch error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });

    // Register message_received hook for TOTP code interception
    api.on("message_received", handleMessageReceived(approval2fa, config, logger), {
      priority: 100,
    });

    // Start Matrix room poller for TOTP codes (independent of OpenClaw's Matrix sync)
    if (matrixToken && matrixHomeserver && roomId) {
      const poller = new MatrixPoller({
        homeserverUrl: matrixHomeserver,
        accessToken: matrixToken,
        roomId,
        approval2fa,
        logger,
        approvers: config.approval2fa.approvers,
      });
      poller.start();

      // Stop poller on gateway shutdown
      api.on("gateway_stop", () => {
        poller.stop();
      }, { priority: 10 });
    }

    logger.info(
      `[governance] Approval 2FA initialized (${config.approval2fa.approvers.length} approver(s), ` +
      `timeout=${config.approval2fa.timeoutSeconds}s, batch=${config.approval2fa.batchWindowMs}ms)`,
    );
  }

  // Primary enforcement
  api.on("before_tool_call", handleBeforeToolCall(engine, config, logger, approval2fa), {
    priority: 1000,
  });
  api.on("message_sending", handleMessageSending(engine, config, logger), {
    priority: 1000,
  });

  // Output validation (synchronous, before message write)
  api.on("before_message_write", handleBeforeMessageWrite(engine, config, logger, responseGate, toolCallLog), {
    priority: 1000,
  });

  // Trust feedback
  api.on("after_tool_call", handleAfterToolCall(engine, logger, toolCallLog), { priority: 900 });

  // ── ERC-8004 Provider (Module 6) ──
  let erc8004Provider: ERC8004Provider | null = null;
  if (config.erc8004?.enabled) {
    erc8004Provider = new ERC8004Provider(config.erc8004);
    logger.info("[governance] ERC-8004 reputation provider initialized");
    // Note: Write-path (feedbackEnabled) removed — feedback signals
    // are now handled by ShieldAPI → AgentProof integration (separate service).
  }

  // Context injection
  api.on("before_agent_start", handleBeforeAgentStart(engine, config, logger, erc8004Provider), {
    priority: 5,
  });

  // Lifecycle
  api.on("session_start", handleSessionStart(engine, logger), { priority: 1 });
  api.on("session_end", handleSessionEnd(engine, toolCallLog), { priority: 999 });
  api.on("gateway_start", handleGatewayStart(engine), { priority: 1 });
  api.on("gateway_stop", handleGatewayStop(engine, redactionState), { priority: 999 });

  // Commands
  registerCommands(api, engine, config);
}

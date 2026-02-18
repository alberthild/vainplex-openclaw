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
} from "./types.js";
import type { GovernanceEngine } from "./engine.js";
import { extractAgentId, getCurrentTime } from "./util.js";

function buildToolEvalContext(
  event: HookBeforeToolCallEvent,
  hookCtx: HookToolContext,
  config: GovernanceConfig,
  engine: GovernanceEngine,
) {
  const agentId = extractAgentId(hookCtx.sessionKey, hookCtx.agentId);
  const trust = engine.getTrust(agentId);
  const trustData = "score" in trust
    ? { score: trust.score, tier: trust.tier }
    : { score: 10, tier: "untrusted" as const };

  return {
    hook: "before_tool_call" as const,
    agentId,
    sessionKey: hookCtx.sessionKey ?? `agent:${agentId}`,
    toolName: event.toolName,
    toolParams: event.params,
    timestamp: Date.now(),
    time: getCurrentTime(config.timezone),
    trust: trustData,
  };
}

function buildMessageEvalContext(
  event: HookMessageSendingEvent,
  hookCtx: HookMessageContext,
  config: GovernanceConfig,
  engine: GovernanceEngine,
) {
  const agentId = "main"; // message context doesn't always have agentId
  const trust = engine.getTrust(agentId);
  const trustData = "score" in trust
    ? { score: trust.score, tier: trust.tier }
    : { score: 10, tier: "untrusted" as const };

  return {
    hook: "message_sending" as const,
    agentId,
    sessionKey: `agent:${agentId}`,
    channel: hookCtx.channelId,
    messageContent: event.content,
    messageTo: event.to,
    timestamp: Date.now(),
    time: getCurrentTime(config.timezone),
    trust: trustData,
    metadata: event.metadata as Record<string, unknown> | undefined,
  };
}

function handleBeforeToolCall(
  engine: GovernanceEngine,
  config: GovernanceConfig,
) {
  return async (
    event: unknown,
    hookCtx: unknown,
  ): Promise<HookBeforeToolCallResult | undefined> => {
    try {
      const ev = event as HookBeforeToolCallEvent;
      const ctx = hookCtx as HookToolContext;
      const evalCtx = buildToolEvalContext(ev, ctx, config, engine);
      const verdict = await engine.evaluate(evalCtx);

      if (verdict.action === "deny") {
        return { block: true, blockReason: verdict.reason };
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
) {
  return async (
    event: unknown,
    hookCtx: unknown,
  ): Promise<HookMessageSendingResult | undefined> => {
    try {
      const ev = event as HookMessageSendingEvent;
      const ctx = hookCtx as HookMessageContext;
      const evalCtx = buildMessageEvalContext(ev, ctx, config, engine);
      const verdict = await engine.evaluate(evalCtx);

      if (verdict.action === "deny") {
        return { cancel: true };
      }
      return undefined;
    } catch {
      return undefined;
    }
  };
}

function handleAfterToolCall(engine: GovernanceEngine) {
  return (event: unknown, hookCtx: unknown): void => {
    try {
      const ev = event as HookAfterToolCallEvent;
      const ctx = hookCtx as HookToolContext;
      const agentId = extractAgentId(ctx.sessionKey, ctx.agentId);
      const success = !ev.error;

      engine.recordOutcome(agentId, ev.toolName, success);

      // Detect sub-agent spawn
      if (
        ev.toolName === "sessions_spawn" &&
        success &&
        ev.result &&
        typeof ev.result === "object"
      ) {
        const result = ev.result as Record<string, unknown>;
        const childSessionId = result["sessionId"] ?? result["sessionKey"];
        if (typeof childSessionId === "string" && ctx.sessionKey) {
          engine.registerSubAgent(ctx.sessionKey, childSessionId);
        }
      }
    } catch {
      // Don't break on after_tool_call errors
    }
  };
}

function handleBeforeAgentStart(
  engine: GovernanceEngine,
  _config: GovernanceConfig,
) {
  return (
    _event: unknown,
    hookCtx: unknown,
  ): HookBeforeAgentStartResult | undefined => {
    try {
      const ctx = hookCtx as HookAgentContext;
      const agentId = extractAgentId(ctx.sessionKey, ctx.agentId);
      const trust = engine.getTrust(agentId);

      if (!("score" in trust)) return undefined;

      const status = engine.getStatus();
      const context = [
        `\n[Governance] Trust: ${trust.tier} (${trust.score}/100)`,
        `Policies: ${status.policyCount} active`,
        status.failMode === "closed" ? "Mode: fail-closed" : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return { prependContext: context };
    } catch {
      return undefined;
    }
  };
}

function handleSessionStart(engine: GovernanceEngine) {
  return (_event: unknown, hookCtx: unknown): void => {
    try {
      const ctx = hookCtx as HookSessionContext;
      const agentId = extractAgentId(undefined, ctx.agentId);
      // Ensure trust state is initialized for this agent
      engine.getTrust(agentId);
    } catch {
      // Don't break on session_start errors
    }
  };
}

function handleGatewayStart(engine: GovernanceEngine) {
  return (): void => {
    // Engine should already be started via service, but this is a safety net
    engine.getStatus();
  };
}

function handleGatewayStop(engine: GovernanceEngine) {
  return async (): Promise<void> => {
    await engine.stop();
  };
}

function registerCommands(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
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
  ];

  for (const cmd of commands) {
    api.registerCommand(cmd);
  }
}

export function registerGovernanceHooks(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
  config: GovernanceConfig,
): void {
  // Primary enforcement
  api.on("before_tool_call", handleBeforeToolCall(engine, config), {
    priority: 1000,
  });
  api.on("message_sending", handleMessageSending(engine, config), {
    priority: 1000,
  });

  // Trust feedback
  api.on("after_tool_call", handleAfterToolCall(engine), { priority: 900 });

  // Context injection
  api.on("before_agent_start", handleBeforeAgentStart(engine, config), {
    priority: 5,
  });

  // Lifecycle
  api.on("session_start", handleSessionStart(engine), { priority: 1 });
  api.on("gateway_start", handleGatewayStart(engine), { priority: 1 });
  api.on("gateway_stop", handleGatewayStop(engine), { priority: 999 });

  // Commands
  registerCommands(api, engine);
}

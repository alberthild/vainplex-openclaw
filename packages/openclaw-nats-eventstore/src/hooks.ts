import { randomUUID } from "node:crypto";
import type { NatsClient } from "./nats-client.js";
import type { PluginLogger } from "./nats-client.js";
import type { NatsEventStoreConfig } from "./config.js";
import type { ClawEvent, EventType, Visibility } from "./events.js";
import { extractAgentId, buildSubject } from "./util.js";

type HookCtx = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  channelId?: string;
  runId?: string;
  jobId?: string;
  messageId?: string;
  senderId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  trace?: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginApi = {
  logger: PluginLogger;
  on: (hookName: string, handler: (...args: any[]) => void) => void;
};

/** Check if a hook should be published based on include/exclude config. */
function shouldPublish(hookName: string, config: NatsEventStoreConfig): boolean {
  if (config.includeHooks.length > 0) {
    return config.includeHooks.includes(hookName);
  }
  if (config.excludeHooks.length > 0) {
    return !config.excludeHooks.includes(hookName);
  }
  return true;
}

type PublishOptions = {
  legacyType?: EventType;
  visibility?: Visibility;
  redaction?: ClawEvent["redaction"];
  ctx?: HookCtx;
};

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function buildEnvelope(
  type: EventType,
  agent: string,
  session: string,
  payload: Record<string, unknown>,
  options: PublishOptions = {},
): ClawEvent {
  const ctx = options.ctx ?? {};
  const trace = ctx.trace ?? {};

  return {
    id: randomUUID(),
    ts: Date.now(),
    agent,
    session,
    type,
    legacyType: options.legacyType,
    schemaVersion: 1,
    source: { plugin: "nats-eventstore" },
    actor: {
      agentId: agent === "system" ? undefined : agent,
      userId: firstString(ctx.senderId),
      channel: firstString(ctx.channelId),
    },
    scope: {
      sessionKey: firstString(ctx.sessionKey),
      sessionId: firstString(ctx.sessionId),
      runId: firstString(ctx.runId, payload.runId),
      toolCallId: firstString(payload.toolCallId),
      messageId: firstString(ctx.messageId, payload.messageId),
      jobId: firstString(ctx.jobId),
    },
    trace: {
      traceId: firstString(ctx.traceId, trace.traceId),
      spanId: firstString(ctx.spanId, trace.spanId),
      parentSpanId: firstString(ctx.parentSpanId, trace.parentSpanId),
      causationId: firstString(payload.causationId),
      correlationId: firstString(ctx.runId, ctx.sessionId, ctx.sessionKey),
    },
    visibility: options.visibility ?? "internal",
    redaction: options.redaction,
    payload,
  };
}

/** Fire-and-forget publish of a ClawEvent to NATS. */
function publish(
  getClient: () => NatsClient | null,
  config: NatsEventStoreConfig,
  type: EventType,
  agent: string,
  session: string,
  payload: Record<string, unknown>,
  logger: PluginLogger,
  options: PublishOptions = {},
): void {
  const client = getClient();
  if (!client?.isConnected()) return;

  const event = buildEnvelope(type, agent, session, payload, options);

  const subject = buildSubject(config.subjectPrefix, agent, type);
  client.publish(subject, JSON.stringify(event)).catch((err) => {
    logger.warn(`[nats-eventstore] Publish ${type} failed: ${err}`);
  });
}

// ── Hook-to-event mapping table ──

type PayloadMapper = (event: any, ctx: any) => Record<string, unknown>;
type EventTypeMapper = EventType | ((event: any, ctx: any) => EventType);

type HookMapping = {
  hookName: string;
  eventType: EventTypeMapper;
  legacyType?: EventType;
  visibility?: Visibility;
  redaction?: ClawEvent["redaction"];
  mapper: PayloadMapper;
  /** If true, uses "system" as agent/session (gateway hooks). */
  systemEvent?: boolean;
};

/** Additional events to emit from the same hook (e.g. run.error from agent_end). */
type ExtraEmitter = {
  hookName: string;
  eventType: EventTypeMapper;
  legacyType?: EventType;
  visibility?: Visibility;
  redaction?: ClawEvent["redaction"];
  condition: (event: any) => boolean;
  mapper: PayloadMapper;
};

const HOOK_MAPPINGS: HookMapping[] = [
  {
    hookName: "message_received",
    eventType: "message.in.received",
    legacyType: "msg.in",
    visibility: "confidential",
    mapper: (event, ctx) => ({
      from: event.from,
      content: event.content,
      timestamp: event.timestamp,
      channel: ctx?.channelId,
      metadata: event.metadata,
    }),
  },
  {
    hookName: "message_sending",
    eventType: "message.out.sending",
    legacyType: "msg.sending",
    visibility: "confidential",
    mapper: (event, ctx) => ({
      to: event.to,
      content: event.content,
      channel: ctx?.channelId,
    }),
  },
  {
    hookName: "message_sent",
    eventType: "message.out.sent",
    legacyType: "msg.out",
    visibility: "confidential",
    mapper: (event, ctx) => ({
      to: event.to,
      content: event.content,
      success: event.success,
      error: event.error,
      channel: ctx?.channelId,
    }),
  },
  {
    hookName: "before_tool_call",
    eventType: "tool.call.requested",
    legacyType: "tool.call",
    visibility: "confidential",
    mapper: (event) => ({
      toolName: event.toolName,
      params: event.params,
    }),
  },
  {
    hookName: "after_tool_call",
    eventType: (event) => event.error ? "tool.call.failed" : "tool.call.executed",
    legacyType: "tool.result",
    visibility: "confidential",
    mapper: (event) => ({
      toolName: event.toolName,
      params: event.params,
      result: event.result,
      error: event.error,
      durationMs: event.durationMs,
    }),
  },
  {
    hookName: "before_agent_start",
    eventType: "run.started",
    legacyType: "run.start",
    visibility: "confidential",
    mapper: (event) => ({ prompt: event.prompt }),
  },
  {
    hookName: "agent_end",
    eventType: "run.ended",
    legacyType: "run.end",
    mapper: (event) => ({
      success: event.success,
      error: event.error,
      durationMs: event.durationMs,
      messageCount: event.messages?.length ?? 0,
    }),
  },
  {
    hookName: "llm_input",
    eventType: "model.input.observed",
    legacyType: "llm.input",
    redaction: { applied: true, omittedFields: ["systemPrompt", "prompt", "historyMessages"] },
    mapper: (event) => ({
      runId: event.runId,
      sessionId: event.sessionId,
      provider: event.provider,
      model: event.model,
      systemPromptLength: event.systemPrompt?.length ?? 0,
      promptLength: event.prompt?.length ?? 0,
      historyMessageCount: event.historyMessages?.length ?? 0,
      imagesCount: event.imagesCount ?? 0,
    }),
  },
  {
    hookName: "llm_output",
    eventType: "model.output.observed",
    legacyType: "llm.output",
    redaction: { applied: true, omittedFields: ["assistantTexts"] },
    mapper: (event) => {
      const texts = event.assistantTexts ?? [];
      return {
        runId: event.runId,
        sessionId: event.sessionId,
        provider: event.provider,
        model: event.model,
        assistantTextCount: texts.length,
        assistantTextTotalLength: texts.reduce(
          (s: number, t: string) => s + (t?.length ?? 0),
          0,
        ),
        usage: event.usage,
      };
    },
  },
  {
    hookName: "before_compaction",
    eventType: "session.compaction.started",
    legacyType: "session.compaction_start",
    mapper: (event) => ({
      messageCount: event.messageCount,
      compactingCount: event.compactingCount,
      tokenCount: event.tokenCount,
    }),
  },
  {
    hookName: "after_compaction",
    eventType: "session.compaction.ended",
    legacyType: "session.compaction_end",
    mapper: (event) => ({
      messageCount: event.messageCount,
      compactedCount: event.compactedCount,
      tokenCount: event.tokenCount,
    }),
  },
  {
    hookName: "before_reset",
    eventType: "session.reset",
    mapper: (event) => ({ reason: event.reason }),
  },
  {
    hookName: "session_start",
    eventType: "session.started",
    legacyType: "session.start",
    mapper: (event) => ({
      sessionId: event.sessionId,
      resumedFrom: event.resumedFrom,
    }),
  },
  {
    hookName: "session_end",
    eventType: "session.ended",
    legacyType: "session.end",
    mapper: (event) => ({
      sessionId: event.sessionId,
      messageCount: event.messageCount,
      durationMs: event.durationMs,
    }),
  },
  {
    hookName: "gateway_start",
    eventType: "gateway.started",
    legacyType: "gateway.start",
    mapper: (event) => ({ port: event.port }),
    systemEvent: true,
  },
  {
    hookName: "gateway_stop",
    eventType: "gateway.stopped",
    legacyType: "gateway.stop",
    mapper: (event) => ({ reason: event.reason }),
    systemEvent: true,
  },
];

/** Extra events emitted from existing hooks (backward compatibility). */
const EXTRA_EMITTERS: ExtraEmitter[] = [
  {
    hookName: "agent_end",
    eventType: "run.failed",
    legacyType: "run.error",
    condition: (event) => !event.success,
    mapper: (event) => ({
      success: false,
      error: event.error,
      durationMs: event.durationMs,
    }),
  },
];

/**
 * Register all event hook handlers on the plugin API.
 * Uses a data-driven mapping table — each hook is registered via a single loop.
 */
export function registerEventHooks(
  api: PluginApi,
  config: NatsEventStoreConfig,
  getClient: () => NatsClient | null,
): void {
  const logger = api.logger;

  // Helper: publish with agent context extraction
  const pub = (
    type: EventType,
    ctx: HookCtx,
    payload: Record<string, unknown>,
    options: PublishOptions = {},
  ) => {
    const agent = extractAgentId(ctx);
    const session = ctx.sessionKey ?? ctx.sessionId ?? "unknown";
    publish(getClient, config, type, agent, session, payload, logger, { ...options, ctx });
  };

  const resolveEventType = (mapper: EventTypeMapper, event: any, ctx: any): EventType =>
    typeof mapper === "function" ? mapper(event, ctx) : mapper;

  // Build lookup for extra emitters per hook
  const extrasByHook = new Map<string, ExtraEmitter[]>();
  for (const extra of EXTRA_EMITTERS) {
    const list = extrasByHook.get(extra.hookName) ?? [];
    list.push(extra);
    extrasByHook.set(extra.hookName, list);
  }

  // Register each hook from the mapping table
  for (const mapping of HOOK_MAPPINGS) {
    if (!shouldPublish(mapping.hookName, config)) continue;

    const extras = extrasByHook.get(mapping.hookName) ?? [];

    api.on(mapping.hookName, (event: any, ctx: any) => {
      try {
        const payload = mapping.mapper(event, ctx);

        const eventType = resolveEventType(mapping.eventType, event, ctx);
        const options: PublishOptions = {
          legacyType: mapping.legacyType,
          visibility: mapping.visibility,
          redaction: mapping.redaction,
          ctx,
        };

        if (mapping.systemEvent) {
          publish(getClient, config, eventType, "system", "system", payload, logger, options);
        } else {
          pub(eventType, ctx, payload, options);
        }

        // Emit any extra events for this hook
        for (const extra of extras) {
          if (extra.condition(event)) {
            const extraType = resolveEventType(extra.eventType, event, ctx);
            pub(extraType, ctx, extra.mapper(event, ctx), {
              legacyType: extra.legacyType,
              visibility: extra.visibility,
              redaction: extra.redaction,
            });
          }
        }
      } catch (err) {
        logger.warn(`[nats-eventstore] Hook ${mapping.hookName} error: ${err}`);
      }
    });
  }
}

import { createHash, randomUUID } from "node:crypto";
import type { NatsClient } from "./nats-client.js";
import type { PluginLogger } from "./nats-client.js";
import type { NatsEventStoreConfig } from "./config.js";
import type { ClawEvent, EventType, Visibility } from "./events.js";
import { extractAgentId, buildSubject } from "./util.js";
import {
  HOOK_MAPPINGS,
  EXTRA_EMITTERS,
  type HookMapping,
  type ExtraEmitter,
  type EventTypeMapper,
} from "./hook-mappings.js";

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
  originalEvent?: Record<string, unknown>;
};

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function deriveEventId(
  canonicalType: EventType,
  session: string,
  payload: Record<string, unknown>,
  ctx: HookCtx,
): string {
  const originalEvent = (ctx as HookCtx & { originalEvent?: Record<string, unknown> }).originalEvent ?? {};
  const stableSourceId = firstString(
    ctx.runId,
    payload.runId,
    originalEvent.runId,
    ctx.messageId,
    payload.messageId,
    originalEvent.messageId,
    payload.toolCallId,
    originalEvent.toolCallId,
    ctx.jobId,
    payload.jobId,
    originalEvent.jobId,
    originalEvent.id,
  );

  if (stableSourceId) {
    const hash = createHash("sha256")
      .update(`${session}:${canonicalType}:${stableSourceId}`)
      .digest("hex")
      .slice(0, 16);
    return `evt-${hash}`;
  }

  return randomUUID();
}

function buildActor(agent: string, ctx: HookCtx): ClawEvent["actor"] {
  return {
    agentId: agent === "system" ? undefined : agent,
    userId: firstString(ctx.senderId),
    channel: firstString(ctx.channelId),
  };
}

function buildScope(payload: Record<string, unknown>, ctx: HookCtx): ClawEvent["scope"] {
  return {
    sessionKey: firstString(ctx.sessionKey),
    sessionId: firstString(ctx.sessionId),
    runId: firstString(ctx.runId, payload.runId),
    toolCallId: firstString(payload.toolCallId),
    messageId: firstString(ctx.messageId, payload.messageId),
    jobId: firstString(ctx.jobId),
  };
}

function buildTrace(payload: Record<string, unknown>, ctx: HookCtx, trace: any): ClawEvent["trace"] {
  return {
    traceId: firstString(ctx.traceId, trace.traceId),
    spanId: firstString(ctx.spanId, trace.spanId),
    parentSpanId: firstString(ctx.parentSpanId, trace.parentSpanId),
    causationId: firstString(payload.causationId),
    correlationId: firstString(ctx.runId, ctx.sessionId, ctx.sessionKey),
  };
}

function buildEnvelope(
  canonicalType: EventType,
  agent: string,
  session: string,
  payload: Record<string, unknown>,
  options: PublishOptions = {},
): ClawEvent {
  const ctx = { ...(options.ctx ?? {}), originalEvent: options.originalEvent };
  const trace = ctx.trace ?? {};
  const legacyType = options.legacyType ?? canonicalType;

  return {
    id: deriveEventId(canonicalType, session, payload, ctx),
    ts: Date.now(),
    agent,
    session,
    type: legacyType,
    canonicalType,
    legacyType: options.legacyType,
    schemaVersion: 1,
    source: { plugin: "nats-eventstore" },
    actor: buildActor(agent, ctx),
    scope: buildScope(payload, ctx),
    trace: buildTrace(payload, ctx, trace),
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

  const subject = buildSubject(config.subjectPrefix, agent, event.type);
  client.publish(subject, JSON.stringify(event)).catch((err) => {
    logger.warn(`[nats-eventstore] Publish ${type} failed: ${err}`);
  });
}

function resolveEventType(mapper: EventTypeMapper, event: any, ctx: any): EventType {
  return typeof mapper === "function" ? mapper(event, ctx) : mapper;
}

function emitExtras(
  extras: ExtraEmitter[],
  event: any,
  ctx: any,
  pub: (type: EventType, ctxPayload: HookCtx, payload: Record<string, unknown>, options?: PublishOptions) => void
): void {
  for (const extra of extras) {
    if (extra.condition(event)) {
      const extraType = resolveEventType(extra.eventType, event, ctx);
      pub(extraType, ctx, extra.mapper(event, ctx), {
        legacyType: extra.legacyType,
        visibility: extra.visibility,
        redaction: extra.redaction,
        originalEvent: event,
      });
    }
  }
}

function publishHookResult(
  getClient: () => NatsClient | null,
  config: NatsEventStoreConfig,
  logger: PluginLogger
) {
  return (
    type: EventType,
    ctxPayload: HookCtx,
    payload: Record<string, unknown>,
    options: PublishOptions = {},
  ): void => {
    const agent = extractAgentId(ctxPayload);
    const session = ctxPayload.sessionKey ?? ctxPayload.sessionId ?? "unknown";
    publish(getClient, config, type, agent, session, payload, logger, { ...options, ctx: ctxPayload });
  };
}

function handleHookEvent(
  mapping: HookMapping,
  extras: ExtraEmitter[],
  event: any,
  ctx: any,
  config: NatsEventStoreConfig,
  getClient: () => NatsClient | null,
  logger: PluginLogger,
): void {
  try {
    const pub = publishHookResult(getClient, config, logger);
    const payload = mapping.mapper(event, ctx);
    const eventType = resolveEventType(mapping.eventType, event, ctx);
    const options: PublishOptions = {
      legacyType: mapping.legacyType,
      visibility: mapping.visibility,
      redaction: mapping.redaction,
      ctx,
      originalEvent: event,
    };

    if (mapping.systemEvent) {
      publish(getClient, config, eventType, "system", "system", payload, logger, options);
    } else {
      pub(eventType, ctx, payload, options);
    }

    emitExtras(extras, event, ctx, pub);
  } catch (err) {
    logger.warn(`[nats-eventstore] Hook ${mapping.hookName} error: ${err}`);
  }
}

/**
 * Register all event hook handlers on the plugin API.
 * Uses a data-driven mapping table — each hook is registered via a single loop.
 */
export function registerEventHooks(
  api: PluginApi,
  config: NatsEventStoreConfig,
  getClient: () => NatsClient | null,
): void {
  const extrasByHook = new Map<string, ExtraEmitter[]>();
  for (const extra of EXTRA_EMITTERS) {
    const list = extrasByHook.get(extra.hookName) ?? [];
    list.push(extra);
    extrasByHook.set(extra.hookName, list);
  }

  for (const mapping of HOOK_MAPPINGS) {
    if (!shouldPublish(mapping.hookName, config)) continue;
    const extras = extrasByHook.get(mapping.hookName) ?? [];
    api.on(mapping.hookName, (event: any, ctx: any) => {
      handleHookEvent(mapping, extras, event, ctx, config, getClient, api.logger);
    });
  }
}

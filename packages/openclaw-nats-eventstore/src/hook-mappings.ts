import type { ClawEvent, EventType, CanonicalEventType, LegacyEventType, Visibility } from "./events.js";

export type HookEventPayload = Record<string, unknown>;
export type HookContext = Record<string, unknown>;

export type PayloadMapper = (event: HookEventPayload, ctx?: HookContext) => Record<string, unknown>;
export type EventTypeMapper = CanonicalEventType | ((event: HookEventPayload, ctx?: HookContext) => CanonicalEventType);

export type HookMapping = {
  hookName: string;
  eventType: EventTypeMapper;
  legacyType?: LegacyEventType;
  visibility?: Visibility;
  redaction?: ClawEvent["redaction"];
  mapper: PayloadMapper;
  /** If true, uses "system" as agent/session (gateway hooks). */
  systemEvent?: boolean;
};

/** Additional events to emit from the same hook (e.g. run.error from agent_end). */
export type ExtraEmitter = {
  hookName: string;
  eventType: EventTypeMapper;
  legacyType?: LegacyEventType;
  visibility?: Visibility;
  redaction?: ClawEvent["redaction"];
  condition: (event: HookEventPayload) => boolean;
  mapper: PayloadMapper;
};

export const HOOK_MAPPINGS: HookMapping[] = [
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
      messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
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
      systemPromptLength: typeof event.systemPrompt === "string" ? event.systemPrompt.length : 0,
      promptLength: typeof event.prompt === "string" ? event.prompt.length : 0,
      historyMessageCount: Array.isArray(event.historyMessages) ? event.historyMessages.length : 0,
      imagesCount: event.imagesCount ?? 0,
    }),
  },
  {
    hookName: "llm_output",
    eventType: "model.output.observed",
    legacyType: "llm.output",
    redaction: { applied: true, omittedFields: ["assistantTexts"] },
    mapper: (event) => {
      const texts = Array.isArray(event.assistantTexts) ? event.assistantTexts : [];
      return {
        runId: event.runId,
        sessionId: event.sessionId,
        provider: event.provider,
        model: event.model,
        assistantTextCount: texts.length,
        assistantTextTotalLength: texts.reduce(
          (s: number, t: unknown) => s + (typeof t === "string" ? t.length : 0),
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

export const EXTRA_EMITTERS: ExtraEmitter[] = [
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

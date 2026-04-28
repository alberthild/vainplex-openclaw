export type EventType =
  // Brainplex nervous-system canonical events (v1)
  | "message.in.received"
  | "message.out.sending"
  | "message.out.sent"
  | "tool.call.requested"
  | "tool.call.executed"
  | "tool.call.failed"
  | "run.started"
  | "run.ended"
  | "run.failed"
  | "model.input.observed"
  | "model.output.observed"
  | "session.started"
  | "session.ended"
  | "session.compaction.started"
  | "session.compaction.ended"
  | "session.reset"
  | "gateway.started"
  | "gateway.stopped"
  // Core (backward-compatible with PR #18171)
  | "msg.in"
  | "msg.out"
  | "msg.sending"
  | "tool.call"
  | "tool.result"
  | "run.start"
  | "run.end"
  | "run.error"
  // New (plugin hooks that didn't exist in core)
  | "llm.input"
  | "llm.output"
  | "session.start"
  | "session.end"
  | "session.compaction_start"
  | "session.compaction_end"
  | "gateway.start"
  | "gateway.stop";

export type Visibility = "public" | "internal" | "confidential" | "secret";

export type EventSource = {
  plugin: string;
  host?: string;
};

export type EventActor = {
  agentId?: string;
  userId?: string;
  channel?: string;
};

export type EventScope = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  messageId?: string;
  jobId?: string;
};

export type EventTrace = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  causationId?: string;
  correlationId?: string;
};

export type EventRedaction = {
  applied: boolean;
  policy?: string;
  omittedFields?: string[];
};

export type ClawEvent = {
  /** Unique event ID (UUIDv4) */
  id: string;
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Agent ID (e.g., "main", "viola") */
  agent: string;
  /** Session key (e.g., "main", "viola:telegram:12345") */
  session: string;
  /** Legacy event type identifier used for backward-compatible consumers/routing. */
  type: EventType;
  /** Canonical nervous-system event type while the taxonomy rolls out. */
  canonicalType?: EventType;
  /** Previous event type name while the nervous-system taxonomy rolls out. */
  legacyType?: EventType;
  /** Schema version for the canonical envelope. */
  schemaVersion: 1;
  /** Component that emitted the event. */
  source: EventSource;
  /** Actor metadata (agent/user/channel). */
  actor: EventActor;
  /** Run/session/tool/message scope metadata. */
  scope: EventScope;
  /** Trace and causality metadata. */
  trace: EventTrace;
  /** Visibility tier for consumers and projections. */
  visibility: Visibility;
  /** Redaction metadata for omitted or transformed payload fields. */
  redaction?: EventRedaction;
  /** Event-specific payload */
  payload: Record<string, unknown>;
};

/** All known event types as an array (useful for validation/testing) */
export const ALL_EVENT_TYPES: EventType[] = [
  "message.in.received",
  "message.out.sending",
  "message.out.sent",
  "tool.call.requested",
  "tool.call.executed",
  "tool.call.failed",
  "run.started",
  "run.ended",
  "run.failed",
  "model.input.observed",
  "model.output.observed",
  "session.started",
  "session.ended",
  "session.compaction.started",
  "session.compaction.ended",
  "session.reset",
  "gateway.started",
  "gateway.stopped",
  "msg.in",
  "msg.out",
  "msg.sending",
  "tool.call",
  "tool.result",
  "run.start",
  "run.end",
  "run.error",
  "llm.input",
  "llm.output",
  "session.start",
  "session.end",
  "session.compaction_start",
  "session.compaction_end",
  "gateway.start",
  "gateway.stop",
];

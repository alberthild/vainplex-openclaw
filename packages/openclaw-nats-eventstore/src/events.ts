export type EventType =
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
  | "session.reset"
  | "gateway.start"
  | "gateway.stop";

export type ClawEvent = {
  /** Unique event ID (UUIDv4) */
  id: string;
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Agent ID (e.g., "main", "viola") */
  agent: string;
  /** Session key (e.g., "main", "viola:telegram:12345") */
  session: string;
  /** Event type identifier */
  type: EventType;
  /** Event-specific payload */
  payload: Record<string, unknown>;
};

/** All known event types as an array (useful for validation/testing) */
export const ALL_EVENT_TYPES: EventType[] = [
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
  "session.reset",
  "gateway.start",
  "gateway.stop",
];

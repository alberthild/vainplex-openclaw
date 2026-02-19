// ============================================================
// Trace Analyzer — Normalized Event Types
// ============================================================
//
// LOCAL event types for the trace analyzer.
// These are NOT imported from nats-eventstore — the analyzer
// normalizes both Schema A (nats-eventstore) and Schema B
// (session-sync) events into this unified shape.
// ============================================================

/** Canonical event types understood by the analyzer. */
export type AnalyzerEventType =
  | "msg.in"
  | "msg.out"
  | "tool.call"
  | "tool.result"
  | "session.start"
  | "session.end"
  | "run.start"
  | "run.end"
  | "run.error";

/**
 * Normalized event — all source schemas are converted to this shape
 * before entering the analysis pipeline.
 */
export type NormalizedEvent = {
  /** Original event ID. */
  id: string;
  /** Timestamp in ms since epoch (extracted from `ts` or `timestamp`). */
  ts: number;
  /** Agent ID (e.g., "main", "forge", "viola"). */
  agent: string;
  /** Session identifier (normalized — "agent:main:uuid" → "uuid"). */
  session: string;
  /** Canonical event type. */
  type: AnalyzerEventType;
  /** Normalized payload. */
  payload: NormalizedPayload;
  /** NATS stream sequence number (for incremental tracking). */
  seq: number;
};

/**
 * Unified payload — consistent field names regardless of source schema.
 * Detectors access ONLY these fields, never raw payloads.
 */
export type NormalizedPayload = {
  // msg.in / msg.out
  content?: string;
  role?: "user" | "assistant";
  from?: string;
  to?: string;
  channel?: string;
  success?: boolean;

  // tool.call / tool.result
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  toolError?: string;
  toolDurationMs?: number;
  toolIsError?: boolean;

  // session lifecycle
  sessionId?: string;

  // run lifecycle
  prompt?: string;
  durationMs?: number;
  error?: string;
};

/**
 * Map from raw event type strings (both schemas) to canonical types.
 * Returns null for unknown/unhandled event types.
 */
const EVENT_TYPE_MAP: Record<string, AnalyzerEventType> = {
  // Schema A (nats-eventstore hook events)
  "msg.in": "msg.in",
  "msg.out": "msg.out",
  "tool.call": "tool.call",
  "tool.result": "tool.result",
  "session.start": "session.start",
  "session.end": "session.end",
  "run.start": "run.start",
  "run.end": "run.end",
  "run.error": "run.error",
  // Schema B (session-sync conversation events)
  "conversation.message.in": "msg.in",
  "conversation.message.out": "msg.out",
  "conversation.tool_call": "tool.call",
  "conversation.tool_result": "tool.result",
};

/** Map a raw event type string to a canonical AnalyzerEventType. */
export function mapEventType(raw: string): AnalyzerEventType | null {
  return EVENT_TYPE_MAP[raw] ?? null;
}

/**
 * Detect which schema a raw event belongs to.
 * - "A" = nats-eventstore (has `ts` as number, standard types)
 * - "B" = session-sync (has `timestamp`, `conversation.*` types, `meta.source`)
 * - null = unknown/unparseable
 */
export function detectSchema(raw: Record<string, unknown>): "A" | "B" | null {
  if (typeof raw.type !== "string") return null;

  const rawType = raw.type;

  // Schema B: conversation.* types OR meta.source === "session-sync"
  if (rawType.startsWith("conversation.")) return "B";

  const meta = raw.meta;
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).source === "session-sync") {
    return "B";
  }

  // Schema A: has `ts` as number and standard event types
  if (typeof raw.ts === "number" && EVENT_TYPE_MAP[rawType]) return "A";

  // Schema B also uses `timestamp` instead of `ts`
  if (typeof raw.timestamp === "number") return "B";

  // Fallback: if type is a known canonical type, assume A
  if (EVENT_TYPE_MAP[rawType]) return "A";

  return null;
}

/**
 * Normalize a session string.
 * Schema B uses "agent:main:uuid" format → extract the UUID portion.
 * Schema A uses direct session keys ("main", "unknown", etc.).
 */
export function normalizeSession(raw: string): string {
  if (raw.startsWith("agent:")) {
    const parts = raw.split(":");
    return parts[2] ?? parts[1] ?? raw;
  }
  return raw;
}

/** Extract optional string field. */
function optStr(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === "string" ? raw[key] : undefined;
}

/** Normalize msg.in/msg.out payload — Schema B (conversation.*). */
function normalizeMessagePayloadB(
  rawPayload: Record<string, unknown>,
  role: "user" | "assistant",
): NormalizedPayload {
  const textPreview = rawPayload.text_preview;
  let content: string | undefined;
  if (Array.isArray(textPreview) && textPreview.length > 0) {
    const first = textPreview[0] as Record<string, unknown> | undefined;
    if (first && typeof first.text === "string") content = first.text;
  }
  return { content, role, sessionId: optStr(rawPayload, "sessionId") };
}

/** Normalize msg.in/msg.out payload — Schema A. */
function normalizeMessagePayloadA(
  rawPayload: Record<string, unknown>,
  role: "user" | "assistant",
): NormalizedPayload {
  return {
    content: optStr(rawPayload, "content"),
    role,
    from: optStr(rawPayload, "from"),
    to: optStr(rawPayload, "to"),
    channel: optStr(rawPayload, "channel"),
    success: typeof rawPayload.success === "boolean" ? rawPayload.success : undefined,
  };
}

/** Normalize tool.call payload. */
function normalizeToolCallPayload(
  rawPayload: Record<string, unknown>,
  isSchemaB: boolean,
): NormalizedPayload {
  if (isSchemaB) {
    const data = rawPayload.data as Record<string, unknown> | undefined;
    return {
      toolName: data && typeof data.name === "string" ? data.name : undefined,
      toolParams: data && typeof data.args === "object" && data.args !== null
        ? data.args as Record<string, unknown> : undefined,
    };
  }
  return {
    toolName: optStr(rawPayload, "toolName"),
    toolParams: typeof rawPayload.params === "object" && rawPayload.params !== null
      ? rawPayload.params as Record<string, unknown> : undefined,
  };
}

/** Normalize tool.result payload — Schema B. */
function normalizeToolResultPayloadB(rawPayload: Record<string, unknown>): NormalizedPayload {
  const data = rawPayload.data as Record<string, unknown> | undefined;
  let toolResult: unknown;
  let toolError: string | undefined;
  let toolIsError = false;
  if (data) {
    toolResult = data.result;
    toolIsError = data.isError === true;
    if (toolIsError && typeof data.result === "string") toolError = data.result;
  }
  return {
    toolName: data && typeof data.name === "string" ? data.name : undefined,
    toolResult, toolError, toolIsError,
  };
}

/** Extract error from nested result structures (Schema A). */
function extractErrorFromResult(rawPayload: Record<string, unknown>): { error?: string; isError: boolean } {
  // 1. Top-level "error" field (simplest case)
  const topError = optStr(rawPayload, "error");
  if (topError) return { error: topError, isError: true };

  // 2. result.details.error or result.details.status === "error"
  const result = rawPayload.result;
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    const details = r.details as Record<string, unknown> | undefined;
    if (details) {
      const detailError = optStr(details, "error");
      if (detailError) return { error: detailError, isError: true };
      if (details.status === "error") return { error: "status: error", isError: true };
      if (typeof details.exitCode === "number" && details.exitCode > 0) {
        return { error: `exit code ${details.exitCode}`, isError: true };
      }
    }
    // 3. result.isError flag
    if (r.isError === true) {
      const text = extractResultText(r);
      return { error: text ?? "unknown error", isError: true };
    }
  }

  return { isError: false };
}

/** Extract text content from tool result. */
function extractResultText(result: Record<string, unknown>): string | undefined {
  const content = result.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (typeof first?.text === "string") return first.text.slice(0, 500);
  }
  if (typeof result.result === "string") return result.result.slice(0, 500);
  return undefined;
}

/** Normalize tool.result payload — Schema A. */
function normalizeToolResultPayloadA(rawPayload: Record<string, unknown>): NormalizedPayload {
  const { error, isError } = extractErrorFromResult(rawPayload);
  return {
    toolName: optStr(rawPayload, "toolName"),
    toolParams: typeof rawPayload.params === "object" && rawPayload.params !== null
      ? rawPayload.params as Record<string, unknown> : undefined,
    toolResult: rawPayload.result,
    toolError: error,
    toolIsError: isError || undefined,
    toolDurationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
  };
}

/** Normalize lifecycle events (session.*, run.*). */
function normalizeLifecyclePayload(
  type: AnalyzerEventType,
  rawPayload: Record<string, unknown>,
): NormalizedPayload {
  switch (type) {
    case "session.start":
      return { sessionId: optStr(rawPayload, "sessionId") };
    case "session.end":
      return {
        sessionId: optStr(rawPayload, "sessionId"),
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };
    case "run.start":
      return { prompt: optStr(rawPayload, "prompt") };
    case "run.end":
      return {
        success: typeof rawPayload.success === "boolean" ? rawPayload.success : undefined,
        error: optStr(rawPayload, "error"),
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };
    case "run.error":
      return {
        error: optStr(rawPayload, "error"),
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };
    default:
      return {};
  }
}

/**
 * Normalize a raw payload into the unified NormalizedPayload shape.
 * Handles both Schema A and Schema B payload structures.
 */
export function normalizePayload(
  type: AnalyzerEventType,
  rawPayload: Record<string, unknown>,
  rawType: string,
): NormalizedPayload {
  const isSchemaB = rawType.startsWith("conversation.");

  switch (type) {
    case "msg.in":
    case "msg.out": {
      const role: "user" | "assistant" = type === "msg.in" ? "user" : "assistant";
      return isSchemaB
        ? normalizeMessagePayloadB(rawPayload, role)
        : normalizeMessagePayloadA(rawPayload, role);
    }
    case "tool.call":
      return normalizeToolCallPayload(rawPayload, isSchemaB);
    case "tool.result":
      return isSchemaB
        ? normalizeToolResultPayloadB(rawPayload)
        : normalizeToolResultPayloadA(rawPayload);
    default:
      return normalizeLifecyclePayload(type, rawPayload);
  }
}

/**
 * Normalize a raw event object (from any schema) into a NormalizedEvent.
 * Returns null if the event cannot be normalized (unknown type, missing timestamp).
 */
export function normalizeEvent(raw: Record<string, unknown>, seq: number): NormalizedEvent | null {
  const rawType = typeof raw.type === "string" ? raw.type : "";

  const ts = typeof raw.ts === "number" ? raw.ts
    : typeof raw.timestamp === "number" ? raw.timestamp
    : 0;
  if (ts === 0) return null;

  const type = mapEventType(rawType);
  if (!type) return null;

  const agent = typeof raw.agent === "string" ? raw.agent : "unknown";
  const rawSession = typeof raw.session === "string" ? raw.session : "unknown";
  const session = normalizeSession(rawSession);

  const rawPayload = (typeof raw.payload === "object" && raw.payload !== null)
    ? raw.payload as Record<string, unknown>
    : {};
  const payload = normalizePayload(type, rawPayload, rawType);

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    ts,
    agent,
    session,
    type,
    payload,
    seq,
  };
}

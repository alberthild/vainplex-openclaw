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

      if (isSchemaB) {
        // Schema B: content in text_preview[0].text
        const textPreview = rawPayload.text_preview;
        let content: string | undefined;
        if (Array.isArray(textPreview) && textPreview.length > 0) {
          const first = textPreview[0] as Record<string, unknown> | undefined;
          if (first && typeof first.text === "string") {
            content = first.text;
          }
        }
        return {
          content,
          role,
          sessionId: typeof rawPayload.sessionId === "string" ? rawPayload.sessionId : undefined,
        };
      }

      // Schema A: direct fields
      return {
        content: typeof rawPayload.content === "string" ? rawPayload.content : undefined,
        role,
        from: typeof rawPayload.from === "string" ? rawPayload.from : undefined,
        to: typeof rawPayload.to === "string" ? rawPayload.to : undefined,
        channel: typeof rawPayload.channel === "string" ? rawPayload.channel : undefined,
        success: typeof rawPayload.success === "boolean" ? rawPayload.success : undefined,
      };
    }

    case "tool.call": {
      if (isSchemaB) {
        // Schema B: data.name, data.args
        const data = rawPayload.data as Record<string, unknown> | undefined;
        return {
          toolName: data && typeof data.name === "string" ? data.name : undefined,
          toolParams: data && typeof data.args === "object" && data.args !== null
            ? data.args as Record<string, unknown>
            : undefined,
        };
      }
      // Schema A: toolName, params
      return {
        toolName: typeof rawPayload.toolName === "string" ? rawPayload.toolName : undefined,
        toolParams: typeof rawPayload.params === "object" && rawPayload.params !== null
          ? rawPayload.params as Record<string, unknown>
          : undefined,
      };
    }

    case "tool.result": {
      if (isSchemaB) {
        // Schema B: data.name, data.isError, data.result
        const data = rawPayload.data as Record<string, unknown> | undefined;
        let toolResult: unknown;
        let toolError: string | undefined;
        let toolIsError = false;

        if (data) {
          toolResult = data.result;
          toolIsError = data.isError === true;
          if (toolIsError && typeof data.result === "string") {
            toolError = data.result;
          }
        }

        return {
          toolName: data && typeof data.name === "string" ? data.name : undefined,
          toolResult,
          toolError,
          toolIsError,
        };
      }
      // Schema A: toolName, params, result, error, durationMs
      return {
        toolName: typeof rawPayload.toolName === "string" ? rawPayload.toolName : undefined,
        toolParams: typeof rawPayload.params === "object" && rawPayload.params !== null
          ? rawPayload.params as Record<string, unknown>
          : undefined,
        toolResult: rawPayload.result,
        toolError: typeof rawPayload.error === "string" ? rawPayload.error : undefined,
        toolIsError: typeof rawPayload.error === "string" ? true : undefined,
        toolDurationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };
    }

    case "session.start":
      return {
        sessionId: typeof rawPayload.sessionId === "string" ? rawPayload.sessionId : undefined,
      };

    case "session.end":
      return {
        sessionId: typeof rawPayload.sessionId === "string" ? rawPayload.sessionId : undefined,
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };

    case "run.start":
      return {
        prompt: typeof rawPayload.prompt === "string" ? rawPayload.prompt : undefined,
      };

    case "run.end":
      return {
        success: typeof rawPayload.success === "boolean" ? rawPayload.success : undefined,
        error: typeof rawPayload.error === "string" ? rawPayload.error : undefined,
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };

    case "run.error":
      return {
        error: typeof rawPayload.error === "string" ? rawPayload.error : undefined,
        durationMs: typeof rawPayload.durationMs === "number" ? rawPayload.durationMs : undefined,
      };

    default:
      return {};
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

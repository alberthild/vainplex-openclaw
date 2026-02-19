import { createHash } from "node:crypto";
import type { TimeContext, TrustTier } from "./types.js";

/** Parse "HH:MM" to minutes since midnight */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return -1;
  }
  return h * 60 + m;
}

/** Check if currentMinutes is within the range [after, before), handling midnight wrap */
export function isInTimeRange(
  currentMinutes: number,
  afterMinutes: number,
  beforeMinutes: number,
): boolean {
  if (afterMinutes <= beforeMinutes) {
    return currentMinutes >= afterMinutes && currentMinutes < beforeMinutes;
  }
  // Midnight wrap: e.g., after=23:00(1380), before=06:00(360)
  return currentMinutes >= afterMinutes || currentMinutes < beforeMinutes;
}

/** Get current time context for a timezone */
export function getCurrentTime(timezone: string): TimeContext {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const year = get("year");
  const month = get("month");
  const day = get("day");

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = get("weekday");
  const dayOfWeek = dayMap[weekday] ?? 0;

  return {
    hour,
    minute,
    dayOfWeek,
    date: `${year}-${month}-${day}`,
    timezone,
  };
}

/** Convert a glob pattern to a RegExp (supports * and ?) */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** SHA-256 hash of a string */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Current time in microseconds (from performance.now) */
export function nowUs(): number {
  return Math.round(performance.now() * 1000);
}

/** Extract agent ID from session key or explicit agentId
 * @deprecated Use `resolveAgentId()` for multi-fallback resolution */
export function extractAgentId(
  sessionKey?: string,
  agentId?: string,
): string {
  if (agentId) return agentId;
  if (!sessionKey) return "unknown";

  // "agent:main:subagent:forge:abc123" → "forge"
  // "agent:main" → "main"
  const parts = sessionKey.split(":");
  if (parts.length >= 4 && parts[2] === "subagent") {
    return parts[3] ?? "unknown";
  }
  return parts[1] ?? "unknown";
}

/**
 * Parse agent name from a session key string.
 * Returns null if the key doesn't contain a parseable agent name.
 *
 * Patterns:
 *   "agent:NAME" → NAME
 *   "agent:NAME:subagent:CHILD:..." → CHILD
 *   UUID or unparseable → null
 */
function parseAgentFromSessionKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    if (parts.length >= 4 && parts[2] === "subagent") {
      return parts[3] || null;
    }
    return parts[1] || null;
  }
  return null;
}

/**
 * Resolve agent ID from hook context with multi-source fallback.
 * Returns "unresolved" (not "unknown") when all sources fail.
 *
 * Priority:
 *   1. hookCtx.agentId (explicit)
 *   2. hookCtx.sessionKey → parse agent name
 *   3. hookCtx.sessionId → parse agent hint
 *   4. event metadata → event.metadata.agentId
 *   5. "unresolved" + log warning
 */
export function resolveAgentId(
  hookCtx: { agentId?: string; sessionKey?: string; sessionId?: string },
  event?: { metadata?: Record<string, unknown> },
  logger?: { warn: (msg: string) => void },
): string {
  // 1. Explicit agentId
  if (hookCtx.agentId) return hookCtx.agentId;

  // 2. Parse from sessionKey
  if (hookCtx.sessionKey) {
    const parsed = parseAgentFromSessionKey(hookCtx.sessionKey);
    if (parsed) return parsed;
  }

  // 3. Parse from sessionId
  if (hookCtx.sessionId) {
    const parsed = parseAgentFromSessionKey(hookCtx.sessionId);
    if (parsed) return parsed;
  }

  // 4. Check event metadata
  if (event?.metadata?.agentId && typeof event.metadata.agentId === "string") {
    return event.metadata.agentId;
  }

  // 5. Fallback
  logger?.warn(
    `[governance] Could not resolve agentId from context: ` +
    `sessionKey=${hookCtx.sessionKey ?? "none"}, ` +
    `sessionId=${hookCtx.sessionId ?? "none"}`,
  );
  return "unresolved";
}

/** Check if a session key indicates a sub-agent */
export function isSubAgent(sessionKey?: string): boolean {
  if (!sessionKey) return false;
  return sessionKey.includes(":subagent:");
}

/** Extract parent session key from a sub-agent session key.
 *  "agent:main:subagent:forge:abc" → "agent:main"
 *  Returns null for root agents. */
export function extractParentSessionKey(
  sessionKey: string,
): string | null {
  const idx = sessionKey.indexOf(":subagent:");
  if (idx === -1) return null;
  return sessionKey.substring(0, idx);
}

/** Map trust score to tier */
export function scoreToTier(score: number): TrustTier {
  if (score >= 80) return "privileged";
  if (score >= 60) return "trusted";
  if (score >= 40) return "standard";
  if (score >= 20) return "restricted";
  return "untrusted";
}

/** Map trust tier to its ordinal for comparisons */
export function tierOrdinal(tier: TrustTier): number {
  const map: Record<TrustTier, number> = {
    untrusted: 0,
    restricted: 1,
    standard: 2,
    trusted: 3,
    privileged: 4,
  };
  return map[tier];
}

import type { EventType } from "./events.js";

/**
 * Extract agent ID from context.
 * Priority: ctx.agentId → ctx.sessionKey first segment → "main"
 */
export function extractAgentId(ctx: { agentId?: string; sessionKey?: string }): string {
  if (ctx.agentId && ctx.agentId !== "main") return ctx.agentId;
  if (ctx.sessionKey) {
    if (ctx.sessionKey === "main") return "main";
    return ctx.sessionKey.split(":")[0] ?? "main";
  }
  return "main";
}

/**
 * Build a NATS subject from prefix, agent ID, and event type.
 * Dots in the event type are replaced with underscores for NATS subject compatibility.
 *
 * Example: buildSubject("openclaw.events", "main", "msg.in") → "openclaw.events.main.msg_in"
 */
export function buildSubject(prefix: string, agent: string, eventType: EventType): string {
  return `${prefix}.${agent}.${eventType.replace(/\./g, "_")}`;
}

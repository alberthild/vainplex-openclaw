import type { Decision, Thread } from "../types.js";

/** Case-insensitive substring match across decision fields. */
export function matchesDecisionQuery(decision: Decision, query: string): boolean {
  const q = query.toLowerCase();
  const d = decision as Record<string, unknown>;
  return (decision.what ?? "").toLowerCase().includes(q)
    || (decision.why ?? "").toLowerCase().includes(q)
    || (typeof d["who"] === "string" && d["who"].toLowerCase().includes(q))
    || (typeof d["thread"] === "string" && d["thread"].toLowerCase().includes(q));
}

/** Case-insensitive substring match across thread fields. */
export function matchesThreadQuery(thread: Thread, query: string): boolean {
  const q = query.toLowerCase();
  return (thread.title ?? "").toLowerCase().includes(q)
    || (thread.summary ?? "").toLowerCase().includes(q)
    || (thread.decisions ?? []).some((d) => (d ?? "").toLowerCase().includes(q));
}

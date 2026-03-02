import { join } from "node:path";
import type { ToolCapableApi, ToolResult, ThreadsData, Thread } from "../types.js";
import { loadJson, rebootDir } from "../storage.js";

function filterThreads(threads: Thread[], status: string, limit: number): Thread[] {
  const filtered = status === "all"
    ? threads
    : threads.filter((t) => t.status === status);
  return filtered
    .sort((a, b) => b.last_activity.localeCompare(a.last_activity))
    .slice(0, limit);
}

function formatThread(t: Thread): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    mood: t.mood,
    waiting_for: t.waiting_for,
    decisions: t.decisions,
    last_activity: t.last_activity,
  };
}

export function registerThreadsTool(api: ToolCapableApi, workspace: string): void {
  api.registerTool({
    name: "cortex_threads",
    description: "List conversation threads tracked by Cortex — open, closed, or blocked.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "closed", "all"], description: "Filter by status (default: open)" },
        limit: { type: "number", description: "Max threads to return (default: 10)" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
      try {
        const status = typeof params["status"] === "string" ? params["status"] : "open";
        const limit = typeof params["limit"] === "number" ? params["limit"] : 10;
        const data = loadJson<Partial<ThreadsData>>(join(rebootDir(workspace), "threads.json"));
        const threads = filterThreads(data.threads ?? [], status, limit);
        const result = { threads: threads.map(formatThread), total: (data.threads ?? []).length, mood: data.session_mood ?? "neutral" };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to load threads" }) }] };
      }
    },
  }, { optional: true });
}

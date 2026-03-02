import { join } from "node:path";
import type { ToolCapableApi, ToolResult, ThreadsData, DecisionsData } from "../types.js";
import { loadJson, loadText, rebootDir } from "../storage.js";

export function registerStatusTool(api: ToolCapableApi, workspace: string): void {
  api.registerTool({
    name: "cortex_status",
    description: "Get Cortex overview — thread counts, current mood, last update, boot context size.",
    parameters: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      try {
        const dir = rebootDir(workspace);
        const threadsData = loadJson<Partial<ThreadsData>>(join(dir, "threads.json"));
        const decisionsData = loadJson<Partial<DecisionsData>>(join(dir, "decisions.json"));
        const bootstrap = loadText(join(workspace, "BOOTSTRAP.md"));
        const threads = threadsData.threads ?? [];
        const result = {
          open_threads: threads.filter((t) => t.status === "open").length,
          closed_threads: threads.filter((t) => t.status === "closed").length,
          total_decisions: (decisionsData.decisions ?? []).length,
          session_mood: threadsData.session_mood ?? "neutral",
          last_updated: threadsData.updated ?? "never",
          bootstrap_size_chars: bootstrap.length,
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to load status" }) }] };
      }
    },
  }, { optional: true });
}

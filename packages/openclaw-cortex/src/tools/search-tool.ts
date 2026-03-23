import { join } from "node:path";
import type { ToolCapableApi, CortexConfig, ToolResult, ThreadsData, DecisionsData } from "../types.js";
import { matchesDecisionQuery, matchesThreadQuery } from "./match-helpers.js";
import { resolveWorkspace } from "../config.js";
import { loadJson, rebootDir } from "../storage.js";

export function registerSearchTool(api: ToolCapableApi, config: CortexConfig): void {
  api.registerTool({
    name: "cortex_search",
    description: "Search across all Cortex data — threads, decisions, and narratives.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (required)" },
        scope: { type: "string", enum: ["threads", "decisions", "all"], description: "Search scope (default: all)" },
      },
      required: ["query"],
    },
    async execute(_id: string, params: Record<string, unknown>, ctx?: { workspaceDir?: string }): Promise<ToolResult> {
      const workspace = resolveWorkspace(config, ctx);
      try {
        const query = typeof params["query"] === "string" ? params["query"] : "";
        const scope = typeof params["scope"] === "string" ? params["scope"] : "all";
        if (!query) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "query is required" }) }] };
        }
        const dir = rebootDir(workspace);
        const result: Record<string, unknown> = {};
        if (scope === "all" || scope === "threads") {
          const td = loadJson<Partial<ThreadsData>>(join(dir, "threads.json"));
          result["threads"] = (td.threads ?? []).filter((t) => matchesThreadQuery(t, query));
        }
        if (scope === "all" || scope === "decisions") {
          const dd = loadJson<Partial<DecisionsData>>(join(dir, "decisions.json"));
          result["decisions"] = (dd.decisions ?? []).filter((d) => matchesDecisionQuery(d, query));
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Search failed" }) }] };
      }
    },
  }, { optional: true });
}

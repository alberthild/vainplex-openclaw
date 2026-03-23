import { join } from "node:path";
import type { ToolCapableApi, CortexConfig, ToolResult, Decision, DecisionsData } from "../types.js";
import { matchesDecisionQuery } from "./match-helpers.js";
import { resolveWorkspace } from "../config.js";
import { loadJson, rebootDir } from "../storage.js";

function isRecent(decision: Decision, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(decision.extracted_at).getTime() > cutoff;
}

function filterDecisions(decisions: Decision[], query: string | undefined, days: number, limit: number): Decision[] {
  let filtered = decisions.filter((d) => isRecent(d, days));
  if (query) {
    filtered = filtered.filter((d) => matchesDecisionQuery(d, query));
  }
  return filtered
    .sort((a, b) => b.extracted_at.localeCompare(a.extracted_at))
    .slice(0, limit);
}

export function registerDecisionsTool(api: ToolCapableApi, config: CortexConfig): void {
  api.registerTool({
    name: "cortex_decisions",
    description: "List decisions extracted from conversations, optionally filtered by query or date range.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search in decision text (fuzzy match)" },
        days: { type: "number", description: "How far back to look in days (default: 14)" },
        limit: { type: "number", description: "Max decisions to return (default: 20)" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>, ctx?: { workspaceDir?: string }): Promise<ToolResult> {
      const workspace = resolveWorkspace(config, ctx);
      try {
        const query = typeof params["query"] === "string" ? params["query"] : undefined;
        const days = typeof params["days"] === "number" ? params["days"] : 14;
        const limit = typeof params["limit"] === "number" ? params["limit"] : 20;
        const data = loadJson<Partial<DecisionsData>>(join(rebootDir(workspace), "decisions.json"));
        const decisions = filterDecisions(data.decisions ?? [], query, days, limit);
        return { content: [{ type: "text", text: JSON.stringify({ decisions, total: (data.decisions ?? []).length }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to load decisions" }) }] };
      }
    },
  }, { optional: true });
}

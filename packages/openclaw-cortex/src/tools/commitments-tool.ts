import { resolveWorkspace } from "../config.js";
import type { ToolCapableApi, CortexConfig, ToolResult, Commitment } from "../types.js";
import { loadCommitments, markOverdue } from "../commitment-tracker.js";

function filterCommitments(
  commitments: Commitment[], status: string, who: string | undefined, limit: number,
): Commitment[] {
  let filtered = markOverdue(commitments);
  if (status !== "all") {
    filtered = filtered.filter((c) => c.status === status);
  }
  if (who) {
    const q = who.toLowerCase();
    filtered = filtered.filter((c) => c.who.toLowerCase().includes(q));
  }
  return filtered
    .sort((a, b) => b.created.localeCompare(a.created))
    .slice(0, limit);
}

export function registerCommitmentsTool(api: ToolCapableApi, config: CortexConfig): void {
  api.registerTool({
    name: "cortex_commitments",
    description: "List commitments and promises made in conversations — what was promised, by whom, and status.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "overdue", "all"], description: "Filter by status (default: open)" },
        who: { type: "string", description: "Filter by person" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>, ctx?: { workspaceDir?: string }): Promise<ToolResult> {
      const workspace = resolveWorkspace(config, ctx);
      try {
        const status = typeof params["status"] === "string" ? params["status"] : "open";
        const who = typeof params["who"] === "string" ? params["who"] : undefined;
        const limit = typeof params["limit"] === "number" ? params["limit"] : 20;
        const all = loadCommitments(workspace);
        const commitments = filterCommitments(all, status, who, limit);
        return { content: [{ type: "text", text: JSON.stringify({ commitments, total: all.length }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to load commitments" }) }] };
      }
    },
  }, { optional: true });
}

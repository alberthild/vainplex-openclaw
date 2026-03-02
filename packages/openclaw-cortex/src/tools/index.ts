import type { OpenClawPluginApi, CortexConfig, ToolCapableApi } from "../types.js";
import { resolveWorkspace } from "../config.js";
import { registerThreadsTool } from "./threads-tool.js";
import { registerDecisionsTool } from "./decisions-tool.js";
import { registerStatusTool } from "./status-tool.js";
import { registerSearchTool } from "./search-tool.js";
import { registerCommitmentsTool } from "./commitments-tool.js";

/**
 * Register all Cortex agent tools.
 * Tools are optional — user must opt-in via tools.allow config.
 * Gracefully skips if api.registerTool is not available.
 */


export function registerCortexTools(api: OpenClawPluginApi, config: CortexConfig): void {
  if (typeof api.registerTool !== "function") {
    api.logger.info("[cortex] registerTool not available — skipping agent tools");
    return;
  }

  const workspace = resolveWorkspace(config);
  const toolApi = api as ToolCapableApi;

  registerThreadsTool(toolApi, workspace);
  registerDecisionsTool(toolApi, workspace);
  registerStatusTool(toolApi, workspace);
  registerSearchTool(toolApi, workspace);
  registerCommitmentsTool(toolApi, workspace);

  api.logger.info("[cortex] 5 agent tools registered (optional, needs tools.allow)");
}

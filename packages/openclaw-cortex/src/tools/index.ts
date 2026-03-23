import type { OpenClawPluginApi, CortexConfig, ToolCapableApi } from "../types.js";
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

  const toolApi = api as ToolCapableApi;

  registerThreadsTool(toolApi, config);
  registerDecisionsTool(toolApi, config);
  registerStatusTool(toolApi, config);
  registerSearchTool(toolApi, config);
  registerCommitmentsTool(toolApi, config);

  api.logger.info("[cortex] 5 agent tools registered (optional, needs tools.allow)");
}

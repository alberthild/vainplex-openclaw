import type { OpenClawPluginApi } from "./src/types.js";
import { loadConfig } from "./src/config-loader.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";

type GovParams = { agentId?: string } | undefined;

/**
 * Extract agent IDs from the OpenClaw config.
 * Handles both { agents: { list: [{id: "main"}, ...] } } and
 * { agents: { list: ["main", ...] } } formats.
 */
function extractAgentIds(openclawConfig: Record<string, unknown>): string[] {
  const agents = openclawConfig["agents"];
  if (!agents || typeof agents !== "object") return [];

  const list = (agents as Record<string, unknown>)["list"];
  if (!Array.isArray(list)) return [];

  return list
    .map((entry: unknown) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "id" in entry) {
        const id = (entry as Record<string, unknown>)["id"];
        return typeof id === "string" ? id : null;
      }
      return null;
    })
    .filter((id): id is string => id !== null);
}

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.3.0",

  register(api: OpenClawPluginApi) {
    const { config, source, filePath } = loadConfig(
      api.pluginConfig as Record<string, unknown> | undefined,
      api.logger,
    );

    api.logger.info(
      `[governance] Config loaded (source=${source}${filePath ? `, path=${filePath}` : ""})`,
    );

    if (!config.enabled) {
      api.logger.info("[governance] Disabled via config");
      return;
    }

    const engine = new GovernanceEngine(config, api.logger);

    // Sync agent list from OpenClaw config → deterministic trust registration
    const agentIds = extractAgentIds(api.config);
    if (agentIds.length > 0) {
      engine.setKnownAgents(agentIds);
    }

    api.registerService({
      id: "governance-engine",
      start: async () => engine.start(),
      stop: async () => engine.stop(),
    });

    registerGovernanceHooks(api, engine, config);

    api.registerGatewayMethod(
      "governance.status",
      async () => engine.getStatus(),
    );

    api.registerGatewayMethod(
      "governance.trust",
      async (...args: unknown[]) => {
        const params = args[0] as GovParams;
        return engine.getTrust(params?.agentId);
      },
    );
  },
};

export default plugin;

import type { OpenClawPluginApi } from "./src/types.js";
import { loadConfig } from "./src/config-loader.js";
import { extractAgentIds } from "./src/util.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";

type GovParams = { agentId?: string } | undefined;

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.5.1",

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

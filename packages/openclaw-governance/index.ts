import type { OpenClawPluginApi } from "./src/types.js";
import { resolveConfig } from "./src/config.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";

type GovParams = { agentId?: string } | undefined;

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.2.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(
      api.pluginConfig as Record<string, unknown> | undefined,
    );

    if (!config.enabled) {
      api.logger.info("[governance] Disabled via config");
      return;
    }

    const engine = new GovernanceEngine(config, api.logger);

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

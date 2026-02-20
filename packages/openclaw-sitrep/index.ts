import type { OpenClawPluginApi } from "./src/types.js";
import { loadConfig } from "./src/config-loader.js";
import { registerSitrepHooks } from "./src/hooks.js";
import { createSitrepService } from "./src/service.js";

const plugin = {
  id: "openclaw-sitrep",
  name: "Situation Report Generator",
  description:
    "Aggregates system health, goals, timers, events, and agent activity into a unified sitrep.json",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const { config, source, filePath } = loadConfig(
      api.pluginConfig as Record<string, unknown> | undefined,
      api.logger,
    );

    api.logger.info(
      `[sitrep] Config loaded (source=${source}${filePath ? `, path=${filePath}` : ""})`,
    );

    if (!config.enabled) {
      api.logger.info("[sitrep] Disabled via config");
      return;
    }

    // Register the periodic generation service
    api.registerService(createSitrepService(config));

    // Register /sitrep command and any hooks
    registerSitrepHooks(api, config);

    api.logger.info(
      `[sitrep] Registered (${Object.entries(config.collectors).filter(([, c]) => c.enabled).length} collectors enabled, interval=${config.intervalMinutes}min)`,
    );
  },
};

export default plugin;

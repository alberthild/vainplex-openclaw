// index.ts — OpenClaw Plugin Entry Point

import { resolveConfig } from './src/config.js';
import { HookManager } from './src/hooks.js';
import type { OpenClawPluginApi } from './src/types.js';

const plugin = {
  id: 'openclaw-knowledge-engine',
  name: 'OpenClaw Knowledge Engine',
  description: 'Real-time knowledge extraction — entities, facts, and relationships from conversations',
  version: '0.1.2',

  register(api: OpenClawPluginApi): void {
    const { pluginConfig, logger } = api;

    // 1. Resolve and validate the configuration
    const config = resolveConfig(pluginConfig, logger);
    if (!config) {
      logger.error('Knowledge Engine: Invalid configuration — plugin disabled.');
      return;
    }
    if (!config.enabled) {
      logger.info('[knowledge-engine] Disabled via config');
      return;
    }

    // 2. Initialize the Hook Manager and register hooks
    try {
      logger.info('[knowledge-engine] Registering hooks...');
      const hookManager = new HookManager(api, config);
      hookManager.registerHooks();
      logger.info('[knowledge-engine] Ready');
    } catch (err) {
      logger.error('[knowledge-engine] Failed to initialize', err as Error);
    }
  },
};

export default plugin;

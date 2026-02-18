import type { NatsClient, PluginLogger } from "./nats-client.js";
import { createNatsClient } from "./nats-client.js";
import { resolveConfig } from "./config.js";

export type ServiceContext = {
  logger: PluginLogger;
  config: {
    plugins?: {
      entries?: Record<string, { config?: Record<string, unknown> }>;
    };
  };
};

export type PluginService = {
  id: string;
  start: (ctx: ServiceContext) => Promise<void>;
  stop: (ctx: ServiceContext) => Promise<void>;
};

export function createEventStoreService(
  getClient: () => NatsClient | null,
  setClient: (client: NatsClient | null) => void,
): PluginService {
  return {
    id: "nats-eventstore",
    async start(ctx) {
      const pluginEntry = ctx.config.plugins?.entries?.["nats-eventstore"];
      const config = resolveConfig(pluginEntry?.config as Record<string, unknown>);

      if (!config.enabled) {
        ctx.logger.info("[nats-eventstore] Disabled");
        return;
      }

      try {
        const client = await createNatsClient(config, ctx.logger);
        setClient(client);
        ctx.logger.info("[nats-eventstore] Ready");
      } catch (err) {
        ctx.logger.error(`[nats-eventstore] Init failed: ${err}`);
        // Non-fatal: gateway continues without event store
      }
    },
    async stop(ctx) {
      const client = getClient();
      if (!client) return;
      await client.drain();
      setClient(null);
      ctx.logger.info("[nats-eventstore] Shutdown");
    },
  };
}

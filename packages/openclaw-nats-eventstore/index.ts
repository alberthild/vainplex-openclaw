import type { NatsClient } from "./src/nats-client.js";
import type { PluginLogger } from "./src/nats-client.js";
import { createEventStoreService } from "./src/service.js";
import { registerEventHooks } from "./src/hooks.js";
import { resolveConfig } from "./src/config.js";

type OpenClawPluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  registerService: (service: { id: string; start: (ctx: any) => Promise<void>; stop: (ctx: any) => Promise<void> }) => void;
  registerCommand: (command: Record<string, unknown>) => void;
  registerGatewayMethod: (method: string, handler: (...args: any[]) => any) => void;
  on: (hookName: string, handler: (...args: any[]) => void, opts?: { priority?: number }) => void;
};

let client: NatsClient | null = null;

const plugin = {
  id: "nats-eventstore",
  name: "NATS Event Store",
  description: "Publish agent events to NATS JetStream for audit, replay, and multi-agent sharing",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[nats-eventstore] Disabled via config");
      return;
    }

    // Register service for connection lifecycle
    api.registerService(
      createEventStoreService(
        () => client,
        (c) => { client = c; },
      ),
    );

    // Register all hook handlers
    registerEventHooks(api, config, () => client);

    // Register /eventstatus command
    api.registerCommand({
      name: "eventstatus",
      description: "Show NATS event store connection status",
      requireAuth: true,
      handler: () => {
        const status = client?.getStatus() ?? {
          connected: false,
          stream: null,
          disconnectCount: 0,
          publishFailures: 0,
        };
        return {
          text: [
            "**NATS Event Store**",
            `Connected: ${status.connected ? "✅" : "❌"}`,
            `Stream: ${status.stream ?? "n/a"}`,
            `Disconnects: ${status.disconnectCount}`,
            `Publish failures: ${status.publishFailures}`,
          ].join("\n"),
        };
      },
    });

    // Register gateway method for programmatic status
    api.registerGatewayMethod("eventstore.status", async () => {
      return client?.getStatus() ?? {
        connected: false,
        stream: null,
        disconnectCount: 0,
        publishFailures: 0,
      };
    });
  },
};

export default plugin;

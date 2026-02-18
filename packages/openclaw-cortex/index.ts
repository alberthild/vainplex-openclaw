import { registerCortexHooks } from "./src/hooks.js";
import { resolveConfig, resolveWorkspace } from "./src/config.js";
import { loadJson, rebootDir } from "./src/storage.js";
import type { OpenClawPluginApi, ThreadsData } from "./src/types.js";

const plugin = {
  id: "openclaw-cortex",
  name: "OpenClaw Cortex",
  description:
    "Conversation intelligence — thread tracking, decision extraction, boot context, pre-compaction snapshots",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[cortex] Disabled via config");
      return;
    }

    api.logger.info("[cortex] Registering conversation intelligence hooks...");

    // Register all hook handlers
    registerCortexHooks(api, config);

    // Register /cortexstatus command
    api.registerCommand({
      name: "cortexstatus",
      description: "Show cortex plugin status: thread count, last update, mood",
      requireAuth: true,
      handler: () => {
        try {
          const workspace = resolveWorkspace(config);
          const data = loadJson<Partial<ThreadsData>>(
            `${rebootDir(workspace)}/threads.json`,
          );
          const threads = data.threads ?? [];
          const openCount = threads.filter(t => t.status === "open").length;
          const closedCount = threads.filter(t => t.status === "closed").length;
          const mood = data.session_mood ?? "neutral";
          const updated = data.updated ?? "never";

          return {
            text: [
              "**Cortex Status**",
              `Threads: ${openCount} open, ${closedCount} closed`,
              `Mood: ${mood}`,
              `Updated: ${updated}`,
            ].join("\n"),
          };
        } catch {
          return { text: "[cortex] Status: operational (no data yet)" };
        }
      },
    });

    api.logger.info("[cortex] Ready");
  },
};

export default plugin;

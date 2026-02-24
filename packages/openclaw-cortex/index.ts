import { registerCortexHooks, getHookDiagnostics } from "./src/hooks.js";
import { resolveWorkspace } from "./src/config.js";
import { loadConfig } from "./src/config-loader.js";
import { loadJson, rebootDir } from "./src/storage.js";
import type { OpenClawPluginApi, ThreadsData } from "./src/types.js";

// ---- Trace Analyzer public API re-export ----
export * from "./src/trace-analyzer/index.js";

const plugin = {
  id: "openclaw-cortex",
  name: "OpenClaw Cortex",
  description:
    "Conversation intelligence — thread tracking, decision extraction, boot context, pre-compaction snapshots",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const { config } = loadConfig(api.pluginConfig, api.logger);

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
      description: "Show cortex plugin status: thread count, last update, mood, hook diagnostics",
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

          // Hook diagnostics
          const diag = getHookDiagnostics();
          const hookLines: string[] = [];
          if (diag) {
            const hookNames = ["message_received", "message_sent", "agent_end", "session_start", "before_compaction", "after_compaction"];
            for (const name of hookNames) {
              const count = diag.counts[name] ?? 0;
              const last = diag.lastFired[name] ?? "never";
              const errors = diag.errors[name] ?? 0;
              const status = count > 0 ? "✅" : "⚠️";
              hookLines.push(`${status} ${name}: ${count}x (last: ${last})${errors > 0 ? ` [${errors} errors]` : ""}`);
            }
          }

          return {
            text: [
              "**Cortex Status**",
              `Threads: ${openCount} open, ${closedCount} closed`,
              `Mood: ${mood}`,
              `Updated: ${updated}`,
              "",
              "**Hook Diagnostics**",
              ...(hookLines.length > 0
                ? [`Since: ${diag!.startedAt}`, ...hookLines]
                : ["No diagnostics available (plugin just started?)"]),
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

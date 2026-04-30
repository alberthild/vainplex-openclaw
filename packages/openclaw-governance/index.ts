import type { OpenClawPluginApi } from "./src/types.js";
import { loadConfig } from "./src/config-loader.js";
import { getOllamaBaseUrl } from "./src/runtime-env.js";
import { extractAgentIds } from "./src/util.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";
import type { CallLlmFn } from "./src/llm-validator.js";

type GovParams = { agentId?: string, sessionId?: string } | undefined;

/**
 * Build a callLlm function that uses the first available provider.
 * Priority: configured model → local Ollama → null (disabled).
 */
function buildCallLlm(logger: OpenClawPluginApi["logger"], model?: string): CallLlmFn | undefined {
  // Default to local Ollama (zero cost, no API key)
  const ollamaUrl = getOllamaBaseUrl();
  const defaultModel = model || "mistral:7b";

  return async (prompt: string, opts?: { model?: string; maxTokens?: number; timeoutMs?: number }) => {
    const useModel = opts?.model || defaultModel;
    const timeoutMs = opts?.timeoutMs || 10000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: useModel,
          prompt,
          stream: false,
          options: {
            num_predict: opts?.maxTokens || 500,
            temperature: 0.1,
          },
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Ollama returned ${resp.status}: ${resp.statusText}`);
      }

      const data = (await resp.json()) as { response?: string };
      return data.response || "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[governance] callLlm failed (${useModel}): ${msg}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.5.7",

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

    // Build LLM callback for Stage 3 output validation (RFC-006)
    const llmConfig = config.outputValidation?.llmValidator;
    const callLlm = llmConfig?.enabled
      ? buildCallLlm(api.logger, llmConfig.model)
      : undefined;

    registerGovernanceHooks(api, engine, config, { callLlm });

    api.registerGatewayMethod(
      "governance.status",
      async () => engine.getStatus(),
    );

    api.registerGatewayMethod(
      "governance.trust",
      async (...args: unknown[]) => {
        const params = args[0] as GovParams;
        return params?.agentId ? engine.getTrust(params.agentId, params.sessionId || "") : engine.getTrust();
      },
    );
  },
};

export default plugin;

import type {
  OpenClawPluginApi,
  CortexConfig,
  HookEvent,
  HookContext,
} from "./types.js";
import { resolveWorkspace } from "./config.js";
import { ThreadTracker } from "./thread-tracker.js";
import { DecisionTracker } from "./decision-tracker.js";
import { BootContextGenerator } from "./boot-context.js";
import { PreCompaction } from "./pre-compaction.js";
import { LlmEnhancer, resolveLlmConfig } from "./llm-enhance.js";

/**
 * Extract message content from a hook event using the fallback chain.
 */
function extractContent(event: HookEvent): string {
  return event.content ?? event.message ?? event.text ?? "";
}

/**
 * Extract sender from a hook event.
 */
function extractSender(event: HookEvent): string {
  return event.from ?? event.sender ?? event.role ?? "unknown";
}

/** Shared state across hooks, lazy-initialized on first call. */
type HookState = {
  workspace: string | null;
  threadTracker: ThreadTracker | null;
  decisionTracker: DecisionTracker | null;
  llmEnhancer: LlmEnhancer | null;
};

function ensureInit(state: HookState, config: CortexConfig, logger: OpenClawPluginApi["logger"], ctx?: HookContext): void {
  if (!state.workspace) {
    state.workspace = resolveWorkspace(config, ctx);
  }
  if (!state.threadTracker && config.threadTracker.enabled) {
    state.threadTracker = new ThreadTracker(state.workspace, config.threadTracker, config.patterns.language, logger);
  }
  if (!state.decisionTracker && config.decisionTracker.enabled) {
    state.decisionTracker = new DecisionTracker(state.workspace, config.decisionTracker, config.patterns.language, logger);
  }
  if (!state.llmEnhancer && config.llm.enabled) {
    state.llmEnhancer = new LlmEnhancer(config.llm, logger);
  }
}

/** Register message hooks (message_received + message_sent). */
function registerMessageHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (!config.threadTracker.enabled && !config.decisionTracker.enabled) return;

  const handler = async (event: HookEvent, ctx: HookContext, senderOverride?: string) => {
    try {
      ensureInit(state, config, api.logger, ctx);
      const content = extractContent(event);
      const sender = senderOverride ?? extractSender(event);
      if (!content) return;

      // Regex-based processing (always runs — zero cost)
      if (config.threadTracker.enabled && state.threadTracker) state.threadTracker.processMessage(content, sender);
      if (config.decisionTracker.enabled && state.decisionTracker) state.decisionTracker.processMessage(content, sender);

      // LLM enhancement (optional — batched, async, fire-and-forget)
      if (state.llmEnhancer) {
        const role = senderOverride ? "assistant" as const : "user" as const;
        const analysis = await state.llmEnhancer.addMessage(content, sender, role);
        if (analysis) {
          // Apply LLM findings on top of regex results
          if (state.threadTracker) state.threadTracker.applyLlmAnalysis(analysis);
          if (state.decisionTracker) {
            for (const dec of analysis.decisions) {
              state.decisionTracker.addDecision(dec.what, dec.who, dec.impact);
            }
          }
        }
      }
    } catch (err) {
      api.logger.warn(`[cortex] message hook error: ${err}`);
    }
  };

  api.on("message_received", (event, ctx) => handler(event, ctx), { priority: 100 });
  api.on("message_sent", (event, ctx) => handler(event, ctx, event.role ?? "assistant"), { priority: 100 });
}

/** Register session_start hook for boot context. */
function registerSessionHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (!config.bootContext.enabled || !config.bootContext.onSessionStart) return;

  api.on("session_start", (_event, ctx) => {
    try {
      ensureInit(state, config, api.logger, ctx);
      new BootContextGenerator(state.workspace!, config.bootContext, api.logger).write();
      api.logger.info("[cortex] Boot context generated on session start");
    } catch (err) {
      api.logger.warn(`[cortex] session_start error: ${err}`);
    }
  }, { priority: 10 });
}

/** Register compaction hooks (before + after). */
function registerCompactionHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (config.preCompaction.enabled) {
    api.on("before_compaction", (event, ctx) => {
      try {
        ensureInit(state, config, api.logger, ctx);
        const tracker = state.threadTracker ?? new ThreadTracker(state.workspace!, config.threadTracker, config.patterns.language, api.logger);
        const result = new PreCompaction(state.workspace!, config, api.logger, tracker).run(event.compactingMessages);
        if (result.warnings.length > 0) api.logger.warn(`[cortex] Pre-compaction warnings: ${result.warnings.join("; ")}`);
        api.logger.info(`[cortex] Pre-compaction complete: ${result.messagesSnapshotted} messages snapshotted`);
      } catch (err) {
        api.logger.warn(`[cortex] before_compaction error: ${err}`);
      }
    }, { priority: 5 });
  }

  api.on("after_compaction", () => {
    try {
      api.logger.info(`[cortex] Compaction completed at ${new Date().toISOString()}`);
    } catch (err) {
      api.logger.warn(`[cortex] after_compaction error: ${err}`);
    }
  }, { priority: 200 });
}

/**
 * Register all cortex hook handlers on the plugin API.
 * Each handler is wrapped in try/catch — never throws.
 */
export function registerCortexHooks(api: OpenClawPluginApi, config: CortexConfig): void {
  const state: HookState = { workspace: null, threadTracker: null, decisionTracker: null, llmEnhancer: null };

  registerMessageHooks(api, config, state);
  registerSessionHooks(api, config, state);
  registerCompactionHooks(api, config, state);

  api.logger.info(
    `[cortex] Hooks registered — threads:${config.threadTracker.enabled} decisions:${config.decisionTracker.enabled} boot:${config.bootContext.enabled} compaction:${config.preCompaction.enabled} llm:${config.llm.enabled}${config.llm.enabled ? ` (${config.llm.model}@${config.llm.endpoint})` : ""}`,
  );
}

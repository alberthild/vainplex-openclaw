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
import { registerTraceAnalyzerHooks, cleanupTraceAnalyzerHooks, type TraceAnalyzerHookState } from "./trace-analyzer/index.js";
import { CommitmentTracker } from "./commitment-tracker.js";

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

/** Hook diagnostics — tracks which hooks fired and when. */
export type HookDiagnostics = {
  counts: Record<string, number>;
  lastFired: Record<string, string>;
  errors: Record<string, number>;
  startedAt: string;
};

type Trackers = {
  threadTracker: ThreadTracker | null;
  decisionTracker: DecisionTracker | null;
  commitmentTracker: CommitmentTracker | null;
};

/** Shared state across hooks, lazy-initialized on first call. */
type HookState = {
  llmEnhancer: LlmEnhancer | null;
  diagnostics: HookDiagnostics;
  trackersByWorkspace: Map<string, Trackers>;
};

function ensureInit(state: HookState, config: CortexConfig, logger: OpenClawPluginApi["logger"]): void {
  if (!state.llmEnhancer && config.llm.enabled) {
    state.llmEnhancer = new LlmEnhancer(config.llm, logger);
  }
}

function getTrackers(state: HookState, workspace: string, config: CortexConfig, logger: OpenClawPluginApi["logger"]): Trackers {
  let trackers = state.trackersByWorkspace.get(workspace);
  if (!trackers) {
    trackers = {
      threadTracker: config.threadTracker.enabled ? new ThreadTracker(workspace, config.threadTracker, config.patterns.language, logger) : null,
      decisionTracker: config.decisionTracker.enabled ? new DecisionTracker(workspace, config.decisionTracker, config.patterns.language, logger) : null,
      commitmentTracker: new CommitmentTracker(workspace, logger),
    };
    state.trackersByWorkspace.set(workspace, trackers);
  }
  return trackers;
}

/** Track a hook firing in diagnostics. */
function trackHook(diag: HookDiagnostics, hookName: string, error?: boolean): void {
  diag.counts[hookName] = (diag.counts[hookName] ?? 0) + 1;
  diag.lastFired[hookName] = new Date().toISOString();
  if (error) {
    diag.errors[hookName] = (diag.errors[hookName] ?? 0) + 1;
  }
}

/** Process a message through thread and decision trackers. */
async function processMessage(
  state: HookState,
  config: CortexConfig,
  api: OpenClawPluginApi,
  content: string,
  sender: string,
  role: "user" | "assistant",
  workspace: string,
): Promise<void> {
  if (!content) return;

  const { threadTracker, decisionTracker, commitmentTracker } = getTrackers(state, workspace, config, api.logger);

  // Regex-based processing (always runs — zero cost)
  if (threadTracker) threadTracker.processMessage(content, sender);
  if (decisionTracker) decisionTracker.processMessage(content, sender);
  if (commitmentTracker) commitmentTracker.processMessage(content, sender);

  // LLM enhancement (optional — batched, async, fire-and-forget)
  if (state.llmEnhancer) {
    const analysis = await state.llmEnhancer.addMessage(content, sender, role);
    if (analysis) {
      if (threadTracker) threadTracker.applyLlmAnalysis(analysis);
      if (decisionTracker) {
        for (const dec of analysis.decisions) {
          decisionTracker.addDecision(dec.what, dec.who, dec.impact);
        }
      }
    }
  }
}

/** Register message hooks (message_received + message_sent + agent_end fallback). */
function registerMessageHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (!config.threadTracker.enabled && !config.decisionTracker.enabled) return;

  // Track whether message_sent ever fires — if not, agent_end is our fallback
  let messageSentFired = false;

  api.on("message_received", async (event, ctx) => {
    trackHook(state.diagnostics, "message_received");
    try {
      ensureInit(state, config, api.logger);
      const content = extractContent(event);
      const sender = extractSender(event);
      const workspace = resolveWorkspace(config, ctx);
      await processMessage(state, config, api, content, sender, "user", workspace);
    } catch (err) {
      trackHook(state.diagnostics, "message_received", true);
      api.logger.warn(`[cortex] message_received hook error: ${err}`);
    }
  }, { priority: 100 });

  api.on("message_sent", async (event, ctx) => {
    messageSentFired = true;
    trackHook(state.diagnostics, "message_sent");
    try {
      ensureInit(state, config, api.logger);
      const content = extractContent(event);
      const sender = event.role ?? "assistant";
      const workspace = resolveWorkspace(config, ctx);
      await processMessage(state, config, api, content, sender, "assistant", workspace);
    } catch (err) {
      trackHook(state.diagnostics, "message_sent", true);
      api.logger.warn(`[cortex] message_sent hook error: ${err}`);
    }
  }, { priority: 100 });

  // Fallback: use agent_end to capture assistant responses if message_sent never fires
  api.on("agent_end", async (event, ctx) => {
    trackHook(state.diagnostics, "agent_end");
    if (messageSentFired) return;
    try {
      ensureInit(state, config, api.logger);
      const content = (event["response"] as string | undefined) ?? extractContent(event);
      if (!content) return;
      api.logger.info("[cortex] Using agent_end fallback for assistant message tracking");
      const workspace = resolveWorkspace(config, ctx);
      await processMessage(state, config, api, content, "assistant", "assistant", workspace);
    } catch (err) {
      trackHook(state.diagnostics, "agent_end", true);
      api.logger.warn(`[cortex] agent_end fallback error: ${err}`);
    }
  }, { priority: 150 });
}

/** Register session_start hook for boot context. */
function registerSessionHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (!config.bootContext.enabled || !config.bootContext.onSessionStart) return;

  api.on("session_start", (_event, ctx) => {
    trackHook(state.diagnostics, "session_start");
    try {
      ensureInit(state, config, api.logger);
      const workspace = resolveWorkspace(config, ctx);
      new BootContextGenerator(workspace, config.bootContext, api.logger).write();
      api.logger.info("[cortex] Boot context generated on session start");
    } catch (err) {
      trackHook(state.diagnostics, "session_start", true);
      api.logger.warn(`[cortex] session_start error: ${err}`);
    }
  }, { priority: 10 });
}

/** Register compaction hooks (before + after). */
function registerCompactionHooks(api: OpenClawPluginApi, config: CortexConfig, state: HookState): void {
  if (config.preCompaction.enabled) {
    api.on("before_compaction", (event, ctx) => {
      trackHook(state.diagnostics, "before_compaction");
      try {
        ensureInit(state, config, api.logger);
        const workspace = resolveWorkspace(config, ctx);
        const trackers = getTrackers(state, workspace, config, api.logger);
        if (!trackers.threadTracker) return;
        const result = new PreCompaction(workspace, config, api.logger, trackers.threadTracker).run(event.compactingMessages);
        if (result.warnings.length > 0) api.logger.warn(`[cortex] Pre-compaction warnings: ${result.warnings.join("; ")}`);
        api.logger.info(`[cortex] Pre-compaction complete: ${result.messagesSnapshotted} messages snapshotted`);
      } catch (err) {
        trackHook(state.diagnostics, "before_compaction", true);
        api.logger.warn(`[cortex] before_compaction error: ${err}`);
      }
    }, { priority: 5 });
  }

  api.on("after_compaction", () => {
    trackHook(state.diagnostics, "after_compaction");
    try {
      api.logger.info(`[cortex] Compaction completed at ${new Date().toISOString()}`);
    } catch (err) {
      trackHook(state.diagnostics, "after_compaction", true);
      api.logger.warn(`[cortex] after_compaction error: ${err}`);
    }
  }, { priority: 200 });
}

/** Global diagnostics reference — exposed for /cortexstatus command. */
let _globalDiagnostics: HookDiagnostics | null = null;

/** Get current hook diagnostics (for /cortexstatus). */
export function getHookDiagnostics(): HookDiagnostics | null {
  return _globalDiagnostics;
}

/**
 * Register all cortex hook handlers on the plugin API.
 * Each handler is wrapped in try/catch — never throws.
 */
export function registerCortexHooks(api: OpenClawPluginApi, config: CortexConfig): void {
  const diagnostics: HookDiagnostics = {
    counts: {},
    lastFired: {},
    errors: {},
    startedAt: new Date().toISOString(),
  };
  _globalDiagnostics = diagnostics;

  const state: HookState = { llmEnhancer: null, diagnostics, trackersByWorkspace: new Map() };

  registerMessageHooks(api, config, state);
  registerSessionHooks(api, config, state);
  registerCompactionHooks(api, config, state);

  // Trace Analyzer — conditional registration (R-010, R-013, R-028)
  if (config.traceAnalyzer?.enabled) {
    const taState: TraceAnalyzerHookState = { timer: null, analyzer: null };
    registerTraceAnalyzerHooks(api, config, taState);

    // Register cleanup as a service so it runs on plugin stop
    api.registerService({
      id: "trace-analyzer",
      start: async () => { /* noop — analyzer is lazy */ },
      stop: async () => { cleanupTraceAnalyzerHooks(taState); },
    });
  }

  api.logger.info(
    `[cortex] Hooks registered — threads:${config.threadTracker.enabled} decisions:${config.decisionTracker.enabled} boot:${config.bootContext.enabled} compaction:${config.preCompaction.enabled} llm:${config.llm.enabled}${config.llm.enabled ? ` (${config.llm.model}@${config.llm.endpoint})` : ""} trace:${config.traceAnalyzer?.enabled ?? false}`,
  );
}
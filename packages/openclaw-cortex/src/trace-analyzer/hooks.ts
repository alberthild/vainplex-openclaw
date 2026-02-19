// ============================================================
// Trace Analyzer — Hook Registration
// ============================================================
//
// Registers trace analyzer commands and scheduled runs with
// the OpenClaw plugin API. Called from src/hooks.ts when
// config.traceAnalyzer.enabled is true.
//
// Implements R-010 (batch only, not in hook path) and R-013
// (graceful deactivation when no TraceSource is available).
// ============================================================

import type { OpenClawPluginApi, CortexConfig, PluginLogger } from "../types.js";
import type { LlmConfig } from "../llm-enhance.js";
import { resolveWorkspace } from "../config.js";
import { TraceAnalyzer } from "./analyzer.js";
import { createNatsTraceSource } from "./nats-trace-source.js";

/** State shared across hook registrations for cleanup. */
export type TraceAnalyzerHookState = {
  /** Scheduled analysis timer (if any). */
  timer: ReturnType<typeof setInterval> | null;
  /** The analyzer instance (lazy, created on first command/schedule run). */
  analyzer: TraceAnalyzer | null;
};

/**
 * Create a TraceAnalyzer instance from config.
 */
function createAnalyzer(
  config: CortexConfig,
  workspace: string,
  logger: PluginLogger,
): TraceAnalyzer {
  return new TraceAnalyzer({
    config: config.traceAnalyzer,
    logger,
    workspace,
    topLevelLlm: config.llm as LlmConfig,
    createSource: () => createNatsTraceSource(config.traceAnalyzer.nats, logger),
  });
}

/**
 * Ensure the analyzer is initialized. Lazy to avoid work if never called.
 */
function ensureAnalyzer(
  state: TraceAnalyzerHookState,
  config: CortexConfig,
  workspace: string,
  logger: PluginLogger,
): TraceAnalyzer {
  if (!state.analyzer) {
    state.analyzer = createAnalyzer(config, workspace, logger);
  }
  return state.analyzer;
}

/**
 * Register trace analyzer hooks (commands + optional scheduled runs).
 *
 * Called from the main `registerCortexHooks()` when
 * `config.traceAnalyzer.enabled` is true.
 */
export function registerTraceAnalyzerHooks(
  api: OpenClawPluginApi,
  config: CortexConfig,
  state: TraceAnalyzerHookState,
): void {
  const workspace = resolveWorkspace(config);

  // Register /trace-analyze command
  api.registerCommand({
    name: "trace-analyze",
    description: "Run the trace analyzer pipeline (batch analysis of agent event traces)",
    handler: async (args?: Record<string, unknown>) => {
      const logger = api.logger;
      const full = args?.full === true || args?.full === "true";

      try {
        const analyzer = ensureAnalyzer(state, config, workspace, logger);
        const report = await analyzer.run({ full });

        return {
          text: [
            `Trace analysis complete.`,
            `Events: ${report.stats.eventsProcessed}`,
            `Chains: ${report.stats.chainsReconstructed}`,
            `Findings: ${report.stats.findingsDetected}`,
            `Classified: ${report.stats.findingsClassified}`,
            `Outputs: ${report.stats.outputsGenerated}`,
          ].join(" | "),
        };
      } catch (err) {
        logger.warn(`[trace-analyzer] Command error: ${err instanceof Error ? err.message : String(err)}`);
        return { text: `Trace analysis failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // Register /trace-status command
  api.registerCommand({
    name: "trace-status",
    description: "Show trace analyzer status (last run, findings count, processing state)",
    handler: async () => {
      const logger = api.logger;
      try {
        const analyzer = ensureAnalyzer(state, config, workspace, logger);
        const status = await analyzer.getStatus();

        return {
          text: [
            `Trace Analyzer Status`,
            `Last run: ${status.lastRun ?? "never"}`,
            `Total findings: ${status.findings}`,
            `Events processed: ${status.state.totalEventsProcessed ?? 0}`,
          ].join(" | "),
        };
      } catch (err) {
        return { text: `Failed to get status: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // Set up scheduled interval if configured
  if (config.traceAnalyzer.schedule.enabled) {
    const intervalMs = config.traceAnalyzer.schedule.intervalHours * 60 * 60 * 1000;

    const timer = setInterval(() => {
      const logger = api.logger;
      logger.info("[trace-analyzer] Running scheduled analysis...");

      const analyzer = ensureAnalyzer(state, config, workspace, logger);
      analyzer.run().catch(err => {
        logger.warn(
          `[trace-analyzer] Scheduled analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);

    // Prevent the timer from keeping Node alive
    timer.unref();
    state.timer = timer;

    api.logger.info(
      `[trace-analyzer] Scheduled analysis every ${config.traceAnalyzer.schedule.intervalHours}h`,
    );
  }

  api.logger.info(
    `[trace-analyzer] Hooks registered — schedule:${config.traceAnalyzer.schedule.enabled} llm:${config.traceAnalyzer.llm.enabled}`,
  );
}

/**
 * Clean up trace analyzer resources.
 * Called when the plugin stops.
 */
export function cleanupTraceAnalyzerHooks(state: TraceAnalyzerHookState): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.analyzer = null;
}

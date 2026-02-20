import type { SitrepConfig, PluginLogger, ServiceContext } from "./types.js";
import { generateSitrep } from "./aggregator.js";
import { writeSitrep } from "./output.js";
import { resolveConfig } from "./config.js";

/**
 * Service: Periodic sitrep generation.
 * Runs on an interval (configurable), writing sitrep.json each cycle.
 */
export function createSitrepService(configFromRegister: SitrepConfig) {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    id: "sitrep-generator",

    async start(ctx: ServiceContext): Promise<void> {
      // Re-resolve config from service context (same pattern as nats-eventstore)
      const pluginEntry = (ctx.config as Record<string, unknown>)["plugins"] as
        | Record<string, unknown>
        | undefined;
      const entries = pluginEntry?.["entries"] as Record<string, unknown> | undefined;
      const sitrepEntry = entries?.["openclaw-sitrep"] as Record<string, unknown> | undefined;
      const config = sitrepEntry?.["config"]
        ? resolveConfig(sitrepEntry["config"] as Record<string, unknown>)
        : configFromRegister;

      const logger = ctx.logger;

      if (!config.enabled) {
        logger.info("[sitrep] Service disabled");
        return;
      }

      // Generate initial report
      await runGeneration(config, logger);

      // Schedule periodic regeneration
      const intervalMs = config.intervalMinutes * 60_000;
      if (intervalMs > 0) {
        timer = setInterval(() => {
          runGeneration(config, logger).catch((err) =>
            logger.error(`[sitrep] Periodic generation failed: ${err}`, err as Error),
          );
        }, intervalMs);

        // Don't prevent Node from exiting
        if (timer && "unref" in timer) {
          (timer as NodeJS.Timeout).unref();
        }

        logger.info(`[sitrep] Scheduled every ${config.intervalMinutes}min`);
      }

      logger.info("[sitrep] Ready");
    },

    async stop(_ctx: ServiceContext): Promise<void> {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

async function runGeneration(
  config: SitrepConfig,
  logger: PluginLogger,
): Promise<void> {
  const start = Date.now();
  try {
    const report = await generateSitrep(config, logger);
    writeSitrep(report, config.outputPath, config.previousPath, logger);
    const duration = Date.now() - start;
    logger.info(
      `[sitrep] Generated in ${duration}ms: ${report.health.overall} (${report.items.length} items)`,
    );
  } catch (err) {
    logger.error(
      `[sitrep] Generation failed: ${err instanceof Error ? err.message : String(err)}`,
      err as Error,
    );
  }
}

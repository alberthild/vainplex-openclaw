import type { SitrepConfig, PluginLogger, ServiceContext } from "./types.js";
import { generateSitrep } from "./aggregator.js";
import { writeSitrep } from "./output.js";
import { resolveConfig } from "./config.js";

/** Run a single sitrep generation cycle. */
async function runGeneration(config: SitrepConfig, logger: PluginLogger): Promise<void> {
  const start = Date.now();
  const report = await generateSitrep(config, logger);
  writeSitrep(report, config.outputPath, config.previousPath, logger);
  logger.info(
    `[sitrep] Generated in ${Date.now() - start}ms: ${report.health.overall} (${report.items.length} items)`,
  );
}

/** Resolve config from service context, falling back to register-time config. */
function resolveServiceConfig(ctx: ServiceContext, fallback: SitrepConfig): SitrepConfig {
  const plugins = (ctx.config as Record<string, unknown>)["plugins"] as Record<string, unknown> | undefined;
  const entries = plugins?.["entries"] as Record<string, unknown> | undefined;
  const entry = entries?.["openclaw-sitrep"] as Record<string, unknown> | undefined;
  const inlineConfig = entry?.["config"] as Record<string, unknown> | undefined;
  return inlineConfig ? resolveConfig(inlineConfig) : fallback;
}

/**
 * Service: Periodic sitrep generation.
 */
export function createSitrepService(configFromRegister: SitrepConfig) {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    id: "sitrep-generator",

    async start(ctx: ServiceContext): Promise<void> {
      const config = resolveServiceConfig(ctx, configFromRegister);
      const logger = ctx.logger;

      if (!config.enabled) {
        logger.info("[sitrep] Service disabled");
        return;
      }

      await runGeneration(config, logger).catch((err) =>
        logger.error(`[sitrep] Initial generation failed: ${err}`, err as Error),
      );

      const intervalMs = config.intervalMinutes * 60_000;
      if (intervalMs > 0) {
        timer = setInterval(() => {
          runGeneration(config, logger).catch((err) =>
            logger.error(`[sitrep] Periodic generation failed: ${err}`, err as Error),
          );
        }, intervalMs);
        if (timer && "unref" in timer) (timer as NodeJS.Timeout).unref();
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

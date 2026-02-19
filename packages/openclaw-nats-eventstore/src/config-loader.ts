import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { NatsEventStoreConfig } from "./config.js";
import type { PluginLogger } from "./nats-client.js";
import { resolveConfig, DEFAULTS } from "./config.js";

/** Minimal inline config that lives in openclaw.json */
export interface InlineConfig {
  readonly enabled?: boolean;
  /** Override path to external config file */
  readonly configPath?: string;
}

const DEFAULT_CONFIG_DIR = join(
  process.env["HOME"] ?? "/tmp",
  ".openclaw",
  "plugins",
  "nats-eventstore",
);
const DEFAULT_CONFIG_FILENAME = "config.json";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Determine whether pluginConfig is a full (legacy) inline config
 * or just the minimal inline pointer.
 *
 * Heuristic: if it has keys beyond `enabled` and `configPath`,
 * treat it as legacy inline config.
 */
function isLegacyInlineConfig(raw: Record<string, unknown>): boolean {
  const inlineOnlyKeys = new Set(["enabled", "configPath"]);
  return Object.keys(raw).some((k) => !inlineOnlyKeys.has(k));
}

/**
 * Read and parse a JSON file. Returns null on any error.
 */
function readJsonFile(
  path: string,
  logger: PluginLogger,
): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      logger.warn(`[nats-eventstore] Config file is not an object: ${path}`);
      return null;
    }
    return parsed;
  } catch (e) {
    logger.warn(
      `[nats-eventstore] Failed to read config file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * Apply inline `enabled` override to a file-loaded config (immutably).
 */
function applyInlineOverrides(
  fileConfig: Record<string, unknown>,
  inline: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof inline["enabled"] === "boolean") {
    return { ...fileConfig, enabled: inline["enabled"] };
  }
  return fileConfig;
}

/**
 * Bootstrap a default config file and return its contents.
 * Returns null if writing or reading back fails.
 */
function bootstrapConfig(
  path: string,
  logger: PluginLogger,
): Record<string, unknown> | null {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
    logger.info(`[nats-eventstore] Created default config at ${path}`);
    return readJsonFile(path, logger);
  } catch (e) {
    logger.warn(
      `[nats-eventstore] Failed to write default config: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

export interface ConfigLoadResult {
  readonly config: NatsEventStoreConfig;
  readonly source: "inline" | "file" | "defaults";
  readonly filePath?: string;
}

/**
 * Load nats-eventstore config with the following priority:
 *
 * 1. Legacy inline config (full config in openclaw.json) → use it directly
 * 2. External file (configPath or default location) → read + resolve
 * 3. Graceful defaults → everything enabled, fail-open
 *
 * NEVER throws. Worst case: returns defaults with a warning.
 */
export function loadConfig(
  pluginConfig: Record<string, unknown> | undefined,
  logger: PluginLogger,
): ConfigLoadResult {
  const raw = pluginConfig ?? {};

  // Priority 1: Legacy inline config (backward compatible)
  if (isLegacyInlineConfig(raw)) {
    logger.info("[nats-eventstore] Using inline config from openclaw.json");
    return { config: resolveConfig(raw), source: "inline" };
  }

  // Priority 2: External config file
  const configPath =
    typeof raw["configPath"] === "string"
      ? raw["configPath"]
      : join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILENAME);

  const fileConfig = readJsonFile(configPath, logger);
  if (fileConfig !== null) {
    const merged = applyInlineOverrides(fileConfig, raw);
    logger.info(`[nats-eventstore] Loaded config from ${configPath}`);
    return { config: resolveConfig(merged), source: "file", filePath: configPath };
  }

  // File missing → bootstrap with defaults
  if (!existsSync(configPath)) {
    const bootstrapped = bootstrapConfig(configPath, logger);
    if (bootstrapped !== null) {
      const merged = applyInlineOverrides(bootstrapped, raw);
      return { config: resolveConfig(merged), source: "file", filePath: configPath };
    }
  }

  // Priority 3: Graceful defaults (file broken or unwritable)
  logger.warn("[nats-eventstore] Falling back to default config");
  return { config: resolveConfig(undefined), source: "defaults" };
}

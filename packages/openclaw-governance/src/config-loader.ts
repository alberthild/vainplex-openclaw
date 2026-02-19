import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { GovernanceConfig, PluginLogger } from "./types.js";
import { resolveConfig } from "./config.js";

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
  "openclaw-governance",
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
      logger.warn(`[governance] Config file is not an object: ${path}`);
      return null;
    }
    return parsed;
  } catch (e) {
    logger.warn(
      `[governance] Failed to read config file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * Write a default config file if none exists (first-run bootstrapping).
 */
function writeDefaultConfig(path: string, logger: PluginLogger): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const defaults: Record<string, unknown> = {
      enabled: true,
      timezone: "Europe/Berlin",
      failMode: "open",
      policies: [],
      timeWindows: {},
      trust: {
        enabled: true,
        defaults: { main: 60, "*": 10 },
      },
      audit: {
        enabled: true,
        retentionDays: 90,
        level: "standard",
      },
      builtinPolicies: {
        nightMode: { enabled: true, start: "23:00", end: "08:00" },
        credentialGuard: true,
        productionSafeguard: true,
        rateLimiter: { enabled: true, maxPerMinute: 15 },
      },
      outputValidation: {
        enabled: false,
      },
    };

    writeFileSync(path, JSON.stringify(defaults, null, 2) + "\n", "utf-8");
    logger.info(`[governance] Created default config at ${path}`);
  } catch (e) {
    logger.warn(
      `[governance] Failed to write default config: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export interface ConfigLoadResult {
  readonly config: GovernanceConfig;
  readonly source: "inline" | "file" | "defaults";
  readonly filePath?: string;
}

/**
 * Load governance config with the following priority:
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
    logger.info("[governance] Using inline config from openclaw.json");
    return {
      config: resolveConfig(raw),
      source: "inline",
    };
  }

  // Priority 2: External config file
  const configPath =
    typeof raw["configPath"] === "string"
      ? raw["configPath"]
      : join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILENAME);

  const fileConfig = readJsonFile(configPath, logger);

  if (fileConfig !== null) {
    // Merge enabled from inline if present (inline `enabled` overrides file)
    if (typeof raw["enabled"] === "boolean") {
      fileConfig["enabled"] = raw["enabled"];
    }
    logger.info(`[governance] Loaded config from ${configPath}`);
    return {
      config: resolveConfig(fileConfig),
      source: "file",
      filePath: configPath,
    };
  }

  // File doesn't exist → bootstrap with defaults
  if (!existsSync(configPath)) {
    writeDefaultConfig(configPath, logger);
    const bootstrapped = readJsonFile(configPath, logger);
    if (bootstrapped !== null) {
      if (typeof raw["enabled"] === "boolean") {
        bootstrapped["enabled"] = raw["enabled"];
      }
      return {
        config: resolveConfig(bootstrapped),
        source: "file",
        filePath: configPath,
      };
    }
  }

  // Priority 3: Graceful defaults (file was broken or unwritable)
  logger.warn("[governance] Falling back to default config");
  return {
    config: resolveConfig(undefined),
    source: "defaults",
  };
}

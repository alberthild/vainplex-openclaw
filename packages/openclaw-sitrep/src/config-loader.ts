import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveConfig, DEFAULTS } from "./config.js";
import type { SitrepConfig, PluginLogger } from "./types.js";

const DEFAULT_CONFIG_DIR = join(
  process.env["HOME"] ?? "/tmp",
  ".openclaw",
  "plugins",
  "openclaw-sitrep",
);
const DEFAULT_CONFIG_FILENAME = "config.json";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isLegacyInlineConfig(raw: Record<string, unknown>): boolean {
  const inlineOnlyKeys = new Set(["enabled", "configPath"]);
  return Object.keys(raw).some((k) => !inlineOnlyKeys.has(k));
}

function readJsonFile(
  path: string,
  logger: PluginLogger,
): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      logger.warn(`[sitrep] Config file is not an object: ${path}`);
      return null;
    }
    return parsed;
  } catch (e) {
    logger.warn(
      `[sitrep] Failed to read config file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

function applyInlineOverrides(
  fileConfig: Record<string, unknown>,
  inline: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof inline["enabled"] === "boolean") {
    return { ...fileConfig, enabled: inline["enabled"] };
  }
  return fileConfig;
}

function bootstrapConfig(
  path: string,
  logger: PluginLogger,
): Record<string, unknown> | null {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
    logger.info(`[sitrep] Created default config at ${path}`);
    return readJsonFile(path, logger);
  } catch (e) {
    logger.warn(
      `[sitrep] Failed to write default config: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

export function loadConfig(
  pluginConfig: Record<string, unknown> | undefined,
  logger: PluginLogger,
): { config: SitrepConfig; source: string; filePath?: string } {
  const raw = pluginConfig ?? {};

  // Priority 1: Legacy inline config
  if (isLegacyInlineConfig(raw)) {
    logger.info("[sitrep] Using inline config from openclaw.json");
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
    logger.info(`[sitrep] Loaded config from ${configPath}`);
    return {
      config: resolveConfig(merged),
      source: "file",
      filePath: configPath,
    };
  }

  // File missing → bootstrap
  if (!existsSync(configPath)) {
    const bootstrapped = bootstrapConfig(configPath, logger);
    if (bootstrapped !== null) {
      const merged = applyInlineOverrides(bootstrapped, raw);
      return {
        config: resolveConfig(merged),
        source: "file",
        filePath: configPath,
      };
    }
  }

  // Priority 3: Defaults
  logger.warn("[sitrep] Falling back to default config");
  return { config: resolveConfig(undefined), source: "defaults" };
}

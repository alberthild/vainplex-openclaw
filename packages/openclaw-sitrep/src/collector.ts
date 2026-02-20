import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import type { CollectorResult, CollectorConfig, CollectorFn, PluginLogger } from "./types.js";

/**
 * Safely run a collector, catching any errors and returning a standardized error result.
 */
export async function safeCollect(
  name: string,
  fn: CollectorFn,
  config: CollectorConfig,
  logger: PluginLogger,
): Promise<CollectorResult> {
  if (!config.enabled) {
    return {
      status: "ok",
      items: [],
      summary: "disabled",
      duration_ms: 0,
    };
  }

  const start = Date.now();
  try {
    const result = await fn(config, logger);
    result.duration_ms = Date.now() - start;
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[sitrep] Collector "${name}" failed: ${message}`);
    return {
      status: "error",
      items: [],
      summary: `error: ${message}`,
      duration_ms: duration,
      error: message,
    };
  }
}

/**
 * Execute a shell command and return stdout. Throws on non-zero exit.
 * Timeout: 10 seconds.
 */
export function shell(command: string): string {
  return execSync(command, {
    timeout: 10_000,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Read and parse a JSON file safely. Returns null if missing or invalid.
 */
export function readJsonSafe<T = unknown>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

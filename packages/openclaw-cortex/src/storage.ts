import { readFileSync, writeFileSync, renameSync, mkdirSync, accessSync, statSync } from "node:fs";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import type { PluginLogger } from "./types.js";

/**
 * Resolve the reboot directory path.
 * Does NOT create it — use ensureRebootDir() for that.
 */
export function rebootDir(workspace: string): string {
  return join(workspace, "memory", "reboot");
}

/**
 * Ensure the memory/reboot/ directory exists.
 * Returns false if creation fails (read-only workspace).
 */
export function ensureRebootDir(workspace: string, logger: PluginLogger): boolean {
  const dir = rebootDir(workspace);
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    logger.warn(`[cortex] Cannot create ${dir}: ${err}`);
    return false;
  }
}

/**
 * Check if the workspace is writable.
 */
export function isWritable(workspace: string): boolean {
  try {
    accessSync(join(workspace, "memory"), constants.W_OK);
    return true;
  } catch {
    // memory/ might not exist yet — check workspace itself
    try {
      accessSync(workspace, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Load a JSON file. Returns empty object on any failure.
 */
export function loadJson<T = Record<string, unknown>>(filePath: string): T {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Atomically write JSON to a file.
 * Writes to .tmp first, then renames. This prevents partial writes on crash.
 * Returns false on failure (read-only filesystem).
 */
export function saveJson(filePath: string, data: unknown, logger: PluginLogger): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    logger.warn(`[cortex] Failed to write ${filePath}: ${err}`);
    return false;
  }
}

/**
 * Load a text file. Returns empty string on failure.
 */
export function loadText(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Write a text file atomically.
 * Returns false on failure.
 */
export function saveText(filePath: string, content: string, logger: PluginLogger): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    logger.warn(`[cortex] Failed to write ${filePath}: ${err}`);
    return false;
  }
}

/**
 * Get file modification time as ISO string. Returns null if file doesn't exist.
 */
export function getFileMtime(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Check if a file is older than the given number of hours.
 * Returns true if the file doesn't exist.
 */
export function isFileOlderThan(filePath: string, hours: number): boolean {
  const mtime = getFileMtime(filePath);
  if (!mtime) return true;
  const ageMs = Date.now() - new Date(mtime).getTime();
  return ageMs > hours * 60 * 60 * 1000;
}

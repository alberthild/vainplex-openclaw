/**
 * Writer module — atomic file writes, backups, safe merging.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { WriteOptions, WriteResult, PluginConfig, ConfigUpdateResult, ScanResult } from './types.js';
import type { InstallPlan } from './types.js';

/**
 * Write JSON atomically: write to .tmp file, then rename.
 * Never overwrites existing config files — returns false if file exists.
 */
export function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: WriteOptions,
): { written: boolean; skipped: boolean } {
  if (fs.existsSync(filePath)) {
    return { written: false, skipped: true };
  }

  if (opts.dryRun) {
    return { written: true, skipped: false };
  }

  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Atomic write: .tmp → rename
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return { written: true, skipped: false };
}

/**
 * Create a backup of a file before modification.
 */
export function createBackup(filePath: string, opts: WriteOptions): string | null {
  if (opts.dryRun) return `${filePath}.bak`;
  if (!fs.existsSync(filePath)) return null;

  const bakPath = `${filePath}.bak`;
  fs.copyFileSync(filePath, bakPath);
  return bakPath;
}

/**
 * Write plugin config files.
 * Only creates new files — never overwrites existing configs.
 */
export function writeConfigs(
  configs: PluginConfig[],
  scan: ScanResult,
  opts: WriteOptions,
): WriteResult {
  const result: WriteResult = { written: [], skipped: [], backedUp: [] };

  for (const pc of configs) {
    const configDir = path.join(scan.pluginsPath, pc.pluginId);
    const configFile = path.join(configDir, 'config.json');

    const writeResult = writeJsonAtomic(configFile, pc.config, opts);

    if (writeResult.skipped) {
      result.skipped.push(pc.pluginId);
    } else if (writeResult.written) {
      result.written.push(pc.pluginId);
    }
  }

  return result;
}

/**
 * Deep-merge two objects. Source values overwrite target values,
 * but nested objects are recursively merged (not replaced).
 * Arrays are NOT merged — source replaces target.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Update openclaw.json with new plugin entries.
 * Creates backup, preserves existing entries, adds new ones.
 */
export function updateOpenClawConfig(
  scan: ScanResult,
  plan: InstallPlan,
  opts: WriteOptions,
): ConfigUpdateResult {
  const result: ConfigUpdateResult = {
    updated: false,
    backedUp: false,
    addedEntries: [],
    addedAllow: [],
  };

  // Determine which plugin IDs to add
  const pluginIds = plan.toInstall.map(p => p.id);
  // Also include plugins that need configuration only (already installed but may need entries)
  const allIds = new Set(pluginIds);
  for (const pc of plan.toConfigure) {
    allIds.add(pc.pluginId);
  }

  if (allIds.size === 0) return result;

  const config = { ...scan.config };

  // Ensure plugins section exists
  if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
  }

  const plugins = config.plugins as {
    entries?: Record<string, unknown>;
    allow?: string[];
    [key: string]: unknown;
  };

  // Ensure sub-sections exist
  if (!plugins.entries || typeof plugins.entries !== 'object') {
    plugins.entries = {};
  }
  if (!Array.isArray(plugins.allow)) {
    plugins.allow = [];
  }

  // Add new entries (don't overwrite existing)
  for (const id of allIds) {
    if (!(id in plugins.entries)) {
      plugins.entries[id] = { enabled: true };
      result.addedEntries.push(id);
    }
  }

  // Add to allow list (don't duplicate)
  const allowSet = new Set(plugins.allow);
  for (const id of allIds) {
    if (!allowSet.has(id)) {
      plugins.allow.push(id);
      result.addedAllow.push(id);
    }
  }

  // Skip if nothing to add
  if (result.addedEntries.length === 0 && result.addedAllow.length === 0) {
    return result;
  }

  // Create backup
  if (!opts.dryRun) {
    const bakPath = createBackup(scan.configPath, opts);
    if (bakPath) {
      result.backedUp = true;
      result.backupPath = bakPath;
    }
  } else {
    result.backedUp = true;
    result.backupPath = `${scan.configPath}.bak`;
  }

  // Write updated config
  if (!opts.dryRun) {
    const tmpPath = `${scan.configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, scan.configPath);
  }

  result.updated = true;
  return result;
}

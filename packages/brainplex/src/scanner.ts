/**
 * Scanner module — environment detection, config discovery, agent extraction.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ScanOutcome, ScanResult, OpenClawConfig } from './types.js';

const MIN_NODE_MAJOR = 22;

/**
 * Parse JSON with JSON5-like tolerance (strip comments, trailing commas).
 */
export function parseConfig(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')            // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')   // multi-line comments
      .replace(/,\s*([}\]])/g, '$1');     // trailing commas
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
}

/**
 * Walk up from startDir to find openclaw.json.
 */
export function findConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    // Check openclaw.json directly
    const direct = path.join(dir, 'openclaw.json');
    if (fs.existsSync(direct)) return direct;

    // Check .openclaw/openclaw.json
    const nested = path.join(dir, '.openclaw', 'openclaw.json');
    if (fs.existsSync(nested)) return nested;

    // Reached filesystem root
    if (dir === root) break;
    dir = path.dirname(dir);
  }

  // Final fallback: ~/.openclaw/openclaw.json
  const homeFallback = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (fs.existsSync(homeFallback)) return homeFallback;

  return null;
}

/**
 * Extract agent names from various openclaw.json formats.
 */
export function extractAgents(config: OpenClawConfig): string[] {
  const agents = config.agents;
  if (!agents) return [];

  // Format 1: flat agents array — [ { id: "main" }, { name: "forge" }, ... ]
  if (Array.isArray(agents)) {
    return extractAgentNames(agents);
  }

  // Format 2: agents.list array (OpenClaw standard format)
  if (typeof agents === 'object' && 'list' in agents) {
    const list = (agents as { list: unknown }).list;
    if (Array.isArray(list)) {
      return extractAgentNames(list);
    }
  }

  // Format 3: agents.definitions array
  if (typeof agents === 'object' && 'definitions' in agents) {
    const defs = (agents as { definitions: unknown }).definitions;
    if (Array.isArray(defs)) {
      return extractAgentNames(defs);
    }
  }

  // Format 4: agents as object with named keys
  if (typeof agents === 'object' && !Array.isArray(agents)) {
    const metaKeys = new Set(['definitions', 'defaults', 'list']);
    return Object.keys(agents as Record<string, unknown>)
      .filter(k => !metaKeys.has(k));
  }

  return [];
}

/**
 * Extract agent names from an array of agent objects.
 * Supports both { id: "name" } and { name: "name" } formats.
 */
function extractAgentNames(agents: unknown[]): string[] {
  return agents
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map(a => {
      if (typeof a['id'] === 'string') return a['id'];
      if (typeof a['name'] === 'string') return a['name'];
      return null;
    })
    .filter((n): n is string => n !== null);
}

/**
 * Detect already-installed plugins from config and filesystem.
 */
export function detectInstalledPlugins(
  config: OpenClawConfig,
  extensionsPath: string,
): Set<string> {
  const installed = new Set<string>();

  const plugins = config.plugins;
  if (plugins && typeof plugins === 'object') {
    // Check plugins.entries
    if (plugins.entries && typeof plugins.entries === 'object') {
      for (const id of Object.keys(plugins.entries)) {
        installed.add(id);
      }
    }

    // Check plugins.allow
    if (Array.isArray(plugins.allow)) {
      for (const id of plugins.allow) {
        if (typeof id === 'string') installed.add(id);
      }
    }

    // Check plugins.installs
    if (plugins.installs && typeof plugins.installs === 'object') {
      for (const id of Object.keys(plugins.installs)) {
        installed.add(id);
      }
    }
  }

  // Check filesystem
  if (fs.existsSync(extensionsPath)) {
    try {
      const dirs = fs.readdirSync(extensionsPath, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory()) installed.add(d.name);
      }
    } catch {
      // Ignore read errors
    }
  }

  return installed;
}

/**
 * Detect already-configured plugins (have config.json).
 */
export function detectConfiguredPlugins(pluginsPath: string): Set<string> {
  const configured = new Set<string>();

  if (!fs.existsSync(pluginsPath)) return configured;

  try {
    const dirs = fs.readdirSync(pluginsPath, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory()) {
        const configFile = path.join(pluginsPath, d.name, 'config.json');
        if (fs.existsSync(configFile)) configured.add(d.name);
      }
    }
  } catch {
    // Ignore read errors
  }

  return configured;
}

/**
 * Check Node.js version meets minimum.
 */
export function checkNodeVersion(): { ok: boolean; version: string } {
  const version = process.version; // e.g., "v22.22.0"
  const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
  return { ok: major >= MIN_NODE_MAJOR, version };
}

/**
 * Main scanner entry point.
 */
export function scan(configPathOverride?: string): ScanOutcome {
  // Check Node.js version
  const nodeCheck = checkNodeVersion();
  if (!nodeCheck.ok) {
    return {
      ok: false,
      error: {
        code: 'NODE_VERSION',
        message: `Node.js >= ${MIN_NODE_MAJOR} required, found ${nodeCheck.version}`,
      },
    };
  }

  // Find config
  let configPath: string | null;
  if (configPathOverride) {
    configPath = path.resolve(configPathOverride);
    if (!fs.existsSync(configPath)) {
      return {
        ok: false,
        error: {
          code: 'NO_CONFIG',
          message: `Config not found at specified path: ${configPath}`,
        },
      };
    }
  } else {
    configPath = findConfig(process.cwd());
  }

  if (!configPath) {
    return {
      ok: false,
      error: {
        code: 'NO_CONFIG',
        message: 'No openclaw.json found. Run in a directory with openclaw.json or use --config.',
      },
    };
  }

  // Parse config
  let rawContent: string;
  let config: OpenClawConfig;
  try {
    rawContent = fs.readFileSync(configPath, 'utf-8');
    config = parseConfig(rawContent) as OpenClawConfig;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'PARSE_ERROR',
        message: `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Derive paths
  const configDir = path.dirname(configPath);
  // If config is under .openclaw/, use that as workspace. Otherwise use ~/.openclaw/
  const workspacePath = configDir.endsWith('.openclaw')
    ? configDir
    : path.join(os.homedir(), '.openclaw');
  const pluginsPath = path.join(workspacePath, 'plugins');
  const extensionsPath = path.join(workspacePath, 'extensions');

  // Extract data
  const agents = extractAgents(config);
  const installedPlugins = detectInstalledPlugins(config, extensionsPath);
  const configuredPlugins = detectConfiguredPlugins(pluginsPath);

  const result: ScanResult = {
    configPath,
    config,
    rawContent,
    agents,
    workspacePath,
    pluginsPath,
    extensionsPath,
    installedPlugins,
    configuredPlugins,
    nodeVersion: nodeCheck.version,
  };

  return { ok: true, result };
}

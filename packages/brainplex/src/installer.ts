/**
 * Installer module — plugin installation + install planning.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  InstallPlan,
  InstallResult,
  InstallResultEntry,
  InstallOptions,
  PluginSpec,
  PluginConfig,
  ScanResult,
} from './types.js';

/**
 * Core plugin bundle (always installed).
 */
export const CORE_PLUGINS: PluginSpec[] = [
  { id: 'openclaw-governance', npmPackage: '@vainplex/openclaw-governance' },
  { id: 'openclaw-cortex', npmPackage: '@vainplex/openclaw-cortex' },
  { id: 'openclaw-membrane', npmPackage: '@vainplex/openclaw-membrane' },
  { id: 'openclaw-leuko', npmPackage: '@vainplex/openclaw-leuko' },
];

/**
 * Optional plugins (--full flag).
 */
export const OPTIONAL_PLUGINS: PluginSpec[] = [
  { id: 'openclaw-knowledge-engine', npmPackage: '@vainplex/openclaw-knowledge-engine' },
];

/**
 * Check if the openclaw CLI is available on PATH.
 */
export function hasOpenClawCli(): boolean {
  try {
    execFileSync('which', ['openclaw'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Plan which plugins need installation and configuration.
 */
export function planInstallation(
  scan: ScanResult,
  configs: PluginConfig[],
  opts: { full: boolean },
): InstallPlan {
  const plugins = [...CORE_PLUGINS];
  if (opts.full) {
    plugins.push(...OPTIONAL_PLUGINS);
  }

  const plan: InstallPlan = {
    toInstall: [],
    toSkip: [],
    toConfigure: [],
    toSkipConfig: [],
  };

  for (const plugin of plugins) {
    // Check if already installed
    if (scan.installedPlugins.has(plugin.id)) {
      plan.toSkip.push({ id: plugin.id, reason: 'already_installed' });
    } else {
      plan.toInstall.push(plugin);
    }

    // Check if needs configuration
    const config = configs.find(c => c.pluginId === plugin.id);
    if (config) {
      if (scan.configuredPlugins.has(plugin.id)) {
        plan.toSkipConfig.push({ id: plugin.id, reason: 'already_configured' });
      } else {
        plan.toConfigure.push(config);
      }
    }
  }

  return plan;
}

/**
 * Execute plugin installations.
 */
export function executeInstallation(
  plan: InstallPlan,
  opts: InstallOptions & { workspacePath?: string },
): InstallResult {
  const result: InstallResult = { installed: [], failed: [] };

  if (opts.dryRun || plan.toInstall.length === 0) {
    return result;
  }

  const useOpenClaw = hasOpenClawCli();

  for (const plugin of plan.toInstall) {
    const entry = installPlugin(plugin, useOpenClaw, opts.verbose, opts.workspacePath);
    if (entry.success) {
      result.installed.push(entry);
    } else {
      result.failed.push(entry);
    }
  }

  return result;
}

/**
 * Install a single plugin.
 */
function installPlugin(
  plugin: PluginSpec,
  useOpenClaw: boolean,
  verbose: boolean,
  workspacePath?: string,
): InstallResultEntry {
  try {
    const stdio = verbose ? 'inherit' as const : 'pipe' as const;
    const timeout = 120_000; // 2 minute timeout per plugin

    let output: string;
    if (useOpenClaw) {
      output = execFileSync('openclaw', ['plugins', 'install', plugin.npmPackage], {
        encoding: 'utf-8',
        stdio,
        timeout,
      }) ?? '';
    } else {
      // npm 10.x has a bug ("Tracker idealTree already exists") when
      // no package.json exists in cwd (common in Docker/npx scenarios).
      // Fix: create a temp workspace with package.json, install there,
      // then copy the installed package to the extensions directory.
      const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainplex-install-'));
      fs.writeFileSync(
        path.join(installDir, 'package.json'),
        '{"name":"brainplex-install","private":true}',
      );

      try {
        output = execFileSync('npm', [
          'install',
          '--no-package-lock',
          plugin.npmPackage,
        ], {
          encoding: 'utf-8',
          stdio,
          timeout,
          cwd: installDir,
        }) ?? '';

        // Copy installed package to extensions dir
        const ws = workspacePath ?? path.join(os.homedir(), '.openclaw');
        const pkgParts = plugin.npmPackage.startsWith('@')
          ? plugin.npmPackage.split('/')
          : [plugin.npmPackage];
        const srcModules = path.join(installDir, 'node_modules', ...pkgParts);
        if (fs.existsSync(srcModules)) {
          const extDir = path.join(ws, 'extensions', plugin.id);
          fs.mkdirSync(path.dirname(extDir), { recursive: true });
          if (!fs.existsSync(extDir)) {
            fs.cpSync(srcModules, extDir, { recursive: true });
          }
        }
      } finally {
        try { fs.rmSync(installDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }

    // Try to extract version from npm output
    const version = extractVersion(output, plugin.npmPackage);

    return {
      plugin,
      success: true,
      version,
    };
  } catch (err) {
    return {
      plugin,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Try to extract installed version from npm output.
 */
function extractVersion(output: string, _npmPackage: string): string | undefined {
  // npm output like: "added 1 package..." or "+ @vainplex/openclaw-governance@0.8.6"
  const match = /@[\w/-]+@(\d+\.\d+\.\d+)/g.exec(output);
  return match?.[1] ?? undefined;
}

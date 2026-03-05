/**
 * CLI orchestrator — argument parsing and 10-step flow.
 */

import type { CliOptions } from './types.js';
import { scan } from './scanner.js';
import { generateConfigs, detectTimezone } from './configurator.js';
import { planInstallation, executeInstallation } from './installer.js';
import { writeConfigs, updateOpenClawConfig } from './writer.js';
import * as out from './output.js';

const VERSION = '0.2.1';

/**
 * Parse CLI arguments. Hand-rolled, zero dependencies.
 */
export function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    command: 'init',
    full: false,
    dryRun: false,
    noColor: false,
    verbose: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case 'init':
        opts.command = 'init';
        break;
      case '--full':
        opts.full = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--config':
        opts.configPath = args[++i];
        break;
      case '--no-color':
        opts.noColor = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      default:
        if (arg?.startsWith('-')) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(1);
        }
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
🧠 Brainplex — OpenClaw Plugin Suite Setup

Usage:
  brainplex init [options]

Options:
  --full          Include optional plugins (knowledge-engine)
  --dry-run       Preview actions without making changes
  --config <path> Path to openclaw.json (default: auto-detect)
  --no-color      Disable ANSI color output
  --verbose       Show npm install output
  --help, -h      Show this help
  --version, -v   Show version
`);
}

function printVersion(): void {
  console.log(`brainplex v${VERSION}`);
}

/**
 * Main CLI entry point.
 */
export async function main(args: string[]): Promise<void> {
  // 1. Parse arguments
  const opts = parseArgs(args);

  if (opts.noColor) {
    out.setNoColor(true);
  }

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.version) {
    printVersion();
    return;
  }

  // 2. Print header
  out.header(VERSION);

  if (opts.dryRun) {
    console.log(out.yellow('  [DRY RUN] No changes will be made.\n'));
  }

  // 3. Scan environment
  out.sectionHeader('🔍', 'Scanning environment...');
  const scanResult = scan(opts.configPath);

  if (!scanResult.ok) {
    out.fail(scanResult.error.message);
    if (scanResult.error.code === 'NO_CONFIG') {
      out.blank();
      console.log('   Run this command in a directory with openclaw.json,');
      console.log('   or specify the path: brainplex init --config /path/to/openclaw.json');
    }
    process.exit(1);
  }

  const sr = scanResult.result;

  out.success(`Found openclaw.json at ${sr.configPath}`);
  if (sr.agents.length > 0) {
    out.success(`Detected ${sr.agents.length} agents: ${sr.agents.join(', ')}`);
  } else {
    out.warn('No agents detected in config');
  }
  out.success(`Workspace: ${sr.workspacePath}`);
  out.success(`Node.js ${sr.nodeVersion}`);
  out.blank();

  // 4. Generate configs
  const timezone = detectTimezone();
  const configs = generateConfigs({
    agents: sr.agents,
    timezone,
    full: opts.full,
  });

  // 5. Plan installation
  const plan = planInstallation(sr, configs, { full: opts.full });

  // 6. Execute installation
  out.sectionHeader('📦', 'Installing plugins...');

  if (plan.toInstall.length === 0 && plan.toSkip.length > 0) {
    out.warn('All plugins already installed');
  }

  // Print skipped plugins
  for (const skip of plan.toSkip) {
    out.warn(`${skip.id} — already installed, skipping`);
  }

  if (!opts.dryRun) {
    const installResult = executeInstallation(plan, {
      verbose: opts.verbose,
      dryRun: opts.dryRun,
      workspacePath: sr.workspacePath,
    });

    for (const entry of installResult.installed) {
      const version = entry.version ? `@${entry.version}` : '';
      out.success(`${entry.plugin.npmPackage}${version}`);
    }

    for (const entry of installResult.failed) {
      out.fail(`${entry.plugin.npmPackage} — ${entry.error ?? 'unknown error'}`);
    }

    // Exit code 2: all plugin installs failed
    if (plan.toInstall.length > 0 && installResult.installed.length === 0 && installResult.failed.length > 0) {
      out.blank();
      out.fail('All plugin installations failed.');
      process.exit(2);
    }
  } else {
    for (const plugin of plan.toInstall) {
      out.success(`${plugin.npmPackage} ${out.dim('(dry run)')}`);
    }
  }

  out.blank();

  // 7. Write configs
  out.sectionHeader('⚙️', 'Configuring plugins...');

  const configResult = writeConfigs(configs, sr, { dryRun: opts.dryRun });

  for (const id of configResult.written) {
    out.success(`${id} — config.json written`);

    // Print details for governance
    if (id === 'openclaw-governance') {
      const govConfig = configs.find(c => c.pluginId === 'openclaw-governance');
      if (govConfig) {
        const trust = govConfig.config['trust'] as { defaults?: Record<string, number> } | undefined;
        if (trust?.defaults) {
          const trustStr = Object.entries(trust.defaults)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          out.info(`Trust: ${trustStr}`);
        }
        out.info(`Night mode: 23:00–06:00 (${timezone})`);
      }
    }
  }

  for (const id of configResult.skipped) {
    out.warn(`${id} — config.json exists, skipping`);
  }

  // Print skipped configs from plan
  for (const skip of plan.toSkipConfig) {
    if (!configResult.skipped.includes(skip.id)) {
      out.warn(`${skip.id} — config.json exists, skipping`);
    }
  }

  out.blank();

  // 8. Update openclaw.json
  const updateResult = updateOpenClawConfig(sr, plan, { dryRun: opts.dryRun });

  if (updateResult.updated) {
    if (updateResult.backedUp) {
      out.success(`openclaw.json updated (backup: ${updateResult.backupPath ?? 'openclaw.json.bak'})`);
    } else {
      out.success('openclaw.json updated');
    }
  } else if (plan.toInstall.length === 0 && plan.toConfigure.length === 0) {
    out.success('openclaw.json — no changes needed');
  }

  // 9. Summary
  out.separator();

  const installedCount = opts.dryRun ? plan.toInstall.length : plan.toInstall.length;
  const configuredCount = configResult.written.length;
  const skippedCount = plan.toSkip.length + configResult.skipped.length;

  if (installedCount === 0 && configuredCount === 0) {
    out.done('Everything is already set up!');
  } else {
    const parts: string[] = [];
    if (installedCount > 0) parts.push(`${installedCount} plugins installed`);
    if (configuredCount > 0) parts.push(`${configuredCount} configured`);
    if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
    out.done(`Done! ${parts.join(', ')}.`);
  }

  // 10. Restart hint
  if (installedCount > 0 || configuredCount > 0) {
    out.hint('Restart your gateway to activate:');
    console.log('   openclaw gateway restart');
  }

  out.blank();
}

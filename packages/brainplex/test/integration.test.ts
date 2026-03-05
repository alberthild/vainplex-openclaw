import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scan } from '../src/scanner.js';
import { generateConfigs, detectTimezone } from '../src/configurator.js';
import { planInstallation } from '../src/installer.js';
import { writeConfigs, updateOpenClawConfig } from '../src/writer.js';
import { parseArgs } from '../src/cli.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainplex-int-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── CLI Arg Parsing ────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses init command', () => {
    const opts = parseArgs(['init']);
    expect(opts.command).toBe('init');
  });

  it('parses --full flag', () => {
    const opts = parseArgs(['init', '--full']);
    expect(opts.full).toBe(true);
  });

  it('parses --dry-run flag', () => {
    const opts = parseArgs(['init', '--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('parses --config path', () => {
    const opts = parseArgs(['init', '--config', '/path/to/config.json']);
    expect(opts.configPath).toBe('/path/to/config.json');
  });

  it('parses --no-color flag', () => {
    const opts = parseArgs(['--no-color']);
    expect(opts.noColor).toBe(true);
  });

  it('parses --verbose flag', () => {
    const opts = parseArgs(['--verbose']);
    expect(opts.verbose).toBe(true);
  });

  it('parses --help flag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('parses --version flag', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('defaults to init command', () => {
    const opts = parseArgs([]);
    expect(opts.command).toBe('init');
  });
});

// ─── Integration: Full flow (dry-run) ──────────────────────────────

describe('integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full init flow: scan → plan → configure → update (dry-run)', () => {
    // Setup fake environment under .openclaw/ so scanner uses tmpDir as workspace
    const ocDir = path.join(tmpDir, '.openclaw');
    const configPath = path.join(ocDir, 'openclaw.json');
    writeJson(configPath, {
      agents: {
        definitions: [
          { name: 'main' },
          { name: 'forge' },
          { name: 'cerberus' },
        ],
      },
      plugins: {},
    });

    // Scan
    const scanResult = scan(configPath);
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;

    expect(scanResult.result.agents).toEqual(['main', 'forge', 'cerberus']);
    // Workspace should be our tmpDir/.openclaw, not the real ~/.openclaw
    expect(scanResult.result.workspacePath).toBe(ocDir);

    // Generate configs
    const configs = generateConfigs({
      agents: scanResult.result.agents,
      timezone: detectTimezone(),
      full: false,
    });
    expect(configs).toHaveLength(4);

    // Plan
    const plan = planInstallation(scanResult.result, configs, { full: false });
    expect(plan.toInstall).toHaveLength(4);
    expect(plan.toConfigure).toHaveLength(4);

    // Write configs (dry-run)
    const writeResult = writeConfigs(configs, scanResult.result, { dryRun: true });
    // In dry-run, writeJsonAtomic returns written: true but doesn't write
    expect(writeResult.written).toHaveLength(4);

    // Verify no files were actually created
    expect(fs.existsSync(path.join(scanResult.result.pluginsPath, 'openclaw-governance', 'config.json'))).toBe(false);
  });

  it('dry-run produces no file changes', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { agents: [], plugins: {} });

    const scanResult = scan(configPath);
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;

    const configs = generateConfigs({
      agents: [],
      timezone: 'UTC',
      full: false,
    });

    const plan = planInstallation(scanResult.result, configs, { full: false });

    // Write configs in dry-run
    writeConfigs(configs, scanResult.result, { dryRun: true });
    updateOpenClawConfig(scanResult.result, plan, { dryRun: true });

    // Original config unchanged
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(content).toEqual({ agents: [], plugins: {} });

    // No backup created
    expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
  });

  it('idempotent: running config writes twice produces same result', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { agents: [], plugins: { entries: {}, allow: [] } });

    const pluginsPath = path.join(tmpDir, 'plugins');

    const scanBase = {
      configPath,
      config: { agents: [], plugins: { entries: {}, allow: [] } },
      rawContent: '{}',
      agents: [] as string[],
      workspacePath: tmpDir,
      pluginsPath,
      extensionsPath: path.join(tmpDir, 'extensions'),
      installedPlugins: new Set<string>(),
      configuredPlugins: new Set<string>(),
      nodeVersion: 'v22.0.0',
    };

    const configs = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const plan = planInstallation(scanBase, configs, { full: false });

    // First write
    writeConfigs(configs, scanBase, { dryRun: false });
    updateOpenClawConfig(scanBase, plan, { dryRun: false });

    // Read state after first write
    const afterFirst = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Second write — configs now exist, should be skipped
    const scan2 = {
      ...scanBase,
      config: afterFirst,
      configuredPlugins: new Set([
        'openclaw-governance', 'openclaw-cortex',
        'openclaw-membrane', 'openclaw-leuko',
      ]),
      installedPlugins: new Set([
        'openclaw-governance', 'openclaw-cortex',
        'openclaw-membrane', 'openclaw-leuko',
      ]),
    };

    const configs2 = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const plan2 = planInstallation(scan2, configs2, { full: false });
    const writeResult2 = writeConfigs(configs2, scan2, { dryRun: false });
    const updateResult2 = updateOpenClawConfig(scan2, plan2, { dryRun: false });

    expect(writeResult2.written).toHaveLength(0);
    expect(writeResult2.skipped).toHaveLength(4);
    expect(updateResult2.updated).toBe(false);
  });

  it('handles empty agents list gracefully', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { plugins: {} });

    const scanResult = scan(configPath);
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;

    expect(scanResult.result.agents).toEqual([]);

    const configs = generateConfigs({
      agents: [],
      timezone: 'UTC',
      full: false,
    });

    // Governance config should still have wildcard trust
    const gov = configs.find(c => c.pluginId === 'openclaw-governance');
    const trust = gov!.config['trust'] as { defaults: Record<string, number> };
    expect(trust.defaults).toEqual({ '*': 10 });
  });

  it('handles already-fully-configured system', () => {
    // Put config inside a .openclaw dir so scanner picks up the correct workspace
    const wsDir = path.join(tmpDir, '.openclaw');
    fs.mkdirSync(wsDir, { recursive: true });
    const configPath = path.join(wsDir, 'openclaw.json');
    const pluginsPath = path.join(wsDir, 'plugins');

    // Create existing configs
    for (const id of ['openclaw-governance', 'openclaw-cortex', 'openclaw-membrane', 'openclaw-leuko']) {
      writeJson(path.join(pluginsPath, id, 'config.json'), { enabled: true });
    }

    writeJson(configPath, {
      plugins: {
        entries: {
          'openclaw-governance': { enabled: true },
          'openclaw-cortex': { enabled: true },
          'openclaw-membrane': { enabled: true },
          'openclaw-leuko': { enabled: true },
        },
        allow: ['openclaw-governance', 'openclaw-cortex', 'openclaw-membrane', 'openclaw-leuko'],
      },
    });

    const scanResult = scan(configPath);
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;

    // Verify scanner picked up the right workspace
    expect(scanResult.result.pluginsPath).toBe(pluginsPath);

    const configs = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const plan = planInstallation(scanResult.result, configs, { full: false });

    expect(plan.toInstall).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(4);

    const writeResult = writeConfigs(configs, scanResult.result, { dryRun: false });
    expect(writeResult.written).toHaveLength(0);
    expect(writeResult.skipped).toHaveLength(4);
  });
});

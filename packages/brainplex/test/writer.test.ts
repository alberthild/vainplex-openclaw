import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  writeJsonAtomic,
  createBackup,
  writeConfigs,
  deepMerge,
  updateOpenClawConfig,
} from '../src/writer.js';
import type { ScanResult, InstallPlan } from '../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainplex-writer-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── writeJsonAtomic ────────────────────────────────────────────────

describe('writeJsonAtomic', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes JSON with 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'test.json');
    writeJsonAtomic(filePath, { foo: 'bar' }, { dryRun: false });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n  "foo": "bar"\n}\n');
  });

  it('creates parent directories recursively', () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'test.json');
    writeJsonAtomic(filePath, { ok: true }, { dryRun: false });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('does not overwrite existing files', () => {
    const filePath = path.join(tmpDir, 'existing.json');
    writeJson(filePath, { original: true });

    const result = writeJsonAtomic(filePath, { new: true }, { dryRun: false });
    expect(result.skipped).toBe(true);
    expect(result.written).toBe(false);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({ original: true });
  });

  it('skips write in dry-run mode', () => {
    const filePath = path.join(tmpDir, 'dryrun.json');
    const result = writeJsonAtomic(filePath, { test: true }, { dryRun: true });
    expect(result.written).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('performs atomic write (no .tmp file left)', () => {
    const filePath = path.join(tmpDir, 'atomic.json');
    writeJsonAtomic(filePath, { ok: true }, { dryRun: false });
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// ─── createBackup ───────────────────────────────────────────────────

describe('createBackup', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates .bak copy of existing file', () => {
    const filePath = path.join(tmpDir, 'config.json');
    writeJson(filePath, { original: true });

    const bakPath = createBackup(filePath, { dryRun: false });
    expect(bakPath).toBe(`${filePath}.bak`);
    expect(fs.existsSync(bakPath!)).toBe(true);

    const content = JSON.parse(fs.readFileSync(bakPath!, 'utf-8'));
    expect(content).toEqual({ original: true });
  });

  it('returns null for non-existent file', () => {
    const result = createBackup(path.join(tmpDir, 'nope.json'), { dryRun: false });
    expect(result).toBeNull();
  });

  it('returns path in dry-run mode without creating file', () => {
    const filePath = path.join(tmpDir, 'config.json');
    const result = createBackup(filePath, { dryRun: true });
    expect(result).toBe(`${filePath}.bak`);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });
});

// ─── deepMerge ──────────────────────────────────────────────────────

describe('deepMerge', () => {
  it('merges flat objects', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('overwrites scalar values', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('deep-merges nested objects', () => {
    const target = { nested: { a: 1, b: 2 } };
    const source = { nested: { b: 3, c: 4 } };
    expect(deepMerge(target, source)).toEqual({ nested: { a: 1, b: 3, c: 4 } });
  });

  it('replaces arrays (does not merge)', () => {
    expect(deepMerge({ arr: [1, 2] }, { arr: [3, 4] })).toEqual({ arr: [3, 4] });
  });

  it('does not modify original objects', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge(target, source);
    expect(target).toEqual({ a: 1 });
    expect(source).toEqual({ b: 2 });
  });
});

// ─── writeConfigs ───────────────────────────────────────────────────

describe('writeConfigs', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes config files for each plugin', () => {
    const scan = {
      pluginsPath: tmpDir,
    } as ScanResult;

    const result = writeConfigs(
      [
        { pluginId: 'openclaw-governance', config: { enabled: true } },
        { pluginId: 'openclaw-cortex', config: { enabled: true } },
      ],
      scan,
      { dryRun: false },
    );

    expect(result.written).toEqual(['openclaw-governance', 'openclaw-cortex']);
    expect(result.skipped).toEqual([]);

    const govConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'openclaw-governance', 'config.json'), 'utf-8'),
    );
    expect(govConfig).toEqual({ enabled: true });
  });

  it('skips existing config files', () => {
    const pluginDir = path.join(tmpDir, 'openclaw-governance');
    fs.mkdirSync(pluginDir, { recursive: true });
    writeJson(path.join(pluginDir, 'config.json'), { existing: true });

    const scan = { pluginsPath: tmpDir } as ScanResult;

    const result = writeConfigs(
      [{ pluginId: 'openclaw-governance', config: { new: true } }],
      scan,
      { dryRun: false },
    );

    expect(result.skipped).toEqual(['openclaw-governance']);
    expect(result.written).toEqual([]);

    const content = JSON.parse(
      fs.readFileSync(path.join(pluginDir, 'config.json'), 'utf-8'),
    );
    expect(content).toEqual({ existing: true });
  });
});

// ─── updateOpenClawConfig ───────────────────────────────────────────

describe('updateOpenClawConfig', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('adds new entries to plugins.entries and plugins.allow', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { plugins: { entries: {}, allow: [] } });

    const scan: ScanResult = {
      configPath,
      config: { plugins: { entries: {}, allow: [] } },
      rawContent: '{}',
      agents: [],
      workspacePath: tmpDir,
      pluginsPath: path.join(tmpDir, 'plugins'),
      extensionsPath: path.join(tmpDir, 'extensions'),
      installedPlugins: new Set(),
      configuredPlugins: new Set(),
      nodeVersion: 'v22.0.0',
    };

    const plan: InstallPlan = {
      toInstall: [
        { id: 'openclaw-governance', npmPackage: '@vainplex/openclaw-governance' },
      ],
      toSkip: [],
      toConfigure: [],
      toSkipConfig: [],
    };

    const result = updateOpenClawConfig(scan, plan, { dryRun: false });

    expect(result.updated).toBe(true);
    expect(result.addedEntries).toContain('openclaw-governance');
    expect(result.addedAllow).toContain('openclaw-governance');

    const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(updatedConfig.plugins.entries['openclaw-governance']).toEqual({ enabled: true });
    expect(updatedConfig.plugins.allow).toContain('openclaw-governance');
  });

  it('preserves existing entries', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, {
      plugins: {
        entries: { 'existing-plugin': { enabled: true, custom: 'value' } },
        allow: ['existing-plugin'],
      },
    });

    const scan: ScanResult = {
      configPath,
      config: {
        plugins: {
          entries: { 'existing-plugin': { enabled: true, custom: 'value' } },
          allow: ['existing-plugin'],
        },
      },
      rawContent: '{}',
      agents: [],
      workspacePath: tmpDir,
      pluginsPath: path.join(tmpDir, 'plugins'),
      extensionsPath: path.join(tmpDir, 'extensions'),
      installedPlugins: new Set(),
      configuredPlugins: new Set(),
      nodeVersion: 'v22.0.0',
    };

    const plan: InstallPlan = {
      toInstall: [
        { id: 'openclaw-governance', npmPackage: '@vainplex/openclaw-governance' },
      ],
      toSkip: [],
      toConfigure: [],
      toSkipConfig: [],
    };

    const result = updateOpenClawConfig(scan, plan, { dryRun: false });

    const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(updatedConfig.plugins.entries['existing-plugin']).toEqual({
      enabled: true,
      custom: 'value',
    });
    expect(updatedConfig.plugins.allow).toContain('existing-plugin');
    expect(result.addedEntries).not.toContain('existing-plugin');
  });

  it('creates backup before modification', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { original: true });

    const scan: ScanResult = {
      configPath,
      config: { original: true },
      rawContent: '{}',
      agents: [],
      workspacePath: tmpDir,
      pluginsPath: path.join(tmpDir, 'plugins'),
      extensionsPath: path.join(tmpDir, 'extensions'),
      installedPlugins: new Set(),
      configuredPlugins: new Set(),
      nodeVersion: 'v22.0.0',
    };

    const plan: InstallPlan = {
      toInstall: [
        { id: 'openclaw-governance', npmPackage: '@vainplex/openclaw-governance' },
      ],
      toSkip: [],
      toConfigure: [],
      toSkipConfig: [],
    };

    const result = updateOpenClawConfig(scan, plan, { dryRun: false });

    expect(result.backedUp).toBe(true);
    expect(fs.existsSync(`${configPath}.bak`)).toBe(true);

    const backup = JSON.parse(fs.readFileSync(`${configPath}.bak`, 'utf-8'));
    expect(backup).toEqual({ original: true });
  });

  it('does not modify in dry-run mode', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { original: true });

    const scan: ScanResult = {
      configPath,
      config: { original: true },
      rawContent: '{}',
      agents: [],
      workspacePath: tmpDir,
      pluginsPath: path.join(tmpDir, 'plugins'),
      extensionsPath: path.join(tmpDir, 'extensions'),
      installedPlugins: new Set(),
      configuredPlugins: new Set(),
      nodeVersion: 'v22.0.0',
    };

    const plan: InstallPlan = {
      toInstall: [
        { id: 'openclaw-governance', npmPackage: '@vainplex/openclaw-governance' },
      ],
      toSkip: [],
      toConfigure: [],
      toSkipConfig: [],
    };

    updateOpenClawConfig(scan, plan, { dryRun: true });

    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(content).toEqual({ original: true });
  });

  it('returns no-op when nothing to add', () => {
    const result = updateOpenClawConfig(
      { configPath: '', config: {} } as ScanResult,
      { toInstall: [], toSkip: [], toConfigure: [], toSkipConfig: [] },
      { dryRun: false },
    );
    expect(result.updated).toBe(false);
  });
});

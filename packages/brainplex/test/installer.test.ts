import { describe, it, expect } from 'vitest';
import {
  CORE_PLUGINS,
  OPTIONAL_PLUGINS,
  planInstallation,
} from '../src/installer.js';
import type { ScanResult, PluginConfig } from '../src/types.js';

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    configPath: '/tmp/openclaw.json',
    config: {},
    rawContent: '{}',
    agents: [],
    workspacePath: '/tmp/.openclaw',
    pluginsPath: '/tmp/.openclaw/plugins',
    extensionsPath: '/tmp/.openclaw/extensions',
    installedPlugins: new Set(),
    configuredPlugins: new Set(),
    nodeVersion: 'v22.0.0',
    ...overrides,
  };
}

function makeConfigs(full: boolean): PluginConfig[] {
  const configs: PluginConfig[] = [
    { pluginId: 'openclaw-governance', config: { enabled: true } },
    { pluginId: 'openclaw-cortex', config: { enabled: true } },
    { pluginId: 'openclaw-membrane', config: { enabled: true } },
    { pluginId: 'openclaw-leuko', config: { enabled: true } },
  ];
  if (full) {
    configs.push({ pluginId: 'openclaw-knowledge-engine', config: { enabled: true } });
  }
  return configs;
}

// ─── Plugin constants ───────────────────────────────────────────────

describe('plugin constants', () => {
  it('has 4 core plugins', () => {
    expect(CORE_PLUGINS).toHaveLength(4);
    expect(CORE_PLUGINS.map(p => p.id)).toEqual([
      'openclaw-governance',
      'openclaw-cortex',
      'openclaw-membrane',
      'openclaw-leuko',
    ]);
  });

  it('has 1 optional plugin', () => {
    expect(OPTIONAL_PLUGINS).toHaveLength(1);
    expect(OPTIONAL_PLUGINS[0]!.id).toBe('openclaw-knowledge-engine');
  });

  it('excludes nats-eventstore and sitrep', () => {
    const allIds = [...CORE_PLUGINS, ...OPTIONAL_PLUGINS].map(p => p.id);
    expect(allIds).not.toContain('nats-eventstore');
    expect(allIds).not.toContain('openclaw-sitrep');
  });
});

// ─── planInstallation ───────────────────────────────────────────────

describe('planInstallation', () => {
  it('plans installation for all core plugins when none installed', () => {
    const scan = makeScanResult();
    const plan = planInstallation(scan, makeConfigs(false), { full: false });

    expect(plan.toInstall).toHaveLength(4);
    expect(plan.toSkip).toHaveLength(0);
  });

  it('skips already-installed plugins', () => {
    const scan = makeScanResult({
      installedPlugins: new Set(['openclaw-governance', 'openclaw-cortex']),
    });
    const plan = planInstallation(scan, makeConfigs(false), { full: false });

    expect(plan.toInstall).toHaveLength(2);
    expect(plan.toSkip).toHaveLength(2);
    expect(plan.toSkip.map(s => s.id)).toEqual(['openclaw-governance', 'openclaw-cortex']);
  });

  it('includes knowledge-engine only with --full flag', () => {
    const scan = makeScanResult();

    const planNoFull = planInstallation(scan, makeConfigs(false), { full: false });
    expect(planNoFull.toInstall.map(p => p.id)).not.toContain('openclaw-knowledge-engine');

    const planFull = planInstallation(scan, makeConfigs(true), { full: true });
    expect(planFull.toInstall.map(p => p.id)).toContain('openclaw-knowledge-engine');
  });

  it('skips already-configured plugins for config writing', () => {
    const scan = makeScanResult({
      configuredPlugins: new Set(['openclaw-governance']),
    });
    const plan = planInstallation(scan, makeConfigs(false), { full: false });

    expect(plan.toSkipConfig.map(s => s.id)).toContain('openclaw-governance');
    expect(plan.toConfigure.map(c => c.pluginId)).not.toContain('openclaw-governance');
  });

  it('handles fully installed + configured system', () => {
    const scan = makeScanResult({
      installedPlugins: new Set([
        'openclaw-governance', 'openclaw-cortex',
        'openclaw-membrane', 'openclaw-leuko',
      ]),
      configuredPlugins: new Set([
        'openclaw-governance', 'openclaw-cortex',
        'openclaw-membrane', 'openclaw-leuko',
      ]),
    });

    const plan = planInstallation(scan, makeConfigs(false), { full: false });

    expect(plan.toInstall).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(4);
    expect(plan.toConfigure).toHaveLength(0);
    expect(plan.toSkipConfig).toHaveLength(4);
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeTrustScore,
  buildTrustDefaults,
  detectTimezone,
  generateConfigs,
} from '../src/configurator.js';

// ─── computeTrustScore ──────────────────────────────────────────────

describe('computeTrustScore', () => {
  it('assigns 70 to agents with "admin" in name', () => {
    expect(computeTrustScore('admin')).toBe(70);
    expect(computeTrustScore('super-admin')).toBe(70);
  });

  it('assigns 70 to agents with "root" in name', () => {
    expect(computeTrustScore('root')).toBe(70);
    expect(computeTrustScore('root-agent')).toBe(70);
  });

  it('assigns 60 to agents with "main" in name', () => {
    expect(computeTrustScore('main')).toBe(60);
    expect(computeTrustScore('main-agent')).toBe(60);
  });

  it('assigns 50 to agents with "review" in name', () => {
    expect(computeTrustScore('review')).toBe(50);
    expect(computeTrustScore('code-review')).toBe(50);
  });

  it('assigns 50 to agents with "cerberus" in name', () => {
    expect(computeTrustScore('cerberus')).toBe(50);
  });

  it('assigns 45 to agents with "forge" in name', () => {
    expect(computeTrustScore('forge')).toBe(45);
    expect(computeTrustScore('forge-agent')).toBe(45);
  });

  it('assigns 45 to agents with "build" in name', () => {
    expect(computeTrustScore('build')).toBe(45);
    expect(computeTrustScore('builder')).toBe(45);
  });

  it('assigns 40 to other named agents', () => {
    expect(computeTrustScore('atlas')).toBe(40);
    expect(computeTrustScore('harbor')).toBe(40);
    expect(computeTrustScore('rex')).toBe(40);
  });

  it('assigns 10 to wildcard "*"', () => {
    expect(computeTrustScore('*')).toBe(10);
  });

  it('is case-insensitive', () => {
    expect(computeTrustScore('Main')).toBe(60);
    expect(computeTrustScore('ADMIN')).toBe(70);
    expect(computeTrustScore('Forge')).toBe(45);
    expect(computeTrustScore('CERBERUS')).toBe(50);
  });

  it('uses first match priority ("admin-forge" → 70, not 45)', () => {
    expect(computeTrustScore('admin-forge')).toBe(70);
    expect(computeTrustScore('admin-main')).toBe(70);
  });
});

// ─── buildTrustDefaults ─────────────────────────────────────────────

describe('buildTrustDefaults', () => {
  it('builds defaults for all agents plus wildcard', () => {
    const result = buildTrustDefaults(['main', 'forge', 'cerberus']);
    expect(result).toEqual({
      main: 60,
      forge: 45,
      cerberus: 50,
      '*': 10,
    });
  });

  it('always includes wildcard even with empty agents', () => {
    const result = buildTrustDefaults([]);
    expect(result).toEqual({ '*': 10 });
  });
});

// ─── detectTimezone ─────────────────────────────────────────────────

describe('detectTimezone', () => {
  it('returns a non-empty string', () => {
    const tz = detectTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ─── generateConfigs ────────────────────────────────────────────────

describe('generateConfigs', () => {
  it('generates 4 core plugin configs', () => {
    const configs = generateConfigs({
      agents: ['main', 'forge'],
      timezone: 'Europe/Berlin',
      full: false,
    });
    expect(configs).toHaveLength(4);
    expect(configs.map(c => c.pluginId)).toEqual([
      'openclaw-governance',
      'openclaw-cortex',
      'openclaw-membrane',
      'openclaw-leuko',
    ]);
  });

  it('includes knowledge-engine with --full', () => {
    const configs = generateConfigs({
      agents: ['main'],
      timezone: 'UTC',
      full: true,
    });
    expect(configs).toHaveLength(5);
    expect(configs[4]!.pluginId).toBe('openclaw-knowledge-engine');
  });

  it('generates valid governance config with trust defaults', () => {
    const configs = generateConfigs({
      agents: ['main', 'forge', 'cerberus'],
      timezone: 'Europe/Berlin',
      full: false,
    });

    const gov = configs.find(c => c.pluginId === 'openclaw-governance');
    expect(gov).toBeDefined();
    expect(gov!.config['enabled']).toBe(true);
    expect(gov!.config['timezone']).toBe('Europe/Berlin');

    const trust = gov!.config['trust'] as { defaults: Record<string, number> };
    expect(trust.defaults).toEqual({
      main: 60,
      forge: 45,
      cerberus: 50,
      '*': 10,
    });
  });

  it('generates valid cortex config', () => {
    const configs = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const cortex = configs.find(c => c.pluginId === 'openclaw-cortex');
    expect(cortex).toBeDefined();
    expect(cortex!.config['enabled']).toBe(true);
    const threadTracker = cortex!.config['threadTracker'] as { enabled: boolean };
    expect(threadTracker.enabled).toBe(true);
  });

  it('generates valid membrane config', () => {
    const configs = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const membrane = configs.find(c => c.pluginId === 'openclaw-membrane');
    expect(membrane).toBeDefined();
    expect(membrane!.config['enabled']).toBe(true);
    expect(membrane!.config['buffer_size']).toBe(10);
  });

  it('generates valid leuko config', () => {
    const configs = generateConfigs({ agents: [], timezone: 'UTC', full: false });
    const leuko = configs.find(c => c.pluginId === 'openclaw-leuko');
    expect(leuko).toBeDefined();
    expect(leuko!.config['enabled']).toBe(true);
  });

  it('includes all detected agents in trust defaults', () => {
    const configs = generateConfigs({
      agents: ['atlas', 'harbor', 'rex'],
      timezone: 'UTC',
      full: false,
    });
    const gov = configs.find(c => c.pluginId === 'openclaw-governance');
    const trust = gov!.config['trust'] as { defaults: Record<string, number> };
    expect(Object.keys(trust.defaults)).toEqual(
      expect.arrayContaining(['atlas', 'harbor', 'rex', '*']),
    );
  });

  it('uses detected timezone in governance config', () => {
    const configs = generateConfigs({
      agents: [],
      timezone: 'America/New_York',
      full: false,
    });
    const gov = configs.find(c => c.pluginId === 'openclaw-governance');
    expect(gov!.config['timezone']).toBe('America/New_York');
  });
});

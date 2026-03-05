/**
 * Configurator module — generate plugin configs with trust score heuristics.
 */

import type { PluginConfig, ConfiguratorOptions } from './types.js';

/**
 * Compute initial trust score for an agent based on naming conventions.
 * Pattern matching is case-insensitive. First match wins.
 */
export function computeTrustScore(agentName: string): number {
  const name = agentName.toLowerCase();
  if (name === '*') return 10;
  if (name.includes('admin') || name.includes('root')) return 70;
  if (name.includes('main')) return 60;
  if (name.includes('review') || name.includes('cerberus')) return 50;
  if (name.includes('forge') || name.includes('build')) return 45;
  return 40;
}

/**
 * Build trust defaults object from agent list.
 */
export function buildTrustDefaults(agents: string[]): Record<string, number> {
  const defaults: Record<string, number> = {};
  for (const agent of agents) {
    defaults[agent] = computeTrustScore(agent);
  }
  defaults['*'] = 10; // Always include wildcard
  return defaults;
}

/**
 * Detect system timezone using Intl API.
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Generate governance plugin config.
 */
function generateGovernanceConfig(agents: string[], timezone: string): Record<string, unknown> {
  return {
    enabled: true,
    timezone,
    failMode: 'open',
    trust: {
      enabled: true,
      defaults: buildTrustDefaults(agents),
      persistIntervalSeconds: 60,
      decay: {
        enabled: true,
        inactivityDays: 30,
        rate: 0.95,
      },
      sessionTrust: {
        enabled: true,
        seedFactor: 0.7,
        ceilingFactor: 1.2,
      },
    },
    nightMode: {
      enabled: true,
      start: '23:00',
      end: '06:00',
    },
    credentialGuard: {
      enabled: true,
    },
    productionSafeguard: {
      enabled: true,
    },
    rateLimiter: {
      enabled: true,
      maxPerMinute: 15,
    },
    builtinPolicies: {
      credentialGuard: true,
      productionSafeguard: true,
      nightMode: true,
    },
    audit: {
      enabled: true,
    },
    policies: [],
    responseGate: {
      enabled: true,
    },
  };
}

/**
 * Generate cortex plugin config.
 */
function generateCortexConfig(): Record<string, unknown> {
  return {
    enabled: true,
    threadTracker: {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    },
    decisionTracker: {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    },
    bootContext: {
      enabled: true,
      maxChars: 16000,
      onSessionStart: true,
      maxThreadsInBoot: 7,
      maxDecisionsInBoot: 10,
      decisionRecencyDays: 14,
    },
    preCompaction: {
      enabled: true,
      maxSnapshotMessages: 15,
    },
    narrative: {
      enabled: true,
    },
    patterns: {
      language: 'both',
    },
  };
}

/**
 * Generate membrane plugin config.
 */
function generateMembraneConfig(): Record<string, unknown> {
  return {
    enabled: true,
    buffer_size: 10,
    default_sensitivity: 'low',
    retrieve_enabled: true,
    retrieve_limit: 2,
    retrieve_min_salience: 0.1,
    retrieve_max_sensitivity: 'medium',
    retrieve_timeout_ms: 30000,
  };
}

/**
 * Generate leuko plugin config.
 */
function generateLeukoConfig(): Record<string, unknown> {
  return {
    enabled: true,
  };
}

/**
 * Generate knowledge-engine plugin config (--full only).
 */
function generateKnowledgeEngineConfig(): Record<string, unknown> {
  return {
    enabled: true,
    entityExtraction: false,
  };
}

/**
 * Generate all plugin configs based on options.
 */
export function generateConfigs(options: ConfiguratorOptions): PluginConfig[] {
  const configs: PluginConfig[] = [
    {
      pluginId: 'openclaw-governance',
      config: generateGovernanceConfig(options.agents, options.timezone),
    },
    {
      pluginId: 'openclaw-cortex',
      config: generateCortexConfig(),
    },
    {
      pluginId: 'openclaw-membrane',
      config: generateMembraneConfig(),
    },
    {
      pluginId: 'openclaw-leuko',
      config: generateLeukoConfig(),
    },
  ];

  if (options.full) {
    configs.push({
      pluginId: 'openclaw-knowledge-engine',
      config: generateKnowledgeEngineConfig(),
    });
  }

  return configs;
}

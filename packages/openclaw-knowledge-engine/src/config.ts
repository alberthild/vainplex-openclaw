// src/config.ts

import * as path from 'node:path';
import { KnowledgeConfig, Logger } from './types.js';

/**
 * The default configuration values for the plugin.
 * These are merged with the user-provided configuration.
 */
export const DEFAULT_CONFIG: Omit<KnowledgeConfig, 'workspace'> = {
  enabled: true,
  extraction: {
    regex: { enabled: true },
    llm: {
      enabled: true,
      model: 'mistral:7b',
      endpoint: 'http://localhost:11434/api/generate',
      batchSize: 10,
      cooldownMs: 30000,
    },
  },
  decay: {
    enabled: true,
    intervalHours: 24,
    rate: 0.02,
  },
  embeddings: {
    enabled: false,
    endpoint: 'http://localhost:8000/api/v1/collections/facts/add',
    collectionName: 'openclaw-facts',
    syncIntervalMinutes: 15,
  },
  storage: {
    maxEntities: 5000,
    maxFacts: 10000,
    writeDebounceMs: 15000,
  },
};

/** Type-safe deep merge: spread source into target for Record values. */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result as T;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Merge user config over defaults and resolve workspace. */
function mergeConfigDefaults(
  userConfig: Record<string, unknown>,
  openClawWorkspace: string
): KnowledgeConfig {
  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    userConfig
  );
  const ws = typeof userConfig.workspace === 'string' && userConfig.workspace
    ? userConfig.workspace
    : path.join(openClawWorkspace, 'knowledge-engine');
  return { ...merged, workspace: ws } as KnowledgeConfig;
}

/** Replace a leading tilde with the user's home directory. */
function resolveTilde(ws: string, logger: Logger, fallback: string): string {
  if (!ws.startsWith('~')) return ws;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) return path.join(homeDir, ws.slice(1));
  logger.warn('Could not resolve home directory for workspace path.');
  return fallback;
}

/**
 * Resolves and validates the plugin's configuration.
 *
 * @param userConfig The user-provided configuration from OpenClaw's pluginConfig.
 * @param logger A logger instance for logging warnings or errors.
 * @param openClawWorkspace The root workspace directory provided by OpenClaw.
 * @returns A fully resolved KnowledgeConfig, or null if validation fails.
 */
export function resolveConfig(
  userConfig: Record<string, unknown> | undefined | null,
  logger: Logger,
  openClawWorkspace?: string
): KnowledgeConfig | null {
  const ws = openClawWorkspace ?? process.cwd();
  const config = mergeConfigDefaults(userConfig ?? {}, ws);
  const fallbackWs = path.join(ws, 'knowledge-engine');
  config.workspace = resolveTilde(config.workspace, logger, fallbackWs);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    errors.forEach(e => logger.error(`Invalid configuration: ${e}`));
    return null;
  }

  logger.info('Knowledge Engine configuration resolved successfully.');
  return config;
}

// ── Validation ──────────────────────────────────────────────

function validateConfig(config: KnowledgeConfig): string[] {
  return [
    ...validateRoot(config),
    ...validateExtraction(config.extraction),
    ...validateDecay(config.decay),
    ...validateEmbeddings(config.embeddings),
    ...validateStorage(config.storage),
  ];
}

function validateRoot(c: KnowledgeConfig): string[] {
  const errs: string[] = [];
  if (typeof c.enabled !== 'boolean') errs.push('"enabled" must be a boolean.');
  if (typeof c.workspace !== 'string' || c.workspace.trim() === '') {
    errs.push('"workspace" must be a non-empty string.');
  }
  return errs;
}

function validateExtraction(ext: KnowledgeConfig['extraction']): string[] {
  const errs: string[] = [];
  if (ext.llm.enabled) {
    if (!isValidHttpUrl(ext.llm.endpoint)) {
      errs.push('"extraction.llm.endpoint" must be a valid HTTP/S URL.');
    }
    if ((ext.llm.batchSize ?? 0) < 1) {
      errs.push('"extraction.llm.batchSize" must be at least 1.');
    }
  }
  return errs;
}

function validateDecay(d: KnowledgeConfig['decay']): string[] {
  const errs: string[] = [];
  if (d.rate < 0 || d.rate > 1) errs.push('"decay.rate" must be between 0 and 1.');
  if ((d.intervalHours ?? 0) <= 0) errs.push('"decay.intervalHours" must be greater than 0.');
  return errs;
}

function validateEmbeddings(e: KnowledgeConfig['embeddings']): string[] {
  const errs: string[] = [];
  if (e.enabled && !isValidHttpUrl(e.endpoint)) {
    errs.push('"embeddings.endpoint" must be a valid HTTP/S URL.');
  }
  return errs;
}

function validateStorage(s: KnowledgeConfig['storage']): string[] {
  const errs: string[] = [];
  if ((s.writeDebounceMs ?? 0) < 0) {
    errs.push('"storage.writeDebounceMs" must be a non-negative number.');
  }
  return errs;
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

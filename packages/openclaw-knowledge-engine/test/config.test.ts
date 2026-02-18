// test/config.test.ts

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import { resolveConfig, DEFAULT_CONFIG } from '../src/config.js';
import type { Logger, KnowledgeConfig } from '../src/types.js';

const createMockLogger = (): Logger & { logs: { level: string; msg: string }[] } => {
  const logs: { level: string; msg:string }[] = [];
  return {
    logs,
    info: (msg: string) => logs.push({ level: 'info', msg }),
    warn: (msg: string) => logs.push({ level: 'warn', msg }),
    error: (msg: string) => logs.push({ level: 'error', msg }),
    debug: (msg: string) => logs.push({ level: 'debug', msg }),
  };
};

describe('resolveConfig', () => {
  let logger: ReturnType<typeof createMockLogger>;
  const openClawWorkspace = '/home/user/.clawd';

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('should return the default configuration when user config is empty', () => {
    const userConfig = {};
    const expectedConfig = {
      ...DEFAULT_CONFIG,
      workspace: path.join(openClawWorkspace, 'knowledge-engine'),
    };
    const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
    assert.deepStrictEqual(resolved, expectedConfig);
  });

  it('should merge user-provided values with defaults', () => {
    const userConfig = {
      extraction: {
        llm: {
          enabled: false,
          model: 'custom-model',
        },
      },
      storage: {
        writeDebounceMs: 5000,
      },
    };
    const resolved = resolveConfig(userConfig, logger, openClawWorkspace) as KnowledgeConfig;
    assert.strictEqual(resolved.extraction.llm.enabled, false);
    assert.strictEqual(resolved.extraction.llm.model, 'custom-model');
    assert.strictEqual(resolved.extraction.llm.batchSize, DEFAULT_CONFIG.extraction.llm.batchSize); // Should remain default
    assert.strictEqual(resolved.storage.writeDebounceMs, 5000);
    assert.strictEqual(resolved.decay.rate, DEFAULT_CONFIG.decay.rate); // Should remain default
  });

  it('should resolve the workspace path correctly', () => {
    const userConfig = { workspace: '/custom/path' };
    const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
    assert.strictEqual(resolved?.workspace, '/custom/path');
  });

  it('should resolve a tilde in the workspace path', () => {
    const homeDir = process.env.HOME || '/home/user';
    process.env.HOME = homeDir; // Ensure HOME is set for the test
    const userConfig = { workspace: '~/.my-knowledge' };
    const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
    assert.strictEqual(resolved?.workspace, path.join(homeDir, '.my-knowledge'));
  });

  it('should use the default workspace path if user path is not provided', () => {
    const userConfig = {};
    const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
    assert.strictEqual(resolved?.workspace, path.join(openClawWorkspace, 'knowledge-engine'));
  });

  describe('Validation', () => {
    it('should return null and log errors for an invalid LLM endpoint URL', () => {
      const userConfig = {
        extraction: {
          llm: {
            enabled: true,
            endpoint: 'not-a-valid-url',
          },
        },
      };
      const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
      assert.strictEqual(resolved, null);
      assert.strictEqual(logger.logs.length, 1);
      assert.strictEqual(logger.logs[0].level, 'error');
      assert.ok(logger.logs[0].msg.includes('"extraction.llm.endpoint" must be a valid HTTP/S URL'));
    });

    it('should return null and log errors for an invalid decay rate', () => {
      const userConfig = {
        decay: {
          rate: 1.5, // > 1
        },
      };
      const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
      assert.strictEqual(resolved, null);
      assert.strictEqual(logger.logs.length, 1);
      assert.ok(logger.logs[0].msg.includes('"decay.rate" must be between 0 and 1'));
    });

    it('should return null and log errors for a non-positive decay interval', () => {
        const userConfig = {
          decay: {
            intervalHours: 0,
          },
        };
        const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
        assert.strictEqual(resolved, null);
        assert.strictEqual(logger.logs.length, 1);
        assert.ok(logger.logs[0].msg.includes('"decay.intervalHours" must be greater than 0'));
    });

    it('should allow a valid configuration to pass', () => {
      const userConfig = {
        enabled: true,
        workspace: '/tmp/test',
        extraction: {
          llm: {
            endpoint: 'https://api.example.com',
          },
        },
        decay: {
          rate: 0.1,
        },
        embeddings: {
          enabled: true,
          endpoint: 'http://localhost:8000',
        },
      };
      const resolved = resolveConfig(userConfig, logger, openClawWorkspace);
      assert.ok(resolved);
      assert.strictEqual(logger.logs.filter(l => l.level === 'error').length, 0);
    });

    it('should handle deeply nested partial configurations', () => {
        const userConfig = {
          extraction: {
            regex: { enabled: false },
          },
        };
        const resolved = resolveConfig(userConfig, logger, openClawWorkspace) as KnowledgeConfig;
        assert.strictEqual(resolved.extraction.regex.enabled, false);
        assert.strictEqual(resolved.extraction.llm.enabled, DEFAULT_CONFIG.extraction.llm.enabled);
    });
  });
});

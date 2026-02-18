// test/hooks.test.ts

import { describe, it, beforeEach, mock, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { HookManager } from '../src/hooks.js';
import type { OpenClawPluginApi, KnowledgeConfig, HookEvent } from '../src/types.js';
import { FactStore } from '../src/fact-store.js';
import { Maintenance } from '../src/maintenance.js';

type TriggerFn = (event: string, eventData: HookEvent) => Promise<void>;

describe('HookManager', () => {
  let api: OpenClawPluginApi & { _trigger: TriggerFn; handlers: Map<string, (e: HookEvent, ctx: Record<string, unknown>) => void> };
  let config: KnowledgeConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      workspace: '/tmp',
      extraction: {
        regex: { enabled: true },
        llm: { enabled: true, model: 'm', endpoint: 'http://e.com', batchSize: 1, cooldownMs: 1 },
      },
      decay: { enabled: true, intervalHours: 1, rate: 0.1 },
      embeddings: { enabled: true, syncIntervalMinutes: 1, endpoint: 'http://e.com', collectionName: 'c' },
      storage: { maxEntities: 1, maxFacts: 1, writeDebounceMs: 0 },
    };
    const handlers = new Map<string, (e: HookEvent, ctx: Record<string, unknown>) => void>();
    api = {
      pluginConfig: {},
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      on: (event: string, handler: (e: HookEvent, ctx: Record<string, unknown>) => void) => { handlers.set(event, handler); },
      handlers,
      _trigger: async (event: string, eventData: HookEvent) => {
        const handler = handlers.get(event);
        if (handler) await handler(eventData, {});
      },
    };
  });

  afterEach(() => {
    mock.reset();
    mock.restoreAll();
  });

  it('should handle onSessionStart correctly', async () => {
    const loadMock = mock.method(FactStore.prototype, 'load', async () => {});
    const startMock = mock.method(Maintenance.prototype, 'start', () => {});

    const hookManager = new HookManager(api, config);
    hookManager.registerHooks();

    await api._trigger('session_start', {});

    assert.strictEqual(loadMock.mock.calls.length, 1);
    assert.strictEqual(startMock.mock.calls.length, 1);
  });

  it('should process incoming messages', async () => {
    mock.method(FactStore.prototype, 'load', async () => {});
    const addFactMock = mock.method(FactStore.prototype, 'addFact', () => ({}));

    const hookManager = new HookManager(api, config);
    hookManager.registerHooks();

    mock.method(hookManager as Record<string, unknown>, 'processLlmBatchWhenReady', async () => {
      const llmEnhancer = (hookManager as Record<string, unknown>).llmEnhancer as { sendBatch: () => Promise<{ entities: unknown[]; facts: unknown[] } | null> };
      const result = await llmEnhancer.sendBatch();
      if (result && result.facts.length > 0) {
        const factStore = (hookManager as Record<string, unknown>).factStore as FactStore;
        factStore.addFact(result.facts[0] as Parameters<FactStore['addFact']>[0]);
      }
    });

    mock.method(
      (hookManager as Record<string, unknown>).llmEnhancer as Record<string, unknown>,
      'sendBatch',
      async () => ({
        entities: [],
        facts: [{ subject: 'test', predicate: 'is-a', object: 'fact' }],
      })
    );

    const event: HookEvent = { content: 'This is a message.' };
    await api._trigger('message_received', event);

    assert.strictEqual(addFactMock.mock.calls.length, 1);
    assert.strictEqual(
      (addFactMock.mock.calls[0].arguments[0] as Record<string, unknown>).subject,
      'test'
    );
  });

  it('should register gateway_stop hook', () => {
    const hookManager = new HookManager(api, config);
    hookManager.registerHooks();
    assert.ok(api.handlers.has('gateway_stop'), 'gateway_stop hook should be registered');
  });

  it('should call maintenance.stop() on shutdown', async () => {
    mock.method(FactStore.prototype, 'load', async () => {});
    const stopMock = mock.method(Maintenance.prototype, 'stop', () => {});
    mock.method(Maintenance.prototype, 'start', () => {});

    const hookManager = new HookManager(api, config);
    hookManager.registerHooks();

    await api._trigger('session_start', {});
    await api._trigger('gateway_stop', {});

    assert.strictEqual(stopMock.mock.calls.length >= 1, true);
  });

  it('should not register hooks when disabled', () => {
    config.enabled = false;
    const hookManager = new HookManager(api, config);
    hookManager.registerHooks();
    assert.strictEqual(api.handlers.size, 0);
  });
});

// test/llm-enhancer.test.ts

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert';
import { LlmEnhancer } from '../src/llm-enhancer.js';
import type { KnowledgeConfig, Logger } from '../src/types.js';

const createMockLogger = (): Logger & { logs: { level: string; msg: string }[] } => {
  return {
    logs: [],
    info: function(msg) { this.logs.push({ level: 'info', msg }); },
    warn: function(msg) { this.logs.push({ level: 'warn', msg }); },
    error: function(msg) { this.logs.push({ level: 'error', msg }); },
    debug: function(msg) { this.logs.push({ level: 'debug', msg }); },
  };
};

const mockConfig: KnowledgeConfig['extraction']['llm'] = {
  enabled: true,
  model: 'test-model',
  endpoint: 'http://localhost:12345/api/test',
  batchSize: 3,
  cooldownMs: 100,
};

describe('LlmEnhancer', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let enhancer: LlmEnhancer;

  beforeEach(() => {
    logger = createMockLogger();
    enhancer = new LlmEnhancer(mockConfig, logger);
  });

  afterEach(() => {
    enhancer.clearTimers();
    mock.reset();
    mock.restoreAll();
  });

  const mockHttpRequest = (response: string): void => {
    // Mock the private makeHttpRequest method on the instance prototype
    mock.method(
      enhancer as unknown as Record<string, unknown>,
      'makeHttpRequest',
      async () => response
    );
  };

  it('should add items to the batch and respect batchSize', () => {
    const llmPayload = { entities: [], facts: [] };
    const llmResponse = { response: JSON.stringify(llmPayload) };
    mockHttpRequest(JSON.stringify(llmResponse));

    enhancer.addToBatch({ id: 'msg1', text: 'Hello' });
    enhancer.addToBatch({ id: 'msg2', text: 'World' });
    assert.strictEqual(logger.logs.filter(l => l.msg.includes('Sending immediately')).length, 0);

    enhancer.addToBatch({ id: 'msg3', text: 'Test' });
    assert.strictEqual(logger.logs.filter(l => l.msg.includes('Sending immediately')).length, 1);
  });

  it('should correctly parse a valid LLM response', async () => {
    const llmPayload = {
      entities: [{ type: 'person', value: 'Claude', importance: 0.9 }],
      facts: [{ subject: 'Claude', predicate: 'is-a', object: 'Person' }],
    };
    const llmResponse = { response: JSON.stringify(llmPayload) };
    mockHttpRequest(JSON.stringify(llmResponse));

    enhancer.addToBatch({ id: 'm1', text: 'The person is Claude.' });
    const result = await enhancer.sendBatch();

    assert.ok(result);
    assert.strictEqual(result.entities.length, 1);
    assert.strictEqual(result.entities[0].value, 'Claude');
    assert.strictEqual(result.facts.length, 1);
    assert.strictEqual(result.facts[0].subject, 'Claude');
  });

  it('should return null when the batch is empty', async () => {
    const result = await enhancer.sendBatch();
    assert.strictEqual(result, null);
  });

  it('should handle HTTP errors gracefully', async () => {
    mock.method(
      enhancer as unknown as Record<string, unknown>,
      'makeHttpRequest',
      async () => { throw new Error('HTTP request failed with status 500'); }
    );

    enhancer.addToBatch({ id: 'm1', text: 'Test' });
    const result = await enhancer.sendBatch();

    assert.strictEqual(result, null);
    assert.ok(logger.logs.some(l => l.level === 'error'));
  });

  it('should handle invalid JSON from LLM', async () => {
    mockHttpRequest('not json');

    enhancer.addToBatch({ id: 'm1', text: 'Test' });
    const result = await enhancer.sendBatch();

    assert.strictEqual(result, null);
    assert.ok(logger.logs.some(l => l.level === 'error'));
  });

  it('should clear the batch after sending', async () => {
    const llmPayload = { entities: [], facts: [] };
    mockHttpRequest(JSON.stringify({ response: JSON.stringify(llmPayload) }));

    enhancer.addToBatch({ id: 'm1', text: 'Test' });
    await enhancer.sendBatch();

    // Second send should return null (empty batch)
    const result = await enhancer.sendBatch();
    assert.strictEqual(result, null);
  });

  it('should handle LLM response with missing entities/facts gracefully', async () => {
    mockHttpRequest(JSON.stringify({ response: '{}' }));

    enhancer.addToBatch({ id: 'm1', text: 'Test' });
    const result = await enhancer.sendBatch();

    assert.ok(result);
    assert.strictEqual(result.entities.length, 0);
    assert.strictEqual(result.facts.length, 0);
  });
});

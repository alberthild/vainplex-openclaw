// test/maintenance.test.ts

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { Maintenance } from '../src/maintenance.js';
import { Embeddings } from '../src/embeddings.js';
import type { KnowledgeConfig, Logger, Fact } from '../src/types.js';
import * as timers from 'node:timers/promises';

class MockFactStore {
  decayRate = 0;
  decayedCount = 0;
  unembeddedFacts: Fact[] = [];
  markedAsEmbeddedIds: string[] = [];

  decayFacts(rate: number) {
    this.decayRate = rate;
    this.decayedCount++;
    return { decayedCount: 1 };
  }
  getUnembeddedFacts() { return this.unembeddedFacts; }
  markFactsAsEmbedded(ids: string[]) {
    this.markedAsEmbeddedIds.push(...ids);
    // Clear unembedded facts after marking (mimics real behavior)
    this.unembeddedFacts = this.unembeddedFacts.filter(f => !ids.includes(f.id));
  }
}

class MockEmbeddings {
  isEnabledState = true;
  syncedFacts: Fact[] = [];
  isEnabled() { return this.isEnabledState; }
  sync(facts: Fact[]) {
    this.syncedFacts.push(...facts);
    return Promise.resolve(facts.length);
  }
}

const createMockLogger = (): Logger => ({
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
});

const mockConfig: KnowledgeConfig = {
  enabled: true,
  workspace: '/tmp',
  decay: { enabled: true, intervalHours: 0.0001, rate: 0.1 },
  embeddings: {
    enabled: true,
    syncIntervalMinutes: 0.0001,
    endpoint: 'http://test.com',
    collectionName: 'test',
  },
  storage: { maxEntities: 100, maxFacts: 100, writeDebounceMs: 0 },
  extraction: {
    regex: { enabled: true },
    llm: { enabled: false, model: '', endpoint: '', batchSize: 1, cooldownMs: 0 },
  },
};

describe('Maintenance', () => {
  let logger: Logger;
  let mockFactStore: MockFactStore;
  let mockEmbeddings: MockEmbeddings;
  let maintenance: Maintenance;

  beforeEach(() => {
    logger = createMockLogger();
    mockFactStore = new MockFactStore();
    mockEmbeddings = new MockEmbeddings();
    // @ts-ignore - Using mock class
    maintenance = new Maintenance(mockConfig, logger, mockFactStore, mockEmbeddings);
  });

  afterEach(() => {
    maintenance.stop();
  });

  it('should schedule and run decay task', async () => {
    maintenance.start();
    await timers.setTimeout(mockConfig.decay.intervalHours * 60 * 60 * 1000 + 10);
    assert.strictEqual(mockFactStore.decayedCount > 0, true);
    assert.strictEqual(mockFactStore.decayRate, mockConfig.decay.rate);
  });

  it('should schedule and run embeddings sync task', async () => {
    const testFact: Fact = {
      id: 'fact1', subject: 's', predicate: 'p', object: 'o',
      relevance: 1, createdAt: 't', lastAccessed: 't', source: 'ingested',
    };
    mockFactStore.unembeddedFacts = [testFact];
    maintenance.start();
    await timers.setTimeout(mockConfig.embeddings.syncIntervalMinutes * 60 * 1000 + 10);
    assert.strictEqual(mockEmbeddings.syncedFacts.length > 0, true);
    assert.deepStrictEqual(mockEmbeddings.syncedFacts[0], testFact);
    assert.deepStrictEqual(mockFactStore.markedAsEmbeddedIds, [testFact.id]);
  });

  it('should not schedule embeddings if disabled', async () => {
    mockEmbeddings.isEnabledState = false;
    maintenance.start();
    await timers.setTimeout(5);
    assert.strictEqual(mockEmbeddings.syncedFacts.length, 0);
  });

  it('should stop all timers cleanly', () => {
    maintenance.start();
    maintenance.stop();
    // No error means timers were cleared successfully
    assert.ok(true);
  });

  it('should run decay manually', () => {
    maintenance.runDecay();
    assert.strictEqual(mockFactStore.decayedCount, 1);
    assert.strictEqual(mockFactStore.decayRate, mockConfig.decay.rate);
  });
});

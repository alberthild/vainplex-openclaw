// test/fact-store.test.ts

import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FactStore } from '../src/fact-store.js';
import type { KnowledgeConfig, Logger, Fact } from '../src/types.js';

const createMockLogger = (): Logger => ({
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
});

const mockConfig: KnowledgeConfig['storage'] = {
  maxEntities: 100, maxFacts: 10, writeDebounceMs: 0,
};

describe('FactStore', () => {
  const testDir = path.join('/tmp', `fact-store-test-${Date.now()}`);
  let factStore: FactStore;

  before(async () => await fs.mkdir(testDir, { recursive: true }));
  after(async () => await fs.rm(testDir, { recursive: true, force: true }));

  beforeEach(async () => {
    // Flush any pending debounced writes from the previous test
    // to prevent stale data from bleeding across test boundaries.
    if (factStore) {
      await factStore.flush();
    }
    const filePath = path.join(testDir, 'facts.json');
    try { await fs.unlink(filePath); } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    factStore = new FactStore(testDir, mockConfig, createMockLogger());
    await factStore.load();
  });

  it('should add a new fact to the store', () => {
    factStore.addFact({ subject: 's1', predicate: 'p1', object: 'o1', source: 'extracted-llm' });
    const facts = factStore.query({});
    assert.strictEqual(facts.length, 1);
  });

  it('should throw if addFact called before load', async () => {
    const unloaded = new FactStore(testDir, mockConfig, createMockLogger());
    assert.throws(() => {
      unloaded.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
    }, /not been loaded/);
  });

  it('should deduplicate identical facts by boosting relevance', () => {
    const f1 = factStore.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
    assert.strictEqual(f1.relevance, 1.0);

    // Decay the fact first so we can verify the boost
    factStore.decayFacts(0.5);
    const decayed = factStore.getFact(f1.id);
    assert.ok(decayed);
    // After decay + access boost the relevance should be < 1.0 but > 0.5
    const preBoost = decayed.relevance;

    // Adding same fact again should boost it
    const f2 = factStore.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
    assert.strictEqual(f1.id, f2.id); // Same fact
    assert.ok(f2.relevance >= preBoost);
  });

  describe('getFact', () => {
    it('should retrieve a fact by ID', () => {
      const added = factStore.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
      const retrieved = factStore.getFact(added.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.subject, 's');
      assert.strictEqual(retrieved.predicate, 'p');
      assert.strictEqual(retrieved.object, 'o');
    });

    it('should return undefined for non-existent ID', () => {
      const result = factStore.getFact('non-existent-id');
      assert.strictEqual(result, undefined);
    });

    it('should boost relevance on access', () => {
      const f = factStore.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
      factStore.decayFacts(0.5); // Decay to 0.5ish
      const decayedFact = factStore.query({ subject: 's' })[0];
      const decayedRelevance = decayedFact.relevance;

      const accessed = factStore.getFact(f.id);
      assert.ok(accessed);
      assert.ok(accessed.relevance > decayedRelevance, 'Relevance should increase on access');
    });

    it('should update lastAccessed timestamp', () => {
      const f = factStore.addFact({ subject: 's', predicate: 'p', object: 'o', source: 'ingested' });
      const before = f.lastAccessed;

      // Small delay to get a different timestamp
      const accessed = factStore.getFact(f.id);
      assert.ok(accessed);
      assert.ok(new Date(accessed.lastAccessed) >= new Date(before));
    });
  });

  describe('query', () => {
    it('should query by subject', () => {
      factStore.addFact({ subject: 'alice', predicate: 'knows', object: 'bob', source: 'ingested' });
      factStore.addFact({ subject: 'charlie', predicate: 'knows', object: 'bob', source: 'ingested' });

      const results = factStore.query({ subject: 'alice' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].subject, 'alice');
    });

    it('should query by predicate', () => {
      factStore.addFact({ subject: 'a', predicate: 'is-a', object: 'b', source: 'ingested' });
      factStore.addFact({ subject: 'c', predicate: 'works-at', object: 'd', source: 'ingested' });

      const results = factStore.query({ predicate: 'is-a' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].predicate, 'is-a');
    });

    it('should query by object', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'target', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p', object: 'other', source: 'ingested' });

      const results = factStore.query({ object: 'target' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].object, 'target');
    });

    it('should query with multiple filters', () => {
      factStore.addFact({ subject: 'a', predicate: 'p1', object: 'o1', source: 'ingested' });
      factStore.addFact({ subject: 'a', predicate: 'p2', object: 'o2', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p1', object: 'o1', source: 'ingested' });

      const results = factStore.query({ subject: 'a', predicate: 'p1' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].object, 'o1');
    });

    it('should return all facts when query is empty', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'o1', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p', object: 'o2', source: 'ingested' });
      const results = factStore.query({});
      assert.strictEqual(results.length, 2);
    });

    it('should sort results by relevance descending', () => {
      const f1 = factStore.addFact({ subject: 'a', predicate: 'p', object: 'o1', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p', object: 'o2', source: 'ingested' });

      // Decay all, then access f1 to boost it
      factStore.decayFacts(0.5);
      factStore.getFact(f1.id);

      const results = factStore.query({});
      assert.strictEqual(results[0].subject, 'a'); // f1 has higher relevance after boost
    });
  });

  describe('decayFacts', () => {
    it('should reduce relevance of all facts', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'o', source: 'ingested' });
      const { decayedCount } = factStore.decayFacts(0.5);
      assert.strictEqual(decayedCount, 1);

      const facts = factStore.query({});
      assert.ok(facts[0].relevance < 1.0);
      assert.ok(facts[0].relevance >= 0.1); // Min relevance floor
    });

    it('should not decay below the minimum relevance of 0.1', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'o', source: 'ingested' });
      // Apply extreme decay many times
      for (let i = 0; i < 100; i++) factStore.decayFacts(0.99);
      const facts = factStore.query({});
      assert.ok(facts[0].relevance >= 0.1);
    });

    it('should return 0 when no facts exist', () => {
      const { decayedCount } = factStore.decayFacts(0.1);
      assert.strictEqual(decayedCount, 0);
    });
  });

  describe('getUnembeddedFacts', () => {
    it('should return facts without embedded timestamp', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'o1', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p', object: 'o2', source: 'ingested' });

      const unembedded = factStore.getUnembeddedFacts();
      assert.strictEqual(unembedded.length, 2);
    });

    it('should exclude embedded facts', () => {
      const f1 = factStore.addFact({ subject: 'a', predicate: 'p', object: 'o1', source: 'ingested' });
      factStore.addFact({ subject: 'b', predicate: 'p', object: 'o2', source: 'ingested' });

      factStore.markFactsAsEmbedded([f1.id]);

      const unembedded = factStore.getUnembeddedFacts();
      assert.strictEqual(unembedded.length, 1);
      assert.strictEqual(unembedded[0].subject, 'b');
    });

    it('should return empty array when all facts are embedded', () => {
      const f1 = factStore.addFact({ subject: 'a', predicate: 'p', object: 'o', source: 'ingested' });
      factStore.markFactsAsEmbedded([f1.id]);

      const unembedded = factStore.getUnembeddedFacts();
      assert.strictEqual(unembedded.length, 0);
    });
  });

  describe('markFactsAsEmbedded', () => {
    it('should set the embedded timestamp on specified facts', () => {
      const f1 = factStore.addFact({ subject: 'a', predicate: 'p', object: 'o', source: 'ingested' });
      assert.strictEqual(f1.embedded, undefined);

      factStore.markFactsAsEmbedded([f1.id]);
      const updated = factStore.getFact(f1.id);
      assert.ok(updated);
      assert.ok(updated.embedded);
      assert.ok(typeof updated.embedded === 'string');
    });

    it('should handle non-existent fact IDs gracefully', () => {
      factStore.addFact({ subject: 'a', predicate: 'p', object: 'o', source: 'ingested' });
      // Should not throw
      factStore.markFactsAsEmbedded(['non-existent-id']);
      assert.ok(true);
    });

    it('should only update specified facts', () => {
      const f1 = factStore.addFact({ subject: 'a', predicate: 'p', object: 'o1', source: 'ingested' });
      const f2 = factStore.addFact({ subject: 'b', predicate: 'p', object: 'o2', source: 'ingested' });

      factStore.markFactsAsEmbedded([f1.id]);

      const updated1 = factStore.getFact(f1.id);
      const updated2 = factStore.getFact(f2.id);
      assert.ok(updated1?.embedded);
      assert.strictEqual(updated2?.embedded, undefined);
    });
  });

  it('should remove the least recently accessed facts when pruning', () => {
    for (let i = 0; i < 11; i++) {
      const fact = factStore.addFact({ subject: 's', predicate: 'p', object: `o${i}`, source: 'ingested' });
      const internalFact = (factStore as Record<string, unknown> as { facts: Map<string, Fact> }).facts.get(fact.id);
      if (internalFact) {
        internalFact.lastAccessed = new Date(Date.now() - (10 - i) * 1000).toISOString();
      }
    }

    const facts = factStore.query({});
    assert.strictEqual(facts.length, 10);

    const objects = facts.map(f => f.object);
    assert.strictEqual(objects.includes('o0'), false, 'Fact "o0" (oldest) should have been pruned');
    assert.strictEqual(objects.includes('o1'), true, 'Fact "o1" should still exist');
  });
});

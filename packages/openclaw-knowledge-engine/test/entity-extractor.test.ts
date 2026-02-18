// test/entity-extractor.test.ts

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { EntityExtractor } from '../src/entity-extractor.js';
import type { Entity, Logger } from '../src/types.js';

const createMockLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

describe('EntityExtractor', () => {
  let extractor: EntityExtractor;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    extractor = new EntityExtractor(logger);
  });

  describe('extract', () => {
    it('should extract a simple email entity', () => {
      const text = 'My email is test@example.com.';
      const entities = extractor.extract(text);
      assert.strictEqual(entities.length, 1);
      const entity = entities[0];
      assert.strictEqual(entity.type, 'email');
      assert.strictEqual(entity.value, 'test@example.com');
      assert.strictEqual(entity.id, 'email:test@example.com');
      assert.deepStrictEqual(entity.mentions, ['test@example.com']);
    });

    it('should extract multiple different entities', () => {
      const text = 'Contact Atlas via atlas@acme.com on 2026-02-17.';
      const entities = extractor.extract(text);
      assert.strictEqual(entities.length, 3); // Atlas (proper_noun), email, date
      
      const names = entities.map(e => e.value).sort();
      assert.deepStrictEqual(names, ['2026-02-17', 'Atlas', 'atlas@acme.com']);
    });

    it('should handle multiple mentions of the same entity', () => {
      const text = 'Project OpenClaw is great. I love OpenClaw!';
      const entities = extractor.extract(text);
      assert.strictEqual(entities.length, 1);
      const entity = entities[0];
      assert.strictEqual(entity.type, 'unknown'); // From proper_noun
      assert.strictEqual(entity.value, 'OpenClaw');
      assert.strictEqual(entity.count, 2);
      assert.deepStrictEqual(entity.mentions, ['OpenClaw']);
    });

    it('should correctly identify and canonicalize an organization', () => {
      const text = 'I work for Acme GmbH. It is a German company.';
      const entities = extractor.extract(text);
      const orgEntity = entities.find(e => e.type === 'organization');
      
      assert.ok(orgEntity, 'Organization entity should be found');
      assert.strictEqual(orgEntity.value, 'Acme'); // Canonicalized
      assert.strictEqual(orgEntity.id, 'organization:acme');
      assert.deepStrictEqual(orgEntity.mentions, ['Acme GmbH']);
    });

    it('should extract dates in various formats', () => {
        const text = 'Event dates: 2026-01-01, 02/03/2024, and 4. Mar 2025 is the German date.';
        const entities = extractor.extract(text);
        const dateEntities = entities.filter(e => e.type === 'date');
        assert.strictEqual(dateEntities.length, 3, 'Should find three distinct dates');

        const dateValues = dateEntities.map(e => e.value).sort();
        assert.deepStrictEqual(dateValues, ['02/03/2024', '2026-01-01', '4. Mar 2025']);
    });

    it('should return an empty array for text with no entities', () => {
        const text = 'this is a plain sentence.';
        const entities = extractor.extract(text);
        assert.strictEqual(entities.length, 0);
    });
  });

  describe('mergeEntities', () => {
    it('should merge two disjoint lists of entities', () => {
      const listA: Entity[] = [{ id: 'person:claude', type: 'person', value: 'Claude', count: 1, importance: 0.7, lastSeen: '2026-01-01', mentions: ['Claude'], source: ['regex'] }];
      const listB: Entity[] = [{ id: 'org:acme', type: 'organization', value: 'Acme', count: 1, importance: 0.8, lastSeen: '2026-01-01', mentions: ['Acme'], source: ['llm'] }];
      
      const merged = EntityExtractor.mergeEntities(listA, listB);
      assert.strictEqual(merged.length, 2);
    });

    it('should merge entities with the same ID', () => {
      const date = new Date().toISOString();
      const listA: Entity[] = [{ id: 'person:claude', type: 'person', value: 'Claude', count: 1, importance: 0.7, lastSeen: date, mentions: ['Claude'], source: ['regex'] }];
      const listB: Entity[] = [{ id: 'person:claude', type: 'person', value: 'Claude', count: 2, importance: 0.85, lastSeen: date, mentions: ["claude's", "Claude"], source: ['llm'] }];
      
      const merged = EntityExtractor.mergeEntities(listA, listB);
      assert.strictEqual(merged.length, 1);
      
      const entity = merged[0];
      assert.strictEqual(entity.id, 'person:claude');
      assert.strictEqual(entity.count, 3);
      assert.strictEqual(entity.importance, 0.85); // Takes the max importance
      assert.deepStrictEqual(entity.mentions.sort(), ["Claude", "claude's"].sort());
      assert.deepStrictEqual(entity.source.sort(), ['llm', 'regex'].sort());
    });

    it('should handle an empty list', () => {
      const listA: Entity[] = [{ id: 'person:claude', type: 'person', value: 'Claude', count: 1, importance: 0.7, lastSeen: '2026-01-01', mentions: ['Claude'], source: ['regex'] }];
      const mergedA = EntityExtractor.mergeEntities(listA, []);
      assert.deepStrictEqual(mergedA, listA);

      const mergedB = EntityExtractor.mergeEntities([], listA);
      assert.deepStrictEqual(mergedB, listA);

      const mergedC = EntityExtractor.mergeEntities([], []);
      assert.deepStrictEqual(mergedC, []);
    });
  });
});

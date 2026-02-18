// src/entity-extractor.ts

import { Entity, Logger } from './types.js';
import { REGEX_PATTERNS } from './patterns.js';

// A map to associate regex pattern names with entity types.
const PATTERN_TYPE_MAP: Record<string, Entity['type']> = {
  email: 'email',
  url: 'url',
  iso_date: 'date',
  common_date: 'date',
  german_date: 'date',
  english_date: 'date',
  proper_noun: 'unknown',
  product_name: 'product',
  organization_suffix: 'organization',
};

/**
 * Extracts entities from text using predefined regular expressions.
 */
export class EntityExtractor {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Extracts entities from a given text based on the regex patterns.
   * @param text The input text to process.
   * @returns An array of found entities.
   */
  public extract(text: string): Entity[] {
    const foundEntities: Map<string, Entity> = new Map();

    for (const key in REGEX_PATTERNS) {
      // Each access returns a fresh RegExp (via Proxy), avoiding /g state-bleed.
      const regex = REGEX_PATTERNS[key];
      if (!regex.global) {
        this.logger.warn(`Regex for "${key}" is not global. Skipping.`);
        continue;
      }
      const entityType = PATTERN_TYPE_MAP[key] || 'unknown';
      let match;
      while ((match = regex.exec(text)) !== null) {
        const value = match[0].trim();
        if (!value) continue;
        this.processMatch(key, value, entityType, foundEntities);
      }
    }

    return Array.from(foundEntities.values());
  }

  /**
   * Processes a single regex match and upserts it into the entity map.
   */
  private processMatch(
    _key: string,
    value: string,
    entityType: Entity['type'],
    entities: Map<string, Entity>
  ): void {
    const canonicalValue = this.canonicalize(value, entityType);
    const id = `${entityType}:${canonicalValue.toLowerCase().replace(/\s+/g, '-')}`;

    if (entities.has(id)) {
      const existing = entities.get(id)!;
      if (!existing.mentions.includes(value)) existing.mentions.push(value);
      existing.count++;
      if (!existing.source.includes('regex')) existing.source.push('regex');
    } else {
      entities.set(id, {
        id,
        type: entityType,
        value: canonicalValue,
        mentions: [value],
        count: 1,
        importance: this.calculateInitialImportance(entityType, value),
        lastSeen: new Date().toISOString(),
        source: ['regex'],
      });
    }
  }

  /**
   * Cleans and standardizes an entity value based on its type.
   */
  private canonicalize(value: string, type: Entity['type']): string {
    if (type === 'organization') {
      const suffixes = /,?\s?(?:Inc\.|LLC|Corp\.|GmbH|AG|Ltd\.)$/i;
      return value.replace(suffixes, '').trim();
    }
    return value.replace(/[.,!?;:]$/, '').trim();
  }

  /**
   * Calculates an initial importance score for an entity.
   */
  private calculateInitialImportance(type: Entity['type'], value: string): number {
    switch (type) {
      case 'organization': return 0.8;
      case 'person':       return 0.7;
      case 'product':      return 0.6;
      case 'location':     return 0.5;
      case 'date':
      case 'email':
      case 'url':          return 0.4;
      default:             return value.split(/\s|-/).length > 1 ? 0.5 : 0.3;
    }
  }

  /**
   * Merges two lists of entities by ID.
   */
  public static mergeEntities(listA: Entity[], listB: Entity[]): Entity[] {
    const merged: Map<string, Entity> = new Map();
    for (const e of listA) merged.set(e.id, { ...e });

    for (const entity of listB) {
      if (merged.has(entity.id)) {
        const ex = merged.get(entity.id)!;
        ex.count += entity.count;
        ex.mentions = [...new Set([...ex.mentions, ...entity.mentions])];
        ex.source = [...new Set([...ex.source, ...entity.source])];
        ex.lastSeen = new Date() > new Date(ex.lastSeen)
          ? new Date().toISOString() : ex.lastSeen;
        ex.importance = Math.max(ex.importance, entity.importance);
      } else {
        merged.set(entity.id, { ...entity });
      }
    }

    return Array.from(merged.values());
  }
}

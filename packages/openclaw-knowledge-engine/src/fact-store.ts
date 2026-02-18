// src/fact-store.ts

import { randomUUID } from 'node:crypto';
import { AtomicStorage } from './storage.js';
import type { Fact, FactsData, KnowledgeConfig, Logger } from './types.js';

/**
 * Manages an in-memory and on-disk store of structured facts.
 * Provides methods for loading, querying, modifying, and persisting facts.
 */
export class FactStore {
  private readonly storage: AtomicStorage;
  private readonly config: KnowledgeConfig['storage'];
  private readonly logger: Logger;
  private facts: Map<string, Fact> = new Map();
  private isLoaded: boolean = false;

  public readonly commit: () => Promise<void>;

  constructor(
    workspace: string,
    config: KnowledgeConfig['storage'],
    logger: Logger
  ) {
    this.storage = new AtomicStorage(workspace, logger);
    this.config = config;
    this.logger = logger;

    // Create a debounced version of the persist method.
    this.commit = AtomicStorage.debounce(
      this.persist.bind(this),
      this.config.writeDebounceMs
    );
  }

  /**
   * Immediately flushes any pending debounced writes.
   * Useful in tests and before shutdown to ensure data is persisted.
   */
  public async flush(): Promise<void> {
    if (this.isLoaded) {
      await this.persist();
    }
  }

  /**
   * Loads facts from the `facts.json` file into the in-memory store.
   * If the file doesn't exist, it initializes an empty store.
   */
  public async load(): Promise<void> {
    if (this.isLoaded) {
      this.logger.debug('Fact store is already loaded.');
      return;
    }

    await this.storage.init();
    const data = await this.storage.readJson<FactsData>('facts.json');
    if (data && Array.isArray(data.facts)) {
      this.facts = new Map(data.facts.map(fact => [fact.id, fact]));
      this.logger.info(`Loaded ${this.facts.size} facts from storage.`);
    } else {
      this.logger.info('No existing fact store found. Initializing a new one.');
      this.facts = new Map();
    }
    this.isLoaded = true;
  }

  /**
   * Adds a new fact to the store or updates an existing one based on content.
   * @param newFactData The data for the new fact, excluding metadata fields.
   * @returns The newly created or found Fact object.
   */
  public addFact(
    newFactData: Omit<Fact, 'id' | 'createdAt' | 'lastAccessed' | 'relevance'>
  ): Fact {
    if (!this.isLoaded) {
      throw new Error('FactStore has not been loaded yet. Call load() first.');
    }
    const now = new Date().toISOString();
    
    // Check if a similar fact already exists to avoid duplicates
    for (const existingFact of this.facts.values()) {
        if (
            existingFact.subject === newFactData.subject &&
            existingFact.predicate === newFactData.predicate &&
            existingFact.object === newFactData.object
        ) {
            // Fact already exists, let's just boost its relevance and update timestamp
            existingFact.relevance = this.boostRelevance(existingFact.relevance);
            existingFact.lastAccessed = now;
            this.commit();
            return existingFact;
        }
    }

    const newFact: Fact = {
      ...newFactData,
      id: randomUUID(),
      createdAt: now,
      lastAccessed: now,
      relevance: 1.0, // New facts start with maximum relevance
    };

    this.facts.set(newFact.id, newFact);
    this.prune(); // Check if we need to prune old facts
    this.commit();
    return newFact;
  }

  /**
   * Retrieves a fact by its unique ID.
   * @param id The UUID of the fact.
   * @returns The Fact object, or undefined if not found.
   */
  public getFact(id: string): Fact | undefined {
    const fact = this.facts.get(id);
    if (fact) {
        fact.lastAccessed = new Date().toISOString();
        fact.relevance = this.boostRelevance(fact.relevance);
        this.commit();
    }
    return fact;
  }

  /**
   * Queries the fact store based on subject, predicate, or object.
   * @param query An object with optional subject, predicate, and/or object to match.
   * @returns An array of matching facts, sorted by relevance.
   */
  public query(query: { subject?: string; predicate?: string; object?: string }): Fact[] {
    const results: Fact[] = [];
    for (const fact of this.facts.values()) {
      const subjectMatch = !query.subject || fact.subject === query.subject;
      const predicateMatch = !query.predicate || fact.predicate === query.predicate;
      const objectMatch = !query.object || fact.object === query.object;
      
      if (subjectMatch && predicateMatch && objectMatch) {
        results.push(fact);
      }
    }
    // Sort by relevance, descending
    return results.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Applies a decay factor to the relevance score of all facts.
   * @param rate The decay rate (e.g., 0.05 for 5%).
   * @returns An object with the count of decayed facts.
   */
  public decayFacts(rate: number): { decayedCount: number } {
    let decayedCount = 0;
    const minRelevance = 0.1; // Floor to prevent facts from disappearing completely

    for (const fact of this.facts.values()) {
      const newRelevance = fact.relevance * (1 - rate);
      if (newRelevance !== fact.relevance) {
          fact.relevance = Math.max(minRelevance, newRelevance);
          decayedCount++;
      }
    }
    
    if (decayedCount > 0) {
      this.logger.info(`Applied decay rate of ${rate * 100}% to ${decayedCount} facts.`);
      this.commit();
    }
    return { decayedCount };
  }

  /**
   * Persists the current in-memory fact store to `facts.json`.
   */
  private async persist(): Promise<void> {
    if (!this.isLoaded) {
      this.logger.warn('Attempted to persist fact store before it was loaded. Aborting.');
      return;
    }
    
    const data: FactsData = {
      updated: new Date().toISOString(),
      facts: Array.from(this.facts.values()),
    };
    
    try {
      await this.storage.writeJson('facts.json', data);
      this.logger.debug(`Successfully persisted ${data.facts.length} facts.`);
    } catch (err) {
      this.logger.error('Failed to persist fact store.', err as Error);
    }
  }

  /**
   * Removes the least relevant facts if the store exceeds its configured max size.
   */
  private prune(): void {
    const factCount = this.facts.size;
    if (factCount <= this.config.maxFacts) {
      return;
    }

    const factsToPrune = factCount - this.config.maxFacts;
    if (factsToPrune <= 0) return;

    // Get all facts, sort by relevance (ascending) and then by lastAccessed (ascending)
    const sortedFacts = Array.from(this.facts.values()).sort((a, b) => {
        if (a.relevance !== b.relevance) {
            return a.relevance - b.relevance;
        }
        return new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime();
    });

    for (let i = 0; i < factsToPrune; i++) {
        this.facts.delete(sortedFacts[i].id);
    }
    
    this.logger.info(`Pruned ${factsToPrune} least relevant facts to maintain store size.`);
  }

  /**
   * Boosts the relevance of a fact upon access.
   * @param currentRelevance The current relevance score.
   * @returns The new, boosted relevance score.
   */
  private boostRelevance(currentRelevance: number): number {
    // Push the relevance 50% closer to 1.0
    const boost = (1.0 - currentRelevance) * 0.5;
    return Math.min(1.0, currentRelevance + boost);
  }

  /**
   * Returns a list of all facts that have not been embedded yet.
   */
  public getUnembeddedFacts(): Fact[] {
    const results: Fact[] = [];
    for (const fact of this.facts.values()) {
        if (!fact.embedded) {
            results.push(fact);
        }
    }
    return results;
  }

  /**
   * Marks a list of facts as having been embedded.
   * @param factIds An array of fact IDs to update.
   */
  public markFactsAsEmbedded(factIds: string[]): void {
    const now = new Date().toISOString();
    let updatedCount = 0;
    for (const id of factIds) {
        const fact = this.facts.get(id);
        if (fact) {
            fact.embedded = now;
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        this.commit();
    }
  }
}

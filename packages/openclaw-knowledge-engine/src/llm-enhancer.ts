// src/llm-enhancer.ts

import { Entity, Fact, KnowledgeConfig, Logger } from './types.js';
import { httpPost } from './http-client.js';

interface LlmBatchItem {
  id: string;
  text: string;
}

interface LlmExtractionResult {
  entities: Omit<Entity, 'id' | 'mentions' | 'count' | 'lastSeen' | 'source'>[];
  facts: Omit<Fact, 'id' | 'relevance' | 'createdAt' | 'lastAccessed' | 'source'>[];
}

/**
 * Manages batched requests to an external LLM for entity and fact extraction.
 */
export class LlmEnhancer {
  private readonly config: KnowledgeConfig['extraction']['llm'];
  private readonly logger: Logger;
  private batch: LlmBatchItem[] = [];
  private cooldownTimeout: NodeJS.Timeout | null = null;

  constructor(config: KnowledgeConfig['extraction']['llm'], logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Adds a message to the current batch.
   * Triggers a batch send (with proper error handling) when the size is reached.
   */
  public addToBatch(item: LlmBatchItem): void {
    if (!this.config.enabled) return;

    this.batch.push(item);
    this.logger.debug(`Added message ${item.id} to LLM batch. Current size: ${this.batch.length}`);

    if (this.batch.length >= this.config.batchSize) {
      this.logger.info(`LLM batch size reached (${this.config.batchSize}). Sending immediately.`);
      // S1: properly await and catch errors from sendBatch
      this.sendBatch().catch(err => {
        this.logger.error('Error sending LLM batch.', err as Error);
      });
    } else {
      this.resetCooldownTimer();
    }
  }

  /** Resets the cooldown timer. When it expires the batch is sent. */
  private resetCooldownTimer(): void {
    if (this.cooldownTimeout) clearTimeout(this.cooldownTimeout);
    this.cooldownTimeout = setTimeout(() => {
      if (this.batch.length > 0) {
        this.logger.info('LLM cooldown expired. Sending batch.');
        this.sendBatch().catch(err => {
          this.logger.error('Error sending LLM batch on cooldown.', err as Error);
        });
      }
    }, this.config.cooldownMs);
    this.cooldownTimeout.unref();
  }

  /**
   * Clears all pending timers. Called during shutdown.
   */
  public clearTimers(): void {
    if (this.cooldownTimeout) {
      clearTimeout(this.cooldownTimeout);
      this.cooldownTimeout = null;
    }
  }

  /**
   * Sends the current batch to the LLM for processing.
   */
  public async sendBatch(): Promise<{ entities: Entity[]; facts: Fact[] } | null> {
    this.clearTimers();

    if (this.batch.length === 0) return null;

    const currentBatch = [...this.batch];
    this.batch = [];

    const prompt = this.constructPrompt(currentBatch);

    try {
      const responseJson = await this.makeHttpRequest(prompt);
      const result = this.parseLlmResponse(responseJson);
      const entities = this.transformToEntities(result.entities);
      const facts = this.transformToFacts(result.facts);
      this.logger.info(`LLM extracted ${entities.length} entities and ${facts.length} facts.`);
      return { entities, facts };
    } catch (err) {
      this.logger.error('Failed to send or process LLM batch.', err as Error);
      return null;
    }
  }

  /** Constructs the prompt to be sent to the LLM. */
  private constructPrompt(batch: LlmBatchItem[]): string {
    const conversation = batch.map(item => item.text).join('\n');
    return [
      'Analyze the following conversation and extract key entities and facts.',
      'Respond with a single JSON object containing "entities" and "facts".',
      '',
      'For "entities", provide objects with "type", "value", and "importance".',
      'Valid types: "person", "location", "organization", "product", "concept".',
      '',
      'For "facts", provide triples (subject, predicate, object).',
      '',
      'Conversation:',
      '---',
      conversation,
      '---',
      '',
      'JSON Response:',
    ].join('\n');
  }

  /** Makes an HTTP(S) request to the configured LLM endpoint. */
  private makeHttpRequest(prompt: string): Promise<string> {
    return httpPost(this.config.endpoint, {
      model: this.config.model,
      prompt,
      stream: false,
      format: 'json',
    });
  }

  /** Parses and validates the JSON response from the LLM. */
  private parseLlmResponse(responseJson: string): LlmExtractionResult {
    try {
      const outer = JSON.parse(responseJson) as Record<string, unknown>;
      const inner = typeof outer.response === 'string'
        ? outer.response : JSON.stringify(outer);
      const data = JSON.parse(inner) as Record<string, unknown>;
      if (!data || typeof data !== 'object') {
        throw new Error('LLM response is not a valid object.');
      }
      return {
        entities: Array.isArray(data.entities) ? data.entities : [],
        facts: Array.isArray(data.facts) ? data.facts : [],
      };
    } catch (err) {
      this.logger.error(`Failed to parse LLM response: ${responseJson}`, err as Error);
      throw new Error('Invalid JSON response from LLM.');
    }
  }

  /** Transforms raw LLM entity data into the standard Entity format. */
  private transformToEntities(rawEntities: unknown[]): Entity[] {
    const entities: Entity[] = [];
    for (const raw of rawEntities) {
      const r = raw as Record<string, unknown>;
      if (typeof r.value !== 'string' || typeof r.type !== 'string') continue;
      const value = r.value.trim();
      const type = r.type.toLowerCase();
      const id = `${type}:${value.toLowerCase().replace(/\s+/g, '-')}`;
      const imp = typeof r.importance === 'number'
        ? Math.max(0, Math.min(1, r.importance)) : 0.7;
      entities.push({
        id, value, type: type as Entity['type'],
        mentions: [value], count: 1, importance: imp,
        lastSeen: new Date().toISOString(), source: ['llm'],
      });
    }
    return entities;
  }

  /** Transforms raw LLM fact data into partial Fact objects. */
  private transformToFacts(rawFacts: unknown[]): Fact[] {
    const facts: Fact[] = [];
    for (const raw of rawFacts) {
      const r = raw as Record<string, unknown>;
      if (typeof r.subject !== 'string' || typeof r.predicate !== 'string' || typeof r.object !== 'string') continue;
      facts.push({
        subject: r.subject.trim(),
        predicate: r.predicate.trim().toLowerCase().replace(/\s+/g, '-'),
        object: r.object.trim(),
        source: 'extracted-llm',
      } as Fact);
    }
    return facts;
  }
}

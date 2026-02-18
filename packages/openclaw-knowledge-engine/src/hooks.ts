// src/hooks.ts

import {
  OpenClawPluginApi,
  HookEvent,
  KnowledgeConfig,
  Logger,
} from './types.js';

import { EntityExtractor } from './entity-extractor.js';
import { FactStore } from './fact-store.js';
import { LlmEnhancer } from './llm-enhancer.js';
import { Maintenance } from './maintenance.js';
import { Embeddings } from './embeddings.js';

/**
 * Manages the registration and orchestration of all plugin hooks.
 */
export class HookManager {
  private readonly api: OpenClawPluginApi;
  private readonly config: KnowledgeConfig;
  private readonly logger: Logger;

  private entityExtractor: EntityExtractor;
  private factStore: FactStore;
  private llmEnhancer?: LlmEnhancer;
  private maintenance?: Maintenance;

  constructor(api: OpenClawPluginApi, config: KnowledgeConfig) {
    this.api = api;
    this.config = config;
    this.logger = api.logger;

    this.entityExtractor = new EntityExtractor(this.logger);
    this.factStore = new FactStore(
      this.config.workspace,
      this.config.storage,
      this.logger
    );

    if (this.config.extraction.llm.enabled) {
      this.llmEnhancer = new LlmEnhancer(this.config.extraction.llm, this.logger);
    }
  }

  /** Registers all the necessary hooks with the OpenClaw host. */
  public registerHooks(): void {
    if (!this.config.enabled) {
      this.logger.info('Knowledge Engine is disabled. No hooks registered.');
      return;
    }

    this.api.on('session_start', this.onSessionStart.bind(this), { priority: 200 });
    this.api.on('message_received', this.onMessage.bind(this), { priority: 100 });
    this.api.on('message_sent', this.onMessage.bind(this), { priority: 100 });
    this.api.on('gateway_stop', this.onShutdown.bind(this), { priority: 900 });

    this.logger.info('Registered all Knowledge Engine hooks.');
  }

  /** Handler for the `session_start` hook. */
  private async onSessionStart(): Promise<void> {
    this.logger.info('Knowledge Engine starting up...');
    await this.factStore.load();

    const embeddings = this.config.embeddings.enabled
      ? new Embeddings(this.config.embeddings, this.logger)
      : undefined;

    this.maintenance = new Maintenance(
      this.config, this.logger, this.factStore, embeddings
    );
    this.maintenance.start();
  }

  /** Handler for `gateway_stop` — cleans up timers and flushes state. */
  private async onShutdown(): Promise<void> {
    this.logger.info('Knowledge Engine shutting down...');
    this.maintenance?.stop();
    this.llmEnhancer?.clearTimers();
    this.logger.info('Knowledge Engine shutdown complete.');
  }

  /** Handler for `message_received` and `message_sent` hooks. */
  private async onMessage(event: HookEvent): Promise<void> {
    const text = event.content || event.message || event.text;
    if (typeof text !== 'string' || text.trim() === '') return;

    this.logger.debug(`Processing message: "${text.substring(0, 50)}..."`);

    if (this.config.extraction.regex.enabled) {
      const entities = this.entityExtractor.extract(text);
      if (entities.length > 0) {
        this.logger.info(`Extracted ${entities.length} entities via regex.`);
      }
    }

    if (this.llmEnhancer) {
      const messageId = `msg-${Date.now()}`;
      this.llmEnhancer.addToBatch({ id: messageId, text });
      this.processLlmBatchWhenReady().catch(err =>
        this.logger.error('LLM batch processing failed', err as Error));
    }
  }

  /** Fire-and-forget: processes LLM batch results when available. */
  private async processLlmBatchWhenReady(): Promise<void> {
    if (!this.llmEnhancer) return;

    const result = await this.llmEnhancer.sendBatch();
    if (!result) return;

    if (result.facts.length > 0) {
      this.logger.info(`Adding ${result.facts.length} LLM facts.`);
      for (const f of result.facts) {
        this.factStore.addFact({
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          source: 'extracted-llm',
        });
      }
    }
  }
}

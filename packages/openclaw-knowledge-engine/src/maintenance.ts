// src/maintenance.ts

import { Embeddings } from './embeddings.js';
import { FactStore } from './fact-store.js';
import { KnowledgeConfig, Logger } from './types.js';

/**
 * Manages background maintenance tasks for the knowledge engine,
 * such as decaying fact relevance and syncing embeddings.
 */
export class Maintenance {
  private readonly config: KnowledgeConfig;
  private readonly logger: Logger;
  private readonly factStore: FactStore;
  private readonly embeddings?: Embeddings;

  private decayTimer: NodeJS.Timeout | null = null;
  private embeddingsTimer: NodeJS.Timeout | null = null;

  constructor(
    config: KnowledgeConfig,
    logger: Logger,
    factStore: FactStore,
    embeddings?: Embeddings
  ) {
    this.config = config;
    this.logger = logger;
    this.factStore = factStore;
    this.embeddings = embeddings;
  }

  /** Starts all configured maintenance timers. */
  public start(): void {
    this.logger.info('Starting maintenance service...');
    this.stop();
    this.startDecayTimer();
    this.startEmbeddingsTimer();
  }

  /** Stops all running maintenance timers. */
  public stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    if (this.embeddingsTimer) {
      clearInterval(this.embeddingsTimer);
      this.embeddingsTimer = null;
    }
    this.logger.info('Stopped maintenance service.');
  }

  private startDecayTimer(): void {
    if (!this.config.decay.enabled) return;
    const ms = this.config.decay.intervalHours * 60 * 60 * 1000;
    this.decayTimer = setInterval(() => this.runDecay(), ms);
    this.decayTimer.unref();
    this.logger.info(`Scheduled fact decay every ${this.config.decay.intervalHours} hours.`);
  }

  private startEmbeddingsTimer(): void {
    if (!this.embeddings?.isEnabled()) return;
    const ms = this.config.embeddings.syncIntervalMinutes * 60 * 1000;
    this.embeddingsTimer = setInterval(() => this.runEmbeddingsSync(), ms);
    this.embeddingsTimer.unref();
    this.logger.info(`Scheduled embeddings sync every ${this.config.embeddings.syncIntervalMinutes} min.`);
  }

  /** Executes the fact decay process. */
  public runDecay(): void {
    this.logger.info('Running scheduled fact decay...');
    try {
      const { decayedCount } = this.factStore.decayFacts(this.config.decay.rate);
      this.logger.info(`Fact decay complete. Decayed ${decayedCount} facts.`);
    } catch (err) {
      this.logger.error('Error during fact decay.', err as Error);
    }
  }

  /** Executes the embeddings synchronization process. */
  public async runEmbeddingsSync(): Promise<void> {
    if (!this.embeddings?.isEnabled()) return;

    this.logger.info('Running scheduled embeddings sync...');
    try {
      const unembedded = this.factStore.getUnembeddedFacts();
      if (unembedded.length === 0) {
        this.logger.info('No new facts to sync for embeddings.');
        return;
      }

      const synced = await this.embeddings.sync(unembedded);
      if (synced > 0) {
        const ids = unembedded.slice(0, synced).map(f => f.id);
        this.factStore.markFactsAsEmbedded(ids);
        this.logger.info(`Embeddings sync complete. Synced ${synced} facts.`);
      }
    } catch (err) {
      this.logger.error('Error during embeddings sync.', err as Error);
    }
  }
}

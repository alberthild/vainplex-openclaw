// src/embeddings.ts

import { Fact, KnowledgeConfig, Logger } from './types.js';
import { httpPost } from './http-client.js';

/** ChromaDB v2 API payload format. */
interface ChromaPayload {
  ids: string[];
  documents: string[];
  metadatas: Record<string, string>[];
}

/**
 * Manages optional integration with a ChromaDB-compatible vector database.
 */
export class Embeddings {
  private readonly config: KnowledgeConfig['embeddings'];
  private readonly logger: Logger;

  constructor(config: KnowledgeConfig['embeddings'], logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /** Checks if the embeddings service is enabled. */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Syncs a batch of facts to the vector database.
   * @returns The number of successfully synced facts.
   */
  public async sync(facts: Fact[]): Promise<number> {
    if (!this.isEnabled() || facts.length === 0) return 0;

    this.logger.info(`Starting embedding sync for ${facts.length} facts.`);
    const payload = this.constructChromaPayload(facts);
    const url = this.buildEndpointUrl();

    try {
      await httpPost(url, payload);
      this.logger.info(`Successfully synced ${facts.length} facts to ChromaDB.`);
      return facts.length;
    } catch (err) {
      this.logger.error('Failed to sync embeddings to ChromaDB.', err as Error);
      return 0;
    }
  }

  /** Builds the full endpoint URL with collection name substituted. */
  private buildEndpointUrl(): string {
    return this.config.endpoint
      .replace('{name}', this.config.collectionName)
      .replace('//', '//')  // preserve protocol double-slash
      .replace(/([^:])\/\//g, '$1/');  // collapse any other double-slashes
  }

  /**
   * Constructs the payload for ChromaDB v2 API.
   * Metadata values are all strings (v2 requirement).
   */
  private constructChromaPayload(facts: Fact[]): ChromaPayload {
    const payload: ChromaPayload = { ids: [], documents: [], metadatas: [] };

    for (const fact of facts) {
      payload.ids.push(fact.id);
      payload.documents.push(
        `${fact.subject} ${fact.predicate.replace(/-/g, ' ')} ${fact.object}.`
      );
      payload.metadatas.push({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        source: fact.source,
        createdAt: fact.createdAt,
      });
    }

    return payload;
  }
}

/**
 * ERC-8004 Reputation Provider — Facade
 * Module 6 of the Agent Firewall (RFC §14)
 *
 * Decides whether to use the on-chain client or the REST API based on config.
 * Shares a single LRU cache across both backends.
 *
 * Fallback order (when preferRest=true):
 *   1. Cache → 2. REST → 3. On-chain → 4. null (fail-open)
 *
 * Fallback order (when preferRest=false or REST not configured):
 *   1. Cache → 2. On-chain → 3. REST → 4. null (fail-open)
 *
 * @module security/erc8004-provider
 */

import type { ERC8004Config, ReputationResult } from "./types.js";
import { ERC8004Client, type LRUCache } from "./erc8004-client.js";
import { AgentProofRestClient } from "./agentproof-rest.js";
import { loadAgentProofApiKey } from "./agentproof-secret.js";

export class ERC8004Provider {
  private readonly onChainClient: ERC8004Client;
  private readonly restClient: AgentProofRestClient | null;
  private readonly cache: LRUCache;
  private readonly preferRest: boolean;

  constructor(config: ERC8004Config) {
    this.onChainClient = new ERC8004Client(config);
    this.cache = this.onChainClient.getCache();
    this.preferRest = config.preferRest === true;

    // Only create REST client if both baseUrl and apiKeyFile are configured
    if (config.restBaseUrl && config.apiKeyFile) {
      this.restClient = new AgentProofRestClient(
        config.restBaseUrl,
        () => loadAgentProofApiKey(config.apiKeyFile!),
      );
    } else {
      this.restClient = null;
    }
  }

  /**
   * Look up an agent's reputation using the best available backend.
   *
   * - Checks shared cache first.
   * - If `preferRest` and REST is configured: try REST, fall back to on-chain.
   * - Otherwise: try on-chain, fall back to REST.
   * - If everything fails: return null (fail-open, no crash).
   */
  async lookupReputation(agentId: number): Promise<ReputationResult | null> {
    // 1. Cache hit?
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    if (this.preferRest && this.restClient) {
      // REST → on-chain fallback
      const restResult = await this.tryRest(agentId);
      if (restResult) return this.cacheAndReturn(restResult);

      const chainResult = await this.tryOnChain(agentId);
      if (chainResult) return chainResult; // already cached by on-chain client

      return null;
    }

    // On-chain → REST fallback
    const chainResult = await this.tryOnChain(agentId);
    if (chainResult) return chainResult; // already cached by on-chain client

    if (this.restClient) {
      const restResult = await this.tryRest(agentId);
      if (restResult) return this.cacheAndReturn(restResult);
    }

    return null;
  }

  /** Clear the shared cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Expose cache size for diagnostics. */
  get cacheSize(): number {
    return this.cache.size;
  }

  // Note: Write-path methods (startFeedbackFlusher, stopFeedbackFlusher, pushSignal)
  // removed — feedback signals are now handled by ShieldAPI → AgentProof integration.

  // ── Private helpers ──

  private async tryRest(agentId: number): Promise<ReputationResult | null> {
    try {
      return this.restClient ? await this.restClient.getAgentProfile(agentId) : null;
    } catch {
      return null;
    }
  }

  private async tryOnChain(agentId: number): Promise<ReputationResult | null> {
    try {
      return await this.onChainClient.lookupReputation(agentId);
    } catch {
      return null;
    }
  }

  private cacheAndReturn(result: ReputationResult): ReputationResult {
    this.cache.set(result.agentId, result);
    return result;
  }
}

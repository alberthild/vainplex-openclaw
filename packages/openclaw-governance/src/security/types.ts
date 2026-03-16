/**
 * ERC-8004 / AgentProof Integration — Type Definitions
 * Module 6 of the Agent Firewall (RFC §14)
 *
 * @module security/types
 */

/** Configuration for the ERC-8004 on-chain reputation module. */
export interface ERC8004Config {
  /** Master switch — disabled by default. */
  enabled: boolean;

  /** JSON-RPC endpoint for Base Mainnet (or custom chain). */
  rpcUrl: string;

  /** ERC-721 identity registry (same address on Base/ETH/Polygon/Monad/BNB). */
  identityRegistryAddress: string;

  /**
   * Main AgentProof aggregation contract.
   * TBC — address to be confirmed with BuilderBen.
   */
  agentProofCoreAddress: string;

  /** Map of OpenClaw agent names → on-chain agent IDs. */
  agentMapping: Record<string, number>;

  /** File path that contains the Bearer token for the Partner REST API. */
  apiKeyFile?: string;

  /** Base URL for the AgentProof Partner REST API. */
  restBaseUrl?: string;

  /** If true, prefer REST lookups over on-chain eth_call. */
  preferRest?: boolean;

  /** If true, push runtime governance signals (policy violations, tool outcomes) to AgentProof. Default: false. */
  feedbackEnabled?: boolean;

  /** LRU cache settings shared across on-chain and REST backends. */
  cache: {
    /** Time-to-live in seconds (default: 3600 = 1 hour). */
    ttlSeconds: number;
    /** Maximum cached entries before LRU eviction (default: 256). */
    maxEntries: number;
  };
}

/** Result of an agent reputation lookup (on-chain or REST). */
export interface ReputationResult {
  /** The ERC-8004 agent ID that was queried. */
  agentId: number;

  /** Whether the agent has an on-chain identity NFT. */
  exists: boolean;

  /** Owner address of the identity NFT (null if unregistered). */
  owner: string | null;

  /** Total feedback entries for this agent. */
  feedbackCount: number;

  /** Normalised reputation score (0–100). */
  reputationScore: number;

  /** Tier classification derived from reputationScore. */
  tier: "high" | "medium" | "low" | "none" | "unregistered";

  /** Where the data came from. */
  source: "on-chain" | "rest" | "cache";
}

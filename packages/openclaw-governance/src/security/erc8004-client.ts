/**
 * ERC-8004 On-Chain Reputation Client
 * Module 6 of the Agent Firewall (RFC §14)
 *
 * Zero external dependencies — uses native `fetch` and hand-rolled ABI encoding.
 * Reads from Base Mainnet (or custom RPC) via JSON-RPC `eth_call`.
 *
 * @module security/erc8004-client
 */

import type { ERC8004Config, ReputationResult } from "./types.js";

// ── Contract addresses (ERC-8004, same on Base/ETH/Polygon/Monad/BNB) ──

/** Default IdentityRegistry address (ERC-721 agent identity NFTs). */
const DEFAULT_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** Default RPC endpoint for Base Mainnet. */
const DEFAULT_RPC_URL = "https://mainnet.base.org";

// ── Function selectors ──

/** `ownerOf(uint256)` selector — ERC-721 standard. */
const SELECTOR_OWNER_OF = "0x6352211e";

/** `getAgentProfile(uint256)` selector — AgentProofCore. */
const SELECTOR_GET_AGENT_PROFILE = "0xc0c53b8b";

/**
 * `submitFeedback(uint256,uint8,string,bytes32)` selector.
 * Phase 2 — stub only.
 */
const SELECTOR_SUBMIT_FEEDBACK = "0xde168f39";

// ── ABI encoding / decoding helpers ──

/** Encode a uint256 as a 64-char hex string (left-padded with zeros). */
export function encodeUint256(value: number | bigint): string {
  const hex = BigInt(value).toString(16);
  return hex.padStart(64, "0");
}

/** Decode a 0x-prefixed hex string into an Ethereum address (last 20 bytes). */
export function decodeAddress(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 64) return "0x" + "0".repeat(40);
  const addr = clean.slice(24, 64);
  return "0x" + addr;
}

/** Decode a 0x-prefixed hex string into a bigint. */
export function decodeUint256(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0 || clean === "0".repeat(clean.length)) return 0n;
  return BigInt("0x" + clean);
}

/**
 * Decode a getAgentProfile response.
 *
 * Expected ABI-encoded return layout (each slot = 32 bytes):
 *   [0]  address owner
 *   [1]  uint256 feedbackCount
 *   [2]  uint256 reputationScore  (0–100 normalised by the contract)
 *
 * NOTE: The actual on-chain ABI is TBC with BuilderBen. This decoder is
 * deliberately lenient — if the response is shorter than expected we
 * return safe defaults (exists=false) rather than throwing.
 */
export function decodeAgentProfile(hex: string): {
  owner: string;
  feedbackCount: number;
  reputationScore: number;
} {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;

  // Minimum: 3 × 32 bytes = 192 hex chars
  if (clean.length < 192) {
    return { owner: "0x" + "0".repeat(40), feedbackCount: 0, reputationScore: 0 };
  }

  const owner = decodeAddress("0x" + clean.slice(0, 64));
  const feedbackCount = Number(decodeUint256("0x" + clean.slice(64, 128)));
  const reputationScore = Number(decodeUint256("0x" + clean.slice(128, 192)));

  return { owner, feedbackCount, reputationScore };
}

// ── LRU cache ──

interface CacheEntry {
  result: ReputationResult;
  expiry: number;
  lastAccess: number;
}

export class LRUCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<number, CacheEntry>();

  constructor(maxEntries: number, ttlSeconds: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlSeconds * 1000;
  }

  get(agentId: number): ReputationResult | null {
    const entry = this.entries.get(agentId);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.entries.delete(agentId);
      return null;
    }
    entry.lastAccess = Date.now();
    return { ...entry.result, source: "cache" };
  }

  set(agentId: number, result: ReputationResult): void {
    // Evict oldest entry if at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(agentId)) {
      this.evictOldest();
    }
    this.entries.set(agentId, {
      result: { ...result },
      expiry: Date.now() + this.ttlMs,
      lastAccess: Date.now(),
    });
  }

  has(agentId: number): boolean {
    const entry = this.entries.get(agentId);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.entries.delete(agentId);
      return false;
    }
    return true;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    let oldestKey: number | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
    }
  }
}

// ── Tier classification ──

export function classifyTier(
  exists: boolean,
  reputationScore: number,
  feedbackCount: number,
): ReputationResult["tier"] {
  if (!exists) return "unregistered";
  if (feedbackCount === 0) return "none";
  if (reputationScore >= 70) return "high";
  if (reputationScore >= 30) return "medium";
  return "low";
}

// ── JSON-RPC helpers ──

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: { code: number; message: string };
}

let rpcIdCounter = 1;

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<string | null> {
  const body = {
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to, data }, "latest"],
    id: rpcIdCounter++,
  };

  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return null;

  const json = (await resp.json()) as JsonRpcResponse;
  if (json.error) return null;
  return json.result ?? null;
}

// ── Main client ──

export class ERC8004Client {
  private readonly rpcUrl: string;
  private readonly identityRegistry: string;
  private readonly agentProofCore: string;
  private readonly cache: LRUCache;

  constructor(config: ERC8004Config) {
    this.rpcUrl = config.rpcUrl || DEFAULT_RPC_URL;
    this.identityRegistry =
      config.identityRegistryAddress || DEFAULT_IDENTITY_REGISTRY;
    this.agentProofCore = config.agentProofCoreAddress;
    this.cache = new LRUCache(
      config.cache.maxEntries,
      config.cache.ttlSeconds,
    );
  }

  /**
   * Look up an agent's on-chain reputation.
   *
   * 1. Check cache
   * 2. `IdentityRegistry.ownerOf(agentId)` → does this agent exist?
   * 3. `AgentProofCore.getAgentProfile(agentId)` → reputation data
   * 4. Normalise, cache, return
   *
   * Returns null if both calls fail (fail-open).
   */
  async lookupReputation(agentId: number): Promise<ReputationResult | null> {
    // 1. Check cache
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    try {
      // 2. Check existence via ownerOf
      const ownerData = SELECTOR_OWNER_OF + encodeUint256(agentId);
      const ownerResult = await ethCall(
        this.rpcUrl,
        this.identityRegistry,
        ownerData,
      );

      // If ownerOf reverts (returns null or 0x), the agent is unregistered
      const exists =
        ownerResult !== null &&
        ownerResult !== "0x" &&
        ownerResult !==
          "0x0000000000000000000000000000000000000000000000000000000000000000";
      const owner = exists ? decodeAddress(ownerResult) : null;

      if (!exists) {
        const result: ReputationResult = {
          agentId,
          exists: false,
          owner: null,
          feedbackCount: 0,
          reputationScore: 0,
          tier: "unregistered",
          source: "on-chain",
        };
        this.cache.set(agentId, result);
        return result;
      }

      // 3. Get profile from AgentProofCore
      let feedbackCount = 0;
      let reputationScore = 0;

      if (this.agentProofCore) {
        const profileData =
          SELECTOR_GET_AGENT_PROFILE + encodeUint256(agentId);
        const profileResult = await ethCall(
          this.rpcUrl,
          this.agentProofCore,
          profileData,
        );

        if (profileResult && profileResult !== "0x") {
          const profile = decodeAgentProfile(profileResult);
          feedbackCount = profile.feedbackCount;
          reputationScore = Math.min(100, Math.max(0, profile.reputationScore));
        }
      }

      const tier = classifyTier(true, reputationScore, feedbackCount);

      const result: ReputationResult = {
        agentId,
        exists: true,
        owner,
        feedbackCount,
        reputationScore,
        tier,
        source: "on-chain",
      };

      this.cache.set(agentId, result);
      return result;
    } catch {
      // Fail-open: return null on any error
      return null;
    }
  }

  /**
   * Submit runtime feedback to the chain.
   *
   * Phase 2 — currently a stub.
   * Selector: 0xde168f39
   * ABI: submitFeedback(uint256 agentId, uint8 rating, string feedbackURI, bytes32 feedbackHash)
   * Rating scale: 1–100 (see RFC §14.3)
   *
   * @returns null (Phase 2 — not yet implemented)
   */
  async submitFeedback(
    _agentId: number,
    _rating: number,
    _feedbackURI: string,
    _feedbackHash: string,
  ): Promise<{ txHash: string } | null> {
    // TODO: Phase 2 — implement signed transaction via eth_sendRawTransaction
    // Will require:
    //   - Wallet private key from config (agentFirewall.erc8004.feedback.walletKey)
    //   - Nonce management
    //   - Gas estimation on Base
    //   - ABI encoding: SELECTOR_SUBMIT_FEEDBACK + encodeUint256(agentId) +
    //     encodeUint8(rating) + encodeDynamicString(feedbackURI) + encodeBytes32(feedbackHash)
    //   - EIP-1559 tx construction + signing (keccak256, secp256k1)
    // Estimated gas on Base: ~0.001 ETH / tx
    void SELECTOR_SUBMIT_FEEDBACK; // reference to avoid unused warning
    return null;
  }

  /** Expose the cache for the shared provider layer. */
  getCache(): LRUCache {
    return this.cache;
  }
}

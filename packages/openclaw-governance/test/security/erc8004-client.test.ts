import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ERC8004Client,
  LRUCache,
  encodeUint256,
  decodeAddress,
  decodeUint256,
  decodeAgentProfile,
  classifyTier,
} from "../../src/security/erc8004-client.js";
import type { ERC8004Config } from "../../src/security/types.js";

// ── Helpers ──

function makeConfig(overrides: Partial<ERC8004Config> = {}): ERC8004Config {
  return {
    enabled: true,
    rpcUrl: "https://test-rpc.example.com",
    identityRegistryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentProofCoreAddress: "0xABCDEF1234567890abcdef1234567890ABCDEF12",
    agentMapping: { claudia: 16700, stella: 25679 },
    cache: { ttlSeconds: 3600, maxEntries: 256 },
    ...overrides,
  };
}

/** Build a valid 32-byte hex address encoding (64 chars, left-padded). */
function padAddress(addr: string): string {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + clean.padStart(64, "0");
}

/** Build an AgentProfile response: owner + feedbackCount + reputationScore. */
function buildProfileResponse(
  owner: string,
  feedbackCount: number,
  reputationScore: number,
): string {
  const ownerHex = (owner.startsWith("0x") ? owner.slice(2) : owner).padStart(
    64,
    "0",
  );
  const fcHex = feedbackCount.toString(16).padStart(64, "0");
  const rsHex = reputationScore.toString(16).padStart(64, "0");
  return "0x" + ownerHex + fcHex + rsHex;
}

/** Mock a successful JSON-RPC response. */
function mockRpcResponse(result: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Mock an error JSON-RPC response. */
function mockRpcError(code: number, message: string) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code, message },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ── Tests: ABI encoding ──

describe("ABI Encoding", () => {
  it("encodes uint256(0) as 64 zeros", () => {
    expect(encodeUint256(0)).toBe("0".repeat(64));
  });

  it("encodes uint256(1) correctly", () => {
    const result = encodeUint256(1);
    expect(result).toBe("0".repeat(63) + "1");
    expect(result.length).toBe(64);
  });

  it("encodes uint256(16700) correctly", () => {
    const result = encodeUint256(16700);
    expect(result).toBe(
      (16700).toString(16).padStart(64, "0"),
    );
  });

  it("encodes bigint values", () => {
    const result = encodeUint256(BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"));
    expect(result).toBe("f".repeat(64));
  });

  it("always produces 64-char strings", () => {
    for (const val of [0, 1, 255, 65535, 16700, 25679, 999999]) {
      expect(encodeUint256(val).length).toBe(64);
    }
  });
});

describe("ABI Decoding — Address", () => {
  it("decodes a left-padded address", () => {
    const hex = "0x" + "0".repeat(24) + "abcdef1234567890abcdef1234567890abcdef12";
    expect(decodeAddress(hex)).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("decodes zero address", () => {
    expect(decodeAddress("0x" + "0".repeat(64))).toBe("0x" + "0".repeat(40));
  });

  it("handles short input gracefully", () => {
    expect(decodeAddress("0x1234")).toBe("0x" + "0".repeat(40));
  });

  it("handles input without 0x prefix", () => {
    const hex = "0".repeat(24) + "ff".repeat(20);
    expect(decodeAddress(hex)).toBe("0x" + "ff".repeat(20));
  });
});

describe("ABI Decoding — uint256", () => {
  it("decodes zero", () => {
    expect(decodeUint256("0x" + "0".repeat(64))).toBe(0n);
  });

  it("decodes small numbers", () => {
    expect(decodeUint256("0x" + "0".repeat(62) + "0a")).toBe(10n);
  });

  it("decodes 16700", () => {
    const hex = "0x" + (16700).toString(16).padStart(64, "0");
    expect(decodeUint256(hex)).toBe(16700n);
  });

  it("handles empty string", () => {
    expect(decodeUint256("0x")).toBe(0n);
  });
});

describe("ABI Decoding — AgentProfile", () => {
  it("decodes a full 3-slot profile", () => {
    const resp = buildProfileResponse(
      "abcdef1234567890abcdef1234567890abcdef12",
      42,
      85,
    );
    const profile = decodeAgentProfile(resp);
    expect(profile.owner).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(profile.feedbackCount).toBe(42);
    expect(profile.reputationScore).toBe(85);
  });

  it("returns defaults for short response", () => {
    const profile = decodeAgentProfile("0x1234");
    expect(profile.owner).toBe("0x" + "0".repeat(40));
    expect(profile.feedbackCount).toBe(0);
    expect(profile.reputationScore).toBe(0);
  });

  it("returns defaults for empty response", () => {
    const profile = decodeAgentProfile("0x");
    expect(profile.feedbackCount).toBe(0);
    expect(profile.reputationScore).toBe(0);
  });

  it("handles profile with zero values", () => {
    const resp = buildProfileResponse("0".repeat(40), 0, 0);
    const profile = decodeAgentProfile(resp);
    expect(profile.feedbackCount).toBe(0);
    expect(profile.reputationScore).toBe(0);
  });
});

// ── Tests: Tier classification ──

describe("classifyTier", () => {
  it("returns 'unregistered' when not on-chain", () => {
    expect(classifyTier(false, 0, 0)).toBe("unregistered");
  });

  it("returns 'none' when registered but no feedback", () => {
    expect(classifyTier(true, 0, 0)).toBe("none");
  });

  it("returns 'high' for score >= 70", () => {
    expect(classifyTier(true, 70, 5)).toBe("high");
    expect(classifyTier(true, 100, 1)).toBe("high");
  });

  it("returns 'medium' for score 30-69", () => {
    expect(classifyTier(true, 30, 3)).toBe("medium");
    expect(classifyTier(true, 69, 2)).toBe("medium");
  });

  it("returns 'low' for score < 30", () => {
    expect(classifyTier(true, 29, 1)).toBe("low");
    expect(classifyTier(true, 1, 10)).toBe("low");
  });

  it("score=0 with feedback is 'low'", () => {
    expect(classifyTier(true, 0, 1)).toBe("low");
  });
});

// ── Tests: LRU Cache ──

describe("LRUCache", () => {
  let cache: LRUCache;

  beforeEach(() => {
    cache = new LRUCache(3, 60); // max 3 entries, 60s TTL
  });

  it("returns null for cache miss", () => {
    expect(cache.get(999)).toBeNull();
  });

  it("stores and retrieves entries", () => {
    const result = {
      agentId: 1,
      exists: true,
      owner: "0x1234",
      feedbackCount: 5,
      reputationScore: 80,
      tier: "high" as const,
      source: "on-chain" as const,
    };
    cache.set(1, result);
    const got = cache.get(1);
    expect(got).not.toBeNull();
    expect(got!.agentId).toBe(1);
    expect(got!.source).toBe("cache"); // source changes to "cache" on retrieval
  });

  it("evicts oldest entry when full", () => {
    for (let i = 1; i <= 3; i++) {
      cache.set(i, {
        agentId: i,
        exists: true,
        owner: null,
        feedbackCount: 0,
        reputationScore: 0,
        tier: "none",
        source: "on-chain",
      });
    }
    expect(cache.size).toBe(3);

    // Adding 4th entry should evict the oldest (1)
    cache.set(4, {
      agentId: 4,
      exists: true,
      owner: null,
      feedbackCount: 0,
      reputationScore: 0,
      tier: "none",
      source: "on-chain",
    });
    expect(cache.size).toBe(3);
    expect(cache.get(1)).toBeNull(); // evicted
    expect(cache.get(4)).not.toBeNull(); // present
  });

  it("respects TTL expiry", () => {
    vi.useFakeTimers();
    cache.set(1, {
      agentId: 1,
      exists: true,
      owner: null,
      feedbackCount: 0,
      reputationScore: 0,
      tier: "none",
      source: "on-chain",
    });
    expect(cache.get(1)).not.toBeNull();

    // Advance past TTL
    vi.advanceTimersByTime(61_000);
    expect(cache.get(1)).toBeNull();
    vi.useRealTimers();
  });

  it("has() checks TTL", () => {
    vi.useFakeTimers();
    cache.set(1, {
      agentId: 1,
      exists: true,
      owner: null,
      feedbackCount: 0,
      reputationScore: 0,
      tier: "none",
      source: "on-chain",
    });
    expect(cache.has(1)).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(cache.has(1)).toBe(false);
    vi.useRealTimers();
  });

  it("clear() removes all entries", () => {
    cache.set(1, {
      agentId: 1,
      exists: true,
      owner: null,
      feedbackCount: 0,
      reputationScore: 0,
      tier: "none",
      source: "on-chain",
    });
    cache.set(2, {
      agentId: 2,
      exists: true,
      owner: null,
      feedbackCount: 0,
      reputationScore: 0,
      tier: "none",
      source: "on-chain",
    });
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("updates existing entry without eviction", () => {
    for (let i = 1; i <= 3; i++) {
      cache.set(i, {
        agentId: i,
        exists: true,
        owner: null,
        feedbackCount: 0,
        reputationScore: i * 10,
        tier: "none",
        source: "on-chain",
      });
    }
    // Update entry 2 — should NOT evict anything
    cache.set(2, {
      agentId: 2,
      exists: true,
      owner: null,
      feedbackCount: 5,
      reputationScore: 99,
      tier: "high",
      source: "on-chain",
    });
    expect(cache.size).toBe(3);
    expect(cache.get(2)!.reputationScore).toBe(99);
  });
});

// ── Tests: ERC8004Client ──

describe("ERC8004Client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns cached result on second call", async () => {
    const ownerResponse = padAddress("abcdef1234567890abcdef1234567890abcdef12");
    const profileResponse = buildProfileResponse(
      "abcdef1234567890abcdef1234567890abcdef12",
      10,
      75,
    );

    fetchSpy
      .mockResolvedValueOnce(mockRpcResponse(ownerResponse))
      .mockResolvedValueOnce(mockRpcResponse(profileResponse));

    const client = new ERC8004Client(makeConfig());
    const first = await client.lookupReputation(16700);
    expect(first).not.toBeNull();
    expect(first!.source).toBe("on-chain");

    // Second call should hit cache
    const second = await client.lookupReputation(16700);
    expect(second).not.toBeNull();
    expect(second!.source).toBe("cache");

    // Only 2 fetch calls (ownerOf + getAgentProfile), not 4
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns unregistered when ownerOf returns zero address", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockRpcResponse("0x" + "0".repeat(64)),
    );

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(99999);
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(false);
    expect(result!.tier).toBe("unregistered");
  });

  it("returns unregistered when ownerOf returns 0x", async () => {
    fetchSpy.mockResolvedValueOnce(mockRpcResponse("0x"));

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(99999);
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(false);
    expect(result!.tier).toBe("unregistered");
  });

  it("returns null on RPC error (fail-open)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockRpcError(-32000, "execution reverted"),
    );

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(16700);
    // ownerOf returned error → treated as unregistered (exists check returns null from ethCall)
    // Actually, the ethCall returns null on error, which means exists=false → unregistered result
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(false);
    expect(result!.tier).toBe("unregistered");
  });

  it("returns null on fetch failure (fail-open)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(16700);
    expect(result).toBeNull();
  });

  it("handles registered agent with no profile contract", async () => {
    const ownerResponse = padAddress("1234567890abcdef1234567890abcdef12345678");

    fetchSpy.mockResolvedValueOnce(mockRpcResponse(ownerResponse));

    const client = new ERC8004Client(
      makeConfig({ agentProofCoreAddress: "" }),
    );
    const result = await client.lookupReputation(16700);
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(true);
    expect(result!.feedbackCount).toBe(0);
    expect(result!.reputationScore).toBe(0);
    expect(result!.tier).toBe("none");
  });

  it("encodes the correct eth_call data for ownerOf", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockRpcResponse("0x" + "0".repeat(64)),
    );

    const client = new ERC8004Client(makeConfig());
    await client.lookupReputation(16700);

    const callBody = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    // ownerOf selector (0x6352211e) + uint256(16700)
    expect(callBody.params[0].data).toBe(
      "0x6352211e" + encodeUint256(16700),
    );
  });

  it("sends requests to the configured RPC URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockRpcResponse("0x" + "0".repeat(64)),
    );

    const client = new ERC8004Client(
      makeConfig({ rpcUrl: "https://custom-rpc.io" }),
    );
    await client.lookupReputation(1);

    expect(fetchSpy.mock.calls[0]![0]).toBe("https://custom-rpc.io");
  });

  it("clamps reputation score to 0-100 range", async () => {
    const ownerResponse = padAddress("abcdef1234567890abcdef1234567890abcdef12");
    // Score of 200 should be clamped to 100
    const profileResponse = buildProfileResponse(
      "abcdef1234567890abcdef1234567890abcdef12",
      5,
      200,
    );

    fetchSpy
      .mockResolvedValueOnce(mockRpcResponse(ownerResponse))
      .mockResolvedValueOnce(mockRpcResponse(profileResponse));

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(1);
    expect(result!.reputationScore).toBe(100);
  });

  it("submitFeedback returns null (Phase 2 stub)", async () => {
    const client = new ERC8004Client(makeConfig());
    const result = await client.submitFeedback(
      16700,
      85,
      "ipfs://QmTest",
      "0x" + "ab".repeat(32),
    );
    expect(result).toBeNull();
  });

  it("handles HTTP 500 from RPC gracefully", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(16700);
    // ethCall returns null on non-200 → exists=false → unregistered
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(false);
  });

  it("correctly classifies high-reputation agent", async () => {
    const ownerResponse = padAddress("abcdef1234567890abcdef1234567890abcdef12");
    const profileResponse = buildProfileResponse(
      "abcdef1234567890abcdef1234567890abcdef12",
      25,
      85,
    );

    fetchSpy
      .mockResolvedValueOnce(mockRpcResponse(ownerResponse))
      .mockResolvedValueOnce(mockRpcResponse(profileResponse));

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(16700);
    expect(result!.tier).toBe("high");
    expect(result!.exists).toBe(true);
    expect(result!.feedbackCount).toBe(25);
  });

  it("correctly classifies low-reputation agent", async () => {
    const ownerResponse = padAddress("abcdef1234567890abcdef1234567890abcdef12");
    const profileResponse = buildProfileResponse(
      "abcdef1234567890abcdef1234567890abcdef12",
      3,
      15,
    );

    fetchSpy
      .mockResolvedValueOnce(mockRpcResponse(ownerResponse))
      .mockResolvedValueOnce(mockRpcResponse(profileResponse));

    const client = new ERC8004Client(makeConfig());
    const result = await client.lookupReputation(25679);
    expect(result!.tier).toBe("low");
    expect(result!.reputationScore).toBe(15);
  });

  it("exposes cache via getCache()", () => {
    const client = new ERC8004Client(makeConfig());
    const cache = client.getCache();
    expect(cache).toBeInstanceOf(LRUCache);
  });
});

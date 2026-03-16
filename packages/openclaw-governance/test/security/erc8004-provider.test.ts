import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ERC8004Provider } from "../../src/security/erc8004-provider.js";
import type { ERC8004Config, ReputationResult } from "../../src/security/types.js";
import * as fs from "node:fs/promises";

// Mock fs for the REST client's API key loading
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(fs.readFile);

// ── Helpers ──

function makeConfig(overrides: Partial<ERC8004Config> = {}): ERC8004Config {
  return {
    enabled: true,
    rpcUrl: "https://test-rpc.example.com",
    identityRegistryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentProofCoreAddress: "0xABCDEF1234567890abcdef1234567890ABCDEF12",
    agentMapping: { claudia: 16700, stella: 25679 },
    apiKeyFile: "~/.config/agentproof-key",
    restBaseUrl: "https://api.agentproof.xyz/api/v1",
    preferRest: true,
    cache: { ttlSeconds: 3600, maxEntries: 256 },
    ...overrides,
  };
}

function padAddress(addr: string): string {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + clean.padStart(64, "0");
}

function buildProfileResponse(
  owner: string,
  feedbackCount: number,
  reputationScore: number,
): string {
  const ownerHex = (owner.startsWith("0x") ? owner.slice(2) : owner).padStart(64, "0");
  const fcHex = feedbackCount.toString(16).padStart(64, "0");
  const rsHex = reputationScore.toString(16).padStart(64, "0");
  return "0x" + ownerHex + fcHex + rsHex;
}

function mockRpcResponse(result: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockRestResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ──

describe("ERC8004Provider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockReadFile.mockResolvedValue("test-api-key");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("preferRest=true (default)", () => {
    it("uses REST as primary backend", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockRestResponse({
          agentId: 16700,
          exists: true,
          owner: "0xowner",
          feedbackCount: 10,
          reputationScore: 75,
        }),
      );

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("rest");
      expect(result!.reputationScore).toBe(75);
    });

    it("falls back to on-chain when REST fails", async () => {
      // REST fails
      fetchSpy.mockResolvedValueOnce(
        new Response("Error", { status: 500 }),
      );
      // On-chain succeeds: ownerOf + getAgentProfile
      fetchSpy.mockResolvedValueOnce(
        mockRpcResponse(padAddress("abcdef1234567890abcdef1234567890abcdef12")),
      );
      fetchSpy.mockResolvedValueOnce(
        mockRpcResponse(
          buildProfileResponse("abcdef1234567890abcdef1234567890abcdef12", 5, 60),
        ),
      );

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("on-chain");
      expect(result!.reputationScore).toBe(60);
    });

    it("returns null when both REST and on-chain fail", async () => {
      // REST fails
      fetchSpy.mockResolvedValueOnce(
        new Response("Error", { status: 500 }),
      );
      // On-chain fails (network error)
      fetchSpy.mockRejectedValueOnce(new Error("network down"));

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(16700);

      expect(result).toBeNull();
    });
  });

  describe("preferRest=false", () => {
    it("uses on-chain as primary backend", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockRpcResponse(padAddress("abcdef1234567890abcdef1234567890abcdef12")),
        )
        .mockResolvedValueOnce(
          mockRpcResponse(
            buildProfileResponse("abcdef1234567890abcdef1234567890abcdef12", 3, 45),
          ),
        );

      const provider = new ERC8004Provider(makeConfig({ preferRest: false }));
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("on-chain");
      expect(result!.reputationScore).toBe(45);
    });

    it("falls back to REST when on-chain fails", async () => {
      // On-chain fails
      fetchSpy.mockRejectedValueOnce(new Error("RPC down"));
      // REST succeeds
      fetchSpy.mockResolvedValueOnce(
        mockRestResponse({
          agentId: 16700,
          exists: true,
          feedbackCount: 8,
          reputationScore: 88,
        }),
      );

      const provider = new ERC8004Provider(makeConfig({ preferRest: false }));
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("rest");
      expect(result!.reputationScore).toBe(88);
    });

    it("returns null when both fail (fail-open)", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("RPC down"));
      fetchSpy.mockResolvedValueOnce(
        new Response("Error", { status: 500 }),
      );

      const provider = new ERC8004Provider(makeConfig({ preferRest: false }));
      const result = await provider.lookupReputation(16700);

      expect(result).toBeNull();
    });
  });

  describe("No REST configured", () => {
    it("uses only on-chain when no restBaseUrl", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockRpcResponse(padAddress("1234567890abcdef1234567890abcdef12345678")),
        )
        .mockResolvedValueOnce(
          mockRpcResponse(
            buildProfileResponse("1234567890abcdef1234567890abcdef12345678", 1, 50),
          ),
        );

      const provider = new ERC8004Provider(
        makeConfig({ restBaseUrl: undefined, apiKeyFile: undefined }),
      );
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("on-chain");
    });

    it("uses only on-chain when no apiKeyFile", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockRpcResponse(padAddress("1234567890abcdef1234567890abcdef12345678")),
        )
        .mockResolvedValueOnce(
          mockRpcResponse(
            buildProfileResponse("1234567890abcdef1234567890abcdef12345678", 2, 65),
          ),
        );

      const provider = new ERC8004Provider(
        makeConfig({ apiKeyFile: undefined }),
      );
      const result = await provider.lookupReputation(16700);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("on-chain");
    });
  });

  describe("Caching", () => {
    it("returns cached result on second call", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockRestResponse({
          agentId: 16700,
          exists: true,
          feedbackCount: 5,
          reputationScore: 70,
        }),
      );

      const provider = new ERC8004Provider(makeConfig());

      const first = await provider.lookupReputation(16700);
      expect(first!.source).toBe("rest");

      const second = await provider.lookupReputation(16700);
      expect(second!.source).toBe("cache");

      // Only 1 fetch call (REST), not 2
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("clearCache() invalidates all entries", async () => {
      fetchSpy.mockResolvedValue(
        mockRestResponse({
          agentId: 16700,
          exists: true,
          feedbackCount: 5,
          reputationScore: 70,
        }),
      );

      const provider = new ERC8004Provider(makeConfig());
      await provider.lookupReputation(16700);
      expect(provider.cacheSize).toBe(1);

      provider.clearCache();
      expect(provider.cacheSize).toBe(0);
    });

    it("cacheSize reflects entries", async () => {
      const provider = new ERC8004Provider(makeConfig());
      expect(provider.cacheSize).toBe(0);

      fetchSpy.mockResolvedValueOnce(
        mockRestResponse({
          agentId: 1,
          exists: true,
          feedbackCount: 0,
          reputationScore: 0,
        }),
      );
      await provider.lookupReputation(1);
      expect(provider.cacheSize).toBe(1);
    });
  });

  describe("Edge cases", () => {
    it("handles REST returning agent with exists=false", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockRestResponse({
          agentId: 99999,
          exists: false,
        }),
      );

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(99999);

      expect(result).not.toBeNull();
      expect(result!.exists).toBe(false);
      expect(result!.tier).toBe("unregistered");
    });

    it("handles on-chain returning unregistered agent", async () => {
      // REST fails
      fetchSpy.mockResolvedValueOnce(
        new Response("Error", { status: 503 }),
      );
      // On-chain: ownerOf returns zero
      fetchSpy.mockResolvedValueOnce(
        mockRpcResponse("0x" + "0".repeat(64)),
      );

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(99999);

      expect(result).not.toBeNull();
      expect(result!.exists).toBe(false);
      expect(result!.tier).toBe("unregistered");
    });

    it("REST client receives fetch exception gracefully", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      // On-chain also fails
      fetchSpy.mockRejectedValueOnce(new Error("Also down"));

      const provider = new ERC8004Provider(makeConfig());
      const result = await provider.lookupReputation(1);
      expect(result).toBeNull();
    });
  });
});

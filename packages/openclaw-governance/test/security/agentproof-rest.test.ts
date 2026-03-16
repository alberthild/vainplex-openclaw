import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentProofRestClient } from "../../src/security/agentproof-rest.js";
import * as fs from "node:fs/promises";

// ── Mocks ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(fs.readFile);

function mockFetchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ──

describe("AgentProofRestClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockReadFile.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("API Key Loading", () => {
    it("reads API key from file on first request", async () => {
      mockReadFile.mockResolvedValueOnce("test-api-key-123\n");
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 16700,
          exists: true,
          owner: "0x1234",
          feedbackCount: 5,
          reputationScore: 80,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.agentproof.xyz/api/v1",
        "~/.config/agentproof-key",
      );
      await client.getAgentProfile(16700);

      // Check the X-API-Key header
      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-api-key-123");
    });

    it("caches API key after first read", async () => {
      mockReadFile.mockResolvedValueOnce("cached-key\n");
      fetchSpy.mockResolvedValue(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          feedbackCount: 0,
          reputationScore: 0,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.test.com/api/v1",
        "/some/path",
      );
      await client.getAgentProfile(1);
      await client.getAgentProfile(2);

      // readFile should only be called once
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it("sends request without auth if key file is missing", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: false,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.test.com/api/v1",
        "/nonexistent/path",
      );
      await client.getAgentProfile(1);

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBeUndefined();
    });

    it("sends request without auth if key file is empty", async () => {
      mockReadFile.mockResolvedValueOnce("   \n  ");
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: false,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.test.com/api/v1",
        "/empty/key",
      );
      await client.getAgentProfile(1);

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBeUndefined();
    });

    it("trims whitespace from API key", async () => {
      mockReadFile.mockResolvedValueOnce("  my-key-with-spaces  \n");
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          feedbackCount: 0,
          reputationScore: 0,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.test.com/api/v1",
        "/key/file",
      );
      await client.getAgentProfile(1);

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("my-key-with-spaces");
    });
  });

  describe("getAgentProfile", () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue("test-key");
    });

    it("calls GET /trust/{agentId}", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 16700,
          exists: true,
          owner: "0xowner",
          feedbackCount: 10,
          reputationScore: 75,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.agentproof.xyz/api/v1",
        "/key",
      );
      const result = await client.getAgentProfile(16700);

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        "https://api.agentproof.xyz/api/v1/trust/16700",
      );
      expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("GET");
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe(16700);
      expect(result!.exists).toBe(true);
      expect(result!.reputationScore).toBe(75);
      expect(result!.source).toBe("rest");
    });

    it("strips trailing slash from base URL", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          feedbackCount: 0,
          reputationScore: 0,
        }),
      );

      const client = new AgentProofRestClient(
        "https://api.test.com/api/v1///",
        "/key",
      );
      await client.getAgentProfile(1);

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        "https://api.test.com/api/v1/trust/1",
      );
    });

    it("returns null on HTTP 404", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(99999);
      expect(result).toBeNull();
    });

    it("returns null on HTTP 500", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("Server Error", { status: 500 }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result).toBeNull();
    });

    it("returns null on network failure", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("network error"));

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result).toBeNull();
    });

    it("classifies tier correctly from REST data", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          owner: "0xowner",
          feedbackCount: 20,
          reputationScore: 90,
        }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result!.tier).toBe("high");
    });

    it("handles missing optional fields in response", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          // no owner, feedbackCount, reputationScore
        }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result).not.toBeNull();
      expect(result!.owner).toBeNull();
      expect(result!.feedbackCount).toBe(0);
      expect(result!.reputationScore).toBe(0);
    });

    it("clamps reputation score to 0-100", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          agentId: 1,
          exists: true,
          reputationScore: 150,
          feedbackCount: 1,
        }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result!.reputationScore).toBe(100);
    });

    it("returns null for malformed response (no agentId)", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ exists: true }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const result = await client.getAgentProfile(1);
      expect(result).toBeNull();
    });
  });

  describe("batchLookup", () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue("test-key");
    });

    it("calls POST /trust/batch with correct body", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          results: [
            { agentId: 1, exists: true, feedbackCount: 5, reputationScore: 80 },
            { agentId: 2, exists: false },
          ],
        }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const results = await client.batchLookup([1, 2]);

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        "https://api.test.com/api/v1/trust/batch",
      );
      expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");

      const body = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.agentIds).toEqual([1, 2]);

      expect(results).toHaveLength(2);
      expect(results[0]!.agentId).toBe(1);
      expect(results[0]!.tier).toBe("high");
      expect(results[1]!.exists).toBe(false);
    });

    it("returns empty array for empty input", async () => {
      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const results = await client.batchLookup([]);
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns nulls on HTTP error", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("Error", { status: 500 }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const results = await client.batchLookup([1, 2, 3]);
      expect(results).toEqual([null, null, null]);
    });

    it("returns nulls on network failure", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("timeout"));

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const results = await client.batchLookup([1, 2]);
      expect(results).toEqual([null, null]);
    });

    it("returns nulls when response has no results array", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ data: "wrong shape" }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      const results = await client.batchLookup([1, 2]);
      expect(results).toEqual([null, null]);
    });

    it("sends X-API-Key header", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ results: [] }),
      );

      const client = new AgentProofRestClient("https://api.test.com/api/v1", "/key");
      await client.batchLookup([1]);

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-key");
    });
  });

  describe("Write Path (Feedback Signals)", () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue("test-key");
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("DLP stripping: drops unknown fields and caps length to 200", async () => {
      const client = new AgentProofRestClient("https://api.test.com", "/key");
      client.pushSignal(1, "POLICY_VIOLATION", "MEDIUM", {
        toolName: "a".repeat(300),
        policyName: "b".repeat(250),
        ruleId: "c".repeat(50),
        apiKey: "sk-1234567890", // should be stripped
        secret: "supersecret"
      });

      await (client as any).flushQueue();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs![1]!.body as string);

      expect(body[0].context.toolName).toBe("a".repeat(200));
      expect(body[0].context.policyName).toBe("b".repeat(200));
      expect(body[0].context.ruleId).toBe("c".repeat(50));
      expect(body[0].context.apiKey).toBeUndefined();
      expect(body[0].context.secret).toBeUndefined();
    });

    it("Ring buffer overflow: drops oldest items when exceeding MAX_QUEUE_SIZE", () => {
      const client = new AgentProofRestClient("https://api.test.com", "/key");
      // Prevent flusher from actually taking items out of queue
      (client as any).isFlushing = true;

      for (let i = 0; i < 1005; i++) {
        client.pushSignal(i, "TOOL_SUCCESS", "LOW", {});
      }

      const queue = (client as any).signalQueue;
      expect(queue.length).toBe(1000);
      expect(queue[0].agentId).toBe(5); // The first 5 items (0-4) should be dropped
      expect(queue[999].agentId).toBe(1004);
    });

    it("Circuit breaker: 5 failures open circuit for 60s", async () => {
      const client = new AgentProofRestClient("https://api.test.com", "/key");
      fetchSpy.mockRejectedValue(new Error("Network Error"));

      // Trigger 5 failures
      for (let i = 0; i < 5; i++) {
        client.pushSignal(1, "TOOL_SUCCESS", "LOW", {});
        await (client as any).flushQueue();
      }

      expect((client as any).consecutiveFailures).toBe(0);
      expect((client as any).circuitOpenUntil).toBeGreaterThan(Date.now());

      // Try sending again while circuit is open
      fetchSpy.mockClear();
      client.pushSignal(1, "TOOL_SUCCESS", "LOW", {});
      await (client as any).flushQueue();
      expect(fetchSpy).not.toHaveBeenCalled();

      // Advance 61 seconds (past 60s timeout)
      vi.advanceTimersByTime(61000);

      // Verify circuit is closed and request goes through
      // There will be 5 pending batches + 1 new batch in the queue
      fetchSpy.mockResolvedValue(new Response("OK", { status: 200 }));
      await (client as any).flushQueue();
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it("Retry / Backoff logic: retries up to 3 times with exponential backoff", async () => {
      fetchSpy.mockResolvedValue(new Response("Too Many Requests", { status: 429 }));
      const client = new AgentProofRestClient("https://api.test.com", "/key");

      client.pushSignal(1, "POLICY_VIOLATION", "MEDIUM", {});
      await (client as any).flushQueue();

      // Initial failure -> placed in pendingBatches with retries=1
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const batches = (client as any).pendingBatches;
      expect(batches.length).toBe(1);
      expect(batches[0].retries).toBe(1);

      // Advance 500ms -> delay is 1000ms, should not retry
      vi.advanceTimersByTime(500);
      await (client as any).flushQueue();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance 500ms more -> 1000ms total, should retry
      vi.advanceTimersByTime(500);
      await (client as any).flushQueue();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(batches[0].retries).toBe(2);

      // Advance 2000ms -> delay is 2000ms, should retry
      vi.advanceTimersByTime(2000);
      await (client as any).flushQueue();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(batches[0].retries).toBe(3);

      // Advance 4000ms -> delay is 4000ms, should retry
      vi.advanceTimersByTime(4000);
      await (client as any).flushQueue();
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // Max retries hit, batch should be discarded
      expect((client as any).pendingBatches.length).toBe(0);
    });
  });
});

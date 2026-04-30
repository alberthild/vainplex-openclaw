import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentProofRestClient } from "./agentproof-rest.js";

// Mock globals
global.fetch = vi.fn();
const mockFetch = global.fetch as any;

describe("AgentProofRestClient (Write Integration)", () => {
  let client: AgentProofRestClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new AgentProofRestClient("http://localhost:8000", async () => "test-key");
    client.startFlusher();
    mockFetch.mockReset();
  });

  afterEach(() => {
    client.stopFlusher();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("Data Leakage Prevention: Strips unallowed context keys (Error stacks, etc)", () => {
    const maliciousContext = {
      toolName: "exec",
      policyName: "safe-exec",
      awsKey: "AKIAIOSFODNN7EXAMPLE",
      errorStack: "Error: Process crashed\n  at main.js:12",
      someOutput: "secret token 12345"
    };

    client.pushSignal(101, "POLICY_VIOLATION", "HIGH", maliciousContext);

    // Force flush
    vi.advanceTimersByTime(5000);

    // Since we didn't mock fetch return yet, it will fail but we just care about the payload
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    const payload = JSON.parse(callArgs[1].body);

    expect(payload).toHaveLength(1);
    const context = payload[0].context;

    // Allowed keys
    expect(context.toolName).toBe("exec");
    expect(context.policyName).toBe("safe-exec");

    // Stripped keys
    expect(context.awsKey).toBeUndefined();
    expect(context.errorStack).toBeUndefined();
    expect(context.someOutput).toBeUndefined();
  });

  it("Ring Buffer Queue: Drops oldest items when exceeding MAX_QUEUE_SIZE", () => {
    for (let i = 0; i < 1005; i++) {
      client.pushSignal(i, "TOOL_SUCCESS", "LOW", { toolName: `tool-${i}` });
    }

    // Access private queue length (for testing)
    const queue = (client as any).signalQueue;
    expect(queue.length).toBe(1000);
    
    // The first item should now be index 5, not 0
    expect(queue[0].agentId).toBe(5);
    expect(queue[999].agentId).toBe(1004);
  });

  it("Fail-Open & Retry: Exponential Backoff on 429", async () => {
    // Return 429 Retry-After
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    client.pushSignal(1, "POLICY_VIOLATION", "HIGH", {});

    // First flush
    const flushPromise1 = (client as any).flushQueue();
    vi.runAllTimers();
    await flushPromise1;

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The batch should be put back into pendingBatches
    const pending = (client as any).pendingBatches;
    expect(pending.length).toBe(1);
    expect(pending[0].retries).toBe(1);
    
    // Fast forward to next retry time (1000ms delay)
    const flushPromise2 = (client as any).flushQueue();
    vi.advanceTimersByTime(1000);
    await flushPromise2;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(pending[0].retries).toBe(2);
  });

  it("Circuit Breaker: Opens after 5 consecutive failures", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    for (let i = 0; i < 5; i++) {
      client.pushSignal(i, "POLICY_VIOLATION", "HIGH", {});
      const flushPromise = (client as any).flushQueue();
      vi.runAllTimers();
      await flushPromise;
    }

    // After 5 failures, circuit should be open
    const circuitOpenUntil = (client as any).circuitOpenUntil;
    expect(circuitOpenUntil).toBeGreaterThan(Date.now());

    mockFetch.mockClear();

    // Next push should not trigger a fetch immediately
    client.pushSignal(99, "POLICY_VIOLATION", "HIGH", {});
    const flushPromiseOpen = (client as any).flushQueue();
    vi.runAllTimers();
    await flushPromiseOpen;

    expect(mockFetch).not.toHaveBeenCalled();
    
    // Fast forward 60 seconds
    vi.advanceTimersByTime(60000);
    
    // Now it should try again
    const flushPromiseClosed = (client as any).flushQueue();
    vi.runAllTimers();
    await flushPromiseClosed;
    
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("Graceful Shutdown: Flushes on SIGTERM", () => {
    client.pushSignal(42, "POLICY_VIOLATION", "CRITICAL", {});

    // We can't actually emit process SIGTERM easily without causing vitest issues,
    // so we call the shutdownHandler directly
    (client as any).shutdownHandler();

    // Even without advanceTimersByTime, it should have triggered a flush
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

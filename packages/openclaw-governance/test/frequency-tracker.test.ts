import { describe, expect, it } from "vitest";
import { FrequencyTrackerImpl } from "../src/frequency-tracker.js";

describe("FrequencyTrackerImpl", () => {
  it("should count entries within time window", () => {
    const ft = new FrequencyTrackerImpl(100);
    const now = Date.now();

    ft.record({ timestamp: now - 5000, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now - 3000, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now - 1000, agentId: "a", sessionKey: "s1" });

    expect(ft.count(10, "agent", "a", "s1")).toBe(3);
    expect(ft.count(2, "agent", "a", "s1")).toBe(1);
  });

  it("should filter by scope: agent", () => {
    const ft = new FrequencyTrackerImpl(100);
    const now = Date.now();

    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now, agentId: "b", sessionKey: "s2" });
    ft.record({ timestamp: now, agentId: "a", sessionKey: "s3" });

    expect(ft.count(60, "agent", "a", "s1")).toBe(2);
    expect(ft.count(60, "agent", "b", "s2")).toBe(1);
  });

  it("should filter by scope: session", () => {
    const ft = new FrequencyTrackerImpl(100);
    const now = Date.now();

    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now, agentId: "a", sessionKey: "s2" });

    expect(ft.count(60, "session", "a", "s1")).toBe(2);
    expect(ft.count(60, "session", "a", "s2")).toBe(1);
  });

  it("should count globally", () => {
    const ft = new FrequencyTrackerImpl(100);
    const now = Date.now();

    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now, agentId: "b", sessionKey: "s2" });
    ft.record({ timestamp: now, agentId: "c", sessionKey: "s3" });

    expect(ft.count(60, "global", "x", "y")).toBe(3);
  });

  it("should handle ring buffer wrap", () => {
    const ft = new FrequencyTrackerImpl(3);
    const now = Date.now();

    ft.record({ timestamp: now - 4000, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now - 3000, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now - 2000, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now - 1000, agentId: "a", sessionKey: "s1" }); // overwrites first
    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" }); // overwrites second

    expect(ft.count(60, "global", "a", "s1")).toBe(3); // buffer size is 3
  });

  it("should clear all entries", () => {
    const ft = new FrequencyTrackerImpl(100);
    const now = Date.now();

    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });
    ft.record({ timestamp: now, agentId: "a", sessionKey: "s1" });

    ft.clear();
    expect(ft.count(60, "global", "a", "s1")).toBe(0);
  });

  it("should handle expired entries gracefully", () => {
    const ft = new FrequencyTrackerImpl(100);

    ft.record({ timestamp: Date.now() - 120_000, agentId: "a", sessionKey: "s1" });

    expect(ft.count(60, "global", "a", "s1")).toBe(0);
  });
});

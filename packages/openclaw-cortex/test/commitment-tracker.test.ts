import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { CommitmentTracker, loadCommitments, markOverdue } from "../src/commitment-tracker.js";

const TEST_WORKSPACE = "/tmp/cortex-test-commitments";
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

beforeEach(() => {
  mkdirSync(`${TEST_WORKSPACE}/memory/reboot`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("CommitmentTracker", () => {
  it("detects commitments from messages", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    const result = tracker.processMessage("I'll fix the auth bug tomorrow", "alice");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].who).toBe("alice");
    expect(result[0].status).toBe("open");
  });

  it("uses captured regex group for 'what'", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    const result = tracker.processMessage("I'll deploy the new version tonight", "bob");
    expect(result.length).toBeGreaterThan(0);
    // 'what' should be the captured group, not the full message
    expect(result[0].what).not.toBe("I'll deploy the new version tonight");
    expect(result[0].what.length).toBeLessThan(result[0].source_message.length);
  });

  it("deduplicates identical commitments from same message", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    // A message that might match multiple patterns with same captured text
    const result = tracker.processMessage("I will handle it and I'll handle it", "alice");
    // Should not have exact duplicates
    const whats = result.map((c) => c.what);
    const unique = new Set(whats);
    expect(unique.size).toBe(whats.length);
  });

  it("returns empty for non-commitment messages", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    const result = tracker.processMessage("The weather is nice", "alice");
    expect(result).toHaveLength(0);
  });

  it("flushes to disk", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    tracker.processMessage("I'll fix the build", "alice");
    tracker.flush();
    const loaded = loadCommitments(TEST_WORKSPACE);
    expect(loaded.length).toBeGreaterThan(0);
  });

  it("getAll returns commitments with overdue marking", () => {
    const tracker = new CommitmentTracker(TEST_WORKSPACE, logger);
    tracker.processMessage("I will review the PR", "bob");
    const all = tracker.getAll();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0].status).toBe("open"); // Just created, not overdue
  });
});

describe("markOverdue", () => {
  it("marks old open commitments as overdue", () => {
    const old = [{
      id: "1", what: "test", who: "alice", status: "open" as const,
      created: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      source_message: "test",
    }];
    const result = markOverdue(old);
    expect(result[0].status).toBe("overdue");
  });

  it("does not mark recent commitments as overdue", () => {
    const recent = [{
      id: "1", what: "test", who: "alice", status: "open" as const,
      created: new Date().toISOString(),
      source_message: "test",
    }];
    const result = markOverdue(recent);
    expect(result[0].status).toBe("open");
  });

  it("does not change done commitments", () => {
    const done = [{
      id: "1", what: "test", who: "alice", status: "done" as const,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      source_message: "test",
    }];
    const result = markOverdue(done);
    expect(result[0].status).toBe("done");
  });
});

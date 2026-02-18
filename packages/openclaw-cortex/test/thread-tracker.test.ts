import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ThreadTracker, extractSignals, matchesThread } from "../src/thread-tracker.js";
import type { Thread } from "../src/types.js";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-tt-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

function readThreads(ws: string) {
  const raw = readFileSync(join(ws, "memory", "reboot", "threads.json"), "utf-8");
  return JSON.parse(raw);
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "test-id",
    title: "auth migration OAuth2",
    status: "open",
    priority: "medium",
    summary: "test thread",
    decisions: [],
    waiting_for: null,
    mood: "neutral",
    last_activity: new Date().toISOString(),
    created: new Date().toISOString(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// matchesThread
// ════════════════════════════════════════════════════════════
describe("matchesThread", () => {
  it("matches when 2+ title words appear in text", () => {
    const thread = makeThread({ title: "auth migration OAuth2" });
    expect(matchesThread(thread, "the auth migration is progressing")).toBe(true);
  });

  it("does not match with only 1 overlapping word", () => {
    const thread = makeThread({ title: "auth migration OAuth2" });
    expect(matchesThread(thread, "auth is broken")).toBe(false);
  });

  it("does not match with zero overlapping words", () => {
    const thread = makeThread({ title: "auth migration OAuth2" });
    expect(matchesThread(thread, "the weather is nice")).toBe(false);
  });

  it("is case-insensitive", () => {
    const thread = makeThread({ title: "Auth Migration" });
    expect(matchesThread(thread, "the AUTH MIGRATION works")).toBe(true);
  });

  it("ignores words shorter than 3 characters", () => {
    const thread = makeThread({ title: "a b c migration" });
    // Only "migration" is > 2 chars, need 2 matches → false
    expect(matchesThread(thread, "a b c something")).toBe(false);
  });

  it("respects custom minOverlap", () => {
    const thread = makeThread({ title: "auth migration OAuth2" });
    expect(matchesThread(thread, "auth migration OAuth2 is great", 3)).toBe(true);
    expect(matchesThread(thread, "the auth migration is progressing", 3)).toBe(false);
  });

  it("handles empty title", () => {
    const thread = makeThread({ title: "" });
    expect(matchesThread(thread, "some text")).toBe(false);
  });

  it("handles empty text", () => {
    const thread = makeThread({ title: "auth migration" });
    expect(matchesThread(thread, "")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// extractSignals
// ════════════════════════════════════════════════════════════
describe("extractSignals", () => {
  it("extracts decision signals", () => {
    const signals = extractSignals("We decided to use TypeScript for all plugins", "both");
    expect(signals.decisions.length).toBeGreaterThan(0);
    expect(signals.decisions[0]).toContain("decided");
  });

  it("extracts closure signals", () => {
    const signals = extractSignals("The bug is fixed and working now", "both");
    expect(signals.closures.length).toBeGreaterThan(0);
  });

  it("extracts wait signals", () => {
    const signals = extractSignals("We are waiting for the code review", "both");
    expect(signals.waits.length).toBeGreaterThan(0);
    expect(signals.waits[0]).toContain("waiting for");
  });

  it("extracts topic signals", () => {
    const signals = extractSignals("Let's get back to the auth migration", "both");
    expect(signals.topics.length).toBeGreaterThan(0);
    expect(signals.topics[0]).toContain("auth migration");
  });

  it("extracts multiple signal types from same text", () => {
    const signals = extractSignals(
      "Back to the auth module. We decided to fix it. It's done!",
      "both",
    );
    expect(signals.topics.length).toBeGreaterThan(0);
    expect(signals.decisions.length).toBeGreaterThan(0);
    expect(signals.closures.length).toBeGreaterThan(0);
  });

  it("extracts German signals with 'both'", () => {
    const signals = extractSignals("Wir haben beschlossen, das zu machen", "both");
    expect(signals.decisions.length).toBeGreaterThan(0);
  });

  it("returns empty signals for unrelated text", () => {
    const signals = extractSignals("The sky is blue and the grass is green", "both");
    expect(signals.decisions).toHaveLength(0);
    expect(signals.closures).toHaveLength(0);
    expect(signals.waits).toHaveLength(0);
    expect(signals.topics).toHaveLength(0);
  });

  it("extracts context window around decisions (50 before, 100 after)", () => {
    const padding = "x".repeat(60);
    const after = "y".repeat(120);
    const text = `${padding}decided to use TypeScript${after}`;
    const signals = extractSignals(text, "en");
    expect(signals.decisions.length).toBeGreaterThan(0);
    // Context window should be trimmed
    const ctx = signals.decisions[0];
    expect(ctx.length).toBeLessThan(text.length);
  });

  it("handles empty text", () => {
    const signals = extractSignals("", "both");
    expect(signals.decisions).toHaveLength(0);
    expect(signals.closures).toHaveLength(0);
    expect(signals.waits).toHaveLength(0);
    expect(signals.topics).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — basic operations
// ════════════════════════════════════════════════════════════
describe("ThreadTracker", () => {
  let workspace: string;
  let tracker: ThreadTracker;

  beforeEach(() => {
    workspace = makeWorkspace();
    tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);
  });

  it("starts with empty threads", () => {
    expect(tracker.getThreads()).toHaveLength(0);
  });

  it("detects a new topic from a topic pattern", () => {
    tracker.processMessage("Let's get back to the auth migration", "user");
    const threads = tracker.getThreads();
    expect(threads.length).toBeGreaterThanOrEqual(1);
    // Should contain something related to "auth migration"
    const found = threads.some(t =>
      t.title.toLowerCase().includes("auth migration"),
    );
    expect(found).toBe(true);
  });

  it("creates thread with correct defaults", () => {
    tracker.processMessage("back to the deployment pipeline", "user");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("deployment pipeline"),
    );
    expect(thread).toBeDefined();
    expect(thread!.status).toBe("open");
    expect(thread!.decisions).toHaveLength(0);
    expect(thread!.waiting_for).toBeNull();
    expect(thread!.id).toBeTruthy();
    expect(thread!.created).toBeTruthy();
    expect(thread!.last_activity).toBeTruthy();
  });

  it("does not create duplicate threads for same topic", () => {
    tracker.processMessage("back to the deployment pipeline", "user");
    tracker.processMessage("back to the deployment pipeline", "user");
    const threads = tracker.getThreads().filter(t =>
      t.title.toLowerCase().includes("deployment pipeline"),
    );
    expect(threads.length).toBe(1);
  });

  it("closes a thread when closure pattern detected", () => {
    tracker.processMessage("back to the login bug fix", "user");
    tracker.processMessage("the login bug fix is done ✅", "assistant");
    const threads = tracker.getThreads();
    const loginThread = threads.find(t =>
      t.title.toLowerCase().includes("login bug"),
    );
    expect(loginThread?.status).toBe("closed");
  });

  it("appends decisions to matching threads", () => {
    tracker.processMessage("back to the auth migration plan", "user");
    tracker.processMessage("For the auth migration plan, we decided to use OAuth2 with PKCE", "assistant");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("auth migration"),
    );
    expect(thread?.decisions.length).toBeGreaterThan(0);
  });

  it("updates waiting_for on matching threads", () => {
    tracker.processMessage("back to the deployment pipeline work", "user");
    tracker.processMessage("The deployment pipeline is waiting for the staging environment fix", "user");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("deployment pipeline"),
    );
    expect(thread?.waiting_for).toBeTruthy();
  });

  it("updates mood on threads when mood detected", () => {
    tracker.processMessage("back to the auth migration work", "user");
    tracker.processMessage("this auth migration is awesome! auth migration rocks 🚀", "user");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("auth migration"),
    );
    expect(thread?.mood).not.toBe("neutral");
  });

  it("persists threads to disk", () => {
    tracker.processMessage("back to the config refactor", "user");
    const data = readThreads(workspace);
    expect(data.version).toBe(2);
    expect(data.threads.length).toBeGreaterThan(0);
  });

  it("tracks session mood", () => {
    tracker.processMessage("This is awesome! 🚀", "user");
    expect(tracker.getSessionMood()).not.toBe("neutral");
  });

  it("increments events processed", () => {
    tracker.processMessage("hello", "user");
    tracker.processMessage("world", "user");
    expect(tracker.getEventsProcessed()).toBe(2);
  });

  it("skips empty content", () => {
    tracker.processMessage("", "user");
    expect(tracker.getEventsProcessed()).toBe(0);
  });

  it("persists integrity data", () => {
    tracker.processMessage("back to something here now", "user");
    const data = readThreads(workspace);
    expect(data.integrity).toBeDefined();
    expect(data.integrity.source).toBe("hooks");
    expect(data.integrity.events_processed).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — pruning
// ════════════════════════════════════════════════════════════
describe("ThreadTracker — pruning", () => {
  it("prunes closed threads older than pruneDays", () => {
    const workspace = makeWorkspace();
    // Seed with an old closed thread
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const threadsData = {
      version: 2,
      updated: oldDate,
      threads: [
        makeThread({
          id: "old-closed",
          title: "old deployment pipeline issue",
          status: "closed",
          last_activity: oldDate,
          created: oldDate,
        }),
        makeThread({
          id: "recent-open",
          title: "recent auth migration work",
          status: "open",
          last_activity: new Date().toISOString(),
        }),
      ],
      integrity: { last_event_timestamp: oldDate, events_processed: 1, source: "hooks" as const },
      session_mood: "neutral",
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "threads.json"),
      JSON.stringify(threadsData),
    );

    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    // Trigger processing + prune
    tracker.processMessage("back to the recent auth migration work update", "user");

    const threads = tracker.getThreads();
    expect(threads.find(t => t.id === "old-closed")).toBeUndefined();
    expect(threads.find(t => t.id === "recent-open")).toBeDefined();
  });

  it("keeps closed threads within pruneDays", () => {
    const workspace = makeWorkspace();
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const threadsData = {
      version: 2,
      updated: recentDate,
      threads: [
        makeThread({
          id: "recent-closed",
          title: "recent fix completed done",
          status: "closed",
          last_activity: recentDate,
        }),
      ],
      integrity: { last_event_timestamp: recentDate, events_processed: 1, source: "hooks" as const },
      session_mood: "neutral",
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "threads.json"),
      JSON.stringify(threadsData),
    );

    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    tracker.processMessage("back to the something else here", "user");
    expect(tracker.getThreads().find(t => t.id === "recent-closed")).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — maxThreads cap
// ════════════════════════════════════════════════════════════
describe("ThreadTracker — maxThreads cap", () => {
  it("enforces maxThreads cap by removing oldest closed threads", () => {
    const workspace = makeWorkspace();
    const threads: Thread[] = [];

    // Create 8 threads: 5 open + 3 closed
    for (let i = 0; i < 5; i++) {
      threads.push(makeThread({
        id: `open-${i}`,
        title: `open thread number ${i} task`,
        status: "open",
        last_activity: new Date(Date.now() - i * 60000).toISOString(),
      }));
    }
    for (let i = 0; i < 3; i++) {
      threads.push(makeThread({
        id: `closed-${i}`,
        title: `closed thread number ${i} done`,
        status: "closed",
        last_activity: new Date(Date.now() - i * 60000).toISOString(),
      }));
    }

    const threadsData = {
      version: 2,
      updated: new Date().toISOString(),
      threads,
      integrity: { last_event_timestamp: new Date().toISOString(), events_processed: 1, source: "hooks" as const },
      session_mood: "neutral",
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "threads.json"),
      JSON.stringify(threadsData),
    );

    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 6, // 8 threads → cap at 6
    }, "both", logger);

    // Trigger processing which runs cap
    tracker.processMessage("back to some topic here now", "user");

    const result = tracker.getThreads();
    expect(result.length).toBeLessThanOrEqual(7); // 6 + possible 1 new
    // All open threads should be preserved
    const openCount = result.filter(t => t.status === "open").length;
    expect(openCount).toBeGreaterThanOrEqual(5);
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — loading existing state
// ════════════════════════════════════════════════════════════
describe("ThreadTracker — loading existing state", () => {
  it("loads threads from existing threads.json", () => {
    const workspace = makeWorkspace();
    const threadsData = {
      version: 2,
      updated: new Date().toISOString(),
      threads: [
        makeThread({ id: "existing-1", title: "existing auth migration thread" }),
      ],
      integrity: { last_event_timestamp: new Date().toISOString(), events_processed: 5, source: "hooks" as const },
      session_mood: "excited",
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "threads.json"),
      JSON.stringify(threadsData),
    );

    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    expect(tracker.getThreads()).toHaveLength(1);
    expect(tracker.getThreads()[0].id).toBe("existing-1");
  });

  it("handles missing threads.json gracefully", () => {
    const workspace = makeWorkspace();
    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    expect(tracker.getThreads()).toHaveLength(0);
  });

  it("handles corrupt threads.json gracefully", () => {
    const workspace = makeWorkspace();
    writeFileSync(
      join(workspace, "memory", "reboot", "threads.json"),
      "not valid json{{{",
    );

    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    expect(tracker.getThreads()).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — flush
// ════════════════════════════════════════════════════════════
describe("ThreadTracker — flush", () => {
  it("flush() persists dirty state", () => {
    const workspace = makeWorkspace();
    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    tracker.processMessage("back to the pipeline review", "user");
    const result = tracker.flush();
    expect(result).toBe(true);
  });

  it("flush() returns true when no dirty state", () => {
    const workspace = makeWorkspace();
    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    expect(tracker.flush()).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// ThreadTracker — priority inference
// ════════════════════════════════════════════════════════════
describe("ThreadTracker — priority inference", () => {
  it("assigns high priority for topics with impact keywords", () => {
    const workspace = makeWorkspace();
    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    tracker.processMessage("back to the security audit review", "user");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("security"),
    );
    expect(thread?.priority).toBe("high");
  });

  it("assigns medium priority for generic topics", () => {
    const workspace = makeWorkspace();
    const tracker = new ThreadTracker(workspace, {
      enabled: true,
      pruneDays: 7,
      maxThreads: 50,
    }, "both", logger);

    tracker.processMessage("back to the feature flag setup", "user");
    const thread = tracker.getThreads().find(t =>
      t.title.toLowerCase().includes("feature flag"),
    );
    expect(thread?.priority).toBe("medium");
  });
});

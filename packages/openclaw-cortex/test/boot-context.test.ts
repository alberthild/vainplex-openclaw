import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BootContextGenerator,
  getExecutionMode,
  getOpenThreads,
  integrityWarning,
} from "../src/boot-context.js";
import type { CortexConfig } from "../src/types.js";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-bc-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

const defaultBootConfig: CortexConfig["bootContext"] = {
  enabled: true,
  maxChars: 16000,
  onSessionStart: true,
  maxThreadsInBoot: 7,
  maxDecisionsInBoot: 10,
  decisionRecencyDays: 14,
};

function seedThreads(ws: string, threads: Record<string, unknown>[] = []) {
  writeFileSync(
    join(ws, "memory", "reboot", "threads.json"),
    JSON.stringify({
      version: 2,
      updated: new Date().toISOString(),
      threads,
      integrity: {
        last_event_timestamp: new Date().toISOString(),
        events_processed: 5,
        source: "hooks",
      },
      session_mood: "productive",
    }),
  );
}

function seedDecisions(ws: string, decisions: Record<string, unknown>[] = []) {
  writeFileSync(
    join(ws, "memory", "reboot", "decisions.json"),
    JSON.stringify({
      version: 1,
      updated: new Date().toISOString(),
      decisions,
    }),
  );
}

function seedNarrative(ws: string, content: string, hoursOld = 0) {
  const filePath = join(ws, "memory", "reboot", "narrative.md");
  writeFileSync(filePath, content);
  if (hoursOld > 0) {
    const mtime = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    utimesSync(filePath, mtime, mtime);
  }
}

function seedHotSnapshot(ws: string, content: string, hoursOld = 0) {
  const filePath = join(ws, "memory", "reboot", "hot-snapshot.md");
  writeFileSync(filePath, content);
  if (hoursOld > 0) {
    const mtime = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    utimesSync(filePath, mtime, mtime);
  }
}

// ════════════════════════════════════════════════════════════
// getExecutionMode
// ════════════════════════════════════════════════════════════
describe("getExecutionMode", () => {
  it("returns a string containing a mode description", () => {
    const mode = getExecutionMode();
    expect(typeof mode).toBe("string");
    expect(mode.length).toBeGreaterThan(0);
    // Should contain one of the known modes
    const validModes = ["Morning", "Afternoon", "Evening", "Night"];
    expect(validModes.some(m => mode.includes(m))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// getOpenThreads
// ════════════════════════════════════════════════════════════
describe("getOpenThreads", () => {
  it("returns only open threads", () => {
    const ws = makeWorkspace();
    seedThreads(ws, [
      { id: "1", title: "open one", status: "open", priority: "medium", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: new Date().toISOString(), created: new Date().toISOString() },
      { id: "2", title: "closed one", status: "closed", priority: "medium", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: new Date().toISOString(), created: new Date().toISOString() },
    ]);

    const threads = getOpenThreads(ws, 7);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("1");
  });

  it("sorts by priority (critical first)", () => {
    const ws = makeWorkspace();
    seedThreads(ws, [
      { id: "low", title: "low", status: "open", priority: "low", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: new Date().toISOString(), created: new Date().toISOString() },
      { id: "critical", title: "crit", status: "open", priority: "critical", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: new Date().toISOString(), created: new Date().toISOString() },
      { id: "high", title: "high", status: "open", priority: "high", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: new Date().toISOString(), created: new Date().toISOString() },
    ]);

    const threads = getOpenThreads(ws, 7);
    expect(threads[0].id).toBe("critical");
    expect(threads[1].id).toBe("high");
    expect(threads[2].id).toBe("low");
  });

  it("within same priority, sorts by recency (newest first)", () => {
    const ws = makeWorkspace();
    const older = new Date(Date.now() - 60000).toISOString();
    const newer = new Date().toISOString();
    seedThreads(ws, [
      { id: "old", title: "old", status: "open", priority: "medium", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: older, created: older },
      { id: "new", title: "new", status: "open", priority: "medium", summary: "", decisions: [], waiting_for: null, mood: "neutral", last_activity: newer, created: newer },
    ]);

    const threads = getOpenThreads(ws, 7);
    expect(threads[0].id).toBe("new");
  });

  it("respects limit parameter", () => {
    const ws = makeWorkspace();
    const threads = Array.from({ length: 10 }, (_, i) => ({
      id: `t-${i}`, title: `thread ${i}`, status: "open", priority: "medium",
      summary: "", decisions: [], waiting_for: null, mood: "neutral",
      last_activity: new Date().toISOString(), created: new Date().toISOString(),
    }));
    seedThreads(ws, threads);

    const result = getOpenThreads(ws, 3);
    expect(result).toHaveLength(3);
  });

  it("handles missing threads.json", () => {
    const ws = makeWorkspace();
    const threads = getOpenThreads(ws, 7);
    expect(threads).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// integrityWarning
// ════════════════════════════════════════════════════════════
describe("integrityWarning", () => {
  it("returns warning when no integrity data", () => {
    const ws = makeWorkspace();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({ version: 2, threads: [], integrity: {}, session_mood: "neutral" }),
    );
    const warning = integrityWarning(ws);
    expect(warning).toContain("⚠️");
  });

  it("returns empty string for fresh data", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const warning = integrityWarning(ws);
    expect(warning).toBe("");
  });

  it("returns staleness warning for data > 2h old", () => {
    const ws = makeWorkspace();
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "neutral",
        integrity: { last_event_timestamp: old, events_processed: 1, source: "hooks" },
      }),
    );
    const warning = integrityWarning(ws);
    expect(warning).toContain("⚠️");
    expect(warning).toContain("staleness");
  });

  it("returns STALE DATA for data > 8h old", () => {
    const ws = makeWorkspace();
    const old = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "neutral",
        integrity: { last_event_timestamp: old, events_processed: 1, source: "hooks" },
      }),
    );
    const warning = integrityWarning(ws);
    expect(warning).toContain("🚨");
    expect(warning).toContain("STALE DATA");
  });

  it("handles missing file gracefully", () => {
    const ws = makeWorkspace();
    const warning = integrityWarning(ws);
    expect(warning).toContain("⚠️");
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — generate
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — generate", () => {
  it("produces valid markdown with header", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("# Context Briefing");
    expect(md).toContain("Generated:");
  });

  it("includes execution mode", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("Mode:");
  });

  it("includes session mood if not neutral", () => {
    const ws = makeWorkspace();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "excited",
        integrity: { last_event_timestamp: new Date().toISOString(), events_processed: 1, source: "hooks" },
      }),
    );
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("excited");
    expect(md).toContain("🔥");
  });

  it("includes active threads section", () => {
    const ws = makeWorkspace();
    seedThreads(ws, [
      {
        id: "1", title: "auth migration", status: "open", priority: "high",
        summary: "Migrating to OAuth2", decisions: ["use PKCE"], waiting_for: "code review",
        mood: "productive", last_activity: new Date().toISOString(), created: new Date().toISOString(),
      },
    ]);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("🧵 Active Threads");
    expect(md).toContain("auth migration");
    expect(md).toContain("🟠"); // high priority
    expect(md).toContain("Migrating to OAuth2");
    expect(md).toContain("⏳ Waiting for: code review");
    expect(md).toContain("use PKCE");
  });

  it("includes recent decisions section", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    seedDecisions(ws, [
      {
        id: "d1", what: "decided to use TypeScript",
        date: new Date().toISOString().slice(0, 10),
        why: "Type safety", impact: "high", who: "albert",
        extracted_at: new Date().toISOString(),
      },
    ]);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("🎯 Recent Decisions");
    expect(md).toContain("decided to use TypeScript");
  });

  it("includes narrative when fresh", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    seedNarrative(ws, "Today was productive. Built the cortex plugin.", 0);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("📖 Narrative");
    expect(md).toContain("Today was productive");
  });

  it("excludes narrative when stale (>36h)", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    seedNarrative(ws, "Old narrative content here", 48);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).not.toContain("Old narrative content");
  });

  it("includes hot snapshot when fresh", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    seedHotSnapshot(ws, "# Hot Snapshot\nRecent conversation...", 0);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("🔥 Last Session Snapshot");
  });

  it("excludes hot snapshot when stale (>1h)", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    seedHotSnapshot(ws, "# Old Snapshot\nOld conversation...", 2);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).not.toContain("Old Snapshot");
  });

  it("includes footer with stats", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("_Boot context |");
  });

  it("handles empty state gracefully", () => {
    const ws = makeWorkspace();
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("# Context Briefing");
    expect(md).toContain("_Boot context |");
    // Should still be valid markdown
    expect(md.length).toBeGreaterThan(50);
  });

  it("excludes decisions older than decisionRecencyDays", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    seedDecisions(ws, [
      {
        id: "old", what: "old decision about fonts",
        date: oldDate, why: "legacy", impact: "medium", who: "user",
        extracted_at: new Date().toISOString(),
      },
    ]);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).not.toContain("old decision about fonts");
  });

  it("limits threads to maxThreadsInBoot", () => {
    const ws = makeWorkspace();
    const threads = Array.from({ length: 15 }, (_, i) => ({
      id: `t-${i}`, title: `thread ${i}`, status: "open", priority: "medium",
      summary: `summary ${i}`, decisions: [], waiting_for: null, mood: "neutral",
      last_activity: new Date().toISOString(), created: new Date().toISOString(),
    }));
    seedThreads(ws, threads);
    const config = { ...defaultBootConfig, maxThreadsInBoot: 3 };
    const gen = new BootContextGenerator(ws, config, logger);
    const md = gen.generate();
    // Count thread section headers
    const threadHeaders = (md.match(/^### /gm) || []).length;
    expect(threadHeaders).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — truncation
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — truncation", () => {
  it("truncates output exceeding maxChars", () => {
    const ws = makeWorkspace();
    // Seed many threads to exceed budget
    const threads = Array.from({ length: 20 }, (_, i) => ({
      id: `t-${i}`, title: `very long thread title number ${i}`,
      status: "open", priority: "medium",
      summary: "A".repeat(500), decisions: ["X".repeat(100)],
      waiting_for: "Y".repeat(100), mood: "neutral",
      last_activity: new Date().toISOString(), created: new Date().toISOString(),
    }));
    seedThreads(ws, threads);
    const config = { ...defaultBootConfig, maxChars: 2000 };
    const gen = new BootContextGenerator(ws, config, logger);
    const md = gen.generate();
    expect(md.length).toBeLessThanOrEqual(2100); // 2000 + truncation marker
    expect(md).toContain("[truncated");
  });

  it("does not truncate within budget", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const config = { ...defaultBootConfig, maxChars: 64000 };
    const gen = new BootContextGenerator(ws, config, logger);
    const md = gen.generate();
    expect(md).not.toContain("[truncated");
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — write
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — write", () => {
  it("writes BOOTSTRAP.md to workspace root", () => {
    const ws = makeWorkspace();
    seedThreads(ws);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const result = gen.write();
    expect(result).toBe(true);

    const content = readFileSync(join(ws, "BOOTSTRAP.md"), "utf-8");
    expect(content).toContain("# Context Briefing");
  });

  it("overwrites existing BOOTSTRAP.md", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "BOOTSTRAP.md"), "old content");
    seedThreads(ws);
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    gen.write();

    const content = readFileSync(join(ws, "BOOTSTRAP.md"), "utf-8");
    expect(content).toContain("# Context Briefing");
    expect(content).not.toContain("old content");
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — shouldGenerate
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — shouldGenerate", () => {
  it("returns true when enabled and onSessionStart", () => {
    const ws = makeWorkspace();
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    expect(gen.shouldGenerate()).toBe(true);
  });

  it("returns false when disabled", () => {
    const ws = makeWorkspace();
    const config = { ...defaultBootConfig, enabled: false };
    const gen = new BootContextGenerator(ws, config, logger);
    expect(gen.shouldGenerate()).toBe(false);
  });

  it("returns false when onSessionStart is false", () => {
    const ws = makeWorkspace();
    const config = { ...defaultBootConfig, onSessionStart: false };
    const gen = new BootContextGenerator(ws, config, logger);
    expect(gen.shouldGenerate()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — mood display
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — mood display", () => {
  it("shows frustrated mood with emoji", () => {
    const ws = makeWorkspace();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "frustrated",
        integrity: { last_event_timestamp: new Date().toISOString(), events_processed: 1, source: "hooks" },
      }),
    );
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("frustrated");
    expect(md).toContain("😤");
  });

  it("does not show mood line for neutral", () => {
    const ws = makeWorkspace();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "neutral",
        integrity: { last_event_timestamp: new Date().toISOString(), events_processed: 1, source: "hooks" },
      }),
    );
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).not.toContain("Last session mood:");
  });
});

// ════════════════════════════════════════════════════════════
// BootContextGenerator — staleness warnings in output
// ════════════════════════════════════════════════════════════
describe("BootContextGenerator — staleness in output", () => {
  it("includes staleness warning for old data", () => {
    const ws = makeWorkspace();
    const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(ws, "memory", "reboot", "threads.json"),
      JSON.stringify({
        version: 2, threads: [], session_mood: "neutral",
        integrity: { last_event_timestamp: old, events_processed: 1, source: "hooks" },
      }),
    );
    const gen = new BootContextGenerator(ws, defaultBootConfig, logger);
    const md = gen.generate();
    expect(md).toContain("⚠️");
  });
});

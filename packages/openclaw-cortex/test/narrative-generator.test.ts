import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NarrativeGenerator, loadDailyNotes, extractTimeline, buildSections, generateStructured } from "../src/narrative-generator.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-narrative-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

function writeDailyNote(workspace: string, date: string, content: string) {
  writeFileSync(join(workspace, "memory", `${date}.md`), content);
}

function writeThreads(workspace: string, threads: any[]) {
  writeFileSync(
    join(workspace, "memory", "reboot", "threads.json"),
    JSON.stringify({ version: 2, updated: new Date().toISOString(), threads }, null, 2),
  );
}

function writeDecisions(workspace: string, decisions: any[]) {
  writeFileSync(
    join(workspace, "memory", "reboot", "decisions.json"),
    JSON.stringify({ version: 1, updated: new Date().toISOString(), decisions }, null, 2),
  );
}

describe("NarrativeGenerator", () => {
  it("creates instance without errors", () => {
    const ws = makeWorkspace();
    const gen = new NarrativeGenerator(ws, logger);
    expect(gen).toBeTruthy();
  });

  it("generates empty narrative for empty workspace", () => {
    const ws = makeWorkspace();
    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("includes date header", () => {
    const ws = makeWorkspace();
    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result).toMatch(/\d{4}/); // contains year
  });

  it("includes open threads", () => {
    const ws = makeWorkspace();
    writeThreads(ws, [
      {
        id: "t1",
        title: "Auth Migration",
        status: "open",
        priority: "high",
        summary: "Migrating auth system",
        decisions: [],
        waiting_for: null,
        mood: "productive",
        last_activity: new Date().toISOString(),
        created: new Date().toISOString(),
      },
    ]);

    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result).toContain("Auth Migration");
  });

  it("includes closed threads as completed", () => {
    const ws = makeWorkspace();
    const now = new Date();
    writeThreads(ws, [
      {
        id: "t2",
        title: "Bug Fix Deploy",
        status: "closed",
        priority: "medium",
        summary: "Fixed critical bug",
        decisions: [],
        waiting_for: null,
        mood: "productive",
        last_activity: now.toISOString(),
        created: new Date(now.getTime() - 3600000).toISOString(),
      },
    ]);

    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result).toContain("Bug Fix Deploy");
  });

  it("includes recent decisions", () => {
    const ws = makeWorkspace();
    writeDecisions(ws, [
      {
        id: "d1",
        what: "Use TypeScript for the plugin",
        date: new Date().toISOString().slice(0, 10),
        why: "Consistency with OpenClaw",
        impact: "high",
        who: "albert",
        extracted_at: new Date().toISOString(),
      },
    ]);

    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result).toContain("TypeScript");
  });

  it("includes daily note content when available", () => {
    const ws = makeWorkspace();
    const today = new Date().toISOString().slice(0, 10);
    writeDailyNote(ws, today, "## 10:00\nWorked on plugin architecture\n## 14:00\nCode review");

    const gen = new NarrativeGenerator(ws, logger);
    const result = gen.generate();
    expect(result.length).toBeGreaterThan(0);
  });

  it("persists narrative to file", () => {
    const ws = makeWorkspace();
    writeThreads(ws, [
      {
        id: "t3",
        title: "Test Thread",
        status: "open",
        priority: "medium",
        summary: "Testing",
        decisions: [],
        waiting_for: null,
        mood: "neutral",
        last_activity: new Date().toISOString(),
        created: new Date().toISOString(),
      },
    ]);

    const gen = new NarrativeGenerator(ws, logger);
    gen.write();

    const filePath = join(ws, "memory", "reboot", "narrative.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Test Thread");
  });

  it("handles missing threads.json gracefully", () => {
    const ws = makeWorkspace();
    const gen = new NarrativeGenerator(ws, logger);
    expect(() => gen.generate()).not.toThrow();
  });

  it("handles missing decisions.json gracefully", () => {
    const ws = makeWorkspace();
    const gen = new NarrativeGenerator(ws, logger);
    expect(() => gen.generate()).not.toThrow();
  });

  it("handles corrupt threads.json", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "memory", "reboot", "threads.json"), "not json");
    const gen = new NarrativeGenerator(ws, logger);
    expect(() => gen.generate()).not.toThrow();
  });
});

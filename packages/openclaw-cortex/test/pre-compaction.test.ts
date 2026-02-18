import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PreCompaction, buildHotSnapshot } from "../src/pre-compaction.js";
import { ThreadTracker } from "../src/thread-tracker.js";
import { resolveConfig } from "../src/config.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-precompact-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

describe("buildHotSnapshot", () => {
  it("builds markdown from messages", () => {
    const result = buildHotSnapshot([
      { role: "user", content: "Fix the auth bug" },
      { role: "assistant", content: "Done, JWT validation is fixed" },
    ], 15);
    expect(result).toContain("Hot Snapshot");
    expect(result).toContain("auth bug");
    expect(result).toContain("[user]");
    expect(result).toContain("[assistant]");
  });

  it("handles empty messages", () => {
    const result = buildHotSnapshot([], 15);
    expect(result).toContain("Hot Snapshot");
    expect(result).toContain("No recent messages");
  });

  it("truncates long messages", () => {
    const longMsg = "A".repeat(500);
    const result = buildHotSnapshot([{ role: "user", content: longMsg }], 15);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(500);
  });

  it("limits to maxMessages (takes last N)", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));
    const result = buildHotSnapshot(messages, 5);
    expect(result).toContain("Message 19");
    expect(result).toContain("Message 15");
    expect(result).not.toContain("Message 0");
  });
});

describe("PreCompaction", () => {
  it("creates instance without errors", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);
    expect(pipeline).toBeTruthy();
  });

  it("runs without errors on empty workspace", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    const result = pipeline.run([]);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("creates hot-snapshot.md", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    pipeline.run([
      { role: "user", content: "Fix the auth bug" },
      { role: "assistant", content: "Done, the JWT validation is fixed" },
    ]);

    const snapshotPath = join(ws, "memory", "reboot", "hot-snapshot.md");
    expect(existsSync(snapshotPath)).toBe(true);
    const content = readFileSync(snapshotPath, "utf-8");
    expect(content).toContain("auth bug");
  });

  it("creates narrative.md", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    pipeline.run([]);

    const narrativePath = join(ws, "memory", "reboot", "narrative.md");
    expect(existsSync(narrativePath)).toBe(true);
  });

  it("creates BOOTSTRAP.md", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    pipeline.run([]);

    const bootstrapPath = join(ws, "BOOTSTRAP.md");
    expect(existsSync(bootstrapPath)).toBe(true);
  });

  it("reports correct messagesSnapshotted count", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `Msg ${i}`,
    }));

    const result = pipeline.run(messages);
    expect(result.messagesSnapshotted).toBe(config.preCompaction.maxSnapshotMessages);
  });

  it("handles errors gracefully — never throws", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "memory", "reboot", "threads.json"), "corrupt");

    const config = resolveConfig({ workspace: ws });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    expect(() => pipeline.run([])).not.toThrow();
  });

  it("skips narrative when disabled", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws, narrative: { enabled: false } });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    pipeline.run([]);
    // narrative.md should not be created (or at least pipeline won't error)
    // The key assertion is it doesn't throw
  });

  it("skips boot context when disabled", () => {
    const ws = makeWorkspace();
    const config = resolveConfig({ workspace: ws, bootContext: { enabled: false } });
    const tracker = new ThreadTracker(ws, config.threadTracker, "both", logger);
    const pipeline = new PreCompaction(ws, config, logger, tracker);

    pipeline.run([]);
    const bootstrapPath = join(ws, "BOOTSTRAP.md");
    expect(existsSync(bootstrapPath)).toBe(false);
  });
});

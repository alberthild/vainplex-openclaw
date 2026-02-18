import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULTS as DEFAULT_CONFIG } from "../src/config.js";

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveConfig(undefined);
    expect(config.enabled).toBe(true);
    expect(config.threadTracker.enabled).toBe(true);
    expect(config.threadTracker.pruneDays).toBe(7);
    expect(config.threadTracker.maxThreads).toBe(50);
    expect(config.decisionTracker.enabled).toBe(true);
    expect(config.decisionTracker.maxDecisions).toBe(100);
    expect(config.decisionTracker.dedupeWindowHours).toBe(24);
    expect(config.bootContext.enabled).toBe(true);
    expect(config.bootContext.maxChars).toBe(16000);
    expect(config.bootContext.onSessionStart).toBe(true);
    expect(config.bootContext.maxThreadsInBoot).toBe(7);
    expect(config.bootContext.maxDecisionsInBoot).toBe(10);
    expect(config.bootContext.decisionRecencyDays).toBe(14);
    expect(config.preCompaction.enabled).toBe(true);
    expect(config.preCompaction.maxSnapshotMessages).toBe(15);
    expect(config.narrative.enabled).toBe(true);
    expect(config.patterns.language).toBe("both");
  });

  it("returns defaults for empty object", () => {
    const config = resolveConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial top-level config", () => {
    const config = resolveConfig({ enabled: false });
    expect(config.enabled).toBe(false);
    expect(config.threadTracker.enabled).toBe(true); // unchanged
  });

  it("merges partial nested config", () => {
    const config = resolveConfig({
      threadTracker: { pruneDays: 30 },
    });
    expect(config.threadTracker.pruneDays).toBe(30);
    expect(config.threadTracker.enabled).toBe(true); // default preserved
    expect(config.threadTracker.maxThreads).toBe(50); // default preserved
  });

  it("merges multiple nested sections", () => {
    const config = resolveConfig({
      bootContext: { maxChars: 8000 },
      patterns: { language: "de" },
    });
    expect(config.bootContext.maxChars).toBe(8000);
    expect(config.bootContext.onSessionStart).toBe(true);
    expect(config.patterns.language).toBe("de");
  });

  it("handles workspace override", () => {
    const config = resolveConfig({ workspace: "/custom/path" });
    expect(config.workspace).toBe("/custom/path");
  });

  it("ignores unknown keys", () => {
    const config = resolveConfig({ unknownKey: "value" } as any);
    expect(config.enabled).toBe(true);
    expect((config as any).unknownKey).toBeUndefined();
  });

  it("handles null config", () => {
    const config = resolveConfig(null as any);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("preserves all feature disabled states", () => {
    const config = resolveConfig({
      threadTracker: { enabled: false },
      decisionTracker: { enabled: false },
      bootContext: { enabled: false },
      preCompaction: { enabled: false },
      narrative: { enabled: false },
    });
    expect(config.threadTracker.enabled).toBe(false);
    expect(config.decisionTracker.enabled).toBe(false);
    expect(config.bootContext.enabled).toBe(false);
    expect(config.preCompaction.enabled).toBe(false);
    expect(config.narrative.enabled).toBe(false);
  });

  it("respects language enum values", () => {
    expect(resolveConfig({ patterns: { language: "en" } }).patterns.language).toBe("en");
    expect(resolveConfig({ patterns: { language: "de" } }).patterns.language).toBe("de");
    expect(resolveConfig({ patterns: { language: "both" } }).patterns.language).toBe("both");
  });
});

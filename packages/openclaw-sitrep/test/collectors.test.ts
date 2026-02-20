import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import type { PluginLogger } from "../src/types.js";

const mockLogger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("systemd-timers collector", () => {
  it("runs without crashing", async () => {
    const { collectSystemdTimers } = await import("../src/collectors/systemd-timers.js");
    const result = await collectSystemdTimers({ enabled: true }, mockLogger);
    expect(result.status).toBeDefined();
    expect(result.items).toBeInstanceOf(Array);
    expect(result.summary).toBeDefined();
  });
});

describe("goals collector", () => {
  const tmpPath = "/tmp/sitrep-test-goals.json";

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it("returns ok when no goalsPath configured", async () => {
    const { collectGoals } = await import("../src/collectors/goals.js");
    const result = await collectGoals({ enabled: true }, mockLogger);
    expect(result.status).toBe("ok");
    expect(result.summary).toContain("no goalsPath");
  });

  it("returns ok for missing file", async () => {
    const { collectGoals } = await import("../src/collectors/goals.js");
    const result = await collectGoals(
      { enabled: true, goalsPath: "/tmp/not-exists.json" },
      mockLogger,
    );
    expect(result.status).toBe("ok");
  });

  it("detects red-zone goals", async () => {
    const goals = [
      { id: "1", title: "Deploy to prod", status: "approved", zone: "red", proposed_at: new Date().toISOString() },
      { id: "2", title: "Fix typo", status: "proposed", zone: "green", proposed_at: new Date().toISOString() },
    ];
    writeFileSync(tmpPath, JSON.stringify(goals));
    const { collectGoals } = await import("../src/collectors/goals.js");
    const result = await collectGoals({ enabled: true, goalsPath: tmpPath }, mockLogger);
    expect(result.items.some((i) => i.title.includes("Red-zone"))).toBe(true);
  });

  it("detects stale proposed goals", async () => {
    const oldDate = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const goals = [{ id: "1", title: "Old idea", status: "proposed", zone: "green", proposed_at: oldDate }];
    writeFileSync(tmpPath, JSON.stringify(goals));
    const { collectGoals } = await import("../src/collectors/goals.js");
    const result = await collectGoals({ enabled: true, goalsPath: tmpPath, staleHours: 48 }, mockLogger);
    expect(result.items.some((i) => i.title.includes("not yet approved"))).toBe(true);
  });
});

describe("threads collector", () => {
  const tmpPath = "/tmp/sitrep-test-threads.json";

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it("returns ok when no threadsPath", async () => {
    const { collectThreads } = await import("../src/collectors/threads.js");
    const result = await collectThreads({ enabled: true }, mockLogger);
    expect(result.status).toBe("ok");
  });

  it("detects stale threads", async () => {
    const old = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const data = {
      threads: [
        { id: "1", topic: "Old thread", status: "open", last_activity: old },
        { id: "2", topic: "Fresh thread", status: "open", last_activity: new Date().toISOString() },
      ],
    };
    writeFileSync(tmpPath, JSON.stringify(data));
    const { collectThreads } = await import("../src/collectors/threads.js");
    const result = await collectThreads({ enabled: true, threadsPath: tmpPath, staleDays: 7 }, mockLogger);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toContain("Old thread");
  });
});

describe("errors collector", () => {
  const tmpPath = "/tmp/sitrep-test-errors.json";

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it("returns ok when no patternsPath", async () => {
    const { collectErrors } = await import("../src/collectors/errors.js");
    const result = await collectErrors({ enabled: true }, mockLogger);
    expect(result.status).toBe("ok");
  });

  it("detects recent critical errors", async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const patterns = [
      { id: "1", pattern: "Auth failed", severity: "critical", last_seen: recent },
      { id: "2", pattern: "Old error", severity: "high", last_seen: old },
    ];
    writeFileSync(tmpPath, JSON.stringify(patterns));
    const { collectErrors } = await import("../src/collectors/errors.js");
    const result = await collectErrors(
      { enabled: true, patternsPath: tmpPath, recentHours: 24 },
      mockLogger,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.severity).toBe("critical");
  });
});

describe("calendar collector", () => {
  it("returns ok when no command", async () => {
    const { collectCalendar } = await import("../src/collectors/calendar.js");
    const result = await collectCalendar({ enabled: true }, mockLogger);
    expect(result.status).toBe("ok");
  });

  it("runs a simple command", async () => {
    const { collectCalendar } = await import("../src/collectors/calendar.js");
    const result = await collectCalendar(
      { enabled: true, command: 'echo "Meeting at 10:00"' },
      mockLogger,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toContain("Meeting");
  });

  it("handles failing command", async () => {
    const { collectCalendar } = await import("../src/collectors/calendar.js");
    const result = await collectCalendar(
      { enabled: true, command: "exit 1" },
      mockLogger,
    );
    expect(result.status).toBe("warn");
  });
});

describe("custom collector", () => {
  it("detects threshold breach", async () => {
    const { runCustomCollector } = await import("../src/collectors/custom.js");
    const result = await runCustomCollector(
      { id: "disk", command: "echo 85", warnThreshold: "80", criticalThreshold: "95" },
      mockLogger,
    );
    expect(result.items.some((i) => i.severity === "warn")).toBe(true);
  });

  it("detects critical threshold", async () => {
    const { runCustomCollector } = await import("../src/collectors/custom.js");
    const result = await runCustomCollector(
      { id: "disk", command: "echo 97", warnThreshold: "80", criticalThreshold: "95" },
      mockLogger,
    );
    expect(result.items.some((i) => i.severity === "critical")).toBe(true);
  });

  it("warnIfOutput triggers on output", async () => {
    const { runCustomCollector } = await import("../src/collectors/custom.js");
    const result = await runCustomCollector(
      { id: "check", command: "echo 'unhealthy container'", warnIfOutput: true },
      mockLogger,
    );
    expect(result.items).toHaveLength(1);
    expect(result.status).toBe("warn");
  });

  it("warnIfOutput ok when no output", async () => {
    const { runCustomCollector } = await import("../src/collectors/custom.js");
    const result = await runCustomCollector(
      { id: "check", command: "true", warnIfOutput: true },
      mockLogger,
    );
    expect(result.items).toHaveLength(0);
    expect(result.status).toBe("ok");
  });
});

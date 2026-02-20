import { describe, it, expect } from "vitest";
import { safeCollect, shell, readJsonSafe } from "../src/collector.js";
import { createMockLogger } from "./helpers.js";
import type { CollectorResult } from "../src/types.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const mockLogger = createMockLogger();

describe("safeCollect", () => {
  it("returns disabled result for disabled collector", async () => {
    const result = await safeCollect(
      "test",
      async () => ({ status: "ok", items: [], summary: "ok", duration_ms: 0 }),
      { enabled: false },
      mockLogger,
    );
    expect(result.status).toBe("ok");
    expect(result.summary).toBe("disabled");
  });

  it("catches errors and returns error result", async () => {
    const result = await safeCollect(
      "broken",
      async () => { throw new Error("simulated failure"); },
      { enabled: true },
      mockLogger,
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("simulated failure");
  });

  it("passes through successful results", async () => {
    const expected: CollectorResult = {
      status: "warn",
      items: [{ id: "test", source: "test", severity: "warn", category: "informational", title: "Test", score: 50 }],
      summary: "1 issue",
      duration_ms: 0,
    };
    const result = await safeCollect("test", async () => expected, { enabled: true }, mockLogger);
    expect(result.status).toBe("warn");
    expect(result.items).toHaveLength(1);
  });

  it("measures duration", async () => {
    const result = await safeCollect(
      "slow",
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { status: "ok" as const, items: [], summary: "ok", duration_ms: 0 };
      },
      { enabled: true },
      mockLogger,
    );
    expect(result.duration_ms).toBeGreaterThanOrEqual(40);
  });
});

describe("shell", () => {
  it("returns stdout", () => { expect(shell("echo hello")).toBe("hello"); });
  it("trims output", () => { expect(shell("echo '  spaced  '")).toBe("spaced"); });
  it("throws on non-zero exit", () => { expect(() => shell("exit 1")).toThrow(); });
});

describe("readJsonSafe", () => {
  const tmpPath = "/tmp/sitrep-test-read.json";
  it("returns null for missing file", () => { expect(readJsonSafe("/tmp/nope.json")).toBeNull(); });
  it("reads valid JSON", () => {
    writeFileSync(tmpPath, '{"test": true}');
    expect(readJsonSafe<{ test: boolean }>(tmpPath)).toEqual({ test: true });
    unlinkSync(tmpPath);
  });
  it("returns null for invalid JSON", () => {
    writeFileSync(tmpPath, "not json");
    expect(readJsonSafe(tmpPath)).toBeNull();
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });
});

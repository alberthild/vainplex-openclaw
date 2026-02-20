import { describe, it, expect, vi, afterEach } from "vitest";
import { writeSitrep } from "../src/output.js";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import type { SitrepReport, PluginLogger } from "../src/types.js";

const mockLogger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const testDir = "/tmp/sitrep-test-output";
const outputPath = `${testDir}/sitrep.json`;
const previousPath = `${testDir}/sitrep-previous.json`;

function makeReport(overrides?: Partial<SitrepReport>): SitrepReport {
  return {
    version: 1,
    generated: new Date().toISOString(),
    summary: "test",
    health: { overall: "ok", details: {} },
    items: [],
    categories: { needs_owner: [], auto_fixable: [], delegatable: [], informational: [] },
    delta: { new_items: 0, resolved_items: 0, previous_generated: null },
    collectors: {},
    ...overrides,
  };
}

afterEach(() => {
  for (const f of [outputPath, previousPath]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("writeSitrep", () => {
  it("creates output file", () => {
    const report = makeReport();
    writeSitrep(report, outputPath, previousPath, mockLogger);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(written.version).toBe(1);
  });

  it("creates directories if needed", () => {
    const deepPath = `${testDir}/deep/nested/sitrep.json`;
    const deepPrev = `${testDir}/deep/nested/prev.json`;
    writeSitrep(makeReport(), deepPath, deepPrev, mockLogger);
    expect(existsSync(deepPath)).toBe(true);
    if (existsSync(deepPath)) unlinkSync(deepPath);
  });

  it("backs up previous report", () => {
    // Write first report
    writeSitrep(makeReport({ summary: "first" }), outputPath, previousPath, mockLogger);
    // Write second report
    writeSitrep(makeReport({ summary: "second" }), outputPath, previousPath, mockLogger);

    // Check previous
    expect(existsSync(previousPath)).toBe(true);
    const prev = JSON.parse(readFileSync(previousPath, "utf-8"));
    expect(prev.summary).toBe("first");

    // Check current
    const current = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(current.summary).toBe("second");
  });

  it("writes valid JSON", () => {
    const report = makeReport({
      items: [{ id: "test", source: "test", severity: "warn", category: "informational", title: "Test item", score: 42 }],
    });
    writeSitrep(report, outputPath, previousPath, mockLogger);
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].score).toBe(42);
  });
});

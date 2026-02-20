import { describe, it, expect, afterEach } from "vitest";
import { writeSitrep } from "../src/output.js";
import { createMockLogger } from "./helpers.js";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import type { SitrepReport } from "../src/types.js";

const mockLogger = createMockLogger();
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
    mkdirSync(testDir, { recursive: true });
    writeSitrep(makeReport(), outputPath, previousPath, mockLogger);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("creates directories if needed", () => {
    const deep = `${testDir}/deep/nested/sitrep.json`;
    writeSitrep(makeReport(), deep, `${testDir}/deep/prev.json`, mockLogger);
    expect(existsSync(deep)).toBe(true);
    unlinkSync(deep);
  });

  it("backs up previous report", () => {
    mkdirSync(testDir, { recursive: true });
    writeSitrep(makeReport({ summary: "first" }), outputPath, previousPath, mockLogger);
    writeSitrep(makeReport({ summary: "second" }), outputPath, previousPath, mockLogger);
    const prev = JSON.parse(readFileSync(previousPath, "utf-8"));
    expect(prev.summary).toBe("first");
    const current = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(current.summary).toBe("second");
  });

  it("writes valid JSON with items", () => {
    mkdirSync(testDir, { recursive: true });
    writeSitrep(makeReport({
      items: [{ id: "x", source: "t", severity: "warn", category: "informational", title: "T", score: 42 }],
    }), outputPath, previousPath, mockLogger);
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(parsed.items).toHaveLength(1);
  });
});

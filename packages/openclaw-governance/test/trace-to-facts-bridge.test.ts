import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TraceToFactsBridge } from "../src/trace-to-facts-bridge.js";
import type { PluginLogger, TraceFinding } from "../src/types.js";

const WORKSPACE = "/tmp/governance-test-trace-bridge";
const OUTPUT_PATH = join(WORKSPACE, "generated-facts.json");

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function writeTraceReport(filename: string, findings: TraceFinding[]): string {
  const path = join(WORKSPACE, filename);
  writeFileSync(path, JSON.stringify({ findings }, null, 2), "utf-8");
  return path;
}

function makeFinding(overrides: Partial<TraceFinding> = {}): TraceFinding {
  return {
    id: "finding-001",
    agent: "main",
    signal: {
      signal: "SIG-HALLUCINATION",
      severity: "high",
      summary: "Fabricated event count",
    },
    factCorrection: {
      subject: "nats-events",
      claimed: "500000",
      actual: "255908",
      predicate: "count",
    },
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
});

afterEach(() => {
  if (existsSync(WORKSPACE)) rmSync(WORKSPACE, { recursive: true });
});

describe("TraceToFactsBridge", () => {
  describe("extractFactsFromFile", () => {
    it("extracts facts from trace report with findings", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const path = writeTraceReport("report.json", [makeFinding()]);

      const facts = bridge.extractFactsFromFile(path);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.subject).toBe("nats-events");
      expect(facts[0]!.predicate).toBe("count");
      expect(facts[0]!.value).toBe("255908"); // actual value
      expect(facts[0]!.source).toBe("trace-analyzer");
    });

    it("skips findings without factCorrection", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const finding = makeFinding();
      delete (finding as Record<string, unknown>)["factCorrection"];
      const path = writeTraceReport("report.json", [finding]);

      const facts = bridge.extractFactsFromFile(path);
      expect(facts).toHaveLength(0);
    });

    it("handles multiple findings", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const findings = [
        makeFinding({ id: "f1" }),
        makeFinding({
          id: "f2",
          factCorrection: {
            subject: "plugins",
            claimed: "no vibe-coded plugins",
            actual: "vainplex plugins are custom-built",
            predicate: "type",
          },
        }),
      ];
      const path = writeTraceReport("report.json", findings);

      const facts = bridge.extractFactsFromFile(path);
      expect(facts).toHaveLength(2);
    });

    it("returns empty for missing file", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const facts = bridge.extractFactsFromFile("/tmp/nonexistent.json");
      expect(facts).toHaveLength(0);
    });

    it("returns empty for invalid JSON", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const path = join(WORKSPACE, "bad.json");
      writeFileSync(path, "not json", "utf-8");

      const facts = bridge.extractFactsFromFile(path);
      expect(facts).toHaveLength(0);
    });

    it("uses default predicate 'value' when predicate is missing", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const finding = makeFinding();
      finding.factCorrection = {
        subject: "test",
        claimed: "wrong",
        actual: "correct",
      };
      const path = writeTraceReport("report.json", [finding]);

      const facts = bridge.extractFactsFromFile(path);
      expect(facts[0]!.predicate).toBe("value");
    });
  });

  describe("extractFactsFromParsed", () => {
    it("handles direct array format", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const parsed = [makeFinding()];

      const facts = bridge.extractFactsFromParsed(parsed);
      expect(facts).toHaveLength(1);
    });

    it("handles { findings: [...] } format", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const parsed = { findings: [makeFinding()] };

      const facts = bridge.extractFactsFromParsed(parsed);
      expect(facts).toHaveLength(1);
    });

    it("returns empty for unexpected format", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const facts = bridge.extractFactsFromParsed("not an object");
      expect(facts).toHaveLength(0);
    });
  });

  describe("deduplicateFacts", () => {
    it("deduplicates by subject+predicate (later wins)", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const facts = bridge.deduplicateFacts([
        { subject: "nats", predicate: "count", value: "100" },
        { subject: "nats", predicate: "count", value: "200" },
      ]);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.value).toBe("200");
    });

    it("preserves facts with different predicates", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const facts = bridge.deduplicateFacts([
        { subject: "nats", predicate: "count", value: "100" },
        { subject: "nats", predicate: "state", value: "running" },
      ]);
      expect(facts).toHaveLength(2);
    });

    it("case-insensitive deduplication", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const facts = bridge.deduplicateFacts([
        { subject: "Nats", predicate: "Count", value: "100" },
        { subject: "nats", predicate: "count", value: "200" },
      ]);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.value).toBe("200");
    });
  });

  describe("processAndWrite", () => {
    it("writes facts to output file", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const path = writeTraceReport("report.json", [makeFinding()]);

      const count = bridge.processAndWrite([path]);
      expect(count).toBe(1);
      expect(existsSync(OUTPUT_PATH)).toBe(true);

      // Read and verify
      const raw = JSON.parse(require("node:fs").readFileSync(OUTPUT_PATH, "utf-8"));
      expect(raw.id).toBe("trace-learned");
      expect(raw.facts).toHaveLength(1);
      expect(raw.generatedAt).toBeDefined();
    });

    it("merges with existing facts", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);

      // Write initial facts
      writeFileSync(
        OUTPUT_PATH,
        JSON.stringify({
          id: "trace-learned",
          generatedAt: "2026-01-01",
          facts: [{ subject: "existing", predicate: "state", value: "running" }],
        }),
        "utf-8",
      );

      const path = writeTraceReport("report.json", [makeFinding()]);
      const count = bridge.processAndWrite([path]);
      expect(count).toBe(2); // existing + new
    });

    it("deduplicates across existing and new facts", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);

      // Write initial fact with same subject+predicate
      writeFileSync(
        OUTPUT_PATH,
        JSON.stringify({
          id: "trace-learned",
          generatedAt: "2026-01-01",
          facts: [{ subject: "nats-events", predicate: "count", value: "old-value" }],
        }),
        "utf-8",
      );

      const path = writeTraceReport("report.json", [makeFinding()]);
      const count = bridge.processAndWrite([path]);
      expect(count).toBe(1); // deduplicated

      const raw = JSON.parse(require("node:fs").readFileSync(OUTPUT_PATH, "utf-8"));
      expect(raw.facts[0].value).toBe("255908"); // new value wins
    });

    it("handles multiple trace report files", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      const path1 = writeTraceReport("report1.json", [makeFinding({ id: "f1" })]);
      const path2 = writeTraceReport("report2.json", [
        makeFinding({
          id: "f2",
          factCorrection: { subject: "other", claimed: "x", actual: "y", predicate: "state" },
        }),
      ]);

      const count = bridge.processAndWrite([path1, path2]);
      expect(count).toBe(2);
    });

    it("returns existing count when no new facts extracted", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);

      // Finding without factCorrection
      const finding = makeFinding();
      delete (finding as Record<string, unknown>)["factCorrection"];
      const path = writeTraceReport("report.json", [finding]);

      const count = bridge.processAndWrite([path]);
      expect(count).toBe(0);
    });

    it("creates output directory if missing", () => {
      const deepPath = join(WORKSPACE, "deep", "nested", "facts.json");
      const bridge = new TraceToFactsBridge(deepPath, logger);
      const path = writeTraceReport("report.json", [makeFinding()]);

      bridge.processAndWrite([path]);
      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe("timer", () => {
    it("starts and stops timer without error", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      bridge.startTimer([], 60000);
      bridge.stopTimer();
    });

    it("stopTimer is safe to call multiple times", () => {
      const bridge = new TraceToFactsBridge(OUTPUT_PATH, logger);
      bridge.stopTimer();
      bridge.stopTimer();
    });
  });
});

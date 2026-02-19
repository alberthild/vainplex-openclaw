import { describe, it, expect } from "vitest";
import {
  resolveTraceAnalyzerConfig,
  TRACE_ANALYZER_DEFAULTS,
} from "../../src/trace-analyzer/config.js";
import { resolveConfig, DEFAULTS } from "../../src/config.js";

describe("TraceAnalyzerConfig", () => {
  describe("TRACE_ANALYZER_DEFAULTS", () => {
    it("has enabled: false by default", () => {
      expect(TRACE_ANALYZER_DEFAULTS.enabled).toBe(false);
    });

    it("has sensible NATS defaults", () => {
      expect(TRACE_ANALYZER_DEFAULTS.nats.url).toBe("nats://localhost:4222");
      expect(TRACE_ANALYZER_DEFAULTS.nats.stream).toBe("openclaw-events");
      expect(TRACE_ANALYZER_DEFAULTS.nats.subjectPrefix).toBe("openclaw.events");
    });

    it("has schedule disabled by default", () => {
      expect(TRACE_ANALYZER_DEFAULTS.schedule.enabled).toBe(false);
      expect(TRACE_ANALYZER_DEFAULTS.schedule.intervalHours).toBe(24);
    });

    it("has 30-minute chain gap default", () => {
      expect(TRACE_ANALYZER_DEFAULTS.chainGapMinutes).toBe(30);
    });

    it("has SIG-UNVERIFIED-CLAIM disabled by default", () => {
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-UNVERIFIED-CLAIM"]?.enabled).toBe(false);
    });

    it("has most signals enabled by default", () => {
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-CORRECTION"]?.enabled).toBe(true);
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-TOOL-FAIL"]?.enabled).toBe(true);
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-DOOM-LOOP"]?.enabled).toBe(true);
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-DISSATISFIED"]?.enabled).toBe(true);
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-REPEAT-FAIL"]?.enabled).toBe(true);
      expect(TRACE_ANALYZER_DEFAULTS.signals["SIG-HALLUCINATION"]?.enabled).toBe(true);
    });
  });

  describe("resolveTraceAnalyzerConfig", () => {
    it("returns defaults when no config provided", () => {
      const config = resolveTraceAnalyzerConfig();
      expect(config.enabled).toBe(false);
      expect(config.nats.url).toBe("nats://localhost:4222");
      expect(config.chainGapMinutes).toBe(30);
    });

    it("returns defaults when undefined provided", () => {
      const config = resolveTraceAnalyzerConfig(undefined);
      expect(config).toEqual(TRACE_ANALYZER_DEFAULTS);
    });

    it("merges partial config with defaults", () => {
      const config = resolveTraceAnalyzerConfig({
        enabled: true,
        chainGapMinutes: 60,
      });
      expect(config.enabled).toBe(true);
      expect(config.chainGapMinutes).toBe(60);
      // Defaults preserved for unspecified fields
      expect(config.nats.url).toBe("nats://localhost:4222");
      expect(config.fetchBatchSize).toBe(500);
    });

    it("resolves NATS config", () => {
      const config = resolveTraceAnalyzerConfig({
        nats: {
          url: "nats://prod:4222",
          stream: "my-events",
          subjectPrefix: "my.events",
          credentials: "/path/to/creds",
          user: "admin",
          password: "secret",
        },
      });
      expect(config.nats.url).toBe("nats://prod:4222");
      expect(config.nats.stream).toBe("my-events");
      expect(config.nats.credentials).toBe("/path/to/creds");
      expect(config.nats.user).toBe("admin");
      expect(config.nats.password).toBe("secret");
    });

    it("resolves signal config per-signal enable/disable", () => {
      const config = resolveTraceAnalyzerConfig({
        signals: {
          "SIG-CORRECTION": { enabled: false },
          "SIG-DOOM-LOOP": { enabled: true, severity: "critical" },
        },
      });
      expect(config.signals["SIG-CORRECTION"]?.enabled).toBe(false);
      expect(config.signals["SIG-DOOM-LOOP"]?.enabled).toBe(true);
      expect(config.signals["SIG-DOOM-LOOP"]?.severity).toBe("critical");
      // Others preserved from defaults
      expect(config.signals["SIG-TOOL-FAIL"]?.enabled).toBe(true);
    });

    it("applies signal severity override", () => {
      const config = resolveTraceAnalyzerConfig({
        signals: {
          "SIG-TOOL-FAIL": { enabled: true, severity: "high" },
        },
      });
      expect(config.signals["SIG-TOOL-FAIL"]?.severity).toBe("high");
    });

    it("resolves LLM config with triage", () => {
      const config = resolveTraceAnalyzerConfig({
        llm: {
          enabled: true,
          endpoint: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKey: "sk-test",
          timeoutMs: 30000,
          triage: {
            endpoint: "http://localhost:11434/v1",
            model: "mistral:7b",
          },
        },
      });
      expect(config.llm.enabled).toBe(true);
      expect(config.llm.endpoint).toBe("https://api.openai.com/v1");
      expect(config.llm.model).toBe("gpt-4o");
      expect(config.llm.triage).toBeDefined();
      expect(config.llm.triage!.endpoint).toBe("http://localhost:11434/v1");
      expect(config.llm.triage!.model).toBe("mistral:7b");
    });

    it("triage is undefined when not configured", () => {
      const config = resolveTraceAnalyzerConfig({
        llm: { enabled: true },
      });
      expect(config.llm.triage).toBeUndefined();
    });

    it("resolves custom redact patterns from array", () => {
      const config = resolveTraceAnalyzerConfig({
        redactPatterns: ["secret-\\d+", "password=\\S+"],
      });
      expect(config.redactPatterns).toEqual(["secret-\\d+", "password=\\S+"]);
    });

    it("filters non-string redact patterns", () => {
      const config = resolveTraceAnalyzerConfig({
        redactPatterns: ["valid", 123, null, "also-valid"],
      });
      expect(config.redactPatterns).toEqual(["valid", "also-valid"]);
    });

    it("resolves output config", () => {
      const config = resolveTraceAnalyzerConfig({
        output: {
          maxFindings: 500,
          reportPath: "/custom/path/report.json",
        },
      });
      expect(config.output.maxFindings).toBe(500);
      expect(config.output.reportPath).toBe("/custom/path/report.json");
    });

    it("handles invalid types gracefully with defaults", () => {
      const config = resolveTraceAnalyzerConfig({
        enabled: "yes" as unknown,
        chainGapMinutes: "thirty" as unknown,
        fetchBatchSize: null as unknown,
      });
      expect(config.enabled).toBe(false); // falls back to default
      expect(config.chainGapMinutes).toBe(30);
      expect(config.fetchBatchSize).toBe(500);
    });

    it("ignores invalid signal IDs", () => {
      const config = resolveTraceAnalyzerConfig({
        signals: {
          "SIG-INVALID": { enabled: true },
          "SIG-CORRECTION": { enabled: false },
        },
      });
      // Invalid ID is ignored, correction is applied
      expect(config.signals["SIG-CORRECTION"]?.enabled).toBe(false);
      // No "SIG-INVALID" key in result
      expect(Object.keys(config.signals)).not.toContain("SIG-INVALID");
    });
  });

  describe("integration with top-level resolveConfig", () => {
    it("includes traceAnalyzer in resolved CortexConfig", () => {
      const config = resolveConfig();
      expect(config.traceAnalyzer).toBeDefined();
      expect(config.traceAnalyzer.enabled).toBe(false);
    });

    it("DEFAULTS includes traceAnalyzer", () => {
      expect(DEFAULTS.traceAnalyzer).toBeDefined();
      expect(DEFAULTS.traceAnalyzer.enabled).toBe(false);
    });

    it("resolves traceAnalyzer from plugin config", () => {
      const config = resolveConfig({
        traceAnalyzer: {
          enabled: true,
          chainGapMinutes: 45,
        },
      });
      expect(config.traceAnalyzer.enabled).toBe(true);
      expect(config.traceAnalyzer.chainGapMinutes).toBe(45);
    });

    it("does not affect other config sections", () => {
      const config = resolveConfig({
        traceAnalyzer: { enabled: true },
      });
      // Other sections should still have their defaults
      expect(config.threadTracker.enabled).toBe(true);
      expect(config.decisionTracker.enabled).toBe(true);
      expect(config.bootContext.enabled).toBe(true);
    });
  });
});

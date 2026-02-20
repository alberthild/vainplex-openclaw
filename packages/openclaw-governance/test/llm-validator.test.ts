import { describe, it, expect, vi } from "vitest";
import {
  LlmValidator,
  buildPrompt,
  parseResponse,
  DEFAULT_LLM_VALIDATOR_CONFIG,
} from "../src/llm-validator.js";
import type { CallLlmFn } from "../src/llm-validator.js";
import type { Fact, LlmValidatorConfig, PluginLogger } from "../src/types.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeConfig(overrides: Partial<LlmValidatorConfig> = {}): LlmValidatorConfig {
  return { ...DEFAULT_LLM_VALIDATOR_CONFIG, enabled: true, ...overrides };
}

const sampleFacts: Fact[] = [
  { subject: "nats-events", predicate: "count", value: "255908", source: "production" },
  { subject: "plugins", predicate: "type", value: "governance, cortex", source: "config" },
];

describe("buildPrompt", () => {
  it("includes the text to review", () => {
    const prompt = buildPrompt("We have 500k events.", [], true);
    expect(prompt).toContain("We have 500k events.");
  });

  it("includes known facts when provided", () => {
    const prompt = buildPrompt("test text", sampleFacts, true);
    expect(prompt).toContain("nats-events count: 255908");
    expect(prompt).toContain("(source: production)");
  });

  it("shows 'No known facts' when no facts provided", () => {
    const prompt = buildPrompt("test text", [], true);
    expect(prompt).toContain("No known facts provided.");
  });

  it("includes external context note for external communications", () => {
    const prompt = buildPrompt("test", [], true);
    expect(prompt).toContain("EXTERNAL communication");
    expect(prompt).toContain("strict scrutiny");
  });

  it("includes internal context note for internal communications", () => {
    const prompt = buildPrompt("test", [], false);
    expect(prompt).toContain("internal use");
  });

  it("lists all 5 check categories", () => {
    const prompt = buildPrompt("test", [], true);
    expect(prompt).toContain("false_numeric");
    expect(prompt).toContain("unsubstantiated_assertion");
    expect(prompt).toContain("misleading_implication");
    expect(prompt).toContain("contradiction");
    expect(prompt).toContain("exaggerated_claim");
  });

  it("requests JSON response format", () => {
    const prompt = buildPrompt("test", [], true);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain('"issues"');
  });
});

describe("parseResponse", () => {
  it("parses valid JSON with issues", () => {
    const raw = JSON.stringify({
      issues: [
        {
          category: "false_numeric",
          claim: "500k events",
          explanation: "Actual count is 255908",
          severity: "high",
        },
      ],
    });

    const result = parseResponse(raw, logger);
    expect(result.verdict).toBe("flag"); // high → flag
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.category).toBe("false_numeric");
    expect(result.issues[0]!.severity).toBe("high");
    expect(result.cached).toBe(false);
  });

  it("returns pass for empty issues array", () => {
    const raw = JSON.stringify({ issues: [] });
    const result = parseResponse(raw, logger);
    expect(result.verdict).toBe("pass");
    expect(result.issues).toHaveLength(0);
  });

  it("returns block for critical severity", () => {
    const raw = JSON.stringify({
      issues: [
        {
          category: "contradiction",
          claim: "false claim",
          explanation: "contradicts known facts",
          severity: "critical",
        },
      ],
    });

    const result = parseResponse(raw, logger);
    expect(result.verdict).toBe("block");
  });

  it("returns flag for high severity", () => {
    const raw = JSON.stringify({
      issues: [
        {
          category: "unsubstantiated_assertion",
          claim: "some claim",
          explanation: "no evidence",
          severity: "high",
        },
      ],
    });

    const result = parseResponse(raw, logger);
    expect(result.verdict).toBe("flag");
  });

  it("returns flag for medium severity", () => {
    const raw = JSON.stringify({
      issues: [
        {
          category: "exaggerated_claim",
          claim: "best ever",
          explanation: "exaggeration",
          severity: "medium",
        },
      ],
    });

    const result = parseResponse(raw, logger);
    expect(result.verdict).toBe("flag");
  });

  it("handles JSON wrapped in markdown code blocks", () => {
    const raw = '```json\n{"issues": [{"category": "test", "claim": "x", "explanation": "y", "severity": "low"}]}\n```';
    const result = parseResponse(raw, logger);
    expect(result.issues).toHaveLength(1);
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseResponse("not json at all", logger);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("unparseable");
  });

  it("handles missing issues field", () => {
    const result = parseResponse('{"verdict": "pass"}', logger);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("missing issues");
  });

  it("handles non-array issues field", () => {
    const result = parseResponse('{"issues": "none"}', logger);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("not an array");
  });

  it("defaults unknown severity to medium", () => {
    const raw = JSON.stringify({
      issues: [
        { category: "test", claim: "x", explanation: "y", severity: "unknown" },
      ],
    });
    const result = parseResponse(raw, logger);
    expect(result.issues[0]!.severity).toBe("medium");
  });

  it("skips malformed issue objects", () => {
    const raw = JSON.stringify({
      issues: [
        "not an object",
        { category: "test", claim: "x" }, // valid (has category + claim)
        { noCategory: true }, // invalid
      ],
    });
    const result = parseResponse(raw, logger);
    expect(result.issues).toHaveLength(1);
  });
});

describe("LlmValidator", () => {
  it("returns pass when disabled", async () => {
    const callLlm: CallLlmFn = vi.fn();
    const validator = new LlmValidator(
      { ...DEFAULT_LLM_VALIDATOR_CONFIG, enabled: false },
      callLlm,
      logger,
    );

    const result = await validator.validate("test text", [], true);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("disabled");
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("calls LLM with constructed prompt", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    await validator.validate("test text", sampleFacts, true);
    expect(callLlm).toHaveBeenCalledOnce();

    const prompt = (callLlm as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(prompt).toContain("test text");
    expect(prompt).toContain("nats-events");
  });

  it("passes LLM config options", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    const config = makeConfig({ model: "gpt-4", maxTokens: 1000, timeoutMs: 10000 });
    const validator = new LlmValidator(config, callLlm, logger);

    await validator.validate("test", [], true);

    const opts = (callLlm as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
    expect(opts["model"]).toBe("gpt-4");
    expect(opts["maxTokens"]).toBe(1000);
    expect(opts["timeoutMs"]).toBe(10000);
  });

  it("returns block on critical LLM findings", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        issues: [{ category: "contradiction", claim: "false", explanation: "wrong", severity: "critical" }],
      }),
    );
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    const result = await validator.validate("false claim", sampleFacts, true);
    expect(result.verdict).toBe("block");
    expect(result.issues).toHaveLength(1);
  });

  it("caches results for same input", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    const result1 = await validator.validate("test text", sampleFacts, true);
    const result2 = await validator.validate("test text", sampleFacts, true);

    expect(callLlm).toHaveBeenCalledOnce(); // Only 1 call
    expect(result1.cached).toBe(false);
    expect(result2.cached).toBe(true);
    expect(validator.cacheSize).toBe(1);
  });

  it("does not use cache for different text", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    await validator.validate("text 1", [], true);
    await validator.validate("text 2", [], true);

    expect(callLlm).toHaveBeenCalledTimes(2);
    expect(validator.cacheSize).toBe(2);
  });

  it("does not use expired cache entries", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    // 0ms TTL = immediately expired
    const validator = new LlmValidator(makeConfig(), callLlm, logger, 0);

    await validator.validate("test", [], true);
    await validator.validate("test", [], true);

    expect(callLlm).toHaveBeenCalledTimes(2);
  });

  it("fails open on LLM call error (default)", async () => {
    const callLlm: CallLlmFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    const result = await validator.validate("test text", [], true);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("fail-open");
  });

  it("fails closed when failMode is 'closed'", async () => {
    const callLlm: CallLlmFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const validator = new LlmValidator(makeConfig({ failMode: "closed" }), callLlm, logger);

    const result = await validator.validate("test text", [], true);
    expect(result.verdict).toBe("block");
    expect(result.reason).toContain("fail-closed");
  });

  it("retries on transient failure", async () => {
    const callLlm: CallLlmFn = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce('{"issues": []}');
    const validator = new LlmValidator(makeConfig({ retryAttempts: 1 }), callLlm, logger);

    const result = await validator.validate("test text", [], true);
    expect(result.verdict).toBe("pass");
    expect(callLlm).toHaveBeenCalledTimes(2);
  });

  it("exhausts all retry attempts before failing", async () => {
    const callLlm: CallLlmFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const validator = new LlmValidator(makeConfig({ retryAttempts: 2 }), callLlm, logger);

    const result = await validator.validate("test text", [], true);
    expect(result.verdict).toBe("pass"); // default fail-open
    expect(callLlm).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("clearCache works", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    const validator = new LlmValidator(makeConfig(), callLlm, logger);

    await validator.validate("test", [], true);
    expect(validator.cacheSize).toBe(1);

    validator.clearCache();
    expect(validator.cacheSize).toBe(0);
  });

  it("evicts expired entries when cache grows large", async () => {
    const callLlm: CallLlmFn = vi.fn().mockResolvedValue('{"issues": []}');
    // Short TTL
    const validator = new LlmValidator(makeConfig(), callLlm, logger, 1);

    // Fill cache with >100 entries
    for (let i = 0; i < 102; i++) {
      await validator.validate(`text ${i}`, [], true);
    }

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Next call should trigger eviction
    await validator.validate("trigger eviction", [], true);

    // Some expired entries should be evicted
    expect(validator.cacheSize).toBeLessThanOrEqual(102);
  });
});

describe("DEFAULT_LLM_VALIDATOR_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.enabled).toBe(false);
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.maxTokens).toBe(500);
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.timeoutMs).toBe(5000);
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.externalChannels).toContain("twitter");
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.externalChannels).toContain("linkedin");
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.externalChannels).toContain("email");
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.externalCommands).toContain("bird tweet");
    expect(DEFAULT_LLM_VALIDATOR_CONFIG.externalCommands).toContain("bird reply");
  });
});

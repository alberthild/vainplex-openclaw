// Cerberus: test files are exempt from 400-line limit — splitting would reduce readability
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyFindings,
  resolveAnalyzerLlmConfig,
  formatChainAsTranscript,
} from "../../src/trace-analyzer/classifier.js";
import type { Finding, FindingClassification } from "../../src/trace-analyzer/signals/types.js";
import type { ConversationChain } from "../../src/trace-analyzer/chain-reconstructor.js";
import type { LlmConfig } from "../../src/llm-enhance.js";
import type { TraceAnalyzerConfig } from "../../src/trace-analyzer/config.js";
import { TRACE_ANALYZER_DEFAULTS } from "../../src/trace-analyzer/config.js";
import type { PluginLogger } from "../../src/types.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000;
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

function makeChain(
  events: NormalizedEvent[],
  overrides: Partial<ConversationChain> = {},
): ConversationChain {
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    id: `chain-1`,
    agent: events[0]?.agent ?? "main",
    session: events[0]?.session ?? "test-session",
    startTs: events[0]?.ts ?? 0,
    endTs: events[events.length - 1]?.ts ?? 0,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-001",
    chainId: "chain-1",
    agent: "main",
    session: "test-session",
    signal: {
      signal: "SIG-TOOL-FAIL",
      severity: "medium",
      eventRange: { start: 0, end: 1 },
      summary: "Tool exec failed without recovery",
      evidence: { toolName: "exec", error: "Connection refused" },
    },
    detectedAt: Date.now(),
    occurredAt: 1700000000000,
    classification: null,
    ...overrides,
  };
}

function makeLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

const TOP_LEVEL_LLM: LlmConfig = {
  enabled: true,
  endpoint: "http://localhost:11434/v1",
  model: "mistral:7b",
  apiKey: "",
  timeoutMs: 15000,
  batchSize: 3,
};

beforeEach(() => {
  resetCounters();
  vi.restoreAllMocks();
});

// ---- resolveAnalyzerLlmConfig tests ----

describe("resolveAnalyzerLlmConfig()", () => {
  it("returns disabled config when override is disabled", () => {
    const result = resolveAnalyzerLlmConfig(TOP_LEVEL_LLM, { enabled: false });
    expect(result.enabled).toBe(false);
  });

  it("falls back to top-level values when override fields are absent", () => {
    const result = resolveAnalyzerLlmConfig(TOP_LEVEL_LLM, { enabled: true });
    expect(result.enabled).toBe(true);
    expect(result.endpoint).toBe("http://localhost:11434/v1");
    expect(result.model).toBe("mistral:7b");
    expect(result.timeoutMs).toBe(15000);
  });

  it("overrides individual fields from analyzer config", () => {
    const result = resolveAnalyzerLlmConfig(TOP_LEVEL_LLM, {
      enabled: true,
      endpoint: "http://cloud-api.com/v1",
      model: "gpt-4o",
      apiKey: "sk-test",
      timeoutMs: 30000,
    });
    expect(result.endpoint).toBe("http://cloud-api.com/v1");
    expect(result.model).toBe("gpt-4o");
    expect(result.apiKey).toBe("sk-test");
    expect(result.timeoutMs).toBe(30000);
  });

  it("merges partially — only overrides specified fields", () => {
    const result = resolveAnalyzerLlmConfig(TOP_LEVEL_LLM, {
      enabled: true,
      model: "gpt-4o",
    });
    expect(result.model).toBe("gpt-4o");
    expect(result.endpoint).toBe("http://localhost:11434/v1"); // from top-level
    expect(result.apiKey).toBe(""); // from top-level
  });
});

// ---- formatChainAsTranscript tests ----

describe("formatChainAsTranscript()", () => {
  it("formats msg.in/msg.out events correctly", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Hello" }),
      makeEvent("msg.out", { content: "Hi there!" }),
    ]);

    const transcript = formatChainAsTranscript(chain);
    expect(transcript).toContain("USER: Hello");
    expect(transcript).toContain("AGENT: Hi there!");
  });

  it("formats tool.call and tool.result events", () => {
    const chain = makeChain([
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "ls" } }),
      makeEvent("tool.result", { toolName: "exec", toolResult: "file.txt" }),
    ]);

    const transcript = formatChainAsTranscript(chain);
    expect(transcript).toContain("TOOL_CALL: exec");
    expect(transcript).toContain("TOOL_OK: exec");
  });

  it("formats tool errors with TOOL_ERROR prefix", () => {
    const chain = makeChain([
      makeEvent("tool.result", { toolName: "exec", toolError: "Permission denied" }),
    ]);

    const transcript = formatChainAsTranscript(chain);
    expect(transcript).toContain("TOOL_ERROR: exec → Permission denied");
  });
});

// ---- classifyFindings tests (with mocked fetch) ----

describe("classifyFindings()", () => {
  it("returns findings unchanged when LLM is disabled", async () => {
    const findings = [makeFinding()];
    const chains = new Map<string, ConversationChain>();
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: false },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBeNull();
  });

  it("returns unclassified finding when chain is not in map", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "soul_rule",
          actionText: "test rule",
          confidence: 0.9,
        }) } }],
      })),
    );

    const findings = [makeFinding({ chainId: "missing-chain" })];
    const chains = new Map<string, ConversationChain>();
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBeNull();
    fetchSpy.mockRestore();
  });

  it("classifies finding with valid LLM response", async () => {
    const llmResponse = {
      rootCause: "Agent retried without changing approach",
      actionType: "soul_rule",
      actionText: "NIEMALS denselben Befehl 3× wiederholen",
      confidence: 0.85,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      })),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec" }),
      makeEvent("tool.result", { toolName: "exec", toolError: "fail" }),
      makeEvent("msg.out", { content: "I tried but failed" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test-model" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).not.toBeNull();
    expect(result[0].classification!.rootCause).toBe("Agent retried without changing approach");
    expect(result[0].classification!.actionType).toBe("soul_rule");
    expect(result[0].classification!.model).toBe("test-model");
    fetchSpy.mockRestore();
  });

  it("handles invalid JSON from LLM gracefully — classification stays null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "This is not JSON at all" } }],
      })),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBeNull();
    fetchSpy.mockRestore();
  });

  it("handles timeout gracefully — classification stays null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("abort"), { name: "AbortError" }),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBeNull();
    fetchSpy.mockRestore();
  });

  it("defaults unknown actionType to manual_review", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "unknown_type",
          actionText: "test action",
          confidence: 0.7,
        }) } }],
      })),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result[0].classification!.actionType).toBe("manual_review");
    fetchSpy.mockRestore();
  });

  it("defaults confidence to 0.5 if LLM omits it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "soul_rule",
          actionText: "test rule",
        }) } }],
      })),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result[0].classification!.confidence).toBe(0.5);
    fetchSpy.mockRestore();
  });

  it("records model name in classification", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "soul_rule",
          actionText: "test rule",
          confidence: 0.9,
        }) } }],
      })),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "gpt-4o-test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result[0].classification!.model).toBe("gpt-4o-test");
    fetchSpy.mockRestore();
  });

  it("applies redaction before sending chain to LLM", async () => {
    let sentBody = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, opts) => {
      sentBody = typeof opts?.body === "string" ? opts.body : "";
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "soul_rule",
          actionText: "test",
          confidence: 0.5,
        }) } }],
      }));
    });

    const chain = makeChain([
      makeEvent("msg.in", { content: "Use PASSWORD=secret123 for the DB" }),
      makeEvent("msg.out", { content: "OK" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(sentBody).not.toContain("secret123");
    expect(sentBody).toContain("[REDACTED]");
    fetchSpy.mockRestore();
  });

  it("triage filters out findings when triage says keep: false", async () => {
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Triage response
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ keep: false, severity: "low", reason: "false positive" }) } }],
        }));
      }
      // Deep analysis (should not be called)
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "test",
          actionType: "soul_rule",
          actionText: "rule",
          confidence: 0.9,
        }) } }],
      }));
    });

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: {
        enabled: true,
        endpoint: "http://localhost/v1",
        model: "test",
        triage: {
          endpoint: "http://localhost/v1",
          model: "triage-model",
          timeoutMs: 5000,
        },
      },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(0); // filtered out by triage
    expect(callCount).toBe(1); // only triage called, not deep analysis
    fetchSpy.mockRestore();
  });

  it("triage passes findings through when keep: true", async () => {
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ keep: true, severity: "high", reason: "real failure" }) } }],
        }));
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          rootCause: "real issue",
          actionType: "soul_rule",
          actionText: "NIEMALS X",
          confidence: 0.9,
        }) } }],
      }));
    });

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: {
        enabled: true,
        endpoint: "http://localhost/v1",
        model: "test",
        triage: {
          endpoint: "http://localhost/v1",
          model: "triage-model",
          timeoutMs: 5000,
        },
      },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result).toHaveLength(1);
    expect(result[0].classification).not.toBeNull();
    expect(callCount).toBe(2); // triage + deep analysis
    fetchSpy.mockRestore();
  });

  it("handles HTTP error gracefully — classification stays null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );

    const chain = makeChain([
      makeEvent("msg.in", { content: "test" }),
      makeEvent("msg.out", { content: "reply" }),
    ]);

    const findings = [makeFinding()];
    const chains = new Map([["chain-1", chain]]);
    const config: TraceAnalyzerConfig = {
      ...TRACE_ANALYZER_DEFAULTS,
      llm: { enabled: true, endpoint: "http://localhost/v1", model: "test" },
    };

    const result = await classifyFindings(findings, chains, config, TOP_LEVEL_LLM, makeLogger());
    expect(result[0].classification).toBeNull();
    fetchSpy.mockRestore();
  });
});

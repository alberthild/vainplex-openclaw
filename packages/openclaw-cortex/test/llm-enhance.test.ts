import { describe, it, expect } from "vitest";
import { resolveLlmConfig, LlmEnhancer, LLM_DEFAULTS } from "../src/llm-enhance.js";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("resolveLlmConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveLlmConfig(undefined);
    expect(config).toEqual(LLM_DEFAULTS);
    expect(config.enabled).toBe(false);
  });

  it("returns defaults for empty object", () => {
    const config = resolveLlmConfig({});
    expect(config).toEqual(LLM_DEFAULTS);
  });

  it("merges partial config with defaults", () => {
    const config = resolveLlmConfig({
      enabled: true,
      model: "qwen2.5:7b",
    });
    expect(config.enabled).toBe(true);
    expect(config.model).toBe("qwen2.5:7b");
    expect(config.endpoint).toBe(LLM_DEFAULTS.endpoint);
    expect(config.timeoutMs).toBe(LLM_DEFAULTS.timeoutMs);
    expect(config.batchSize).toBe(LLM_DEFAULTS.batchSize);
  });

  it("respects custom endpoint and apiKey", () => {
    const config = resolveLlmConfig({
      enabled: true,
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      timeoutMs: 30000,
      batchSize: 5,
    });
    expect(config.endpoint).toBe("https://api.openai.com/v1");
    expect(config.apiKey).toBe("sk-test");
    expect(config.timeoutMs).toBe(30000);
    expect(config.batchSize).toBe(5);
  });

  it("ignores invalid types", () => {
    const config = resolveLlmConfig({
      enabled: "yes" as any,
      model: 42 as any,
      timeoutMs: "fast" as any,
    });
    expect(config.enabled).toBe(LLM_DEFAULTS.enabled);
    expect(config.model).toBe(LLM_DEFAULTS.model);
    expect(config.timeoutMs).toBe(LLM_DEFAULTS.timeoutMs);
  });
});

describe("LlmEnhancer", () => {
  it("returns null when disabled", async () => {
    const enhancer = new LlmEnhancer({ ...LLM_DEFAULTS, enabled: false }, mockLogger);
    const result = await enhancer.addMessage("test message", "user1", "user");
    expect(result).toBeNull();
  });

  it("buffers messages until batchSize", async () => {
    const enhancer = new LlmEnhancer(
      { ...LLM_DEFAULTS, enabled: true, batchSize: 3 },
      mockLogger,
    );
    // First two messages should buffer (no LLM call)
    const r1 = await enhancer.addMessage("hello", "user1", "user");
    expect(r1).toBeNull();
    const r2 = await enhancer.addMessage("world", "assistant", "assistant");
    expect(r2).toBeNull();
    // Third would trigger LLM but will fail gracefully (no server)
    const r3 = await enhancer.addMessage("test", "user1", "user");
    // Returns null because localhost:11434 is not guaranteed
    // The important thing is it doesn't throw
    expect(r3 === null || typeof r3 === "object").toBe(true);
  });

  it("flush returns null when no messages buffered", async () => {
    const enhancer = new LlmEnhancer({ ...LLM_DEFAULTS, enabled: true }, mockLogger);
    const result = await enhancer.flush();
    expect(result).toBeNull();
  });

  it("flush returns null when disabled", async () => {
    const enhancer = new LlmEnhancer({ ...LLM_DEFAULTS, enabled: false }, mockLogger);
    const result = await enhancer.flush();
    expect(result).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULTS } from "../src/config.js";

describe("resolveConfig", () => {
  it("applies all defaults for empty config", () => {
    const config = resolveConfig();
    expect(config).toEqual(DEFAULTS);
  });

  it("applies all defaults for undefined config", () => {
    const config = resolveConfig(undefined);
    expect(config).toEqual(DEFAULTS);
  });

  it("applies all defaults for empty object", () => {
    const config = resolveConfig({});
    expect(config).toEqual(DEFAULTS);
  });

  it("merges partial config over defaults", () => {
    const config = resolveConfig({
      natsUrl: "nats://custom:4222",
      streamName: "my-stream",
    });
    expect(config.natsUrl).toBe("nats://custom:4222");
    expect(config.streamName).toBe("my-stream");
    // Defaults preserved
    expect(config.enabled).toBe(true);
    expect(config.subjectPrefix).toBe("openclaw.events");
    expect(config.publishTimeoutMs).toBe(5000);
  });

  it("preserves explicit values", () => {
    const config = resolveConfig({
      enabled: false,
      natsUrl: "nats://host:9222",
      streamName: "custom-stream",
      subjectPrefix: "custom.prefix",
      publishTimeoutMs: 10000,
      connectTimeoutMs: 3000,
      drainTimeoutMs: 2000,
      includeHooks: ["message_received"],
      excludeHooks: ["gateway_start"],
    });
    expect(config.enabled).toBe(false);
    expect(config.natsUrl).toBe("nats://host:9222");
    expect(config.streamName).toBe("custom-stream");
    expect(config.subjectPrefix).toBe("custom.prefix");
    expect(config.publishTimeoutMs).toBe(10000);
    expect(config.connectTimeoutMs).toBe(3000);
    expect(config.drainTimeoutMs).toBe(2000);
    expect(config.includeHooks).toEqual(["message_received"]);
    expect(config.excludeHooks).toEqual(["gateway_start"]);
  });

  it("handles nested retention config", () => {
    const config = resolveConfig({
      retention: {
        maxMessages: 1000,
        maxBytes: 5000000,
        maxAgeHours: 720,
      },
    });
    expect(config.retention.maxMessages).toBe(1000);
    expect(config.retention.maxBytes).toBe(5000000);
    expect(config.retention.maxAgeHours).toBe(720);
  });

  it("handles partial retention config", () => {
    const config = resolveConfig({
      retention: {
        maxMessages: 500,
      },
    });
    expect(config.retention.maxMessages).toBe(500);
    expect(config.retention.maxBytes).toBe(-1);
    expect(config.retention.maxAgeHours).toBe(0);
  });

  it("ignores invalid types and uses defaults", () => {
    const config = resolveConfig({
      enabled: "yes" as unknown,
      natsUrl: 123 as unknown,
      publishTimeoutMs: "fast" as unknown,
      includeHooks: "all" as unknown,
    });
    expect(config.enabled).toBe(DEFAULTS.enabled);
    expect(config.natsUrl).toBe(DEFAULTS.natsUrl);
    expect(config.publishTimeoutMs).toBe(DEFAULTS.publishTimeoutMs);
    expect(config.includeHooks).toEqual(DEFAULTS.includeHooks);
  });
});

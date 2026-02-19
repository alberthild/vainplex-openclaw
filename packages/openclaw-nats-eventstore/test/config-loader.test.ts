import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config-loader.js";
import type { PluginLogger } from "../src/nats-client.js";

function createLogger(): PluginLogger & {
  logs: Array<{ level: string; msg: string }>;
} {
  const logs: Array<{ level: string; msg: string }> = [];
  return {
    logs,
    info: (msg: string) => logs.push({ level: "info", msg }),
    warn: (msg: string) => logs.push({ level: "warn", msg }),
    error: (msg: string) => logs.push({ level: "error", msg }),
    debug: (msg: string) => logs.push({ level: "debug", msg }),
  };
}

const TEST_DIR = join(import.meta.dirname ?? __dirname, ".tmp-config-test-nats");
const TEST_CONFIG_PATH = join(TEST_DIR, "config.json");

describe("nats-eventstore/config-loader", () => {
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    logger = createLogger();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe("legacy inline config", () => {
    it("uses full inline config when extra keys present", () => {
      const inline = {
        enabled: true,
        natsUrl: "nats://inline:4222",
        streamName: "inline-stream",
      };

      const result = loadConfig(inline, logger);

      expect(result.source).toBe("inline");
      expect(result.config.natsUrl).toBe("nats://inline:4222");
      expect(result.config.streamName).toBe("inline-stream");
      expect(result.filePath).toBeUndefined();
    });

    it("treats config with only enabled+configPath as non-legacy", () => {
      const inline = { enabled: true, configPath: TEST_CONFIG_PATH };

      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ natsUrl: "nats://file:4222" }),
        "utf-8",
      );

      const result = loadConfig(inline, logger);

      expect(result.source).toBe("file");
      expect(result.config.natsUrl).toBe("nats://file:4222");
    });
  });

  describe("external file config", () => {
    it("loads config from configPath", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          enabled: true,
          natsUrl: "nats://custom:4222",
          retention: { maxMessages: 100 },
        }),
        "utf-8",
      );

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      expect(result.source).toBe("file");
      expect(result.filePath).toBe(TEST_CONFIG_PATH);
      expect(result.config.natsUrl).toBe("nats://custom:4222");
      expect(result.config.retention.maxMessages).toBe(100);
    });

    it("inline enabled=false overrides file enabled=true", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ enabled: true, natsUrl: "nats://file:4222" }),
        "utf-8",
      );

      const result = loadConfig(
        { enabled: false, configPath: TEST_CONFIG_PATH },
        logger,
      );

      expect(result.config.enabled).toBe(false);
    });

    it("handles malformed JSON gracefully", () => {
      writeFileSync(TEST_CONFIG_PATH, "{ broken json", "utf-8");

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      expect(result.source).toBe("defaults");
      expect(result.config.enabled).toBe(true);
      expect(result.config.natsUrl).toBe("nats://localhost:4222");
      expect(logger.logs.some((l) => l.level === "warn")).toBe(true);
    });

    it("handles non-object JSON gracefully", () => {
        writeFileSync(TEST_CONFIG_PATH, '"just a string"', "utf-8");
  
        const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);
  
        expect(result.source).toBe("defaults");
        expect(logger.logs.some((l) => l.msg.includes("not an object"))).toBe(
          true,
        );
      });
  });

  describe("default bootstrapping", () => {
    it("creates default config when file missing", () => {
      const newPath = join(TEST_DIR, "new-subdir", "config.json");

      const result = loadConfig({ configPath: newPath }, logger);

      expect(result.source).toBe("file");
      expect(existsSync(newPath)).toBe(true);

      const written = JSON.parse(readFileSync(newPath, "utf-8")) as Record<
        string,
        unknown
      >;
      expect(written["natsUrl"]).toBe("nats://localhost:4222");
      expect(written["enabled"]).toBe(true);
    });

    it("default config is valid", () => {
        const result = loadConfig(
          { configPath: join(TEST_DIR, "auto.json") },
          logger,
        );
  
        expect(result.config.enabled).toBe(true);
        expect(result.config.streamName).toBe("openclaw-events");
      });
  });

  describe("graceful defaults", () => {
    it("returns defaults when no config at all", () => {
      const result = loadConfig(undefined, logger);
      expect(result.source).toBe("file"); // will try default path and bootstrap
      expect(result.config.enabled).toBe(true);
      expect(result.config.natsUrl).toBe("nats://localhost:4222");
    });
    
    it("returns defaults for empty object", () => {
        const result = loadConfig({}, logger);
        expect(result.source).toBe("file"); // will try default path and bootstrap
        expect(result.config.enabled).toBe(true);
    });
  });
});

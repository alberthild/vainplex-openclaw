import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config-loader.js";
import type { PluginLogger } from "../src/types.js";

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

const TEST_DIR = join(import.meta.dirname ?? __dirname, ".tmp-config-test");
const TEST_CONFIG_PATH = join(TEST_DIR, "config.json");

describe("config-loader", () => {
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
        failMode: "closed",
        timezone: "Europe/Berlin",
        policies: [],
      };

      const result = loadConfig(inline, logger);

      expect(result.source).toBe("inline");
      expect(result.config.failMode).toBe("closed");
      expect(result.config.timezone).toBe("Europe/Berlin");
      expect(result.filePath).toBeUndefined();
    });

    it("treats config with only enabled+configPath as non-legacy", () => {
      const inline = { enabled: true, configPath: TEST_CONFIG_PATH };

      // Write a file so it loads
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ failMode: "closed" }),
        "utf-8",
      );

      const result = loadConfig(inline, logger);

      expect(result.source).toBe("file");
      expect(result.config.failMode).toBe("closed");
    });

    it("treats config with only enabled as non-legacy", () => {
      // No file exists → will bootstrap defaults
      const result = loadConfig({ enabled: true, configPath: TEST_CONFIG_PATH }, logger);

      // Should bootstrap a default file
      expect(result.source).toBe("file");
      expect(result.config.enabled).toBe(true);
      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);
    });
  });

  describe("external file config", () => {
    it("loads config from configPath", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          enabled: true,
          failMode: "closed",
          timezone: "UTC",
          trust: { enabled: false },
        }),
        "utf-8",
      );

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      expect(result.source).toBe("file");
      expect(result.filePath).toBe(TEST_CONFIG_PATH);
      expect(result.config.failMode).toBe("closed");
      expect(result.config.trust.enabled).toBe(false);
    });

    it("inline enabled=false overrides file enabled=true", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ enabled: true, failMode: "closed" }),
        "utf-8",
      );

      const result = loadConfig(
        { enabled: false, configPath: TEST_CONFIG_PATH },
        logger,
      );

      expect(result.config.enabled).toBe(false);
    });

    it("handles malformed JSON gracefully", () => {
      writeFileSync(TEST_CONFIG_PATH, "{ broken json !!!", "utf-8");

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      // Should fall back to defaults, not throw
      expect(result.source).toBe("defaults");
      expect(result.config.enabled).toBe(true);
      expect(result.config.failMode).toBe("open");
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
      expect(written["failMode"]).toBe("open");
      expect(written["timezone"]).toBe("UTC");
    });

    it("default config is valid", () => {
      const result = loadConfig(
        { configPath: join(TEST_DIR, "auto.json") },
        logger,
      );

      expect(result.config.enabled).toBe(true);
      expect(result.config.failMode).toBe("open");
      expect(result.config.trust.enabled).toBe(true);
      expect(result.config.audit.enabled).toBe(true);
    });
  });

  describe("graceful defaults", () => {
    it("returns defaults when no config at all", () => {
      const result = loadConfig(undefined, logger);

      // No inline, no file at default path → will try default path, bootstrap
      expect(result.config.enabled).toBe(true);
      expect(result.config.failMode).toBe("open");
    });

    it("returns defaults for empty object", () => {
      // Empty object = no extra keys = not legacy, will look for file
      const result = loadConfig({}, logger);

      expect(result.config.enabled).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles undefined pluginConfig", () => {
      const result = loadConfig(undefined, logger);
      expect(result.config).toBeDefined();
      expect(result.config.failMode).toBe("open");
    });

    it("preserves all config sections from file", () => {
      const fullConfig = {
        enabled: true,
        timezone: "America/New_York",
        failMode: "closed",
        policies: [{ id: "test", rules: [] }],
        trust: { enabled: true, defaults: { main: 80 } },
        audit: { enabled: true, level: "verbose" },
        outputValidation: {
          enabled: true,
          enabledDetectors: ["system_state"],
          factRegistries: [],
        },
        builtinPolicies: { credentialGuard: true },
        toolRiskOverrides: { gateway: 90 },
        performance: { maxEvalUs: 3000 },
      };

      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify(fullConfig),
        "utf-8",
      );

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      expect(result.config.timezone).toBe("America/New_York");
      expect(result.config.failMode).toBe("closed");
      expect(result.config.trust.defaults?.["main"]).toBe(80);
      expect(result.config.audit.level).toBe("verbose");
      expect(result.config.outputValidation.enabled).toBe(true);
      expect(result.config.performance.maxEvalUs).toBe(3000);
    });

    it("logs info about config source", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ enabled: true }),
        "utf-8",
      );

      loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      expect(
        logger.logs.some(
          (l) => l.level === "info" && l.msg.includes("Loaded config"),
        ),
      ).toBe(true);
    });
  });
});

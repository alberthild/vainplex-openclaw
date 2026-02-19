import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config-loader.js";
import type { Logger } from "../src/types.js";

function createLogger(): Logger & {
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_DIR = join(__dirname, ".tmp-config-test-ke");
const TEST_CONFIG_PATH = join(TEST_DIR, "config.json");

describe("knowledge-engine/config-loader", () => {
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
        workspace: "/tmp/ke",
        decay: { enabled: false },
      };

      const result = loadConfig(inline, logger);

      assert.strictEqual(result.source, "inline");
      assert(result.config, "Config should not be null");
      assert.strictEqual(result.config.workspace, "/tmp/ke");
      assert.strictEqual(result.config.decay.enabled, false);
      assert.strictEqual(result.filePath, undefined);
    });

    it("treats config with only enabled+configPath as non-legacy", () => {
      const inline = { enabled: true, configPath: TEST_CONFIG_PATH };

      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ workspace: "/tmp/from-file" }),
        "utf-8",
      );

      const result = loadConfig(inline, logger);

      assert.strictEqual(result.source, "file");
      assert(result.config, "Config should not be null");
      assert(result.config.workspace.includes("from-file"));
    });
  });

  describe("external file config", () => {
    it("loads config from configPath", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          enabled: true,
          workspace: "/tmp/ke-file",
          embeddings: { enabled: true, endpoint: "http://localhost:8080" },
        }),
        "utf-8",
      );

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);
      
      assert.strictEqual(result.source, "file");
      assert.strictEqual(result.filePath, TEST_CONFIG_PATH);
      assert(result.config, "Config should not be null");
      assert.strictEqual(result.config.workspace, "/tmp/ke-file");
      assert.strictEqual(result.config.embeddings.enabled, true);
    });

    it("inline enabled=false overrides file enabled=true", () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({ enabled: true, workspace: "/tmp/ke" }),
        "utf-8",
      );

      const result = loadConfig(
        { enabled: false, configPath: TEST_CONFIG_PATH },
        logger,
      );

      assert(result.config, "Config should not be null");
      assert.strictEqual(result.config.enabled, false);
    });

    it("handles malformed JSON gracefully", () => {
      writeFileSync(TEST_CONFIG_PATH, "{ broken json", "utf-8");

      const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);

      assert.strictEqual(result.source, "defaults");
      assert(result.config, "Config should not be null");
      assert.strictEqual(result.config.enabled, true);
      assert(logger.logs.some((l) => l.level === "warn"));
    });

    it("handles non-object JSON gracefully", () => {
        writeFileSync(TEST_CONFIG_PATH, '"just a string"', "utf-8");
  
        const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);
  
        assert.strictEqual(result.source, "defaults");
        assert(logger.logs.some((l) => l.msg.includes("not an object")));
      });
  });

  describe("default bootstrapping", () => {
    it("creates default config when file missing", () => {
      const newPath = join(TEST_DIR, "new-subdir", "config.json");

      const result = loadConfig({ configPath: newPath }, logger);

      assert.strictEqual(result.source, "file");
      assert(existsSync(newPath));

      const written = JSON.parse(readFileSync(newPath, "utf-8")) as Record<
        string,
        any
      >;
      assert.strictEqual(written.decay.enabled, true);
      assert.strictEqual(written.enabled, true);
    });

    it("default config is valid", () => {
        const result = loadConfig(
          { configPath: join(TEST_DIR, "auto.json") },
          logger,
        );
  
        assert(result.config, "Config should not be null");
        assert.strictEqual(result.config.enabled, true);
        assert.strictEqual(result.config.extraction.llm.enabled, true);
      });
  });

  describe("graceful defaults", () => {
    it("returns defaults when no config at all", () => {
      const result = loadConfig(undefined, logger);
      assert.strictEqual(result.source, "file"); // will try default path and bootstrap
      assert(result.config, "Config should not be null");
      assert.strictEqual(result.config.enabled, true);
    });
    
    it("returns defaults for empty object", () => {
        const result = loadConfig({}, logger);
        assert.strictEqual(result.source, "file"); // will try default path and bootstrap
        assert(result.config, "Config should not be null");
        assert.strictEqual(result.config.enabled, true);
    });

    it("returns null config on validation error", () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({ decay: { rate: 99 } }), // invalid rate
            "utf-8",
        );

        const result = loadConfig({ configPath: TEST_CONFIG_PATH }, logger);
        assert.strictEqual(result.config, null);
        assert(logger.logs.some(l => l.level === 'error'));
    });
  });
});

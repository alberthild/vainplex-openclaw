import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../src/config-loader.js";
import { createMockLogger } from "./helpers.js";
import { writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";

const logger = createMockLogger();
const testConfigDir = "/tmp/sitrep-test-config";
const testConfigPath = `${testConfigDir}/config.json`;

afterEach(() => {
  if (existsSync(testConfigDir)) {
    rmSync(testConfigDir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("returns defaults for undefined pluginConfig", () => {
    const { config, source } = loadConfig(undefined, logger);
    expect(config.enabled).toBe(true);
    expect(source).toMatch(/file|defaults/);
  });

  it("returns defaults for empty object", () => {
    const { config } = loadConfig({}, logger);
    expect(config.enabled).toBe(true);
    expect(config.intervalMinutes).toBe(120);
  });

  it("uses inline config when extra keys present (legacy)", () => {
    const { config, source } = loadConfig(
      { enabled: true, intervalMinutes: 30, outputPath: "/tmp/test.json" },
      logger,
    );
    expect(source).toBe("inline");
    expect(config.intervalMinutes).toBe(30);
  });

  it("reads external config file", () => {
    mkdirSync(testConfigDir, { recursive: true });
    writeFileSync(
      testConfigPath,
      JSON.stringify({ enabled: true, intervalMinutes: 45 }),
    );

    const { config, source, filePath } = loadConfig(
      { configPath: testConfigPath },
      logger,
    );
    expect(source).toBe("file");
    expect(filePath).toBe(testConfigPath);
    expect(config.intervalMinutes).toBe(45);
  });

  it("applies inline enabled override on file config", () => {
    mkdirSync(testConfigDir, { recursive: true });
    writeFileSync(
      testConfigPath,
      JSON.stringify({ enabled: true, intervalMinutes: 60 }),
    );

    const { config } = loadConfig(
      { enabled: false, configPath: testConfigPath },
      logger,
    );
    expect(config.enabled).toBe(false);
    expect(config.intervalMinutes).toBe(60);
  });

  it("bootstraps default config when file missing", () => {
    const path = `${testConfigDir}/new/config.json`;
    const { config, source } = loadConfig(
      { configPath: path },
      logger,
    );
    expect(source).toBe("file");
    expect(existsSync(path)).toBe(true);
    expect(config.enabled).toBe(true);
  });

  it("handles invalid JSON in config file", () => {
    mkdirSync(testConfigDir, { recursive: true });
    writeFileSync(testConfigPath, "not json");

    const { source } = loadConfig(
      { configPath: testConfigPath },
      logger,
    );
    // Should fall back to defaults or bootstrap
    expect(["defaults", "file"]).toContain(source);
  });

  it("handles non-object JSON in config file", () => {
    mkdirSync(testConfigDir, { recursive: true });
    writeFileSync(testConfigPath, '"just a string"');

    const { source } = loadConfig(
      { configPath: testConfigPath },
      logger,
    );
    expect(["defaults", "file"]).toContain(source);
  });
});

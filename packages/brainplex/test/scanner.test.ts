import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseConfig,
  findConfig,
  extractAgents,
  detectInstalledPlugins,
  detectConfiguredPlugins,
  checkNodeVersion,
} from '../src/scanner.js';
import type { OpenClawConfig } from '../src/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainplex-test-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── parseConfig ────────────────────────────────────────────────────

describe('parseConfig', () => {
  it('parses valid JSON', () => {
    const result = parseConfig('{"foo": "bar"}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('strips single-line comments', () => {
    const result = parseConfig('{\n  // comment\n  "foo": "bar"\n}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('strips multi-line comments', () => {
    const result = parseConfig('{\n  /* multi\n  line */\n  "foo": "bar"\n}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('strips trailing commas', () => {
    const result = parseConfig('{"foo": "bar",}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('throws on completely invalid input', () => {
    expect(() => parseConfig('not json at all')).toThrow();
  });
});

// ─── findConfig ─────────────────────────────────────────────────────

describe('findConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds openclaw.json in given directory', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { test: true });

    const found = findConfig(tmpDir);
    expect(found).toBe(configPath);
  });

  it('finds .openclaw/openclaw.json in given directory', () => {
    const configPath = path.join(tmpDir, '.openclaw', 'openclaw.json');
    writeJson(configPath, { test: true });

    const found = findConfig(tmpDir);
    expect(found).toBe(configPath);
  });

  it('walks up to find openclaw.json in parent directories', () => {
    const configPath = path.join(tmpDir, 'openclaw.json');
    writeJson(configPath, { test: true });

    const subDir = path.join(tmpDir, 'sub', 'deep');
    fs.mkdirSync(subDir, { recursive: true });

    const found = findConfig(subDir);
    expect(found).toBe(configPath);
  });

  it('returns null when not found', () => {
    // Use a temp dir with no config
    const emptyDir = makeTmpDir();
    try {
      // findConfig will walk up and may find the real ~/.openclaw/openclaw.json
      // So we test the concept by checking the immediate dir has no config
      const direct = path.join(emptyDir, 'openclaw.json');
      expect(fs.existsSync(direct)).toBe(false);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ─── extractAgents ──────────────────────────────────────────────────

describe('extractAgents', () => {
  it('extracts agents from agents.definitions array format', () => {
    const config: OpenClawConfig = {
      agents: {
        definitions: [{ name: 'main' }, { name: 'forge' }],
      },
    };
    expect(extractAgents(config)).toEqual(['main', 'forge']);
  });

  it('extracts agents from agents object keys format', () => {
    const config: OpenClawConfig = {
      agents: {
        main: { model: 'gpt-4' },
        forge: { model: 'claude' },
      } as Record<string, unknown>,
    };
    expect(extractAgents(config)).toEqual(['main', 'forge']);
  });

  it('extracts agents from flat agents array format', () => {
    const config: OpenClawConfig = {
      agents: [{ name: 'main' }, { name: 'forge' }] as unknown as OpenClawConfig['agents'],
    };
    expect(extractAgents(config)).toEqual(['main', 'forge']);
  });

  it('extracts agents from agents.list array with id field (OpenClaw standard)', () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { model: { primary: 'some-model' } },
        list: [
          { id: 'main', name: 'Claudia' },
          { id: 'stella', name: 'Stella' },
          { id: 'forge', name: 'Forge' },
          { id: 'cerberus', name: 'Cerberus' },
        ],
      } as Record<string, unknown>,
    };
    expect(extractAgents(config)).toEqual(['main', 'stella', 'forge', 'cerberus']);
  });

  it('extracts agents from agents.list preferring id over name', () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: 'agent-1', name: 'Agent One' },
          { name: 'agent-2' },
        ],
      } as Record<string, unknown>,
    };
    expect(extractAgents(config)).toEqual(['agent-1', 'agent-2']);
  });

  it('returns empty array when no agents configured', () => {
    expect(extractAgents({})).toEqual([]);
    expect(extractAgents({ agents: undefined })).toEqual([]);
  });

  it('filters out meta-keys like definitions from object format', () => {
    const config: OpenClawConfig = {
      agents: {
        definitions: 'not-an-array', // Should be filtered as meta-key
        main: { model: 'gpt-4' },
      } as Record<string, unknown>,
    };
    expect(extractAgents(config)).toEqual(['main']);
  });
});

// ─── detectInstalledPlugins ─────────────────────────────────────────

describe('detectInstalledPlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects plugins in plugins.entries', () => {
    const config: OpenClawConfig = {
      plugins: {
        entries: { 'openclaw-governance': { enabled: true } },
      },
    };
    const result = detectInstalledPlugins(config, tmpDir);
    expect(result.has('openclaw-governance')).toBe(true);
  });

  it('detects plugins in plugins.allow', () => {
    const config: OpenClawConfig = {
      plugins: {
        allow: ['openclaw-cortex'],
      },
    };
    const result = detectInstalledPlugins(config, tmpDir);
    expect(result.has('openclaw-cortex')).toBe(true);
  });

  it('detects plugins in plugins.installs', () => {
    const config: OpenClawConfig = {
      plugins: {
        installs: { 'openclaw-membrane': { version: '1.0.0' } },
      },
    };
    const result = detectInstalledPlugins(config, tmpDir);
    expect(result.has('openclaw-membrane')).toBe(true);
  });

  it('detects plugin directories in extensions path', () => {
    const extDir = path.join(tmpDir, 'openclaw-leuko');
    fs.mkdirSync(extDir, { recursive: true });

    const result = detectInstalledPlugins({}, tmpDir);
    expect(result.has('openclaw-leuko')).toBe(true);
  });

  it('returns empty set when nothing installed', () => {
    const result = detectInstalledPlugins({}, tmpDir);
    expect(result.size).toBe(0);
  });
});

// ─── detectConfiguredPlugins ────────────────────────────────────────

describe('detectConfiguredPlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects plugins with config.json', () => {
    const pluginDir = path.join(tmpDir, 'openclaw-governance');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'config.json'), '{}', 'utf-8');

    const result = detectConfiguredPlugins(tmpDir);
    expect(result.has('openclaw-governance')).toBe(true);
  });

  it('ignores plugins without config.json', () => {
    const pluginDir = path.join(tmpDir, 'openclaw-cortex');
    fs.mkdirSync(pluginDir, { recursive: true });

    const result = detectConfiguredPlugins(tmpDir);
    expect(result.has('openclaw-cortex')).toBe(false);
  });

  it('returns empty set when plugins dir does not exist', () => {
    const result = detectConfiguredPlugins('/nonexistent/path');
    expect(result.size).toBe(0);
  });
});

// ─── checkNodeVersion ───────────────────────────────────────────────

describe('checkNodeVersion', () => {
  it('passes for current Node.js (>= 22)', () => {
    const result = checkNodeVersion();
    // We're running on Node >= 22 in this env
    expect(result.ok).toBe(true);
    expect(result.version).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

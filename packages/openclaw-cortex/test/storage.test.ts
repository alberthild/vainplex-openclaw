import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadJson,
  saveJson,
  loadText,
  saveText,
  rebootDir,
  ensureRebootDir,
  isWritable,
  getFileMtime,
  isFileOlderThan,
} from "../src/storage.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "cortex-storage-"));
}

describe("rebootDir", () => {
  it("returns memory/reboot path", () => {
    expect(rebootDir("/workspace")).toBe(join("/workspace", "memory", "reboot"));
  });
});

describe("ensureRebootDir", () => {
  it("creates the directory", () => {
    const ws = makeTmp();
    const ok = ensureRebootDir(ws, logger);
    expect(ok).toBe(true);
    const stat = require("node:fs").statSync(rebootDir(ws));
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns true if directory already exists", () => {
    const ws = makeTmp();
    mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
    expect(ensureRebootDir(ws, logger)).toBe(true);
  });
});

describe("isWritable", () => {
  it("returns true for writable workspace", () => {
    const ws = makeTmp();
    expect(isWritable(ws)).toBe(true);
  });

  it("returns true when memory/ dir exists and is writable", () => {
    const ws = makeTmp();
    mkdirSync(join(ws, "memory"), { recursive: true });
    expect(isWritable(ws)).toBe(true);
  });
});

describe("loadJson", () => {
  it("loads valid JSON", () => {
    const ws = makeTmp();
    const f = join(ws, "test.json");
    writeFileSync(f, '{"a":1}');
    const result = loadJson<{ a: number }>(f);
    expect(result.a).toBe(1);
  });

  it("returns empty object for missing file", () => {
    const result = loadJson("/nonexistent/path.json");
    expect(result).toEqual({});
  });

  it("returns empty object for corrupt JSON", () => {
    const ws = makeTmp();
    const f = join(ws, "bad.json");
    writeFileSync(f, "not json {{{");
    expect(loadJson(f)).toEqual({});
  });

  it("returns empty object for empty file", () => {
    const ws = makeTmp();
    const f = join(ws, "empty.json");
    writeFileSync(f, "");
    expect(loadJson(f)).toEqual({});
  });
});

describe("saveJson", () => {
  it("writes valid JSON atomically", () => {
    const ws = makeTmp();
    const f = join(ws, "out.json");
    const ok = saveJson(f, { hello: "world" }, logger);
    expect(ok).toBe(true);
    const content = JSON.parse(readFileSync(f, "utf-8"));
    expect(content.hello).toBe("world");
  });

  it("creates parent directories", () => {
    const ws = makeTmp();
    const f = join(ws, "sub", "deep", "out.json");
    const ok = saveJson(f, { nested: true }, logger);
    expect(ok).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf-8")).nested).toBe(true);
  });

  it("no .tmp file left after successful write", () => {
    const ws = makeTmp();
    const f = join(ws, "clean.json");
    saveJson(f, { clean: true }, logger);
    const fs = require("node:fs");
    expect(fs.existsSync(f + ".tmp")).toBe(false);
  });

  it("pretty-prints with 2-space indent", () => {
    const ws = makeTmp();
    const f = join(ws, "pretty.json");
    saveJson(f, { a: 1 }, logger);
    const raw = readFileSync(f, "utf-8");
    expect(raw).toContain("  ");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

describe("loadText", () => {
  it("loads text file content", () => {
    const ws = makeTmp();
    const f = join(ws, "note.md");
    writeFileSync(f, "# Hello\nWorld");
    expect(loadText(f)).toBe("# Hello\nWorld");
  });

  it("returns empty string for missing file", () => {
    expect(loadText("/nonexistent/file.md")).toBe("");
  });
});

describe("saveText", () => {
  it("writes text file atomically", () => {
    const ws = makeTmp();
    const f = join(ws, "out.md");
    const ok = saveText(f, "# Test", logger);
    expect(ok).toBe(true);
    expect(readFileSync(f, "utf-8")).toBe("# Test");
  });

  it("creates parent directories", () => {
    const ws = makeTmp();
    const f = join(ws, "a", "b", "out.md");
    saveText(f, "deep", logger);
    expect(readFileSync(f, "utf-8")).toBe("deep");
  });
});

describe("getFileMtime", () => {
  it("returns ISO string for existing file", () => {
    const ws = makeTmp();
    const f = join(ws, "file.txt");
    writeFileSync(f, "x");
    const mtime = getFileMtime(f);
    expect(mtime).toBeTruthy();
    expect(new Date(mtime!).getTime()).toBeGreaterThan(0);
  });

  it("returns null for missing file", () => {
    expect(getFileMtime("/nonexistent")).toBeNull();
  });
});

describe("isFileOlderThan", () => {
  it("returns true for missing file", () => {
    expect(isFileOlderThan("/nonexistent", 1)).toBe(true);
  });

  it("returns false for fresh file", () => {
    const ws = makeTmp();
    const f = join(ws, "fresh.txt");
    writeFileSync(f, "new");
    expect(isFileOlderThan(f, 1)).toBe(false);
  });
});

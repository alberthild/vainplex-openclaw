// test/storage.test.ts

import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AtomicStorage } from '../src/storage.js';
import type { Logger } from '../src/types.js';

const createMockLogger = (): Logger & { logs: { level: string; msg: string }[] } => {
  const logs: { level: string; msg: string }[] = [];
  return { logs, info: (msg) => logs.push({ level: 'info', msg }), warn: (msg) => logs.push({ level: 'warn', msg }), error: (msg) => logs.push({ level: 'error', msg }), debug: (msg) => logs.push({ level: 'debug', msg }) };
};

describe('AtomicStorage', () => {
  const testDir = path.join('/tmp', `atomic-storage-test-${Date.now()}`);
  let logger: ReturnType<typeof createMockLogger>;
  let storage: AtomicStorage;

  before(async () => await fs.mkdir(testDir, { recursive: true }));
  after(async () => await fs.rm(testDir, { recursive: true, force: true }));
  beforeEach(() => { logger = createMockLogger(); storage = new AtomicStorage(testDir, logger); });

  it('should initialize and create the storage directory', async () => {
    const newDir = path.join(testDir, 'new-dir');
    const newStorage = new AtomicStorage(newDir, logger);
    await newStorage.init();
    const stats = await fs.stat(newDir);
    assert.ok(stats.isDirectory(), 'Directory should be created');
  });

  describe('writeJson', () => {
    it('should write a JSON object to a file', async () => {
      const fileName = 'test.json';
      const data = { key: 'value', number: 123 };
      await storage.writeJson(fileName, data);
      const content = await fs.readFile(path.join(testDir, fileName), 'utf-8');
      assert.deepStrictEqual(JSON.parse(content), data);
    });
  });

  describe('readJson', () => {
    it('should read and parse a valid JSON file', async () => {
      const fileName = 'read.json';
      const data = { a: 1, b: [2, 3] };
      await fs.writeFile(path.join(testDir, fileName), JSON.stringify(data));
      const result = await storage.readJson<typeof data>(fileName);
      assert.deepStrictEqual(result, data);
    });

    it('should return null if the file does not exist', async () => {
      const result = await storage.readJson('nonexistent.json');
      assert.strictEqual(result, null);
    });
  });

  describe('debounce', () => {
    it('should only call the async function once after the delay', async () => {
      let callCount = 0;
      const asyncFn = async () => { callCount++; return callCount; };
      const debouncedFn = AtomicStorage.debounce(asyncFn, 50);

      const p1 = debouncedFn();
      const p2 = debouncedFn();
      const p3 = debouncedFn();

      const results = await Promise.all([p1, p2, p3]);
      assert.strictEqual(callCount, 1);
      assert.deepStrictEqual(results, [1, 1, 1]);
    });

    it('should pass the arguments of the last call to the async function', async () => {
      let finalArgs: any[] = [];
      const asyncFn = async (...args: any[]) => { finalArgs = args; return finalArgs; };
      const debouncedFn = AtomicStorage.debounce(asyncFn, 50);

      debouncedFn(1);
      debouncedFn(2, 3);
      const finalPromise = debouncedFn(4, 5, 6);
      
      const result = await finalPromise;
      assert.deepStrictEqual(finalArgs, [4, 5, 6]);
      assert.deepStrictEqual(result, [4, 5, 6]);
    });
  });
});

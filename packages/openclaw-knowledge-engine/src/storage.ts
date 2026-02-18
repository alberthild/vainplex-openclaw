// src/storage.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IStorage, Logger } from './types.js';

/** Type guard for Node.js system errors with a `code` property. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * A utility class for performing atomic and durable file I/O operations.
 * It writes to a temporary file first, then renames it to the final destination,
 * which prevents data corruption in case of a crash during the write.
 */
export class AtomicStorage implements IStorage {
  private readonly storagePath: string;
  private readonly logger: Logger;

  /**
   * Creates an instance of AtomicStorage.
   * @param storagePath The base directory where files will be stored.
   * @param logger A logger instance for logging errors.
   */
  constructor(storagePath: string, logger: Logger) {
    this.storagePath = storagePath;
    this.logger = logger;
  }

  /**
   * Ensures that the storage directory exists.
   */
  public async init(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (err) {
      this.logger.error(`Failed to create storage directory: ${this.storagePath}`, err as Error);
      throw err;
    }
  }

  /**
   * Reads and parses a JSON file from the storage path.
   * @param fileName The name of the file to read (e.g., "facts.json").
   * @returns The parsed JSON object, or null if the file doesn't exist or is invalid.
   */
  async readJson<T>(fileName: string): Promise<T | null> {
    const filePath = path.join(this.storagePath, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      this.logger.error(`Failed to read or parse JSON file: ${filePath}`, err as Error);
      return null;
    }
  }

  /**
   * Writes a JSON object to a file atomically.
   * @param fileName The name of the file to write (e.g., "facts.json").
   * @param data The JSON object to serialize and write.
   */
  async writeJson<T>(fileName: string, data: T): Promise<void> {
    const filePath = path.join(this.storagePath, fileName);
    const tempFilePath = `${filePath}.${Date.now()}.tmp`;

    try {
      const jsonString = JSON.stringify(data, null, 2);
      await fs.writeFile(tempFilePath, jsonString, 'utf-8');
      await fs.rename(tempFilePath, filePath);
    } catch (err) {
      this.logger.error(`Failed to write JSON file atomically: ${filePath}`, err as Error);
      // Attempt to clean up the temporary file if it exists
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupErr) {
        if (!isNodeError(cleanupErr) || cleanupErr.code !== 'ENOENT') {
          this.logger.warn(`Failed to clean up temporary file: ${tempFilePath}`);
        }
      }
      throw err; // Re-throw the original error
    }
  }

  /**
   * A debouncer function to limit the rate at which a function is executed.
   * This version is designed for async functions and returns a promise that
   * resolves with the result of the last invocation.
   * @param func The async function to debounce.
   * @param delay The debounce delay in milliseconds.
   * @returns A debounced version of the function that returns a promise.
   */
  static debounce<A extends unknown[], R>(
    func: (...args: A) => Promise<R>,
    delay: number
  ): (...args: A) => Promise<R> {
    let timeoutId: NodeJS.Timeout | null = null;
    let resolvers: { resolve: (v: R) => void; reject: (e: unknown) => void }[] = [];

    return (...args: A): Promise<R> => {
      if (timeoutId) clearTimeout(timeoutId);

      const promise = new Promise<R>((resolve, reject) => {
        resolvers.push({ resolve, reject });
      });

      timeoutId = setTimeout(() => {
        const current = resolvers;
        resolvers = [];
        func(...args)
          .then(result => current.forEach(r => r.resolve(result)))
          .catch(err => current.forEach(r => r.reject(err)));
      }, delay);

      return promise;
    };
  }
}

/**
 * Redaction Vault (RFC-007 §4)
 *
 * Stores mapping between redacted placeholders and original values.
 * Uses SHA-256 for deterministic hashing. Supports TTL-based expiry
 * and collision handling (hash8 → hash12 on collision).
 *
 * Security invariants:
 * - Vault contents NEVER appear in logs or error messages
 * - Vault is NEVER persisted to disk
 * - Vault is NEVER sent over the network
 */

import { createHash } from "node:crypto";
import type { PluginLogger, RedactionCategory, VaultEntry } from "../types.js";

/** Default vault expiry: 1 hour */
const DEFAULT_EXPIRY_SECONDS = 3600;

/** Cleanup interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Compute SHA-256 hash of a string, return full hex digest.
 */
function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Format a redaction placeholder.
 */
function formatPlaceholder(category: RedactionCategory, hashSlice: string): string {
  return `[REDACTED:${category}:${hashSlice}]`;
}

/** Regex to match redaction placeholders in text */
const PLACEHOLDER_REGEX = /\[REDACTED:(?:credential|pii|financial|custom):([a-f0-9]{8,12})\]/g;

export class RedactionVault {
  /** hash → VaultEntry */
  private readonly entries: Map<string, VaultEntry> = new Map();
  /** hash8 → full hash (for collision detection) */
  private readonly hashIndex: Map<string, string[]> = new Map();
  private readonly expirySeconds: number;
  private readonly logger: PluginLogger;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(logger: PluginLogger, expirySeconds?: number) {
    this.logger = logger;
    this.expirySeconds = expirySeconds ?? DEFAULT_EXPIRY_SECONDS;
  }

  /** Start the cleanup timer (must call stop() to clear) */
  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref(); // Don't prevent process exit
  }

  /** Stop the cleanup timer and clear all entries */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
    this.hashIndex.clear();
  }

  /**
   * Store a secret and return its placeholder.
   * Handles hash8 collisions by extending to hash12.
   */
  store(original: string, category: RedactionCategory): string {
    const fullHash = sha256(original);
    const hash8 = fullHash.slice(0, 8);

    // Check if we already have this exact value stored
    const existing = this.entries.get(fullHash);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.placeholder;
    }

    // Check for hash8 collision
    const existingHashes = this.hashIndex.get(hash8);
    let hashSlice: string;

    if (existingHashes && existingHashes.length > 0) {
      // Check if any existing hash8 collision is from a DIFFERENT value
      const hasCollision = existingHashes.some((h) => {
        const entry = this.entries.get(h);
        return entry && h !== fullHash && entry.expiresAt > Date.now();
      });

      if (hasCollision) {
        // Use hash12 to avoid collision
        hashSlice = fullHash.slice(0, 12);
      } else {
        hashSlice = hash8;
      }
    } else {
      hashSlice = hash8;
    }

    const placeholder = formatPlaceholder(category, hashSlice);
    const now = Date.now();

    const entry: VaultEntry = {
      original,
      category,
      placeholder,
      hash: fullHash,
      createdAt: now,
      expiresAt: now + this.expirySeconds * 1000,
    };

    this.entries.set(fullHash, entry);

    // Update hash index
    const indexed = this.hashIndex.get(hash8) ?? [];
    if (!indexed.includes(fullHash)) {
      indexed.push(fullHash);
      this.hashIndex.set(hash8, indexed);
    }

    return placeholder;
  }

  /**
   * Resolve a placeholder back to its original value.
   * Returns null if not found or expired.
   */
  resolve(placeholder: string): string | null {
    const match = /\[REDACTED:(?:credential|pii|financial|custom):([a-f0-9]{8,12})\]/.exec(
      placeholder,
    );
    if (!match?.[1]) return null;

    const hashSlice = match[1];
    return this.resolveByHash(hashSlice);
  }

  /**
   * Resolve a hash slice (8 or 12 chars) to original value.
   * Returns null if not found or expired.
   */
  resolveByHash(hashSlice: string): string | null {
    // Try direct lookup via hash index (hash8 case)
    if (hashSlice.length === 8) {
      const fullHashes = this.hashIndex.get(hashSlice);
      if (!fullHashes) return null;

      for (const fullHash of fullHashes) {
        const entry = this.entries.get(fullHash);
        if (entry && entry.expiresAt > Date.now()) {
          // Verify the placeholder uses this hash slice
          if (entry.placeholder.includes(hashSlice)) {
            return entry.original;
          }
        }
      }
      return null;
    }

    // hash12 case: iterate entries
    for (const [fullHash, entry] of this.entries) {
      if (
        fullHash.startsWith(hashSlice) &&
        entry.expiresAt > Date.now() &&
        entry.placeholder.includes(hashSlice)
      ) {
        return entry.original;
      }
    }

    return null;
  }

  /**
   * Resolve all placeholders in a string, replacing them with original values.
   * Returns the string with all resolvable placeholders replaced.
   * Unresolvable placeholders are left as-is and their hashes returned.
   */
  resolveAll(input: string): { resolved: string; unresolvedHashes: string[] } {
    const unresolved: string[] = [];

    const resolved = input.replace(PLACEHOLDER_REGEX, (fullMatch, hashSlice: string) => {
      const original = this.resolveByHash(hashSlice);
      if (original !== null) {
        return original;
      }
      unresolved.push(hashSlice);
      return fullMatch;
    });

    return { resolved, unresolvedHashes: unresolved };
  }

  /** Get the number of active (non-expired) entries */
  get size(): number {
    let count = 0;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) count++;
    }
    return count;
  }

  /** Check if vault has any entries (including expired) */
  get totalSize(): number {
    return this.entries.size;
  }

  /** Evict all expired entries */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [fullHash, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(fullHash);
        evicted++;

        // Clean up hash index
        const hash8 = fullHash.slice(0, 8);
        const indexed = this.hashIndex.get(hash8);
        if (indexed) {
          const filtered = indexed.filter((h) => h !== fullHash);
          if (filtered.length === 0) {
            this.hashIndex.delete(hash8);
          } else {
            this.hashIndex.set(hash8, filtered);
          }
        }
      }
    }

    if (evicted > 0) {
      this.logger.debug?.(
        `[redaction] Vault evicted ${evicted} expired entries, ${this.entries.size} remaining`,
      );
    }

    return evicted;
  }

  /** Clear all entries (e.g., on session end) */
  clear(): void {
    this.entries.clear();
    this.hashIndex.clear();
  }

  /** Get a fresh placeholder regex for scanning strings */
  static getPlaceholderRegex(): RegExp {
    return /\[REDACTED:(?:credential|pii|financial|custom):([a-f0-9]{8,12})\]/g;
  }
}

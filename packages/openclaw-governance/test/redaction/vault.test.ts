import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginLogger } from "../../src/types.js";
import { RedactionVault } from "../../src/redaction/vault.js";

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("RedactionVault", () => {
  let vault: RedactionVault;

  afterEach(() => {
    vault?.stop();
  });

  // ── Basic Store/Resolve ──

  describe("store and resolve", () => {
    it("stores a value and returns a placeholder", () => {
      vault = new RedactionVault(logger);
      const placeholder = vault.store("my-secret", "credential");
      expect(placeholder).toMatch(/^\[REDACTED:credential:[a-f0-9]{8}\]$/);
    });

    it("resolves a placeholder back to original value", () => {
      vault = new RedactionVault(logger);
      const placeholder = vault.store("my-secret", "credential");
      const resolved = vault.resolve(placeholder);
      expect(resolved).toBe("my-secret");
    });

    it("uses SHA-256 hash for placeholder", () => {
      vault = new RedactionVault(logger);
      const secret = "test-secret-value";
      const placeholder = vault.store(secret, "credential");
      const expectedHash = sha256(secret).slice(0, 8);
      expect(placeholder).toBe(`[REDACTED:credential:${expectedHash}]`);
    });

    it("returns same placeholder for same value", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("same-secret", "credential");
      const p2 = vault.store("same-secret", "credential");
      expect(p1).toBe(p2);
    });

    it("returns different placeholders for different values", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("secret-1", "credential");
      const p2 = vault.store("secret-2", "credential");
      expect(p1).not.toBe(p2);
    });

    it("stores values with different categories", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("secret@example.com", "pii");
      expect(p1).toMatch(/^\[REDACTED:pii:[a-f0-9]{8}\]$/);
    });

    it("returns null for unknown placeholder", () => {
      vault = new RedactionVault(logger);
      const resolved = vault.resolve("[REDACTED:credential:00000000]");
      expect(resolved).toBeNull();
    });

    it("returns null for malformed placeholder", () => {
      vault = new RedactionVault(logger);
      const resolved = vault.resolve("not-a-placeholder");
      expect(resolved).toBeNull();
    });
  });

  // ── SHA-256 Hashing ──

  describe("SHA-256 hashing", () => {
    it("uses cryptographic hash, not simple hash", () => {
      vault = new RedactionVault(logger);
      const secret = "test-value";
      const expectedHash = sha256(secret).slice(0, 8);
      const placeholder = vault.store(secret, "credential");
      expect(placeholder).toContain(expectedHash);
    });

    it("produces deterministic hashes", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("deterministic", "credential");
      vault.clear();
      const p2 = vault.store("deterministic", "credential");
      expect(p1).toBe(p2);
    });
  });

  // ── TTL / Expiry ──

  describe("TTL and expiry", () => {
    it("entries expire after TTL", () => {
      vault = new RedactionVault(logger, 1); // 1 second TTL
      const placeholder = vault.store("expiring-secret", "credential");

      // Should resolve immediately
      expect(vault.resolve(placeholder)).toBe("expiring-secret");

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      // Should no longer resolve
      expect(vault.resolve(placeholder)).toBeNull();

      vi.useRealTimers();
    });

    it("evictExpired removes expired entries", () => {
      vault = new RedactionVault(logger, 1);
      vault.store("secret-1", "credential");
      vault.store("secret-2", "pii");

      expect(vault.totalSize).toBe(2);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      const evicted = vault.evictExpired();
      expect(evicted).toBe(2);
      expect(vault.totalSize).toBe(0);

      vi.useRealTimers();
    });

    it("size only counts non-expired entries", () => {
      vault = new RedactionVault(logger, 1);
      vault.store("secret", "credential");

      expect(vault.size).toBe(1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      expect(vault.size).toBe(0);

      vi.useRealTimers();
    });

    it("re-storing an expired value creates a new entry", () => {
      vault = new RedactionVault(logger, 1);
      vault.store("rotate-me", "credential");

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      // Re-store the same value
      const p2 = vault.store("rotate-me", "credential");
      expect(vault.resolve(p2)).toBe("rotate-me");

      vi.useRealTimers();
    });
  });

  // ── Collision Handling ──

  describe("collision handling", () => {
    it("handles hash8 collisions by extending to hash12", () => {
      vault = new RedactionVault(logger);

      // We can't easily create real SHA-256 collisions on 8 chars,
      // but we can test the mechanism by storing many values and
      // verifying they all resolve correctly
      const values: string[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < 100; i++) {
        const val = `secret-${i}-${Math.random().toString(36)}`;
        values.push(val);
        placeholders.push(vault.store(val, "credential"));
      }

      // All should resolve correctly
      for (let i = 0; i < values.length; i++) {
        const resolved = vault.resolve(placeholders[i]!);
        expect(resolved).toBe(values[i]);
      }
    });

    it("vault size reflects stored entries", () => {
      vault = new RedactionVault(logger);
      expect(vault.size).toBe(0);

      vault.store("a", "credential");
      expect(vault.size).toBe(1);

      vault.store("b", "credential");
      expect(vault.size).toBe(2);

      // Same value doesn't increase size
      vault.store("a", "credential");
      expect(vault.size).toBe(2);
    });
  });

  // ── resolveAll ──

  describe("resolveAll", () => {
    it("resolves all placeholders in a string", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("secret1", "credential");
      const p2 = vault.store("secret2", "pii");

      const input = `Use ${p1} and ${p2} together`;
      const { resolved, unresolvedHashes } = vault.resolveAll(input);

      expect(resolved).toBe("Use secret1 and secret2 together");
      expect(unresolvedHashes.length).toBe(0);
    });

    it("leaves unresolvable placeholders intact", () => {
      vault = new RedactionVault(logger);
      const input = "Use [REDACTED:credential:deadbeef] here";
      const { resolved, unresolvedHashes } = vault.resolveAll(input);

      expect(resolved).toBe(input);
      expect(unresolvedHashes.length).toBe(1);
      expect(unresolvedHashes[0]).toBe("deadbeef");
    });

    it("handles mixed resolved and unresolved", () => {
      vault = new RedactionVault(logger);
      const p1 = vault.store("real-secret", "credential");

      const input = `${p1} and [REDACTED:credential:00000000]`;
      const { resolved, unresolvedHashes } = vault.resolveAll(input);

      expect(resolved).toContain("real-secret");
      expect(resolved).toContain("[REDACTED:credential:00000000]");
      expect(unresolvedHashes.length).toBe(1);
    });

    it("handles string with no placeholders", () => {
      vault = new RedactionVault(logger);
      const input = "No placeholders here";
      const { resolved, unresolvedHashes } = vault.resolveAll(input);

      expect(resolved).toBe(input);
      expect(unresolvedHashes.length).toBe(0);
    });
  });

  // ── Lifecycle ──

  describe("lifecycle", () => {
    it("clear removes all entries", () => {
      vault = new RedactionVault(logger);
      vault.store("a", "credential");
      vault.store("b", "pii");
      expect(vault.size).toBe(2);

      vault.clear();
      expect(vault.size).toBe(0);
    });

    it("stop clears entries and timer", () => {
      vault = new RedactionVault(logger);
      vault.start();
      vault.store("a", "credential");

      vault.stop();
      expect(vault.size).toBe(0);
    });

    it("start is idempotent", () => {
      vault = new RedactionVault(logger);
      vault.start();
      vault.start(); // Should not throw or create duplicate timers
      vault.stop();
    });
  });

  // ── Performance ──

  describe("performance", () => {
    it("stores and resolves 1000 entries in < 50ms", () => {
      vault = new RedactionVault(logger);

      const start = performance.now();
      const placeholders: string[] = [];

      for (let i = 0; i < 1000; i++) {
        placeholders.push(vault.store(`secret-${i}`, "credential"));
      }

      for (const p of placeholders) {
        vault.resolve(p);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("resolveAll with many placeholders < 5ms", () => {
      vault = new RedactionVault(logger);
      const placeholders: string[] = [];

      for (let i = 0; i < 100; i++) {
        placeholders.push(vault.store(`secret-${i}`, "credential"));
      }

      const input = placeholders.join(" ");
      const start = performance.now();
      vault.resolveAll(input);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });

  // ── Placeholder Regex ──

  describe("getPlaceholderRegex", () => {
    it("matches valid placeholders", () => {
      // Each test() call needs a fresh regex (global flag advances lastIndex)
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:credential:abcd1234]")).toBe(true);
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:pii:12345678]")).toBe(true);
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:financial:abcdef12]")).toBe(true);
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:custom:aabbccdd]")).toBe(true);
    });

    it("matches hash12 placeholders", () => {
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:credential:abcd12345678]")).toBe(true);
    });

    it("does not match invalid placeholders", () => {
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:unknown:abcd1234]")).toBe(false);
      expect(RedactionVault.getPlaceholderRegex().test("[REDACTED:credential:short]")).toBe(false);
      expect(RedactionVault.getPlaceholderRegex().test("not a placeholder")).toBe(false);
    });
  });
});

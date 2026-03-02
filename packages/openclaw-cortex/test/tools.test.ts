import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchesDecisionQuery, matchesThreadQuery } from "../src/tools/match-helpers.js";

const TEST_WORKSPACE = "/tmp/cortex-test-tools";

beforeEach(() => {
  mkdirSync(`${TEST_WORKSPACE}/memory/reboot`, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("matchesDecisionQuery", () => {
  const decision = {
    id: "1", what: "Use Auth0 as provider", why: "Best OAuth2 solution",
    who: "alice", impact: "high" as const, date: "2026-03-01", extracted_at: new Date().toISOString(),
  };

  it("matches on 'what' field", () => {
    expect(matchesDecisionQuery(decision, "Auth0")).toBe(true);
  });

  it("matches on 'why' field", () => {
    expect(matchesDecisionQuery(decision, "OAuth2")).toBe(true);
  });

  it("matches on 'who' field", () => {
    expect(matchesDecisionQuery(decision, "alice")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesDecisionQuery(decision, "auth0")).toBe(true);
  });

  it("returns false for non-matching query", () => {
    expect(matchesDecisionQuery(decision, "kubernetes")).toBe(false);
  });
});

describe("matchesThreadQuery", () => {
  const thread = {
    id: "1", title: "Auth Migration", status: "open" as const,
    priority: "high" as const, summary: "Migrating from JWT to OAuth2",
    decisions: ["Use Auth0"], waiting_for: null, mood: "neutral",
    last_activity: new Date().toISOString(), created: new Date().toISOString(),
  };

  it("matches on title", () => {
    expect(matchesThreadQuery(thread, "Auth")).toBe(true);
  });

  it("matches on summary", () => {
    expect(matchesThreadQuery(thread, "JWT")).toBe(true);
  });

  it("matches on decisions", () => {
    expect(matchesThreadQuery(thread, "Auth0")).toBe(true);
  });

  it("returns false for non-matching query", () => {
    expect(matchesThreadQuery(thread, "kubernetes")).toBe(false);
  });
});

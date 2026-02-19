import { describe, expect, it } from "vitest";
import {
  clamp,
  extractAgentId,
  extractAgentIds,
  extractParentSessionKey,
  getCurrentTime,
  globToRegex,
  isInTimeRange,
  isSubAgent,
  nowUs,
  parseTimeToMinutes,
  resolveAgentId,
  scoreToTier,
  sha256,
  tierOrdinal,
} from "../src/util.js";

describe("parseTimeToMinutes", () => {
  it("should parse valid times", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("12:30")).toBe(750);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("should return -1 for invalid times", () => {
    expect(parseTimeToMinutes("25:00")).toBe(-1);
    expect(parseTimeToMinutes("abc")).toBe(-1);
    expect(parseTimeToMinutes("12:60")).toBe(-1);
  });
});

describe("isInTimeRange", () => {
  it("should handle normal range", () => {
    expect(isInTimeRange(600, 480, 1020)).toBe(true); // 10:00 in 08:00-17:00
    expect(isInTimeRange(300, 480, 1020)).toBe(false); // 05:00 in 08:00-17:00
  });

  it("should handle midnight wrap", () => {
    // 23:00-06:00
    expect(isInTimeRange(1400, 1380, 360)).toBe(true); // 23:20 in 23:00-06:00
    expect(isInTimeRange(100, 1380, 360)).toBe(true); // 01:40 in 23:00-06:00
    expect(isInTimeRange(600, 1380, 360)).toBe(false); // 10:00 not in 23:00-06:00
  });

  it("should handle equal start/end (full day)", () => {
    expect(isInTimeRange(600, 480, 480)).toBe(false);
  });
});

describe("getCurrentTime", () => {
  it("should return a valid TimeContext for UTC", () => {
    const tc = getCurrentTime("UTC");
    expect(tc.timezone).toBe("UTC");
    expect(tc.hour).toBeGreaterThanOrEqual(0);
    expect(tc.hour).toBeLessThan(24);
    expect(tc.minute).toBeGreaterThanOrEqual(0);
    expect(tc.minute).toBeLessThan(60);
    expect(tc.dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(tc.dayOfWeek).toBeLessThan(7);
    expect(tc.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("globToRegex", () => {
  it("should match exact strings", () => {
    expect(globToRegex("exec").test("exec")).toBe(true);
    expect(globToRegex("exec").test("exec2")).toBe(false);
  });

  it("should handle * wildcard", () => {
    expect(globToRegex("memory_*").test("memory_search")).toBe(true);
    expect(globToRegex("memory_*").test("exec")).toBe(false);
  });

  it("should handle ? wildcard", () => {
    expect(globToRegex("rea?").test("read")).toBe(true);
    expect(globToRegex("rea?").test("reading")).toBe(false);
  });

  it("should escape regex special characters", () => {
    expect(globToRegex("file.txt").test("file.txt")).toBe(true);
    expect(globToRegex("file.txt").test("filextxt")).toBe(false);
  });
});

describe("sha256", () => {
  it("should return a 64-char hex string", () => {
    const hash = sha256("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("should be deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("clamp", () => {
  it("should clamp values", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe("nowUs", () => {
  it("should return a positive number", () => {
    expect(nowUs()).toBeGreaterThan(0);
  });
});

describe("extractAgentId", () => {
  it("should prefer explicit agentId", () => {
    expect(extractAgentId("agent:main", "forge")).toBe("forge");
  });

  it("should extract from root session key", () => {
    expect(extractAgentId("agent:main")).toBe("main");
  });

  it("should extract from sub-agent session key", () => {
    expect(extractAgentId("agent:main:subagent:forge:abc")).toBe("forge");
  });

  it("should return unknown for missing data", () => {
    expect(extractAgentId()).toBe("unknown");
  });
});

describe("isSubAgent", () => {
  it("should detect sub-agents", () => {
    expect(isSubAgent("agent:main:subagent:forge:abc")).toBe(true);
  });

  it("should not detect root agents", () => {
    expect(isSubAgent("agent:main")).toBe(false);
  });

  it("should handle undefined", () => {
    expect(isSubAgent()).toBe(false);
  });
});

describe("extractParentSessionKey", () => {
  it("should extract parent for sub-agents", () => {
    expect(extractParentSessionKey("agent:main:subagent:forge:abc")).toBe(
      "agent:main",
    );
  });

  it("should return null for root agents", () => {
    expect(extractParentSessionKey("agent:main")).toBeNull();
  });
});

describe("scoreToTier", () => {
  it("should map scores to correct tiers", () => {
    expect(scoreToTier(0)).toBe("untrusted");
    expect(scoreToTier(19)).toBe("untrusted");
    expect(scoreToTier(20)).toBe("restricted");
    expect(scoreToTier(39)).toBe("restricted");
    expect(scoreToTier(40)).toBe("standard");
    expect(scoreToTier(59)).toBe("standard");
    expect(scoreToTier(60)).toBe("trusted");
    expect(scoreToTier(79)).toBe("trusted");
    expect(scoreToTier(80)).toBe("privileged");
    expect(scoreToTier(100)).toBe("privileged");
  });
});

describe("tierOrdinal", () => {
  it("should return correct ordinals", () => {
    expect(tierOrdinal("untrusted")).toBe(0);
    expect(tierOrdinal("restricted")).toBe(1);
    expect(tierOrdinal("standard")).toBe(2);
    expect(tierOrdinal("trusted")).toBe(3);
    expect(tierOrdinal("privileged")).toBe(4);
  });
});

describe("resolveAgentId", () => {
  it("should return agentId when provided", () => {
    expect(resolveAgentId({ agentId: "atlas" })).toBe("atlas");
  });

  it("should parse from sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "agent:forge:abc" })).toBe("forge");
  });

  it("should parse subagent from sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "agent:main:subagent:forge:abc" })).toBe("forge");
  });

  it("should return 'unresolved' when both undefined", () => {
    expect(resolveAgentId({})).toBe("unresolved");
  });

  it("should return 'unresolved' for UUID sessionKey", () => {
    expect(resolveAgentId({ sessionKey: "78b1f33b-e9a4-4eae-8341-7c57bbc69843" })).toBe("unresolved");
  });

  it("should parse from sessionId as fallback", () => {
    expect(resolveAgentId({ sessionId: "agent:leuko:session123" })).toBe("leuko");
  });

  it("should use event metadata as last resort", () => {
    expect(resolveAgentId({}, { metadata: { agentId: "forge" } })).toBe("forge");
  });

  it("should log debug when unresolved", () => {
    const debugs: string[] = [];
    resolveAgentId({}, undefined, { warn: () => {}, debug: (m) => debugs.push(m) });
    expect(debugs).toHaveLength(1);
    expect(debugs[0]).toContain("Could not resolve agentId");
  });

  it("should not log warning when resolved", () => {
    const warnings: string[] = [];
    resolveAgentId({ agentId: "atlas" }, undefined, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(0);
  });

  it("should prefer agentId over sessionKey", () => {
    expect(resolveAgentId({ agentId: "atlas", sessionKey: "agent:forge" })).toBe("atlas");
  });

  it("should prefer sessionKey over sessionId", () => {
    expect(resolveAgentId({ sessionKey: "agent:forge", sessionId: "agent:leuko" })).toBe("forge");
  });

  it("should prefer sessionId over event metadata", () => {
    expect(resolveAgentId({ sessionId: "agent:leuko" }, { metadata: { agentId: "other" } })).toBe("leuko");
  });

  it("should handle empty string agentId", () => {
    // Empty string is falsy, should fall through
    expect(resolveAgentId({ agentId: "", sessionKey: "agent:forge" })).toBe("forge");
  });
});

describe("extractAgentIds", () => {
  it("should extract IDs from object array", () => {
    const config = { agents: { list: [{ id: "main" }, { id: "forge" }, { id: "cerberus" }] } };
    expect(extractAgentIds(config)).toEqual(["main", "forge", "cerberus"]);
  });

  it("should extract IDs from string array", () => {
    const config = { agents: { list: ["main", "forge"] } };
    expect(extractAgentIds(config)).toEqual(["main", "forge"]);
  });

  it("should handle mixed array", () => {
    const config = { agents: { list: ["main", { id: "forge" }, 42, null] } };
    expect(extractAgentIds(config)).toEqual(["main", "forge"]);
  });

  it("should return empty for missing agents key", () => {
    expect(extractAgentIds({})).toEqual([]);
  });

  it("should return empty for missing list key", () => {
    expect(extractAgentIds({ agents: {} })).toEqual([]);
  });

  it("should return empty for non-array list", () => {
    expect(extractAgentIds({ agents: { list: "not-an-array" } })).toEqual([]);
  });

  it("should skip entries without id field", () => {
    const config = { agents: { list: [{ name: "no-id" }, { id: "valid" }] } };
    expect(extractAgentIds(config)).toEqual(["valid"]);
  });

  it("should skip entries with non-string id", () => {
    const config = { agents: { list: [{ id: 42 }, { id: "valid" }] } };
    expect(extractAgentIds(config)).toEqual(["valid"]);
  });

  it("should handle agents as non-object", () => {
    expect(extractAgentIds({ agents: "string" })).toEqual([]);
    expect(extractAgentIds({ agents: null })).toEqual([]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DecisionTracker, inferImpact } from "../src/decision-tracker.js";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cortex-dt-"));
  mkdirSync(join(ws, "memory", "reboot"), { recursive: true });
  return ws;
}

function readDecisions(ws: string) {
  const raw = readFileSync(join(ws, "memory", "reboot", "decisions.json"), "utf-8");
  return JSON.parse(raw);
}

// ════════════════════════════════════════════════════════════
// inferImpact
// ════════════════════════════════════════════════════════════
describe("inferImpact", () => {
  it("returns 'high' for 'architecture'", () => {
    expect(inferImpact("changed the architecture")).toBe("high");
  });

  it("returns 'high' for 'security'", () => {
    expect(inferImpact("security vulnerability found")).toBe("high");
  });

  it("returns 'high' for 'migration'", () => {
    expect(inferImpact("database migration plan")).toBe("high");
  });

  it("returns 'high' for 'delete'", () => {
    expect(inferImpact("delete the old repo")).toBe("high");
  });

  it("returns 'high' for 'production'", () => {
    expect(inferImpact("deployed to production")).toBe("high");
  });

  it("returns 'high' for 'deploy'", () => {
    expect(inferImpact("deploy to staging")).toBe("high");
  });

  it("returns 'high' for 'critical'", () => {
    expect(inferImpact("critical bug found")).toBe("high");
  });

  it("returns 'high' for German 'architektur'", () => {
    expect(inferImpact("Die Architektur muss geändert werden")).toBe("high");
  });

  it("returns 'high' for German 'löschen'", () => {
    expect(inferImpact("Repo löschen")).toBe("high");
  });

  it("returns 'high' for 'strategy'", () => {
    expect(inferImpact("new business strategy")).toBe("high");
  });

  it("returns 'medium' for generic text", () => {
    expect(inferImpact("changed the color scheme")).toBe("medium");
  });

  it("returns 'medium' for empty text", () => {
    expect(inferImpact("")).toBe("medium");
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — basic extraction
// ════════════════════════════════════════════════════════════
describe("DecisionTracker", () => {
  let workspace: string;
  let tracker: DecisionTracker;

  beforeEach(() => {
    workspace = makeWorkspace();
    tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);
  });

  it("starts with empty decisions", () => {
    expect(tracker.getDecisions()).toHaveLength(0);
  });

  it("extracts a decision from English text", () => {
    tracker.processMessage("We decided to use TypeScript for all plugins", "albert");
    const decisions = tracker.getDecisions();
    expect(decisions.length).toBe(1);
    expect(decisions[0].what).toContain("decided");
    expect(decisions[0].who).toBe("albert");
  });

  it("extracts a decision from German text", () => {
    tracker.processMessage("Wir haben beschlossen, TS zu verwenden", "albert");
    const decisions = tracker.getDecisions();
    expect(decisions.length).toBe(1);
    expect(decisions[0].what).toContain("beschlossen");
  });

  it("sets correct date format (YYYY-MM-DD)", () => {
    tracker.processMessage("We decided to go with plan A", "user");
    const d = tracker.getDecisions()[0];
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sets extracted_at as ISO timestamp", () => {
    tracker.processMessage("The decision was to use Vitest", "user");
    const d = tracker.getDecisions()[0];
    expect(d.extracted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates unique IDs", () => {
    tracker.processMessage("decided to use A", "user");
    tracker.processMessage("decided to use B as well", "user");
    const ids = tracker.getDecisions().map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not extract from unrelated text", () => {
    tracker.processMessage("The weather is nice and sunny today", "user");
    expect(tracker.getDecisions()).toHaveLength(0);
  });

  it("skips empty content", () => {
    tracker.processMessage("", "user");
    expect(tracker.getDecisions()).toHaveLength(0);
  });

  it("extracts context window for 'why'", () => {
    tracker.processMessage("After much debate and long discussions about the tech stack and the future of the company, we finally decided to use Rust for performance and safety reasons going forward", "user");
    const d = tracker.getDecisions()[0];
    // 'why' has a wider window (100 before + 200 after) vs 'what' (50 before + 100 after)
    expect(d.why.length).toBeGreaterThanOrEqual(d.what.length);
  });

  it("persists decisions to disk", () => {
    tracker.processMessage("We agreed on MIT license for all plugins", "albert");
    const data = readDecisions(workspace);
    expect(data.version).toBe(1);
    expect(data.decisions.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — deduplication
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — deduplication", () => {
  it("deduplicates identical decisions within window", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    tracker.processMessage("We decided to use TypeScript", "user");
    tracker.processMessage("We decided to use TypeScript", "user");
    expect(tracker.getDecisions()).toHaveLength(1);
  });

  it("allows different decisions", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    tracker.processMessage("We decided to use TypeScript", "user");
    tracker.processMessage("We decided to use ESM modules", "user");
    expect(tracker.getDecisions()).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — impact inference
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — impact inference", () => {
  it("assigns high impact for architecture decisions", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    tracker.processMessage("We decided to change the architecture completely", "user");
    expect(tracker.getDecisions()[0].impact).toBe("high");
  });

  it("assigns medium impact for generic decisions", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    tracker.processMessage("We decided to change the color scheme to blue", "user");
    expect(tracker.getDecisions()[0].impact).toBe("medium");
  });

  it("assigns high impact for security decisions", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    tracker.processMessage("The decision was to prioritize the security audit immediately", "user");
    expect(tracker.getDecisions()[0].impact).toBe("high");
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — maxDecisions cap
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — maxDecisions cap", () => {
  it("enforces maxDecisions by removing oldest", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 3,
      dedupeWindowHours: 0, // disable dedup for this test
    }, "both", logger);

    tracker.processMessage("decided to do alpha first", "user");
    tracker.processMessage("decided to do bravo second", "user");
    tracker.processMessage("decided to do charlie third", "user");
    tracker.processMessage("decided to do delta fourth", "user");

    const decisions = tracker.getDecisions();
    expect(decisions.length).toBe(3);
    // Oldest should be gone
    expect(decisions.some(d => d.what.includes("alpha"))).toBe(false);
    // Newest should be present
    expect(decisions.some(d => d.what.includes("delta"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — loading existing state
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — loading existing state", () => {
  it("loads decisions from existing file", () => {
    const workspace = makeWorkspace();
    const existingData = {
      version: 1,
      updated: new Date().toISOString(),
      decisions: [
        {
          id: "existing-1",
          what: "decided to use TypeScript",
          date: "2026-02-17",
          why: "Type safety",
          impact: "high",
          who: "albert",
          extracted_at: new Date().toISOString(),
        },
      ],
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "decisions.json"),
      JSON.stringify(existingData),
    );

    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    expect(tracker.getDecisions()).toHaveLength(1);
    expect(tracker.getDecisions()[0].id).toBe("existing-1");
  });

  it("handles missing decisions.json gracefully", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    expect(tracker.getDecisions()).toHaveLength(0);
  });

  it("handles corrupt decisions.json gracefully", () => {
    const workspace = makeWorkspace();
    writeFileSync(
      join(workspace, "memory", "reboot", "decisions.json"),
      "invalid json {{{",
    );

    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    expect(tracker.getDecisions()).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — getRecentDecisions
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — getRecentDecisions", () => {
  it("filters by recency days", () => {
    const workspace = makeWorkspace();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const existingData = {
      version: 1,
      updated: new Date().toISOString(),
      decisions: [
        {
          id: "old",
          what: "old decision",
          date: oldDate,
          why: "old",
          impact: "medium" as const,
          who: "user",
          extracted_at: new Date().toISOString(),
        },
        {
          id: "recent",
          what: "recent decision",
          date: new Date().toISOString().slice(0, 10),
          why: "recent",
          impact: "medium" as const,
          who: "user",
          extracted_at: new Date().toISOString(),
        },
      ],
    };
    writeFileSync(
      join(workspace, "memory", "reboot", "decisions.json"),
      JSON.stringify(existingData),
    );

    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    const recent = tracker.getRecentDecisions(14, 10);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("recent");
  });

  it("respects limit parameter", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 0,
    }, "both", logger);

    for (let i = 0; i < 5; i++) {
      tracker.processMessage(`decided to do item number ${i} now`, "user");
    }

    const recent = tracker.getRecentDecisions(14, 2);
    expect(recent).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════
// DecisionTracker — multiple patterns in one message
// ════════════════════════════════════════════════════════════
describe("DecisionTracker — multiple patterns", () => {
  it("extracts multiple decisions from one message", () => {
    const workspace = makeWorkspace();
    const tracker = new DecisionTracker(workspace, {
      enabled: true,
      maxDecisions: 100,
      dedupeWindowHours: 24,
    }, "both", logger);

    // "decided" and "the plan is" are separate patterns in distinct sentences
    // Use enough spacing so context windows don't produce identical 'what' values
    tracker.processMessage(
      "After reviewing all options, we decided to use TypeScript for the new plugin system. Meanwhile in a completely separate topic, the plan is to migrate the database to PostgreSQL next quarter.",
      "user",
    );
    expect(tracker.getDecisions().length).toBeGreaterThanOrEqual(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  reconstructChains,
  deduplicateEvents,
  eventFingerprint,
  simpleHash,
  computeChainId,
} from "../../src/trace-analyzer/chain-reconstructor.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../src/trace-analyzer/events.js";

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000; // 1 second between events
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
    ...overrides,
  };
}

async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// ---- Tests ----

beforeEach(() => {
  resetCounters();
});

describe("chain-reconstructor", () => {
  describe("reconstructChains", () => {
    it("groups events by (session, agent) into separate chains", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }, { session: "sess-A", agent: "main" }),
        makeEvent("msg.out", { content: "hi" }, { session: "sess-A", agent: "main" }),
        makeEvent("msg.in", { content: "world" }, { session: "sess-B", agent: "main" }),
        makeEvent("msg.out", { content: "hey" }, { session: "sess-B", agent: "main" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(2);
      expect(chains.map(c => c.session).sort()).toEqual(["sess-A", "sess-B"]);
    });

    it("same session, different agents → separate chains", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }, { session: "shared", agent: "main" }),
        makeEvent("msg.out", { content: "b" }, { session: "shared", agent: "main" }),
        makeEvent("msg.in", { content: "c" }, { session: "shared", agent: "forge" }),
        makeEvent("msg.out", { content: "d" }, { session: "shared", agent: "forge" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(2);
      expect(chains.map(c => c.agent).sort()).toEqual(["forge", "main"]);
    });

    it("orders events by timestamp within a chain", async () => {
      // Insert events out of order
      const e1 = makeEvent("msg.in", { content: "first" });
      const e3 = makeEvent("msg.out", { content: "third" });
      const e2 = makeEvent("tool.call", { toolName: "exec" });
      // Swap timestamps to put e2 between e1 and e3
      e2.ts = e1.ts + 500;
      e3.ts = e1.ts + 1500;

      const chains = await reconstructChains(asyncIter([e3, e1, e2]));
      expect(chains.length).toBe(1);
      expect(chains[0].events[0].payload.content).toBe("first");
      expect(chains[0].events[1].payload.toolName).toBe("exec");
      expect(chains[0].events[2].payload.content).toBe("third");
    });

    it("splits chain on session.start event", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
        makeEvent("session.start", { sessionId: "new" }),
        makeEvent("msg.in", { content: "c" }),
        makeEvent("msg.out", { content: "d" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(2);
      expect(chains[0].events.length).toBe(2);
      // Second chain starts with session.start
      expect(chains[1].events[0].type).toBe("session.start");
    });

    it("splits chain on session.end event", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
        makeEvent("session.end", { sessionId: "old" }),
        makeEvent("msg.in", { content: "c" }),
        makeEvent("msg.out", { content: "d" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(2);
    });

    it("splits chain on inactivity gap > 30 min", async () => {
      const e1 = makeEvent("msg.in", { content: "a" });
      const e2 = makeEvent("msg.out", { content: "b" });
      const e3 = makeEvent("msg.in", { content: "c" });
      const e4 = makeEvent("msg.out", { content: "d" });
      // Put 31 minutes gap between e2 and e3
      e3.ts = e2.ts + 31 * 60 * 1000;
      e4.ts = e3.ts + 1000;

      const chains = await reconstructChains(asyncIter([e1, e2, e3, e4]));
      expect(chains.length).toBe(2);
    });

    it("does NOT split on gap < 30 min", async () => {
      const e1 = makeEvent("msg.in", { content: "a" });
      const e2 = makeEvent("msg.out", { content: "b" });
      const e3 = makeEvent("msg.in", { content: "c" });
      const e4 = makeEvent("msg.out", { content: "d" });
      // 29 minutes gap — should NOT split
      e3.ts = e2.ts + 29 * 60 * 1000;
      e4.ts = e3.ts + 1000;

      const chains = await reconstructChains(asyncIter([e1, e2, e3, e4]));
      expect(chains.length).toBe(1);
      expect(chains[0].events.length).toBe(4);
    });

    it("splits on run.end → run.start with >5 min gap", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("run.end", { success: true }),
      ];
      // 6 minute gap
      const runStart = makeEvent("run.start", { prompt: "new" });
      runStart.ts = events[1].ts + 6 * 60 * 1000;
      const e4 = makeEvent("msg.in", { content: "b" });
      e4.ts = runStart.ts + 1000;

      const chains = await reconstructChains(asyncIter([...events, runStart, e4]));
      expect(chains.length).toBe(2);
    });

    it("does NOT split on run.end → run.start with <5 min gap", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("run.end", { success: true }),
      ];
      // 4 minute gap
      const runStart = makeEvent("run.start", { prompt: "next" });
      runStart.ts = events[1].ts + 4 * 60 * 1000;
      const e4 = makeEvent("msg.in", { content: "b" });
      e4.ts = runStart.ts + 1000;

      const chains = await reconstructChains(asyncIter([...events, runStart, e4]));
      expect(chains.length).toBe(1);
    });

    it("filters out chains with <2 events", async () => {
      // Single event in its own session — too short
      const events = [
        makeEvent("msg.in", { content: "a" }, { session: "lonely" }),
        makeEvent("msg.in", { content: "b" }, { session: "pair" }),
        makeEvent("msg.out", { content: "c" }, { session: "pair" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].session).toBe("pair");
    });

    it("computes chain ID deterministically", async () => {
      const events = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "world" }),
      ];

      const chains1 = await reconstructChains(asyncIter(events));
      resetCounters();
      const events2 = [
        makeEvent("msg.in", { content: "hello" }),
        makeEvent("msg.out", { content: "world" }),
      ];
      const chains2 = await reconstructChains(asyncIter(events2));

      expect(chains1[0].id).toBe(chains2[0].id);
    });

    it("computes typeCounts correctly", async () => {
      const events = [
        makeEvent("msg.in", { content: "q1" }),
        makeEvent("tool.call", { toolName: "exec" }),
        makeEvent("tool.result", { toolName: "exec", toolResult: "ok" }),
        makeEvent("tool.call", { toolName: "Read" }),
        makeEvent("tool.result", { toolName: "Read", toolResult: "data" }),
        makeEvent("msg.out", { content: "done" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].typeCounts["msg.in"]).toBe(1);
      expect(chains[0].typeCounts["msg.out"]).toBe(1);
      expect(chains[0].typeCounts["tool.call"]).toBe(2);
      expect(chains[0].typeCounts["tool.result"]).toBe(2);
    });

    it("caps chain at maxEventsPerChain", async () => {
      const events: NormalizedEvent[] = [];
      for (let i = 0; i < 12; i++) {
        events.push(makeEvent(i % 2 === 0 ? "msg.in" : "msg.out", {
          content: `msg-${i}`,
        }));
      }

      const chains = await reconstructChains(asyncIter(events), {
        maxEventsPerChain: 5,
      });

      // 12 events with cap 5 → 2 full chains of 5 + 1 chain of 2
      expect(chains.length).toBe(3);
      expect(chains[0].events.length).toBe(5);
      expect(chains[1].events.length).toBe(5);
      expect(chains[2].events.length).toBe(2);
    });

    it("handles empty event stream", async () => {
      const chains = await reconstructChains(asyncIter([]));
      expect(chains).toEqual([]);
    });

    it("handles single-agent, single-session stream", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
        makeEvent("msg.in", { content: "c" }),
        makeEvent("msg.out", { content: "d" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].events.length).toBe(4);
    });

    it("handles events with session='unknown'", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }, { session: "unknown" }),
        makeEvent("msg.out", { content: "b" }, { session: "unknown" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].session).toBe("unknown");
    });

    it("respects configurable gapMinutes parameter", async () => {
      const e1 = makeEvent("msg.in", { content: "a" });
      const e2 = makeEvent("msg.out", { content: "b" });
      const e3 = makeEvent("msg.in", { content: "c" });
      const e4 = makeEvent("msg.out", { content: "d" });
      // 11 minute gap
      e3.ts = e2.ts + 11 * 60 * 1000;
      e4.ts = e3.ts + 1000;

      // With 10 min gap → should split
      const chains10 = await reconstructChains(asyncIter([e1, e2, e3, e4]), { gapMinutes: 10 });
      expect(chains10.length).toBe(2);

      resetCounters();
      const f1 = makeEvent("msg.in", { content: "a" });
      const f2 = makeEvent("msg.out", { content: "b" });
      const f3 = makeEvent("msg.in", { content: "c" });
      const f4 = makeEvent("msg.out", { content: "d" });
      f3.ts = f2.ts + 11 * 60 * 1000;
      f4.ts = f3.ts + 1000;

      // With 15 min gap → should NOT split
      const chains15 = await reconstructChains(asyncIter([f1, f2, f3, f4]), { gapMinutes: 15 });
      expect(chains15.length).toBe(1);
    });

    it("multiple agents interleaved in timestamps", async () => {
      // Events from two agents mixed in timestamp order
      resetCounters();
      const events = [
        makeEvent("msg.in", { content: "a" }, { agent: "main", session: "s1" }),
        makeEvent("msg.in", { content: "b" }, { agent: "forge", session: "s1" }),
        makeEvent("msg.out", { content: "c" }, { agent: "main", session: "s1" }),
        makeEvent("msg.out", { content: "d" }, { agent: "forge", session: "s1" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(2);

      const mainChain = chains.find(c => c.agent === "main")!;
      const forgeChain = chains.find(c => c.agent === "forge")!;
      expect(mainChain.events.length).toBe(2);
      expect(forgeChain.events.length).toBe(2);
    });

    it("sets boundaryType to 'lifecycle' when lifecycle events present", async () => {
      const events = [
        makeEvent("session.start", { sessionId: "s1" }),
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].boundaryType).toBe("lifecycle");
    });

    it("sets boundaryType to 'gap' when no lifecycle events", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains.length).toBe(1);
      expect(chains[0].boundaryType).toBe("gap");
    });

    it("records startTs and endTs from first/last events", async () => {
      const events = [
        makeEvent("msg.in", { content: "a" }),
        makeEvent("msg.out", { content: "b" }),
        makeEvent("msg.in", { content: "c" }),
      ];

      const chains = await reconstructChains(asyncIter(events));
      expect(chains[0].startTs).toBe(events[0].ts);
      expect(chains[0].endTs).toBe(events[2].ts);
    });
  });

  describe("deduplicateEvents", () => {
    it("removes duplicate events with same fingerprint", () => {
      const base = 1700000000000;
      const e1: NormalizedEvent = {
        id: "a", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello", role: "user" }, seq: 1,
      };
      // Same content, same 1-second window, different seq
      const e2: NormalizedEvent = {
        id: "b", ts: base + 500, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello", role: "user" }, seq: 100,
      };

      const deduped = deduplicateEvents([e1, e2]);
      expect(deduped.length).toBe(1);
      // Higher seq wins
      expect(deduped[0].seq).toBe(100);
    });

    it("keeps events with different content", () => {
      const base = 1700000000000;
      const e1: NormalizedEvent = {
        id: "a", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello", role: "user" }, seq: 1,
      };
      const e2: NormalizedEvent = {
        id: "b", ts: base + 500, agent: "main", session: "s", type: "msg.in",
        payload: { content: "world", role: "user" }, seq: 2,
      };

      const deduped = deduplicateEvents([e1, e2]);
      expect(deduped.length).toBe(2);
    });

    it("deduplicates tool.call events by toolName + params", () => {
      const base = 1700000000000;
      const e1: NormalizedEvent = {
        id: "a", ts: base, agent: "main", session: "s", type: "tool.call",
        payload: { toolName: "exec", toolParams: { command: "ls" } }, seq: 1,
      };
      const e2: NormalizedEvent = {
        id: "b", ts: base + 200, agent: "main", session: "s", type: "tool.call",
        payload: { toolName: "exec", toolParams: { command: "ls" } }, seq: 50,
      };

      const deduped = deduplicateEvents([e1, e2]);
      expect(deduped.length).toBe(1);
      expect(deduped[0].seq).toBe(50); // Higher seq wins
    });

    it("keeps events outside the 1-second dedup window", () => {
      const base = 1700000000000;
      const e1: NormalizedEvent = {
        id: "a", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello", role: "user" }, seq: 1,
      };
      // 2 seconds later — different window
      const e2: NormalizedEvent = {
        id: "b", ts: base + 2000, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello", role: "user" }, seq: 2,
      };

      const deduped = deduplicateEvents([e1, e2]);
      expect(deduped.length).toBe(2);
    });
  });

  describe("eventFingerprint", () => {
    it("produces same fingerprint for Schema A and B of same event", () => {
      const base = 1700000000000;
      const schemaA: NormalizedEvent = {
        id: "uuid-1", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello" }, seq: 1,
      };
      const schemaB: NormalizedEvent = {
        id: "short-1", ts: base + 100, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello" }, seq: 100,
      };

      expect(eventFingerprint(schemaA)).toBe(eventFingerprint(schemaB));
    });

    it("different content → different fingerprint", () => {
      const base = 1700000000000;
      const e1: NormalizedEvent = {
        id: "a", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "hello" }, seq: 1,
      };
      const e2: NormalizedEvent = {
        id: "b", ts: base, agent: "main", session: "s", type: "msg.in",
        payload: { content: "world" }, seq: 2,
      };

      expect(eventFingerprint(e1)).not.toBe(eventFingerprint(e2));
    });
  });

  describe("simpleHash", () => {
    it("produces consistent results", () => {
      expect(simpleHash("hello")).toBe(simpleHash("hello"));
    });

    it("produces different results for different strings", () => {
      expect(simpleHash("hello")).not.toBe(simpleHash("world"));
    });

    it("handles empty string", () => {
      expect(typeof simpleHash("")).toBe("number");
    });
  });

  describe("computeChainId", () => {
    it("produces 16-char hex string", () => {
      const id = computeChainId("session", "agent", 1700000000000);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("is deterministic", () => {
      const id1 = computeChainId("s", "a", 123);
      const id2 = computeChainId("s", "a", 123);
      expect(id1).toBe(id2);
    });

    it("different inputs → different IDs", () => {
      const id1 = computeChainId("s1", "a", 123);
      const id2 = computeChainId("s2", "a", 123);
      expect(id1).not.toBe(id2);
    });
  });
});

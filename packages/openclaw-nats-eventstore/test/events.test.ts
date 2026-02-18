import { describe, it, expect } from "vitest";
import { ALL_EVENT_TYPES } from "../src/events.js";
import type { ClawEvent, EventType } from "../src/events.js";

describe("EventType", () => {
  it("has 17 event types", () => {
    expect(ALL_EVENT_TYPES).toHaveLength(17);
  });

  it("includes all core event types from PR #18171", () => {
    const core: EventType[] = [
      "msg.in",
      "msg.out",
      "tool.call",
      "tool.result",
      "run.start",
      "run.end",
      "run.error",
    ];
    for (const t of core) {
      expect(ALL_EVENT_TYPES).toContain(t);
    }
  });

  it("includes new plugin event types", () => {
    const newTypes: EventType[] = [
      "msg.sending",
      "llm.input",
      "llm.output",
      "session.start",
      "session.end",
      "session.compaction_start",
      "session.compaction_end",
      "session.reset",
      "gateway.start",
      "gateway.stop",
    ];
    for (const t of newTypes) {
      expect(ALL_EVENT_TYPES).toContain(t);
    }
  });

  it("has no duplicate event types", () => {
    const unique = new Set(ALL_EVENT_TYPES);
    expect(unique.size).toBe(ALL_EVENT_TYPES.length);
  });
});

describe("ClawEvent structure", () => {
  it("conforms to the expected envelope shape", () => {
    const event: ClawEvent = {
      id: "test-uuid",
      ts: Date.now(),
      agent: "main",
      session: "main:matrix:albert",
      type: "msg.in",
      payload: { from: "albert", content: "hello" },
    };

    expect(event.id).toBe("test-uuid");
    expect(typeof event.ts).toBe("number");
    expect(event.agent).toBe("main");
    expect(event.session).toBe("main:matrix:albert");
    expect(event.type).toBe("msg.in");
    expect(event.payload).toHaveProperty("from");
    expect(event.payload).toHaveProperty("content");
  });

  it("accepts all known event types", () => {
    for (const type of ALL_EVENT_TYPES) {
      const event: ClawEvent = {
        id: "uuid",
        ts: 0,
        agent: "main",
        session: "main",
        type,
        payload: {},
      };
      expect(event.type).toBe(type);
    }
  });
});

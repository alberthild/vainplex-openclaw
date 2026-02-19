import { describe, it, expect } from "vitest";
import {
  normalizeEvent,
  normalizeSession,
  normalizePayload,
  mapEventType,
  detectSchema,
} from "../../src/trace-analyzer/events.js";
import type { AnalyzerEventType } from "../../src/trace-analyzer/events.js";

describe("events", () => {
  describe("mapEventType", () => {
    it("maps Schema A types to canonical types", () => {
      expect(mapEventType("msg.in")).toBe("msg.in");
      expect(mapEventType("msg.out")).toBe("msg.out");
      expect(mapEventType("tool.call")).toBe("tool.call");
      expect(mapEventType("tool.result")).toBe("tool.result");
      expect(mapEventType("session.start")).toBe("session.start");
      expect(mapEventType("session.end")).toBe("session.end");
      expect(mapEventType("run.start")).toBe("run.start");
      expect(mapEventType("run.end")).toBe("run.end");
      expect(mapEventType("run.error")).toBe("run.error");
    });

    it("maps Schema B conversation types to canonical types", () => {
      expect(mapEventType("conversation.message.in")).toBe("msg.in");
      expect(mapEventType("conversation.message.out")).toBe("msg.out");
      expect(mapEventType("conversation.tool_call")).toBe("tool.call");
      expect(mapEventType("conversation.tool_result")).toBe("tool.result");
    });

    it("returns null for unknown event types", () => {
      expect(mapEventType("session.compaction_start")).toBeNull();
      expect(mapEventType("gateway.start")).toBeNull();
      expect(mapEventType("foo.bar")).toBeNull();
      expect(mapEventType("")).toBeNull();
    });
  });

  describe("detectSchema", () => {
    it("detects Schema A (nats-eventstore) events", () => {
      expect(detectSchema({
        id: "abc-123",
        ts: 1700000000000,
        agent: "main",
        session: "main",
        type: "msg.in",
        payload: { content: "hello" },
      })).toBe("A");
    });

    it("detects Schema B (session-sync) events by type prefix", () => {
      expect(detectSchema({
        id: "short-123",
        timestamp: 1700000000000,
        agent: "main",
        session: "agent:main:uuid-123",
        type: "conversation.message.in",
        payload: { text_preview: [{ type: "text", text: "hello" }] },
      })).toBe("B");
    });

    it("detects Schema B by meta.source", () => {
      expect(detectSchema({
        id: "x",
        ts: 1700000000000,
        agent: "main",
        session: "main",
        type: "msg.in",
        meta: { source: "session-sync" },
        payload: {},
      })).toBe("B");
    });

    it("detects Schema B by timestamp field", () => {
      expect(detectSchema({
        id: "x",
        timestamp: 1700000000000,
        agent: "main",
        session: "main",
        type: "msg.in",
        payload: {},
      })).toBe("B");
    });

    it("returns null for unknown events", () => {
      expect(detectSchema({})).toBeNull();
      expect(detectSchema({ type: 123 })).toBeNull();
      expect(detectSchema({ type: "unknown.event" })).toBeNull();
    });
  });

  describe("normalizeSession", () => {
    it("extracts UUID from Schema B session format", () => {
      expect(normalizeSession("agent:main:abc-def-123")).toBe("abc-def-123");
    });

    it("handles two-part agent: prefix", () => {
      expect(normalizeSession("agent:main")).toBe("main");
    });

    it("passes through Schema A session keys unchanged", () => {
      expect(normalizeSession("main")).toBe("main");
      expect(normalizeSession("unknown")).toBe("unknown");
      expect(normalizeSession("viola:telegram:12345")).toBe("viola:telegram:12345");
    });
  });

  describe("normalizePayload", () => {
    describe("msg.in / msg.out — Schema A", () => {
      it("extracts content, from, to, channel", () => {
        const payload = normalizePayload("msg.in", {
          content: "hello",
          from: "matrix:@user:example.com",
          channel: "matrix",
        }, "msg.in");
        expect(payload.content).toBe("hello");
        expect(payload.from).toBe("matrix:@user:example.com");
        expect(payload.channel).toBe("matrix");
        expect(payload.role).toBe("user");
      });

      it("sets role=assistant for msg.out", () => {
        const payload = normalizePayload("msg.out", {
          content: "response",
          success: true,
        }, "msg.out");
        expect(payload.role).toBe("assistant");
        expect(payload.success).toBe(true);
      });
    });

    describe("msg.in / msg.out — Schema B", () => {
      it("extracts content from text_preview[0].text", () => {
        const payload = normalizePayload("msg.in", {
          role: "user",
          text_preview: [{ type: "text", text: "und nu?" }],
          content_length: 7,
          sessionId: "sess-123",
        }, "conversation.message.in");
        expect(payload.content).toBe("und nu?");
        expect(payload.role).toBe("user");
      });

      it("handles empty text_preview array", () => {
        const payload = normalizePayload("msg.in", {
          text_preview: [],
        }, "conversation.message.in");
        expect(payload.content).toBeUndefined();
      });
    });

    describe("tool.call — Schema A", () => {
      it("extracts toolName and params", () => {
        const payload = normalizePayload("tool.call", {
          toolName: "exec",
          params: { command: "ls -la" },
        }, "tool.call");
        expect(payload.toolName).toBe("exec");
        expect(payload.toolParams).toEqual({ command: "ls -la" });
      });
    });

    describe("tool.call — Schema B", () => {
      it("extracts toolName from data.name and params from data.args", () => {
        const payload = normalizePayload("tool.call", {
          data: { phase: "start", name: "exec", args: { command: "ls" } },
        }, "conversation.tool_call");
        expect(payload.toolName).toBe("exec");
        expect(payload.toolParams).toEqual({ command: "ls" });
      });
    });

    describe("tool.result — Schema A", () => {
      it("extracts result and error", () => {
        const payload = normalizePayload("tool.result", {
          toolName: "exec",
          error: "Permission denied",
          durationMs: 500,
        }, "tool.result");
        expect(payload.toolName).toBe("exec");
        expect(payload.toolError).toBe("Permission denied");
        expect(payload.toolIsError).toBe(true);
        expect(payload.toolDurationMs).toBe(500);
      });

      it("handles successful result", () => {
        const payload = normalizePayload("tool.result", {
          toolName: "exec",
          result: { exitCode: 0 },
          durationMs: 100,
        }, "tool.result");
        expect(payload.toolResult).toEqual({ exitCode: 0 });
        expect(payload.toolError).toBeUndefined();
        expect(payload.toolIsError).toBeUndefined();
      });
    });

    describe("tool.result — Schema B", () => {
      it("extracts from data.isError and data.result", () => {
        const payload = normalizePayload("tool.result", {
          data: {
            phase: "result",
            name: "exec",
            isError: true,
            result: "Connection refused",
          },
        }, "conversation.tool_result");
        expect(payload.toolName).toBe("exec");
        expect(payload.toolIsError).toBe(true);
        expect(payload.toolError).toBe("Connection refused");
      });
    });

    describe("session lifecycle", () => {
      it("extracts sessionId from session.start", () => {
        const payload = normalizePayload("session.start", {
          sessionId: "abc-123",
        }, "session.start");
        expect(payload.sessionId).toBe("abc-123");
      });
    });
  });

  describe("normalizeEvent", () => {
    it("normalizes a Schema A msg.in event", () => {
      const event = normalizeEvent({
        id: "uuid-1",
        ts: 1700000000000,
        agent: "main",
        session: "main",
        type: "msg.in",
        payload: { content: "hello", from: "user@matrix" },
      }, 100);

      expect(event).not.toBeNull();
      expect(event!.id).toBe("uuid-1");
      expect(event!.ts).toBe(1700000000000);
      expect(event!.agent).toBe("main");
      expect(event!.session).toBe("main");
      expect(event!.type).toBe("msg.in");
      expect(event!.payload.content).toBe("hello");
      expect(event!.seq).toBe(100);
    });

    it("normalizes a Schema B conversation.message.out event", () => {
      const event = normalizeEvent({
        id: "short-1",
        timestamp: 1700000001000,
        agent: "main",
        session: "agent:main:sess-uuid",
        type: "conversation.message.out",
        payload: {
          role: "assistant",
          text_preview: [{ type: "text", text: "hi there" }],
          content_length: 8,
        },
      }, 200);

      expect(event).not.toBeNull();
      expect(event!.ts).toBe(1700000001000);
      expect(event!.session).toBe("sess-uuid");
      expect(event!.type).toBe("msg.out");
      expect(event!.payload.content).toBe("hi there");
      expect(event!.payload.role).toBe("assistant");
    });

    it("returns null for events with no timestamp", () => {
      expect(normalizeEvent({ type: "msg.in", agent: "main" }, 1)).toBeNull();
    });

    it("returns null for unknown event types", () => {
      expect(normalizeEvent({
        ts: 1700000000000,
        type: "gateway.start",
        agent: "main",
      }, 1)).toBeNull();
    });

    it("returns null for events with no type", () => {
      expect(normalizeEvent({ ts: 1700000000000, agent: "main" }, 1)).toBeNull();
    });

    it("defaults agent to 'unknown' when missing", () => {
      const event = normalizeEvent({
        ts: 1700000000000,
        type: "msg.in",
        session: "main",
        payload: { content: "test" },
      }, 1);
      expect(event!.agent).toBe("unknown");
    });

    it("defaults session to 'unknown' when missing", () => {
      const event = normalizeEvent({
        ts: 1700000000000,
        type: "msg.in",
        agent: "main",
        payload: { content: "test" },
      }, 1);
      expect(event!.session).toBe("unknown");
    });

    it("handles empty payload gracefully", () => {
      const event = normalizeEvent({
        ts: 1700000000000,
        type: "msg.in",
        agent: "main",
        session: "main",
      }, 1);
      expect(event).not.toBeNull();
      expect(event!.payload.content).toBeUndefined();
    });
  });
});

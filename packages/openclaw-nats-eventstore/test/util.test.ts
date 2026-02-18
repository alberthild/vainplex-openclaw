import { describe, it, expect } from "vitest";
import { extractAgentId, buildSubject } from "../src/util.js";

describe("extractAgentId", () => {
  it("returns agentId when provided and not 'main'", () => {
    expect(extractAgentId({ agentId: "viola" })).toBe("viola");
  });

  it("falls back to sessionKey first segment when agentId is 'main'", () => {
    expect(extractAgentId({ agentId: "main", sessionKey: "viola:telegram:123" })).toBe("viola");
  });

  it("returns 'main' when sessionKey is 'main'", () => {
    expect(extractAgentId({ sessionKey: "main" })).toBe("main");
  });

  it("extracts first segment from sessionKey", () => {
    expect(extractAgentId({ sessionKey: "viola:matrix:room1" })).toBe("viola");
  });

  it("returns 'main' when no context provided", () => {
    expect(extractAgentId({})).toBe("main");
  });

  it("returns 'main' when agentId is 'main' and no sessionKey", () => {
    expect(extractAgentId({ agentId: "main" })).toBe("main");
  });

  it("handles sessionKey with single segment", () => {
    expect(extractAgentId({ sessionKey: "agent1" })).toBe("agent1");
  });

  it("prefers non-main agentId over sessionKey", () => {
    expect(extractAgentId({ agentId: "viola", sessionKey: "main:matrix:x" })).toBe("viola");
  });
});

describe("buildSubject", () => {
  it("builds correct subject with dots replaced by underscores", () => {
    expect(buildSubject("openclaw.events", "main", "msg.in")).toBe(
      "openclaw.events.main.msg_in",
    );
  });

  it("handles event types with multiple dots", () => {
    expect(buildSubject("openclaw.events", "main", "session.compaction_start")).toBe(
      "openclaw.events.main.session_compaction_start",
    );
  });

  it("handles custom prefix", () => {
    expect(buildSubject("custom.prefix", "viola", "tool.call")).toBe(
      "custom.prefix.viola.tool_call",
    );
  });

  it("handles gateway events with system agent", () => {
    expect(buildSubject("openclaw.events", "system", "gateway.start")).toBe(
      "openclaw.events.system.gateway_start",
    );
  });

  it("handles run.error", () => {
    expect(buildSubject("openclaw.events", "main", "run.error")).toBe(
      "openclaw.events.main.run_error",
    );
  });
});

import { describe, expect, it } from "vitest";
import type { RedactionAllowlist } from "../../src/types.js";
import {
  evaluateAllowlist,
  getRedactableCategories,
  isAgentExempt,
  isToolExempt,
} from "../../src/redaction/allowlist.js";

const defaultAllowlist: RedactionAllowlist = {
  piiAllowedChannels: ["matrix"],
  financialAllowedChannels: ["admin-internal"],
  exemptTools: ["session_status", "governance"],
  exemptAgents: ["admin-bot"],
};

const emptyAllowlist: RedactionAllowlist = {
  piiAllowedChannels: [],
  financialAllowedChannels: [],
  exemptTools: [],
  exemptAgents: [],
};

describe("Allowlist Evaluator", () => {
  // ── Credential Security Invariant ──

  describe("credential security invariant", () => {
    it("credentials are NEVER allowlisted", () => {
      const decision = evaluateAllowlist("credential", {
        channel: "matrix",
        toolName: "session_status",
        agentId: "admin-bot",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("never");
    });

    it("credentials blocked even with empty context", () => {
      const decision = evaluateAllowlist("credential", {}, defaultAllowlist);
      expect(decision.allowed).toBe(false);
    });

    it("credentials blocked even with all allowlist fields matching", () => {
      const fullAllowlist: RedactionAllowlist = {
        piiAllowedChannels: ["matrix", "telegram", "cli"],
        financialAllowedChannels: ["matrix", "telegram", "cli"],
        exemptTools: ["*"],
        exemptAgents: ["*"],
      };

      const decision = evaluateAllowlist("credential", {
        channel: "matrix",
        toolName: "*",
        agentId: "*",
      }, fullAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });

  // ── PII Allowlist ──

  describe("PII allowlist", () => {
    it("allows PII on allowed channels", () => {
      const decision = evaluateAllowlist("pii", {
        channel: "matrix",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("PII allowed");
    });

    it("blocks PII on non-allowed channels", () => {
      const decision = evaluateAllowlist("pii", {
        channel: "twitter",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });

    it("blocks PII when no channel specified", () => {
      const decision = evaluateAllowlist("pii", {}, defaultAllowlist);
      expect(decision.allowed).toBe(false);
    });

    it("blocks PII on empty allowlist", () => {
      const decision = evaluateAllowlist("pii", {
        channel: "matrix",
      }, emptyAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });

  // ── Financial Data Allowlist ──

  describe("financial data allowlist", () => {
    it("allows financial data on allowed channels", () => {
      const decision = evaluateAllowlist("financial", {
        channel: "admin-internal",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("Financial data allowed");
    });

    it("blocks financial data on non-allowed channels", () => {
      const decision = evaluateAllowlist("financial", {
        channel: "matrix",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });

  // ── Tool Exemptions ──

  describe("tool exemptions", () => {
    it("exempts configured tools", () => {
      const decision = evaluateAllowlist("pii", {
        toolName: "session_status",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("exempt");
    });

    it("does not exempt non-configured tools", () => {
      const decision = evaluateAllowlist("pii", {
        toolName: "exec",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });

    it("tool exemption does NOT apply to credentials", () => {
      const decision = evaluateAllowlist("credential", {
        toolName: "session_status",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });

  // ── Agent Exemptions ──

  describe("agent exemptions", () => {
    it("exempts configured agents", () => {
      const decision = evaluateAllowlist("pii", {
        agentId: "admin-bot",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("exempt");
    });

    it("does not exempt non-configured agents", () => {
      const decision = evaluateAllowlist("pii", {
        agentId: "forge",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });

    it("agent exemption does NOT apply to credentials", () => {
      const decision = evaluateAllowlist("credential", {
        agentId: "admin-bot",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });

  // ── isToolExempt ──

  describe("isToolExempt", () => {
    it("returns true for exempt tools", () => {
      expect(isToolExempt("session_status", defaultAllowlist)).toBe(true);
      expect(isToolExempt("governance", defaultAllowlist)).toBe(true);
    });

    it("returns false for non-exempt tools", () => {
      expect(isToolExempt("exec", defaultAllowlist)).toBe(false);
      expect(isToolExempt("read", defaultAllowlist)).toBe(false);
    });
  });

  // ── isAgentExempt ──

  describe("isAgentExempt", () => {
    it("returns true for exempt agents", () => {
      expect(isAgentExempt("admin-bot", defaultAllowlist)).toBe(true);
    });

    it("returns false for non-exempt agents", () => {
      expect(isAgentExempt("forge", defaultAllowlist)).toBe(false);
    });
  });

  // ── getRedactableCategories ──

  describe("getRedactableCategories", () => {
    it("filters out allowlisted categories", () => {
      const result = getRedactableCategories(
        ["credential", "pii", "financial"],
        { channel: "matrix" },
        defaultAllowlist,
      );

      // credential always stays, PII allowed on matrix, financial not
      expect(result).toContain("credential");
      expect(result).not.toContain("pii"); // allowed on matrix
      expect(result).toContain("financial");
    });

    it("keeps all categories when nothing is allowlisted", () => {
      const result = getRedactableCategories(
        ["credential", "pii", "financial"],
        { channel: "twitter" },
        defaultAllowlist,
      );

      expect(result).toEqual(["credential", "pii", "financial"]);
    });

    it("always includes credential category", () => {
      const result = getRedactableCategories(
        ["credential"],
        { channel: "matrix", toolName: "session_status", agentId: "admin-bot" },
        defaultAllowlist,
      );

      expect(result).toContain("credential");
    });

    it("handles custom category", () => {
      const result = getRedactableCategories(
        ["custom"],
        {},
        emptyAllowlist,
      );

      expect(result).toEqual(["custom"]);
    });
  });

  // ── Priority / Precedence ──

  describe("evaluation precedence", () => {
    it("tool exemption checked before channel allowlist", () => {
      // When both tool and channel match, tool exemption wins
      const decision = evaluateAllowlist("financial", {
        toolName: "session_status",
        channel: "twitter",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain("Tool");
    });

    it("credential invariant overrides tool exemption", () => {
      const decision = evaluateAllowlist("credential", {
        toolName: "session_status",
      }, defaultAllowlist);

      expect(decision.allowed).toBe(false);
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { createNotifier } from "../src/notifier.js";
import type { PluginLogger } from "../src/types.js";

function mockLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("createNotifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Auto-detection ──

  it("returns undefined when nothing is configured", () => {
    const log = mockLogger();
    const notifier = createNotifier({}, log);
    expect(notifier).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("No notification method"));
  });

  it("auto-detects webhook when notifyWebhook is set", () => {
    const log = mockLogger();
    const notifier = createNotifier(
      { notifyWebhook: "https://ntfy.sh/test" },
      log,
    );
    expect(notifier).toBeTypeOf("function");
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Webhook notifier"));
  });

  it("auto-detects matrix when notifyChannel + notifyHomeserver are set", () => {
    const log = mockLogger();
    const notifier = createNotifier(
      {
        notifyChannel: "!room:example.com",
        notifyHomeserver: "https://matrix.example.com",
        notifyToken: "syt_test",
      },
      log,
    );
    expect(notifier).toBeTypeOf("function");
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Matrix notifier"));
  });

  // ── Explicit methods ──

  it("returns undefined for console method", () => {
    const log = mockLogger();
    const notifier = createNotifier({ notifyMethod: "console" }, log);
    expect(notifier).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("console"));
  });

  it("warns when webhook method but no URL", () => {
    const log = mockLogger();
    const notifier = createNotifier({ notifyMethod: "webhook" }, log);
    expect(notifier).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("no notifyWebhook URL"));
  });

  it("warns when matrix method but missing config", () => {
    const log = mockLogger();
    const notifier = createNotifier(
      { notifyMethod: "matrix", notifyChannel: "!room:example.com" },
      log,
    );
    expect(notifier).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("missing"));
  });

  // ── Matrix env token ──

  it("reads matrix token from GOVERNANCE_NOTIFY_TOKEN env", () => {
    const log = mockLogger();
    const original = process.env.GOVERNANCE_NOTIFY_TOKEN;
    process.env.GOVERNANCE_NOTIFY_TOKEN = "env_token";

    const notifier = createNotifier(
      {
        notifyChannel: "!room:example.com",
        notifyHomeserver: "https://matrix.example.com",
      },
      log,
    );
    expect(notifier).toBeTypeOf("function");

    if (original) process.env.GOVERNANCE_NOTIFY_TOKEN = original;
    else delete process.env.GOVERNANCE_NOTIFY_TOKEN;
  });

  // ── Webhook transport ──

  it("webhook sends POST to URL", async () => {
    const log = mockLogger();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNotifier(
      { notifyWebhook: "https://ntfy.sh/governance" },
      log,
    )!;

    await notifier("⚠️ Approval needed");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://ntfy.sh/governance");
    expect(opts.method).toBe("POST");
    expect(opts.body).toContain("Approval needed");
  });

  it("webhook includes custom headers", async () => {
    const log = mockLogger();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNotifier(
      {
        notifyWebhook: "https://api.telegram.org/bot123/sendMessage",
        notifyWebhookHeaders: { "X-Custom": "test" },
      },
      log,
    )!;

    await notifier("test");

    const opts = mockFetch.mock.calls[0]![1];
    expect(opts.headers["X-Custom"]).toBe("test");
  });

  it("webhook throws on non-ok response", async () => {
    const log = mockLogger();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: () => Promise.resolve("boom"),
    }));

    const notifier = createNotifier(
      { notifyWebhook: "https://example.com/hook" },
      log,
    )!;

    await expect(notifier("test")).rejects.toThrow("Webhook notification failed: 500");
  });

  // ── Matrix transport ──

  it("matrix sends PUT to Client-Server API", async () => {
    const log = mockLogger();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNotifier(
      {
        notifyChannel: "!abc:matrix.example.com",
        notifyHomeserver: "https://matrix.example.com",
        notifyToken: "syt_test",
      },
      log,
    )!;

    await notifier("⚠️ **Approval Required**");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("matrix.example.com");
    expect(url).toContain("/_matrix/client/v3/rooms/");
    expect(url).toContain("/send/m.room.message/");
    expect(opts.method).toBe("PUT");
    expect(opts.headers.Authorization).toBe("Bearer syt_test");

    const body = JSON.parse(opts.body);
    expect(body.msgtype).toBe("m.text");
    expect(body.body).toContain("Approval Required");
    expect(body.formatted_body).toContain("<strong>");
  });

  it("matrix uses channelOverride when provided", async () => {
    const log = mockLogger();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNotifier(
      {
        notifyChannel: "!default:example.com",
        notifyHomeserver: "https://matrix.example.com",
        notifyToken: "syt_test",
      },
      log,
    )!;

    await notifier("test", "!override:example.com");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain(encodeURIComponent("!override:example.com"));
  });

  it("matrix throws on non-ok response", async () => {
    const log = mockLogger();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("Not in room"),
    }));

    const notifier = createNotifier(
      {
        notifyChannel: "!abc:example.com",
        notifyHomeserver: "https://matrix.example.com",
        notifyToken: "syt_test",
      },
      log,
    )!;

    await expect(notifier("test")).rejects.toThrow("Matrix send failed: 403");
  });
});

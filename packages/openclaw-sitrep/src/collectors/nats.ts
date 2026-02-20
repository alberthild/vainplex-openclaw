import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface NatsCollectorConfig extends CollectorConfig {
  natsUrl?: string;
  streamName?: string;
  natsCliAuth?: string;
  maxAgeMins?: number;
}

/** Extract auth args from NATS URL or explicit config. */
function resolveAuth(config: NatsCollectorConfig): { authArgs: string; cleanUrl: string } {
  const natsUrl = config.natsUrl ?? "nats://localhost:4222";

  if (config.natsCliAuth) {
    return { authArgs: config.natsCliAuth, cleanUrl: natsUrl };
  }

  try {
    const parsed = new URL(natsUrl.replace(/^nats:\/\//, "http://"));
    if (parsed.username && parsed.password) {
      const user = shellEscape(decodeURIComponent(parsed.username));
      const pass = shellEscape(decodeURIComponent(parsed.password));
      const cleanUrl = `nats://${parsed.hostname}:${parsed.port || "4222"}`;
      return { authArgs: `--user ${user} --password ${pass}`, cleanUrl };
    }
  } catch {
    // No auth
  }

  return { authArgs: "", cleanUrl: natsUrl.replace(/\/\/[^@]+@/, "//") };
}

/** Escape a string for safe shell interpolation. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Fetch stream info via nats CLI. */
function fetchStreamInfo(streamName: string, cleanUrl: string, authArgs: string): string {
  return shell(
    `nats stream info ${shellEscape(streamName)} -s ${shellEscape(cleanUrl)} ${authArgs} 2>/dev/null`,
  );
}

/** Parse message count and last event age from stream info output. */
function parseStreamInfo(raw: string): { messageCount: number; lastEventAgeMins: number } {
  const msgMatch = raw.match(/Messages:\s*([\d,]+)/i);
  const lastMatch =
    raw.match(/Last Sequence:.*?@\s*(.+)/i) ??
    raw.match(/last_ts.*?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);

  const messageCount = msgMatch ? parseInt(msgMatch[1]!.replace(/,/g, ""), 10) : 0;
  let lastEventAgeMins = Infinity;

  if (lastMatch?.[1]) {
    const lastTs = new Date(lastMatch[1].trim());
    if (!isNaN(lastTs.getTime())) {
      lastEventAgeMins = (Date.now() - lastTs.getTime()) / 60_000;
    }
  }

  return { messageCount, lastEventAgeMins };
}

/** Check freshness and return items. */
function checkFreshness(
  messageCount: number,
  ageMins: number,
  maxAgeMins: number,
  streamName: string,
): SitrepItem[] {
  if (ageMins > maxAgeMins * 6) {
    return [{
      id: "nats-events-stale-critical",
      source: "nats",
      severity: "critical",
      category: "needs_owner",
      title: `NATS last event is ${Math.round(ageMins / 60)}h old (threshold: ${maxAgeMins}min)`,
      detail: `Stream: ${streamName}, Messages: ${messageCount}`,
      score: 100,
    }];
  }
  if (ageMins > maxAgeMins) {
    return [{
      id: "nats-events-stale",
      source: "nats",
      severity: "warn",
      category: "auto_fixable",
      title: `NATS last event is ${Math.round(ageMins)}min old (threshold: ${maxAgeMins}min)`,
      detail: `Stream: ${streamName}, Messages: ${messageCount}`,
      score: 50,
    }];
  }
  return [];
}

/**
 * Collector: NATS JetStream health.
 */
export const collectNats: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const natsConfig = config as NatsCollectorConfig;
  const streamName = natsConfig.streamName ?? "openclaw-events";
  const maxAgeMins = natsConfig.maxAgeMins ?? 60;
  const { authArgs, cleanUrl } = resolveAuth(natsConfig);

  let raw: string;
  try {
    raw = fetchStreamInfo(streamName, cleanUrl, authArgs);
  } catch (err) {
    return {
      status: "critical",
      items: [{
        id: "nats-unreachable",
        source: "nats",
        severity: "critical",
        category: "needs_owner",
        title: `NATS stream ${streamName} unreachable`,
        detail: err instanceof Error ? err.message : String(err),
        score: 100,
      }],
      summary: "NATS unreachable",
      duration_ms: 0,
    };
  }

  const { messageCount, lastEventAgeMins } = parseStreamInfo(raw);
  const items = checkFreshness(messageCount, lastEventAgeMins, maxAgeMins, streamName);

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${messageCount.toLocaleString()} events, last ${Math.round(lastEventAgeMins)}min ago`,
    duration_ms: 0,
  };
};

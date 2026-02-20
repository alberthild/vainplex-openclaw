import { shell } from "../collector.js";
import type { CollectorConfig, CollectorFn, CollectorResult, SitrepItem } from "../types.js";

interface NatsCollectorConfig extends CollectorConfig {
  natsUrl?: string;
  streamName?: string;
  natsCliAuth?: string; // e.g. "--user claudia --password xxx" or env-based
  maxAgeMins?: number; // Max age of last event before warning (default: 60)
}

/**
 * Collector: NATS JetStream health.
 * Checks stream existence, event freshness, consumer health.
 */
export const collectNats: CollectorFn = async (
  config: CollectorConfig,
): Promise<CollectorResult> => {
  const natsConfig = config as NatsCollectorConfig;
  const streamName = natsConfig.streamName ?? "openclaw-events";
  const natsUrl = natsConfig.natsUrl ?? "nats://localhost:4222";
  const maxAgeMins = natsConfig.maxAgeMins ?? 60;

  const items: SitrepItem[] = [];

  // Parse auth from URL if present
  let authArgs = natsConfig.natsCliAuth ?? "";
  if (!authArgs) {
    try {
      const parsed = new URL(natsUrl.replace(/^nats:\/\//, "http://"));
      if (parsed.username && parsed.password) {
        authArgs = `--user ${parsed.username} --password ${decodeURIComponent(parsed.password)}`;
      }
    } catch {
      // No auth
    }
  }

  const cleanUrl = natsUrl.replace(/\/\/[^@]+@/, "//");

  // Get stream info
  let raw: string;
  try {
    raw = shell(
      `nats stream info ${streamName} -s ${cleanUrl} ${authArgs} --json 2>/dev/null`,
    );
  } catch {
    // Try without --json
    try {
      raw = shell(
        `nats stream info ${streamName} -s ${cleanUrl} ${authArgs} 2>/dev/null`,
      );
    } catch (err) {
      items.push({
        id: "nats-unreachable",
        source: "nats",
        severity: "critical",
        category: "needs_owner",
        title: `NATS stream ${streamName} unreachable`,
        detail: err instanceof Error ? err.message : String(err),
        score: 100,
      });
      return { status: "critical", items, summary: "NATS unreachable", duration_ms: 0 };
    }
  }

  // Parse message count and last timestamp
  const msgMatch = raw.match(/Messages:\s*([\d,]+)/i);
  const lastMatch = raw.match(/Last Sequence:.*?@\s*(.+)/i) ?? raw.match(/last_ts.*?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);

  const messageCount = msgMatch ? parseInt(msgMatch[1]!.replace(/,/g, ""), 10) : 0;
  let lastEventAge = Infinity;

  if (lastMatch?.[1]) {
    const lastTs = new Date(lastMatch[1].trim());
    if (!isNaN(lastTs.getTime())) {
      lastEventAge = (Date.now() - lastTs.getTime()) / 60_000; // minutes
    }
  }

  // Check freshness
  if (lastEventAge > maxAgeMins * 6) {
    items.push({
      id: "nats-events-stale-critical",
      source: "nats",
      severity: "critical",
      category: "needs_owner",
      title: `NATS last event is ${Math.round(lastEventAge / 60)}h old (threshold: ${maxAgeMins}min)`,
      detail: `Stream: ${streamName}, Messages: ${messageCount}`,
      score: 100,
    });
  } else if (lastEventAge > maxAgeMins) {
    items.push({
      id: "nats-events-stale",
      source: "nats",
      severity: "warn",
      category: "auto_fixable",
      title: `NATS last event is ${Math.round(lastEventAge)}min old (threshold: ${maxAgeMins}min)`,
      detail: `Stream: ${streamName}, Messages: ${messageCount}`,
      score: 50,
    });
  }

  const status = items.some((i) => i.severity === "critical")
    ? "critical"
    : items.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  return {
    status,
    items,
    summary: `${messageCount.toLocaleString()} events, last ${Math.round(lastEventAge)}min ago`,
    duration_ms: 0,
  };
};

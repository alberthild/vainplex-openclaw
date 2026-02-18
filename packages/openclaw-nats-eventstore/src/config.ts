export type NatsEventStoreConfig = {
  enabled: boolean;
  natsUrl: string;
  streamName: string;
  subjectPrefix: string;
  retention: {
    maxMessages: number;
    maxBytes: number;
    maxAgeHours: number;
  };
  publishTimeoutMs: number;
  connectTimeoutMs: number;
  drainTimeoutMs: number;
  includeHooks: string[];
  excludeHooks: string[];
};

export const DEFAULTS: NatsEventStoreConfig = {
  enabled: true,
  natsUrl: "nats://localhost:4222",
  streamName: "openclaw-events",
  subjectPrefix: "openclaw.events",
  retention: {
    maxMessages: -1,
    maxBytes: -1,
    maxAgeHours: 0,
  },
  publishTimeoutMs: 5000,
  connectTimeoutMs: 5000,
  drainTimeoutMs: 5000,
  includeHooks: [],
  excludeHooks: [],
};

export function resolveConfig(pluginConfig?: Record<string, unknown>): NatsEventStoreConfig {
  const raw = pluginConfig ?? {};
  const retention = raw.retention as Record<string, unknown> | undefined;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
    natsUrl: typeof raw.natsUrl === "string" ? raw.natsUrl : DEFAULTS.natsUrl,
    streamName: typeof raw.streamName === "string" ? raw.streamName : DEFAULTS.streamName,
    subjectPrefix: typeof raw.subjectPrefix === "string" ? raw.subjectPrefix : DEFAULTS.subjectPrefix,
    retention: {
      maxMessages: retention?.maxMessages != null ? Number(retention.maxMessages) : DEFAULTS.retention.maxMessages,
      maxBytes: retention?.maxBytes != null ? Number(retention.maxBytes) : DEFAULTS.retention.maxBytes,
      maxAgeHours: retention?.maxAgeHours != null ? Number(retention.maxAgeHours) : DEFAULTS.retention.maxAgeHours,
    },
    publishTimeoutMs: typeof raw.publishTimeoutMs === "number" ? raw.publishTimeoutMs : DEFAULTS.publishTimeoutMs,
    connectTimeoutMs: typeof raw.connectTimeoutMs === "number" ? raw.connectTimeoutMs : DEFAULTS.connectTimeoutMs,
    drainTimeoutMs: typeof raw.drainTimeoutMs === "number" ? raw.drainTimeoutMs : DEFAULTS.drainTimeoutMs,
    includeHooks: Array.isArray(raw.includeHooks) ? raw.includeHooks : DEFAULTS.includeHooks,
    excludeHooks: Array.isArray(raw.excludeHooks) ? raw.excludeHooks : DEFAULTS.excludeHooks,
  };
}

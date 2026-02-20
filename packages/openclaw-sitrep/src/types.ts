// ---- Plugin API (OpenClaw provides these) ----

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: Error): void;
  debug(msg: string): void;
}

export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  on(hook: string, handler: (...args: unknown[]) => void): void;
  registerCommand(cmd: {
    name: string;
    description: string;
    requireAuth?: boolean;
    handler: (params?: Record<string, unknown>) => { text: string };
  }): void;
  registerService(svc: {
    id: string;
    start: (ctx: ServiceContext) => Promise<void>;
    stop: (ctx: ServiceContext) => Promise<void>;
  }): void;
}

export interface ServiceContext {
  config: Record<string, unknown>;
  logger: PluginLogger;
}

// ---- Collector Types ----

export interface CollectorResult {
  status: "ok" | "warn" | "critical" | "error";
  items: SitrepItem[];
  summary: string;
  duration_ms: number;
  error?: string;
}

export interface SitrepItem {
  id: string;
  source: string;
  severity: "info" | "warn" | "critical";
  category: "needs_owner" | "auto_fixable" | "delegatable" | "informational";
  title: string;
  detail?: string;
  score: number;
}

export type CollectorFn = (
  config: CollectorConfig,
  logger: PluginLogger,
) => Promise<CollectorResult>;

export interface CollectorConfig {
  enabled: boolean;
  [key: string]: unknown;
}

// ---- Custom Collector ----

export interface CustomCollectorDef {
  id: string;
  command: string;
  warnThreshold?: string;
  criticalThreshold?: string;
  warnIfOutput?: boolean;
  warnIfNoOutput?: boolean;
}

// ---- Sitrep Output Schema ----

export interface SitrepReport {
  version: number;
  generated: string;
  summary: string;
  health: {
    overall: "ok" | "warn" | "critical";
    details: Record<string, "ok" | "warn" | "critical" | "error" | "disabled">;
  };
  items: SitrepItem[];
  categories: {
    needs_owner: SitrepItem[];
    auto_fixable: SitrepItem[];
    delegatable: SitrepItem[];
    informational: SitrepItem[];
  };
  delta: {
    new_items: number;
    resolved_items: number;
    previous_generated: string | null;
  };
  collectors: Record<string, { status: string; duration_ms: number; error?: string }>;
}

// ---- Plugin Config ----

export interface SitrepConfig {
  enabled: boolean;
  outputPath: string;
  previousPath: string;
  intervalMinutes: number;
  collectors: Record<string, CollectorConfig>;
  customCollectors: CustomCollectorDef[];
  scoring: {
    criticalWeight: number;
    warnWeight: number;
    infoWeight: number;
    staleThresholdHours: number;
  };
  summaryMaxChars: number;
}

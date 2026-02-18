// ============================================================
// Plugin API Types (OpenClaw contract)
// ============================================================

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

export type OpenClawPluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  registerService: (service: PluginService) => void;
  registerCommand: (command: PluginCommand) => void;
  on: (
    hookName: string,
    handler: (event: HookEvent, ctx: HookContext) => void,
    opts?: { priority?: number },
  ) => void;
};

export type PluginService = {
  id: string;
  start: (ctx: ServiceContext) => Promise<void>;
  stop: (ctx: ServiceContext) => Promise<void>;
};

export type ServiceContext = {
  logger: PluginLogger;
  config: Record<string, unknown>;
};

export type PluginCommand = {
  name: string;
  description: string;
  requireAuth?: boolean;
  handler: (args?: Record<string, unknown>) => { text: string } | Promise<{ text: string }>;
};

export type HookEvent = {
  content?: string;
  message?: string;
  text?: string;
  from?: string;
  to?: string;
  sender?: string;
  role?: string;
  timestamp?: string;
  sessionId?: string;
  messageCount?: number;
  compactingCount?: number;
  compactingMessages?: CompactingMessage[];
  [key: string]: unknown;
};

export type HookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  channelId?: string;
  workspaceDir?: string;
};

export type CompactingMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

// ============================================================
// Thread Tracker Types
// ============================================================

export type ThreadStatus = "open" | "closed";

export type ThreadPriority = "critical" | "high" | "medium" | "low";

export type Thread = {
  /** Unique thread ID (UUIDv4) */
  id: string;
  /** Human-readable thread title (extracted from topic patterns or first message) */
  title: string;
  /** Thread lifecycle status */
  status: ThreadStatus;
  /** Priority level — inferred from content or manually set */
  priority: ThreadPriority;
  /** Brief summary of the thread topic */
  summary: string;
  /** Decisions made within this thread context */
  decisions: string[];
  /** What the thread is blocked on, if anything */
  waiting_for: string | null;
  /** Detected mood of conversation within this thread */
  mood: string;
  /** ISO 8601 timestamp of last activity */
  last_activity: string;
  /** ISO 8601 timestamp of thread creation */
  created: string;
};

export type ThreadsData = {
  /** Schema version (current: 2) */
  version: number;
  /** ISO 8601 timestamp of last update */
  updated: string;
  /** All tracked threads */
  threads: Thread[];
  /** Integrity tracking for staleness detection */
  integrity: ThreadIntegrity;
  /** Overall session mood from latest processing */
  session_mood: string;
};

export type ThreadIntegrity = {
  /** Timestamp of last processed event */
  last_event_timestamp: string;
  /** Number of events processed in last run */
  events_processed: number;
  /** Source of events */
  source: "hooks" | "daily_notes" | "unknown";
};

export type ThreadSignals = {
  decisions: string[];
  closures: boolean[];
  waits: string[];
  topics: string[];
};

// ============================================================
// Decision Tracker Types
// ============================================================

export type ImpactLevel = "critical" | "high" | "medium" | "low";

export type Decision = {
  /** Unique decision ID (UUIDv4) */
  id: string;
  /** What was decided — extracted context window around decision pattern match */
  what: string;
  /** ISO 8601 date (YYYY-MM-DD) when the decision was detected */
  date: string;
  /** Surrounding context explaining why / rationale */
  why: string;
  /** Inferred impact level */
  impact: ImpactLevel;
  /** Who made/announced the decision (from message sender) */
  who: string;
  /** ISO 8601 timestamp of extraction */
  extracted_at: string;
};

export type DecisionsData = {
  /** Schema version (current: 1) */
  version: number;
  /** ISO 8601 timestamp of last update */
  updated: string;
  /** All tracked decisions */
  decisions: Decision[];
};

// ============================================================
// Boot Context Types
// ============================================================

export type ExecutionMode =
  | "Morning — brief, directive, efficient"
  | "Afternoon — execution mode"
  | "Evening — strategic, philosophical possible"
  | "Night — emergencies only";

export type BootContextSections = {
  header: string;
  state: string;
  warnings: string;
  hotSnapshot: string;
  narrative: string;
  threads: string;
  decisions: string;
  footer: string;
};

// ============================================================
// Pre-Compaction Types
// ============================================================

export type PreCompactionResult = {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Timestamp of snapshot */
  timestamp: string;
  /** Number of messages in hot snapshot */
  messagesSnapshotted: number;
  /** Errors encountered (non-fatal) */
  warnings: string[];
};

// ============================================================
// Narrative Types
// ============================================================

export type NarrativeSections = {
  completed: Thread[];
  open: Thread[];
  decisions: Decision[];
  timelineEntries: string[];
};

// ============================================================
// Config Types
// ============================================================

export type CortexConfig = {
  enabled: boolean;
  workspace: string;
  threadTracker: {
    enabled: boolean;
    pruneDays: number;
    maxThreads: number;
  };
  decisionTracker: {
    enabled: boolean;
    maxDecisions: number;
    dedupeWindowHours: number;
  };
  bootContext: {
    enabled: boolean;
    maxChars: number;
    onSessionStart: boolean;
    maxThreadsInBoot: number;
    maxDecisionsInBoot: number;
    decisionRecencyDays: number;
  };
  preCompaction: {
    enabled: boolean;
    maxSnapshotMessages: number;
  };
  narrative: {
    enabled: boolean;
  };
  patterns: {
    language: "en" | "de" | "both";
  };
  llm: {
    enabled: boolean;
    endpoint: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    batchSize: number;
  };
};

// ============================================================
// Mood Types
// ============================================================

export type Mood =
  | "neutral"
  | "frustrated"
  | "excited"
  | "tense"
  | "productive"
  | "exploratory";

export const MOOD_EMOJI: Record<Mood, string> = {
  neutral: "",
  frustrated: "😤",
  excited: "🔥",
  tense: "⚡",
  productive: "🔧",
  exploratory: "🔬",
};

export const PRIORITY_EMOJI: Record<ThreadPriority, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

export const PRIORITY_ORDER: Record<ThreadPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

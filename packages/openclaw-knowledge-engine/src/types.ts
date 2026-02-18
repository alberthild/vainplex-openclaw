// src/types.ts

/**
 * The public API exposed by the OpenClaw host to the plugin.
 * This is a subset of the full API, containing only what this plugin needs.
 */
export interface OpenClawPluginApi {
  pluginConfig: Record<string, unknown>;
  logger: Logger;
  on: (
    event: string,
    handler: (event: HookEvent, ctx: HookContext) => void,
    options?: { priority: number }
  ) => void;
}

/**
 * A generic logger interface compatible with OpenClaw's logger.
 */
export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: Error) => void;
  debug: (msg: string) => void;
}

/**
 * Represents the data payload for an OpenClaw hook.
 * It's a generic shape, as different hooks have different payloads.
 */
export interface HookEvent {
  content?: string;
  message?: string;
  text?: string;
  from?: string;
  sender?: string;
  role?: "user" | "assistant";
  [key: string]: unknown;
}

/**
 * Represents the context object passed with each hook event.
 */
export interface HookContext {
  workspace: string; // Absolute path to the OpenClaw workspace
}

/**
 * The fully resolved and validated plugin configuration object.
 */
export interface KnowledgeConfig {
  enabled: boolean;
  workspace: string;
  extraction: {
    regex: {
      enabled: boolean;
    };
    llm: {
      enabled: boolean;
      model: string;
      endpoint: string;
      batchSize: number;
      cooldownMs: number;
    };
  };
  decay: {
    enabled: boolean;
    intervalHours: number;
    rate: number; // e.g., 0.05 for 5% decay per interval
  };
  embeddings: {
    enabled: boolean;
    endpoint: string;
    collectionName: string;
    syncIntervalMinutes: number;
  };
  storage: {
    maxEntities: number;
    maxFacts: number;
    writeDebounceMs: number;
  };
}

/**
 * Represents an extracted entity.
 */
export interface Entity {
  id: string; // e.g., "person:claude"
  type:
    | "person"
    | "location"
    | "organization"
    | "date"
    | "product"
    | "concept"
    | "email"
    | "url"
    | "unknown";
  value: string; // The canonical value, e.g., "Claude"
  mentions: string[]; // Different ways it was mentioned, e.g., ["claude", "Claude's"]
  count: number;
  importance: number; // 0.0 to 1.0
  lastSeen: string; // ISO 8601 timestamp
  source: ("regex" | "llm")[];
}

/**
 * Represents a structured fact (a triple).
 */
export interface Fact {
  id: string; // UUID v4
  subject: string; // Entity ID
  predicate: string; // e.g., "is-a", "has-property", "works-at"
  object: string; // Entity ID or literal value
  relevance: number; // 0.0 to 1.0, subject to decay
  createdAt: string; // ISO 8601 timestamp
  lastAccessed: string; // ISO 8601 timestamp
  source: "ingested" | "extracted-regex" | "extracted-llm";
  embedded?: string; // ISO 8601 timestamp of last embedding sync
}

/**
 * The data structure for the entities.json file.
 */
export interface EntitiesData {
  updated: string;
  entities: Entity[];
}

/**
 * The data structure for the facts.json file.
 */
export interface FactsData {
  updated: string;
  facts: Fact[];
}

/**
 * Interface for a generic file storage utility.
 */
export interface IStorage {
  readJson<T>(fileName: string): Promise<T | null>;
  writeJson<T>(fileName: string, data: T): Promise<void>;
}

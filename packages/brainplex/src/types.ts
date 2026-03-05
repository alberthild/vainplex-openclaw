/**
 * Brainplex shared type definitions.
 * All types for scanner, configurator, installer, writer, and CLI modules.
 */

// ─── OpenClaw Config Types ──────────────────────────────────────────

export interface OpenClawConfig {
  agents?: AgentsConfig;
  plugins?: PluginsConfig;
  [key: string]: unknown;
}

export type AgentsConfig =
  | AgentDefinitionsFormat
  | AgentObjectFormat
  | AgentArrayFormat;

export interface AgentDefinitionsFormat {
  definitions: Array<{ name: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface AgentObjectFormat {
  [agentName: string]: unknown;
}

export type AgentArrayFormat = Array<{ name: string; [key: string]: unknown }>;

export interface PluginsConfig {
  entries?: Record<string, PluginEntry>;
  allow?: string[];
  installs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PluginEntry {
  enabled?: boolean;
  [key: string]: unknown;
}

// ─── Scanner Types ──────────────────────────────────────────────────

export interface ScanResult {
  /** Absolute path to openclaw.json */
  configPath: string;

  /** Parsed openclaw.json content */
  config: OpenClawConfig;

  /** Raw file content for format preservation */
  rawContent: string;

  /** Detected agent names */
  agents: string[];

  /** Workspace root (e.g., ~/.openclaw/) */
  workspacePath: string;

  /** Plugins directory (e.g., ~/.openclaw/plugins/) */
  pluginsPath: string;

  /** Extensions directory (e.g., ~/.openclaw/extensions/) */
  extensionsPath: string;

  /** Already installed plugin IDs */
  installedPlugins: Set<string>;

  /** Already configured plugin IDs (have config.json) */
  configuredPlugins: Set<string>;

  /** Node.js version */
  nodeVersion: string;
}

export interface ScanError {
  code: 'NO_CONFIG' | 'INVALID_CONFIG' | 'NODE_VERSION' | 'PARSE_ERROR';
  message: string;
}

export type ScanOutcome =
  | { ok: true; result: ScanResult }
  | { ok: false; error: ScanError };

// ─── Configurator Types ─────────────────────────────────────────────

export interface PluginConfig {
  pluginId: string;
  config: Record<string, unknown>;
}

export interface ConfiguratorOptions {
  agents: string[];
  timezone: string;
  full: boolean;
}

// ─── Installer Types ────────────────────────────────────────────────

export interface PluginSpec {
  id: string;
  npmPackage: string;
}

export interface SkippedPlugin {
  id: string;
  reason: 'already_installed' | 'already_configured' | 'excluded';
}

export interface InstallPlan {
  toInstall: PluginSpec[];
  toSkip: SkippedPlugin[];
  toConfigure: PluginConfig[];
  toSkipConfig: SkippedPlugin[];
}

export interface InstallOptions {
  verbose: boolean;
  dryRun: boolean;
}

export interface InstallResultEntry {
  plugin: PluginSpec;
  success: boolean;
  version?: string;
  error?: string;
}

export interface InstallResult {
  installed: InstallResultEntry[];
  failed: InstallResultEntry[];
}

// ─── Writer Types ───────────────────────────────────────────────────

export interface WriteOptions {
  dryRun: boolean;
}

export interface WriteResult {
  written: string[];
  skipped: string[];
  backedUp: string[];
}

// ─── CLI Types ──────────────────────────────────────────────────────

export interface CliOptions {
  command: 'init' | 'help' | 'version';
  full: boolean;
  dryRun: boolean;
  configPath?: string;
  noColor: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

// ─── Config Update Types ────────────────────────────────────────────

export interface ConfigUpdateResult {
  updated: boolean;
  backedUp: boolean;
  backupPath?: string;
  addedEntries: string[];
  addedAllow: string[];
}

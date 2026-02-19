// ============================================================
// Trace Analyzer — Public API (Phase 1: re-exports only)
// ============================================================

// Event types
export type {
  NormalizedEvent,
  AnalyzerEventType,
  NormalizedPayload,
} from "./events.js";

export {
  normalizeEvent,
  normalizeSession,
  normalizePayload,
  mapEventType,
  detectSchema,
} from "./events.js";

// TraceSource interface
export type { TraceSource, FetchOpts } from "./trace-source.js";

// NatsTraceSource
export { createNatsTraceSource } from "./nats-trace-source.js";

// Chain reconstruction
export type { ConversationChain, ChainReconstructorOpts } from "./chain-reconstructor.js";
export { reconstructChains } from "./chain-reconstructor.js";

// Config
export type { TraceAnalyzerConfig, SignalId, Severity, TriageLlmConfig } from "./config.js";
export { TRACE_ANALYZER_DEFAULTS, resolveTraceAnalyzerConfig } from "./config.js";

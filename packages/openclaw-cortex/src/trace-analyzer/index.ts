// ============================================================
// Trace Analyzer — Public API
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

// Signal types (Phase 2)
export type {
  FailureSignal,
  Finding,
  FindingClassification,
  SignalDetector,
} from "./signals/types.js";

// Signal detectors
export { detectCorrections } from "./signals/correction.js";
export { detectToolFails } from "./signals/tool-fail.js";
export { detectDoomLoops } from "./signals/doom-loop.js";
export { detectDissatisfied } from "./signals/dissatisfied.js";
export { detectRepeatFails, createRepeatFailState } from "./signals/repeat-fail.js";
export type { RepeatFailState } from "./signals/repeat-fail.js";
export { detectHallucinations } from "./signals/hallucination.js";
export { detectUnverifiedClaims } from "./signals/unverified-claim.js";

// Signal registry
export { detectAllSignals } from "./signals/index.js";

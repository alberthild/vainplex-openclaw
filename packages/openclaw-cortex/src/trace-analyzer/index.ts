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

// Redaction (Phase 3)
export { redactText, redactChain } from "./redactor.js";

// Classifier (Phase 3)
export { classifyFindings, resolveAnalyzerLlmConfig, formatChainAsTranscript } from "./classifier.js";

// Output generator (Phase 3)
export type { GeneratedOutput } from "./output-generator.js";
export { generateOutputs } from "./output-generator.js";

// Report (Phase 3)
export type {
  AnalysisReport,
  RunStats,
  SignalStats,
  RuleEffectiveness,
  ProcessingState,
  AssembleReportParams,
} from "./report.js";
export { assembleReport } from "./report.js";

// Analyzer (Phase 4)
export { TraceAnalyzer } from "./analyzer.js";
export type { TraceAnalyzerRunOpts, TraceAnalyzerStatus } from "./analyzer.js";

// Hook registration (Phase 4)
export { registerTraceAnalyzerHooks, cleanupTraceAnalyzerHooks } from "./hooks.js";
export type { TraceAnalyzerHookState } from "./hooks.js";

// ============================================================
// Trace Analyzer — Signal Types
// ============================================================
//
// Types for failure signals, findings, and classifications.
// Used by all signal detectors and the registry.
// ============================================================

import type { SignalId, Severity } from "../config.js";

export type { SignalId, Severity };

/** A detected failure signal within a conversation chain. */
export type FailureSignal = {
  /** Signal type identifier. */
  signal: SignalId;
  /** Detected severity. */
  severity: Severity;
  /** Index range within chain.events where the signal was detected. */
  eventRange: { start: number; end: number };
  /** Human-readable one-line summary. */
  summary: string;
  /** Additional structured evidence (signal-specific). */
  evidence: Record<string, unknown>;
};

/** LLM-produced classification of a finding's root cause. */
export type FindingClassification = {
  /** Root cause category. */
  rootCause: string;
  /** Recommended action type. */
  actionType: "soul_rule" | "governance_policy" | "cortex_pattern" | "manual_review";
  /** The generated rule/policy/pattern text. */
  actionText: string;
  /** Confidence score from the LLM (0.0–1.0, self-reported). */
  confidence: number;
  /** Model that produced this classification. */
  model: string;
};

/** A finding = failure signal + chain context + optional LLM classification. */
export type Finding = {
  /** Unique finding ID (UUIDv4). */
  id: string;
  /** The chain this finding belongs to. */
  chainId: string;
  /** Agent involved. */
  agent: string;
  /** Session involved. */
  session: string;
  /** The detected failure signal. */
  signal: FailureSignal;
  /** Timestamps for when this occurred. */
  detectedAt: number;
  occurredAt: number;
  /** LLM classification (populated in stage 2, null after stage 1). */
  classification: FindingClassification | null;
};

/** Signature for a per-chain signal detector function. */
export type SignalDetector = (chain: ConversationChain) => FailureSignal[];

// Re-import chain type here to avoid circular deps — use import type only
import type { ConversationChain } from "../chain-reconstructor.js";
export type { ConversationChain };

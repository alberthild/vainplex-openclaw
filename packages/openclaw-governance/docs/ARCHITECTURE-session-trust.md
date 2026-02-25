# Architecture: Session Trust (RFC-008)

**Version:** 0.1  
**Status:** Proposed  
**Author:** Atlas (AI Architect)  

This document outlines the architecture for implementing RFC-008, introducing a two-tier trust model with persistent agent trust and ephemeral session trust.

## 1. Overview

The current trust system is agent-based and persistent. RFC-008 introduces a second layer: an ephemeral, dynamic **session trust score** that is seeded by the agent's trust but adjusts based on real-time behavior within a single session.

This allows the system to be more responsive to session-specific risks and rewards good behavior within a session, without permanently altering the agent's baseline trust.

**Traceability:** This entire architecture directly implements the requirements of RFC-008.

## 2. File Impact Analysis

This is a non-trivial change, but it's localized to the governance plugin. The core changes affect trust management, evaluation context, and configuration.

| File | Change Type | Est. LOC Impact | Summary of Changes |
| --- | --- | --- | --- |
| `src/types.ts` | **Major Change** | +40 | Add `SessionTrust` type, `SessionTrustConfig`. Update `EvaluationContext` and `TrustConfig`. |
| `src/trust-manager.ts`| **No Change** | 0 | Renamed to `agent-trust-manager.ts`. |
| `src/session-trust-manager.ts`| **New File** | +150 | Manages ephemeral session trust scores. Handles initialization, signals, and decay. |
| `src/engine.ts` | **Major Change** | +50 | Integrate both trust managers. The `getTrust` method will be updated to return both agent and session trust. |
| `src/hooks.ts` | **Major Change** | +60 | Update hook context builders (`buildToolEvalContext`, etc.) to include session trust. Update `handleBeforeAgentStart` for new display format. Update `handleAfterToolCall` to record session signals. Initialize session trust in `handleSessionStart`. |
| `src/config.ts` | **Minor Change** | +25 | Add `resolveSessionTrust` and integrate into `resolveConfig`. |
| `src/policy-evaluator.ts` | **Minor Change** | +10 | Update to use `sessionTrust.tier` instead of `trust.tier` from the `EvaluationContext`. |
| **TOTAL** | | **~335** | |

## 3. Data Structures (`src/types.ts`)

### 3.1. New: `SessionTrustConfig`

This will be added to `TrustConfig` under a `sessionTrust` property.

```typescript
// In src/types.ts

export type SessionTrustSignalsConfig = {
  success: number;
  policyBlock: number;
  credentialViolation: number;
  cleanStreakBonus: number;
  cleanStreakThreshold: number;
};

export type SessionTrustConfig = {
  enabled: boolean;
  seedFactor: number;
  ceilingFactor: number;
  signals: SessionTrustSignalsConfig;
};
```
**Traceability:** RFC-008 "Configuration" section.

### 3.2. New: `SessionTrust`

This ephemeral object will hold the trust score for a single session.

```typescript
// In src/types.ts

export type SessionTrust = {
  sessionId: string;
  agentId: string;
  score: number;
  tier: TrustTier;
  cleanStreak: number;
  createdAt: number;
};
```

### 3.3. Modified: `TrustConfig`

The existing `TrustConfig` will be updated to include the new session trust configuration.

```typescript
// In src/types.ts

export type TrustConfig = {
  enabled: boolean;
  defaults: Record<string, number>;
  persistIntervalSeconds: number;
  decay: { enabled: boolean; inactivityDays: number; rate: number };
  weights?: Partial<TrustWeights>;
  maxHistoryPerAgent: number;
  // NEW
  sessionTrust: SessionTrustConfig;
};
```

### 3.4. Modified: `EvaluationContext`

The `trust` property will be updated to include both agent and session trust.

```typescript
// In src/types.ts

export type EvaluationContext = {
  // ... other properties
  trust: {
    agent: AgentTrust;
    session: SessionTrust;
  };
};
```
**Traceability:** RFC-008 "Effective Trust" section. This allows policies to be written against either agent or session trust, though the default will be session trust.

## 4. Architecture Changes

### 4.1. `trust-manager.ts` -> `agent-trust-manager.ts`

The existing `TrustManager` will be renamed to `AgentTrustManager` to clarify its role. Its implementation will remain the same.

### 4.2. New: `session-trust-manager.ts`

A new `SessionTrustManager` class will be created to handle the logic for session trust. It will be a simple in-memory store.

**Interface:**
```typescript
class SessionTrustManager {
  constructor(config: SessionTrustConfig, agentTrustManager: AgentTrustManager);
  
  // Called on session_start hook
  initializeSession(sessionId: string, agentId: string): SessionTrust;
  
  // Get session trust, or initialize if not found
  getSessionTrust(sessionId: string, agentId: string): SessionTrust;
  
  // Apply a signal to a session
  applySignal(sessionId: string, signal: keyof SessionTrustSignalsConfig): SessionTrust;
  
  // For operator override
  setScore(sessionId: string, newScore: number): SessionTrust;
  
  // Clean up on session_end
  destroySession(sessionId: string): void;
}
```
**Traceability:** Implements the logic defined in RFC-008 "Session Trust Initialization" and "Session Trust Signals".

### 4.3. `engine.ts` Orchestration

The `GovernanceEngine` will instantiate and manage both the `AgentTrustManager` and the new `SessionTrustManager`.

- The `getTrust` method will be updated to accept a `sessionId` and return an object containing both `agent` and `session` trust objects.
- The `recordOutcome` method will delegate to `SessionTrustManager.applySignal`.

### 4.4. Hook Integration (`src/hooks.ts`)

- **`handleSessionStart`**: Will call `sessionTrustManager.initializeSession`.
- **`handleAfterToolCall`**: Will call `sessionTrustManager.applySignal` based on the outcome of the tool call.
- **`buildToolEvalContext` / `buildMessageEvalContext`**: Will be updated to call the new `engine.getTrust(agentId, sessionId)` and populate the `EvaluationContext` with both trust objects.
- **`handleBeforeAgentStart`**: The context message will be updated to the new format:
  `[Governance] Agent: main (60/trusted) | Session: 42/standard | Policies: 4`
  **Traceability:** RFC-008 "Display Format" section.

### 4.5. Policy Evaluation (`src/policy-evaluator.ts`)

The `matchPolicy` function will be updated to use the session trust tier as the primary tier for evaluation.

```typescript
// In src/policy-evaluator.ts
// OLD
if (rule.minTrust && !isTierAtLeast(ctx.trust.tier, rule.minTrust)) { ... }

// NEW
if (rule.minTrust && !isTierAtLeast(ctx.trust.session.tier, rule.minTrust)) { ... }
```
**Traceability:** RFC-008 "Effective Trust" section.

### 4.6. Configuration (`src/config.ts`)

A new `resolveSessionTrust` function will be created and integrated into `resolveConfig`. It will provide default values as specified in the RFC.

## 5. Migration Path

The migration path is designed to be seamless and backward-compatible.

1.  **Default Enabled:** The `sessionTrust.enabled` flag will be `true` by default.
2.  **Backward Compatibility:** If `sessionTrust.enabled` is set to `false`, the system will fall back to the current behavior. The `EvaluationContext` will be populated with the agent trust for both `agent` and `session` properties, making the change transparent to existing policies.
3.  **Configuration:** Existing `trust.defaults` are automatically treated as agent trust baselines. No configuration changes are required for existing users.
4.  **`unresolved` Agent:** The RFC requirement to handle the `unresolved` agent is implicitly handled by this design. A session will be created for the `unresolved` agent, and its trust will be managed like any other session.

This approach ensures that the new system works out-of-the-box, while providing an escape hatch for users who want to retain the old behavior.

**Traceability:** RFC-008 "Migration" section.

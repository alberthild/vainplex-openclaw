# RFC-006: LLM Output Validation Gate for External Communications

- **Status:** Proposed
- **Author:** Atlas
- **Date:** 2026-02-20

## 1. Summary

This document proposes an enhancement to the `@vainplex/openclaw-governance` plugin to address semantic hallucinations in agent outputs, particularly for external communications. The solution involves adding a new LLM-based validation stage (Stage 3) that is triggered only for external-facing tool calls. This is complemented by a "Trace-to-Facts Bridge" to create a learning loop from observed hallucinations and support for loading fact registries from external files.

## 2. Motivation

The existing output validation system (v0.4.0) is effective at catching numeric and fact-based hallucinations using regex detectors and a fact registry. However, it cannot detect more nuanced, semantic hallucinations (e.g., "we have no vibe-coded plugins"). These types of errors are particularly damaging when they occur in external communications like tweets or emails.

A full LLM validation on every message is too slow and expensive. This proposal targets the highest-risk surface — external communication — with a cost-effective, targeted LLM validation step.

## 3. Requirements

- **R-001: LLM Validation Gate (Stage 3):** An LLM-based validation stage in the `OutputValidator` for external communications.
- **R-002: Trace-to-Facts Bridge:** A module to extract verified facts from Cortex Trace Analyzer reports and update the Fact Registry.
- **R-003: Fact Registry File Loader:** Support for loading facts from external JSON files.
- **R-004: External Communication Hook:** A new `before_external_communication` governance hook.

## 4. Proposed Architecture

### 4.1. Core Components

#### 4.1.1. LLM Validator (Stage 3)

- **File:** `src/llm-validator.ts` (new)
- **Class:** `LlmValidator`
- **Responsibilities:**
    - Takes text, existing facts, and a set of checks as input.
    - Constructs a prompt for an LLM to evaluate the text against the checks.
    - The prompt will instruct the LLM to act as a "Corporate Communications Fact-Checker" and check for:
        1. False numeric claims.
        2. Unsubstantiated assertions.
        3. Misleading implications.
        4. Contradictions to known facts.
        5. Exaggerated capability claims.
    - Parses the LLM's response (likely JSON) to produce a pass/fail verdict with reasons.
    - Caches results to avoid re-validating the same text.
- **Dependencies:** `OpenClawPluginApi.llm`

#### 4.1.2. Trace-to-Facts Bridge

- **File:** `src/trace-to-facts-bridge.ts` (new)
- **Class:** `TraceToFactsBridge`
- **Responsibilities:**
    - Reads trace report JSON files from a configured directory (e.g., `/tmp/`).
    - Watches for new or updated trace reports.
    - Parses the reports to find "hallucination" signals where the Trace Analyzer has identified a discrepancy between a claim and reality.
    - Converts these discrepancies into `Fact` objects.
    - Appends these new facts to a configured JSON file (e.g., `/var/lib/openclaw/governance/generated-facts.json`).
- **Trigger:** This will be a background process, likely kicked off on plugin startup and running on a timer (e.g., every 5 minutes).

#### 4.1.3. Fact Registry File Loader

- **File:** `src/fact-checker.ts` (modified)
- **Class:** `FactRegistry` (modified constructor)
- **Responsibilities:**
    - The `FactRegistry` constructor will be updated to accept `FactRegistryConfig` objects that can contain either an inline `facts` array or a `filePath` string.
    - If `filePath` is present, it reads and parses the JSON file to load the facts.
    - This allows facts to be managed in external files, which is essential for the Trace-to-Facts Bridge.

### 4.2. Integration

#### 4.2.1. New Hook: `before_external_communication`

- **File:** `src/hooks.ts` (modified)
- **Implementation:**
    - A new hook, `before_external_communication`, will be registered.
    - This hook will be triggered by a new `evaluateExternalCommunication` method in the `GovernanceEngine`.
    - The hook's evaluation context will be similar to `before_tool_call` but will be specifically for external comms.

#### 4.2.2. Triggering the LLM Validation

- **File:** `src/output-validator.ts` (modified)
- **Class:** `OutputValidator` (modified `validate` method)
- **Implementation:**
    - The `validate` method will be extended with a new optional parameter: `isExternal: boolean`.
    - The `GovernanceEngine` will call `validate(text, trust, true)` when handling the `before_external_communication` hook.
    - When `isExternal` is true, the `OutputValidator` will invoke the `LlmValidator` after the existing stages.
    - If the `LlmValidator` returns a "block" verdict, the final verdict will be "block".

#### 4.2.3. Identifying External Communication

- We will not introduce a new hook immediately to keep the implementation lean. Instead, we will modify the existing `before_tool_call` hook handler.
- **File:** `src/hooks.ts` (modified `handleBeforeToolCall`)
- **Implementation:**
    - The `handleBeforeToolCall` function will inspect the `toolName` and `params`.
    - It will contain logic to identify external communication targets:
        - `toolName === 'message'` and `params.channel` is in `['twitter', 'linkedin', 'email']`.
        - `toolName === 'exec'` and `params.command` contains `'bird tweet'` or `'bird reply'`.
    - When an external communication is detected, it will call `engine.validateOutput(text, agentId, { isExternal: true })`. The `validateOutput` method in the engine will pass this flag to the `OutputValidator`.

## 5. File List and Estimated LOC

| File                                                              | Type      | Est. LOC Change |
| ----------------------------------------------------------------- | --------- | --------------- |
| `docs/RFC-006-llm-output-gate.md`                                 | New       | +150            |
| `ARCHITECTURE.md`                                                 | Modified  | +5              |
| `src/llm-validator.ts`                                            | New       | +120            |
| `src/trace-to-facts-bridge.ts`                                    | New       | +100            |
| `src/output-validator.ts`                                         | Modified  | +40             |
| `src/fact-checker.ts`                                             | Modified  | +30             |
| `src/config.ts`                                                   | Modified  | +15             |
| `src/hooks.ts`                                                    | Modified  | +50             |
| `src/types.ts`                                                    | Modified  | +10             |
| `test/llm-validator.test.ts`                                      | New       | +100            |
| `test/trace-to-facts-bridge.test.ts`                              | New       | +80             |
| `test/output-validator.test.ts`                                   | Modified  | +50             |
| `test/fact-checker.test.ts`                                       | Modified  | +30             |
| **Total**                                                         |           | **~780**        |

## 6. Test Strategy

- **Unit Tests (`vitest`):**
    - `llm-validator.test.ts`:
        - Test prompt construction.
        - Mock the LLM API response and test the parsing of "pass" and "block" verdicts.
        - Test the caching mechanism.
    - `trace-to-facts-bridge.test.ts`:
        - Test parsing of trace report JSON.
        - Test the conversion of hallucination signals to `Fact` objects.
        - Test file watching and appending to the facts file.
    - `fact-checker.test.ts`:
        - Test the new file loading logic in the `FactRegistry`.
        - Test handling of missing files and invalid JSON.
    - `output-validator.test.ts`:
        - Test that the `LlmValidator` is only called when `isExternal` is true.
        - Test that a "block" from the `LlmValidator` results in a final "block" verdict.
- **Integration Tests:**
    - `integration.test.ts`:
        - Add a test case for the end-to-end `before_tool_call` flow for an external communication tool (`exec` with `bird tweet`).
        - Mock the LLM response to simulate a hallucination and assert that the tool call is blocked.

## 7. Integration Plan

1.  **Implement Core Logic:**
    - Develop `llm-validator.ts` and `trace-to-facts-bridge.ts` with their respective tests.
2.  **Update Fact Registry:**
    - Modify `fact-checker.ts` and `config.ts` to support file-based fact registries. Update tests.
3.  **Integrate into Output Validator:**
    - Modify `output-validator.ts` to incorporate the `LlmValidator` as Stage 3, triggered by the `isExternal` flag.
4.  **Update Hooks:**
    - Modify `hooks.ts` to add the logic for detecting external communication in `handleBeforeToolCall` and triggering the external validation path.
5.  **Configuration:**
    - Update documentation to explain the new configuration options in `~/.openclaw/plugins/openclaw-governance/config.json` for the LLM validator, trace bridge, and file-based fact registries.
6.  **Deployment:**
    - The changes will be deployed as part of the `@vainplex/openclaw-governance` v0.5.0 release.

## 8. Community & Plugin Suite Integration

### 8.1 LLM Configuration (Resolved)

The LLM model MUST be configurable via external config. Default: use whatever default model OpenClaw is configured with. Config structure:

```json
{
  "llmValidator": {
    "enabled": true,
    "model": "gemini/gemini-3-flash-preview",
    "maxTokens": 500,
    "timeoutMs": 5000,
    "externalChannels": ["twitter", "linkedin", "email"],
    "externalCommands": ["bird tweet", "bird reply"]
  }
}
```

The `model` field is optional — if omitted, uses the OpenClaw default model. This ensures community members using OpenAI, Ollama, Anthropic, or any provider can use this feature without configuration changes.

### 8.2 Trace Report Interface (Standardized)

The Trace-to-Facts Bridge MUST NOT depend on Cortex internals. Instead, define a **standard Finding interface** that any analyzer can produce:

```typescript
/** Standard finding format for cross-plugin interop */
interface TraceFinding {
  id: string;
  agent: string;
  signal: {
    signal: string;           // e.g. "SIG-HALLUCINATION", "SIG-CORRECTION"
    severity: "critical" | "high" | "medium" | "low";
    summary: string;
  };
  classification?: {
    rootCause: string;
    actionType: string;       // "governance_policy" | "soul_rule" | "tool_learning"
    actionText: string;
    confidence: number;       // 0-1
  };
  /** Optional: the claimed vs actual values (for fact extraction) */
  factCorrection?: {
    subject: string;
    claimed: string;
    actual: string;
    predicate?: string;
  };
}
```

The Bridge reads any JSON file matching this interface. The `factCorrection` field is optional — only findings with this field generate new facts.

**Current Cortex format:** Already close to this interface (see trace-report-daily.json). The `factCorrection` field needs to be added to the Cortex Trace Analyzer as a minor enhancement.

### 8.3 Fact Registry File Format (Standardized)

External fact files follow the existing `FactRegistryConfig` format:

```json
{
  "id": "trace-learned",
  "generatedAt": "2026-02-20T08:00:00Z",
  "facts": [
    { "subject": "nats-events", "predicate": "count", "value": "255908", "source": "trace-analyzer" }
  ]
}
```

The `filePath` config option in `factRegistries` points to these files:

```json
{
  "factRegistries": [
    { "id": "inline-facts", "facts": [...] },
    { "filePath": "~/.openclaw/plugins/openclaw-governance/generated-facts.json" }
  ]
}
```

### 8.4 Plugin Suite Boundaries

- **Governance Plugin** owns: LLM Validator, Fact Registry (inline + file), Output Validator, hooks
- **Cortex Plugin** owns: Trace Analyzer, Signal Detection, LLM Classification
- **Bridge** lives in Governance but reads standard-format files that Cortex (or any analyzer) produces
- No direct code dependency between plugins — only shared file format

## 9. Resolved Questions

1. **LLM Model:** Configurable, default to OpenClaw's configured model. Gemini Flash recommended for cost/speed.
2. **Trace Report Format:** Standardized `TraceFinding` interface with optional `factCorrection` field. See §8.2.

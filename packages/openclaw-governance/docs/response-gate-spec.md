# Response Gate Architecture Spec

**Version:** 0.7.0
**Author:** Atlas

## 1. Summary

This document specifies the architecture for the **Response Gate**, a synchronous validation layer for agent-generated messages before they are written to the conversation log. It provides a final checkpoint to enforce rules about tool usage and content patterns, ensuring that agent responses adhere to specific operational constraints.

The Response Gate is configured via a new `responseGate` section in the `governance.json` configuration file and is integrated into the `before_message_write` hook.

## 2. Motivation

While existing policies can regulate tool calls as they happen, there is no mechanism to validate the final composed message based on the tools that were used to generate it. For example, an agent might be required to use a specific data-fetching tool before answering a question, but this is not currently enforceable.

The Response Gate addresses this by inspecting the `toolCallLog` associated with a message and applying a set of synchronous validators. This ensures that the agent's final output is consistent with the process that was expected to create it.

## 3. Architecture

### 3.1. Integration with `before_message_write` Hook

The Response Gate will be implemented as a new validation step within the `handleBeforeMessageWrite` function in `src/hooks.ts`. It will run *before* the existing output validation logic.

The hook's context provides the `toolCallLog`, which is a critical dependency for the `requiredTools` validator.

```typescript
// src/hooks.ts (conceptual change)

function handleBeforeMessageWrite(
  engine: GovernanceEngine,
  config: GovernanceConfig,
  logger: PluginLogger,
) {
  return (
    event: unknown,
    hookCtx: unknown,
  ): { block?: boolean; blockReason?: string } | undefined => {
    try {
      // ... existing setup ...

      // ── Response Gate (New) ──
      if (config.responseGate?.enabled) {
        const responseGate = new ResponseGate(config.responseGate);
        const agentId = resolveAgentId(ctx, undefined, logger);
        const toolCallLog = (hookCtx as any).toolCallLog ?? [];
        const gateResult = responseGate.validate(ev.content, agentId, toolCallLog);

        if (gateResult.verdict === 'block') {
          return { block: true, blockReason: gateResult.reason };
        }
      }

      // ... existing output validation logic ...
    } catch (err) {
      // ... error handling ...
    }
  };
}
```

### 3.2. Data Structures and Configuration

The configuration for the Response Gate will be defined in `src/types.ts` and resolved in `src/config.ts`.

#### 3.2.1. `src/types.ts` Additions

```typescript
// New Validator Types
export type ResponseGateValidator =
  | { type: 'requiredTools'; tools: string[]; message?: string }
  | { type: 'mustMatch'; pattern: string; message?: string }
  | { type: 'mustNotMatch'; pattern: string; message?: string };

// Rule to apply validators to specific agents
export type ResponseGateRule = {
  agentId?: string | string[];
  validators: ResponseGateValidator[];
};

// Top-level config
export type ResponseGateConfig = {
  enabled: boolean;
  rules: ResponseGateRule[];
};

// Add to GovernanceConfig
export type GovernanceConfig = {
  // ... existing properties
  outputValidation: OutputValidationConfig;
  redaction?: RedactionConfig;
  responseGate?: ResponseGateConfig; // New
};
```

#### 3.2.2. `src/config.ts` Additions

A new `resolveResponseGate` function will be added to parse the configuration. This will be implemented in `src/response-gate.ts` to keep the logic self-contained.

```typescript
// src/config.ts (conceptual change)

import { resolveResponseGate } from './response-gate'; // New import

export function resolveConfig(
  raw?: Record<string, unknown>,
): GovernanceConfig {
  const r = raw ?? {};
  // ... existing resolution logic ...

  return {
    // ... existing properties
    outputValidation: resolveOutputValidation(r['outputValidation']),
    redaction: /* ... */,
    responseGate: resolveResponseGate(r['responseGate']), // New
  };
}
```

### 3.3. Implementation in `src/response-gate.ts`

A new file, `src/response-gate.ts`, will contain the core logic for the Response Gate.

This file will include:
1.  **`ResponseGate` class:** Manages the validation logic based on the provided configuration.
2.  **`resolveResponseGate` function:** Parses and validates the `responseGate` section of the configuration, providing default values.
3.  **Validator functions:** Individual functions for each validator type (`requiredTools`, `mustMatch`, `mustNotMatch`).

### 3.4. Validator Logic

#### `requiredTools`

-   **Purpose:** Ensures that one or more specified tools were called before the message was generated.
-   **Input:** `toolCallLog` from the `before_message_write` hook context.
-   **Logic:** Checks if the `toolName` of each tool in the `tools` array is present in the `toolCallLog`. If any tool is missing, the validator fails.

#### `mustMatch`

-   **Purpose:** Ensures the message content matches a given regular expression.
-   **Input:** `content` of the message.
-   **Logic:** Compiles the `pattern` string into a `RegExp` and tests it against the message content. If it does not match, the validator fails.

#### `mustNotMatch`

-   **Purpose:** Ensures the message content does *not* match a given regular expression.
-   **Input:** `content` of the message.
-   **Logic:** Compiles the `pattern` string into a `RegExp` and tests it against the message content. If it matches, the validator fails.

## 4. File Structure

-   **New File:** `/home/keller/repos/vainplex-openclaw/packages/openclaw-governance/src/response-gate.ts`
-   **New File:** `/home/keller/repos/vainplex-openclaw/packages/openclaw-governance/docs/response-gate-spec.md`
-   **Modified File (Conceptual):** `/home/keller/repos/vainplex-openclaw/packages/openclaw-governance/src/hooks.ts`
-   **Modified File (Conceptual):** `/home/keller/repos/vainplex-openclaw/packages/openclaw-governance/src/types.ts`
-   **Modified File (Conceptual):** `/home/keller/repos/vainplex-openclaw/packages/openclaw-governance/src/config.ts`

## 5. Testing Strategy

Unit tests should be created for the `ResponseGate` class and each validator type.

-   **`requiredTools`:** Test cases with and without the required tools in the `toolCallLog`.
-   **`mustMatch`:** Test cases with content that matches and does not match the pattern.
-   **`mustNotMatch`:** Test cases with content that matches and does not match the pattern.
-   **Agent Targeting:** Test that rules are correctly applied to the specified `agentId`.
-   **Configuration:** Test the `resolveResponseGate` function with valid and invalid configurations.

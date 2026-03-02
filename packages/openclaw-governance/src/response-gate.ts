import type {
  ResponseGateConfig,
  ResponseGateRule,
  ResponseGateValidator,
  ResponseGateValidationResult,
} from "./types.js";

/** Shape of entries in the toolCallLog from hooks.ts after_tool_call */
export type ToolCallEntry = {
  toolName: string;
  output: string;
};

/**
 * Response Gate — synchronous validation layer for agent messages.
 *
 * Validates that agent output meets configured requirements before
 * the message is written to the conversation. Supports:
 * - `requiredTools`: specific tools must have been called
 * - `mustMatch`: content must match regex pattern(s)
 * - `mustNotMatch`: content must NOT match regex pattern(s)
 */
export class ResponseGate {
  private config: ResponseGateConfig;
  private regexCache: Map<string, RegExp> = new Map();

  constructor(config: ResponseGateConfig) {
    this.config = config;
  }

  /**
   * Validate a message against all applicable rules.
   * Returns immediately (synchronous) — safe for before_message_write.
   */
  public validate(
    content: string,
    agentId: string,
    toolCallLog: ToolCallEntry[],
  ): ResponseGateValidationResult {
    if (!this.config.enabled) {
      return { passed: true, failedValidators: [], reasons: [] };
    }

    const failedValidators: string[] = [];
    const reasons: string[] = [];

    for (const rule of this.config.rules) {
      if (!this.isRuleForAgent(rule, agentId)) continue;

      for (const validator of rule.validators) {
        const result = this.runValidator(validator, content, toolCallLog);
        if (!result.passed) {
          failedValidators.push(
            validator.type === "requiredTools"
              ? `requiredTools:${validator.tools.join(",")}`
              : `${validator.type}:${validator.pattern}`,
          );
          reasons.push(result.reason!);
        }
      }
    }

    const passed = failedValidators.length === 0;
    const result: ResponseGateValidationResult = { passed, failedValidators, reasons };

    if (!passed) {
      result.fallbackMessage = this.renderFallback(agentId, failedValidators, reasons);
    }

    return result;
  }

  private runValidator(
    validator: ResponseGateValidator,
    content: string,
    toolCallLog: ToolCallEntry[],
  ): { passed: boolean; reason?: string } {
    switch (validator.type) {
      case "requiredTools":
        return this.validateRequiredTools(validator, toolCallLog);
      case "mustMatch":
        return this.validateMustMatch(validator, content);
      case "mustNotMatch":
        return this.validateMustNotMatch(validator, content);
    }
  }

  private validateRequiredTools(
    validator: Extract<ResponseGateValidator, { type: "requiredTools" }>,
    toolCallLog: ToolCallEntry[],
  ): { passed: boolean; reason?: string } {
    const calledToolNames = new Set(toolCallLog.map((e) => e.toolName));
    const missing = validator.tools.filter((t) => !calledToolNames.has(t));
    if (missing.length > 0) {
      return {
        passed: false,
        reason:
          validator.message ??
          `Response Gate: required tool(s) not called: ${missing.join(", ")}`,
      };
    }
    return { passed: true };
  }

  private validateMustMatch(
    validator: Extract<ResponseGateValidator, { type: "mustMatch" }>,
    content: string,
  ): { passed: boolean; reason?: string } {
    const regex = this.getRegex(validator.pattern);
    if (!regex) {
      return {
        passed: false,
        reason: `Response Gate: invalid regex pattern /${validator.pattern}/ — blocked (fail-closed)`,
      };
    }
    if (!regex.test(content)) {
      return {
        passed: false,
        reason:
          validator.message ??
          `Response Gate: content does not match required pattern /${validator.pattern}/`,
      };
    }
    return { passed: true };
  }

  private validateMustNotMatch(
    validator: Extract<ResponseGateValidator, { type: "mustNotMatch" }>,
    content: string,
  ): { passed: boolean; reason?: string } {
    const regex = this.getRegex(validator.pattern);
    if (!regex) {
      return {
        passed: false,
        reason: `Response Gate: invalid regex pattern /${validator.pattern}/ — blocked (fail-closed)`,
      };
    }
    if (regex.test(content)) {
      return {
        passed: false,
        reason:
          validator.message ??
          `Response Gate: content matches forbidden pattern /${validator.pattern}/`,
      };
    }
    return { passed: true };
  }

  /**
   * Render the fallback message to send to the user when the gate blocks.
   * Supports template variables: {reasons}, {validators}, {agent}
   */
  private renderFallback(
    agentId: string,
    failedValidators: string[],
    reasons: string[],
  ): string | undefined {
    const template =
      this.config.fallbackMessage ??
      this.config.fallbackTemplate ??
      undefined;

    if (!template) return undefined;

    return template
      .replace(/\{reasons\}/g, reasons.join("; "))
      .replace(/\{validators\}/g, failedValidators.join(", "))
      .replace(/\{agent\}/g, agentId);
  }

  private isRuleForAgent(rule: ResponseGateRule, agentId: string): boolean {
    if (!rule.agentId) return true;
    if (Array.isArray(rule.agentId)) return rule.agentId.includes(agentId);
    return rule.agentId === agentId;
  }

  private getRegex(pattern: string): RegExp | null {
    let cached = this.regexCache.get(pattern);
    if (cached !== undefined) return cached;
    try {
      cached = new RegExp(pattern);
      this.regexCache.set(pattern, cached);
      return cached;
    } catch {
      // Invalid regex — fail closed (block), don't silently pass
      return null;
    }
  }
}

/**
 * Resolve responseGate config section with defaults.
 */
export function resolveResponseGate(raw: unknown): ResponseGateConfig {
  const r =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : false,
    rules: Array.isArray(r["rules"])
      ? (r["rules"] as ResponseGateRule[])
      : [],
    fallbackMessage: typeof r["fallbackMessage"] === "string" ? r["fallbackMessage"] : undefined,
    fallbackTemplate: typeof r["fallbackTemplate"] === "string" ? r["fallbackTemplate"] : undefined,
  };
}

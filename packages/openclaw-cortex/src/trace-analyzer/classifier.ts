// ============================================================
// Trace Analyzer — LLM Classifier (Stage 2)
// ============================================================
//
// Takes Finding[] from signal detection, optionally triages them
// with a fast/local model, then classifies remaining findings
// with a capable analysis model. Implements R-015, R-017, R-018,
// R-031, R-046, R-047.
// ============================================================

import type { PluginLogger } from "../types.js";
import type { LlmConfig } from "../llm-enhance.js";
import type { TraceAnalyzerConfig, TriageLlmConfig } from "./config.js";
import type { ConversationChain } from "./chain-reconstructor.js";
import type { Finding, FindingClassification } from "./signals/types.js";
import { redactChain } from "./redactor.js";
import { truncate } from "./util.js";

// ---- LLM Config Resolution (R-018, R-031) ----

type ResolvedLlmConfig = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

/**
 * Merge analyzer-specific LLM overrides with top-level config.
 * Per-field merge, not full replace (R-031).
 */
export function resolveAnalyzerLlmConfig(
  topLevel: LlmConfig,
  override: TraceAnalyzerConfig["llm"],
): ResolvedLlmConfig {
  if (!override?.enabled) {
    return { enabled: false, endpoint: "", model: "", apiKey: "", timeoutMs: 15000 };
  }
  return {
    enabled: true,
    endpoint: override.endpoint ?? topLevel.endpoint,
    model: override.model ?? topLevel.model,
    apiKey: override.apiKey ?? topLevel.apiKey,
    timeoutMs: override.timeoutMs ?? topLevel.timeoutMs,
  };
}

// ---- Prompts ----

const TRIAGE_SYSTEM_PROMPT = `You are a signal triage system. Given a failure detection summary, decide:
1. Is this a TRUE positive (real failure) or FALSE positive (benign/expected behavior)?
2. If true positive, what severity? (low/medium/high/critical)

Respond ONLY with JSON: {"keep": true|false, "severity": "low|medium|high|critical", "reason": "one sentence"}

Common false positives to watch for:
- User saying "nein" to a question (not a correction)
- Tool errors that the agent intentionally provoked for testing
- Session endings due to timeout, not dissatisfaction
- Tool calls to check status (no claim made, just checking)`;

const DEEP_ANALYSIS_SYSTEM_PROMPT = `You are analyzing an agent failure trace. Given the full conversation chain and failure signal, produce:

1. **rootCause**: Why did the failure happen? Be specific.
2. **actionType**: What kind of fix prevents recurrence?
   - "soul_rule": A behavioral directive for the agent's system prompt
   - "governance_policy": A machine-enforced policy rule
   - "cortex_pattern": A regex pattern for real-time detection
   - "manual_review": Requires human judgment
3. **actionText**: The specific rule/policy/pattern text. Be concrete.
   - For soul_rule: "NIEMALS X — stattdessen Y. [Grund: Z]" or "NEVER X — instead Y. [Reason: Z]"
   - For governance_policy: The condition and effect as a sentence.
   - For cortex_pattern: A regex string.
   - For manual_review: Describe what to investigate.
4. **confidence**: How confident are you (0.0–1.0)?

Respond ONLY with valid JSON:
{"rootCause": "...", "actionType": "soul_rule|governance_policy|cortex_pattern|manual_review", "actionText": "...", "confidence": 0.85}`;

// ---- Chain-to-Transcript Formatter ----

export function formatChainAsTranscript(chain: ConversationChain): string {
  const lines: string[] = [];
  for (const event of chain.events) {
    const ts = new Date(event.ts).toISOString();
    switch (event.type) {
      case "msg.in":
        lines.push(`[${ts}] USER: ${truncate(event.payload.content ?? "", 500)}`);
        break;
      case "msg.out":
        lines.push(`[${ts}] AGENT: ${truncate(event.payload.content ?? "", 500)}`);
        break;
      case "tool.call":
        lines.push(`[${ts}] TOOL_CALL: ${event.payload.toolName ?? "unknown"}(${truncate(JSON.stringify(event.payload.toolParams ?? {}), 300)})`);
        break;
      case "tool.result":
        if (event.payload.toolError) {
          lines.push(`[${ts}] TOOL_ERROR: ${event.payload.toolName ?? "unknown"} → ${truncate(String(event.payload.toolError), 300)}`);
        } else {
          const resultStr = typeof event.payload.toolResult === "object"
            ? JSON.stringify(event.payload.toolResult)
            : String(event.payload.toolResult ?? "");
          lines.push(`[${ts}] TOOL_OK: ${event.payload.toolName ?? "unknown"} → ${truncate(resultStr, 300)}`);
        }
        break;
      case "session.start":
        lines.push(`[${ts}] SESSION_START`);
        break;
      case "session.end":
        lines.push(`[${ts}] SESSION_END`);
        break;
      default:
        lines.push(`[${ts}] ${event.type.toUpperCase()}`);
    }
  }
  return lines.join("\n");
}

// ---- HTTP Call (uses node built-in fetch — Node 22) ----

/** Resolve config fields that may come from ResolvedLlmConfig or TriageLlmConfig. */
function resolveLlmCallConfig(config: ResolvedLlmConfig | TriageLlmConfig): {
  endpoint: string; model: string; apiKey: string; timeoutMs: number;
} {
  return {
    endpoint: "endpoint" in config ? config.endpoint : "",
    model: "model" in config ? config.model : "",
    apiKey: "apiKey" in config && config.apiKey ? config.apiKey : "",
    timeoutMs: "timeoutMs" in config && config.timeoutMs ? config.timeoutMs : 15000,
  };
}

/** Extract the assistant message content from an OpenAI-compatible response. */
function parseLlmResponse(data: Record<string, unknown>): string | null {
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content ?? null;
}

async function callLlmChat(
  config: ResolvedLlmConfig | TriageLlmConfig,
  messages: Array<{ role: string; content: string }>,
  logger: PluginLogger,
): Promise<string | null> {
  const { endpoint, model, apiKey, timeoutMs } = resolveLlmCallConfig(config);
  if (!endpoint || !model) return null;

  const url = `${endpoint}/chat/completions`;
  const body = JSON.stringify({
    model, messages, temperature: 0.1,
    max_tokens: 1000, response_format: { type: "json_object" },
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      logger.warn(`[trace-analyzer] LLM HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    return parseLlmResponse(await response.json() as Record<string, unknown>);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn(`[trace-analyzer] LLM request timed out (${timeoutMs}ms)`);
    } else {
      logger.warn(`[trace-analyzer] LLM request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

// ---- Response Parsing (Graceful Degradation) ----

const VALID_ACTION_TYPES = ["soul_rule", "governance_policy", "cortex_pattern", "manual_review"] as const;

function parseClassification(
  raw: string | null,
  model: string,
  logger: PluginLogger,
): FindingClassification | null {
  if (!raw) return null;

  try {
    // Try to extract JSON from response (may have markdown fences)
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (typeof parsed.rootCause !== "string" || typeof parsed.actionText !== "string") {
      logger.warn("[trace-analyzer] LLM response missing required fields");
      return null;
    }

    let actionType = String(parsed.actionType ?? "manual_review");
    if (!(VALID_ACTION_TYPES as readonly string[]).includes(actionType)) {
      logger.warn(`[trace-analyzer] LLM returned unknown actionType: ${actionType}`);
      actionType = "manual_review";
    }

    return {
      rootCause: parsed.rootCause,
      actionType: actionType as FindingClassification["actionType"],
      actionText: parsed.actionText,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      model,
    };
  } catch {
    logger.warn("[trace-analyzer] Failed to parse LLM classification response as JSON");
    return null;
  }
}

// ---- Triage ----

type TriageResult = {
  keep: boolean;
  severity?: string;
};

function parseTriageResponse(raw: string | null, logger: PluginLogger): TriageResult | null {
  if (!raw) return null;

  try {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.keep !== "boolean") return null;

    return {
      keep: parsed.keep,
      severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
    };
  } catch {
    logger.warn("[trace-analyzer] Failed to parse triage response");
    return null;
  }
}

async function triageFinding(
  finding: Finding,
  triageConfig: TriageLlmConfig,
  logger: PluginLogger,
): Promise<boolean> {
  const userPrompt = `Signal: ${finding.signal.signal}
Detected severity: ${finding.signal.severity}
Summary: ${finding.signal.summary}
Agent: ${finding.agent}
Evidence: ${JSON.stringify(finding.signal.evidence, null, 2)}`;

  const raw = await callLlmChat(
    triageConfig,
    [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    logger,
  );

  const result = parseTriageResponse(raw, logger);
  if (!result) return true; // On failure, keep the finding (conservative)
  return result.keep;
}

// ---- Deep Analysis ----

/** Extract a focused window of events around the finding's event range. */
function extractRelevantWindow(chain: ConversationChain, finding: Finding, windowSize = 10): ConversationChain {
  const range = finding.signal.eventRange;
  const start = Math.max(0, range.start - windowSize);
  const end = Math.min(chain.events.length, range.end + windowSize);
  return {
    ...chain,
    events: chain.events.slice(start, end),
  };
}

async function deepAnalyze(
  finding: Finding,
  chain: ConversationChain,
  config: ResolvedLlmConfig,
  logger: PluginLogger,
): Promise<FindingClassification | null> {
  // Use focused window around the finding instead of full chain
  const focused = extractRelevantWindow(chain, finding);
  const transcript = formatChainAsTranscript(focused);

  const userPrompt = `## Failure Signal
Type: ${finding.signal.signal}
Severity: ${finding.signal.severity}
Summary: ${finding.signal.summary}

## Evidence
${JSON.stringify(finding.signal.evidence, null, 2)}

## Conversation Context (${focused.events.length} events around failure, agent: ${chain.agent})
${transcript}`;

  const raw = await callLlmChat(
    config,
    [
      { role: "system", content: DEEP_ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    logger,
  );

  return parseClassification(raw, config.model, logger);
}

// ---- Main Classification Pipeline ----

/**
 * Classify findings using LLM analysis (Stage 2).
 *
 * If LLM is disabled, returns findings unchanged (classification=null).
 * If triage model configured, filters false positives first.
 * Graceful degradation: invalid JSON → classification=null, timeout → skip.
 */
export async function classifyFindings(
  findings: Finding[],
  chains: Map<string, ConversationChain>,
  config: TraceAnalyzerConfig,
  topLevelLlm: LlmConfig,
  logger: PluginLogger,
): Promise<Finding[]> {
  const llmConfig = resolveAnalyzerLlmConfig(topLevelLlm, config.llm);
  if (!llmConfig.enabled) return findings;

  const result: Finding[] = [];

  for (const finding of findings) {
    // Step 1: Triage (optional)
    if (config.llm.triage) {
      const keep = await triageFinding(finding, config.llm.triage, logger);
      if (!keep) {
        logger.debug(`[trace-analyzer] Triage filtered finding ${finding.id}`);
        continue;
      }
    }

    // Step 2: Deep analysis
    const chain = chains.get(finding.chainId);
    if (!chain) {
      result.push(finding); // No chain context — skip classification
      continue;
    }

    const redactedChain = redactChain(chain, config.redactPatterns);
    const classification = await deepAnalyze(finding, redactedChain, llmConfig, logger);
    result.push({
      ...finding,
      classification,
    });
  }

  return result;
}

import { request } from "node:http";
import { URL } from "node:url";
import type { PluginLogger } from "./types.js";

/**
 * LLM Enhancement — optional AI-powered analysis layered on top of regex patterns.
 *
 * When enabled, sends conversation snippets to a local or remote LLM for deeper
 * thread/decision/closure detection. Falls back gracefully to regex-only on failure.
 *
 * Supports any OpenAI-compatible API (Ollama, vLLM, OpenRouter, OpenAI, etc.)
 */

export type LlmConfig = {
  enabled: boolean;
  /** OpenAI-compatible endpoint, e.g. "http://localhost:11434/v1" */
  endpoint: string;
  /** Model identifier, e.g. "mistral:7b" or "gpt-4o-mini" */
  model: string;
  /** API key (optional, for cloud providers) */
  apiKey: string;
  /** Timeout in ms for LLM calls */
  timeoutMs: number;
  /** Minimum message count before triggering LLM (batches for efficiency) */
  batchSize: number;
};

export const LLM_DEFAULTS: LlmConfig = {
  enabled: false,
  endpoint: "http://localhost:11434/v1",
  model: "mistral:7b",
  apiKey: "",
  timeoutMs: 15000,
  batchSize: 3,
};

export type LlmAnalysis = {
  threads: Array<{
    title: string;
    status: "open" | "closed";
    summary?: string;
  }>;
  decisions: Array<{
    what: string;
    who: string;
    impact: "high" | "medium" | "low";
  }>;
  closures: string[];
  mood: string;
};

const SYSTEM_PROMPT = `You are a conversation analyst. Given a snippet of conversation between a user and an AI assistant, extract:

1. **threads**: Active topics being discussed. Each has a title (short, specific) and status (open/closed).
2. **decisions**: Any decisions made. Include what was decided, who decided, and impact (high/medium/low).
3. **closures**: Thread titles that were completed/resolved in this snippet.
4. **mood**: Overall conversation mood (neutral/frustrated/excited/tense/productive/exploratory).

Rules:
- Only extract REAL topics, not meta-conversation ("how are you", greetings, etc.)
- Thread titles should be specific and actionable ("auth migration to OAuth2", not "the thing")
- Decisions must be actual commitments, not questions or suggestions
- Be conservative — when in doubt, don't extract

Respond ONLY with valid JSON matching this schema:
{"threads":[{"title":"...","status":"open|closed","summary":"..."}],"decisions":[{"what":"...","who":"...","impact":"high|medium|low"}],"closures":["thread title"],"mood":"neutral"}`;

/**
 * Call an OpenAI-compatible chat completion API.
 */
function callLlm(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
  logger: PluginLogger,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const url = new URL(`${config.endpoint}/chat/completions`);
      const body = JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      };
      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      const proto = url.protocol === "https:" ? require("node:https") : require("node:http");
      const req = proto.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname,
          method: "POST",
          headers,
          timeout: config.timeoutMs,
        },
        (res: any) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              const content = parsed?.choices?.[0]?.message?.content;
              resolve(content ?? null);
            } catch {
              logger.warn(`[cortex-llm] Failed to parse LLM response`);
              resolve(null);
            }
          });
        },
      );

      req.on("error", (err: Error) => {
        logger.warn(`[cortex-llm] Request error: ${err.message}`);
        resolve(null);
      });

      req.on("timeout", () => {
        req.destroy();
        logger.warn(`[cortex-llm] Request timed out (${config.timeoutMs}ms)`);
        resolve(null);
      });

      req.write(body);
      req.end();
    } catch (err) {
      logger.warn(`[cortex-llm] Exception: ${err}`);
      resolve(null);
    }
  });
}

/**
 * Parse LLM JSON response into structured analysis.
 * Returns null on any parse failure (graceful degradation).
 */
function parseAnalysis(raw: string, logger: PluginLogger): LlmAnalysis | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      threads: Array.isArray(parsed.threads)
        ? parsed.threads.filter(
            (t: any) => typeof t.title === "string" && t.title.length > 2,
          )
        : [],
      decisions: Array.isArray(parsed.decisions)
        ? parsed.decisions.filter(
            (d: any) => typeof d.what === "string" && d.what.length > 5,
          )
        : [],
      closures: Array.isArray(parsed.closures)
        ? parsed.closures.filter((c: any) => typeof c === "string")
        : [],
      mood: typeof parsed.mood === "string" ? parsed.mood : "neutral",
    };
  } catch {
    logger.warn(`[cortex-llm] Failed to parse analysis JSON`);
    return null;
  }
}

/**
 * Message buffer for batching LLM calls.
 */
export class LlmEnhancer {
  private buffer: Array<{ role: string; content: string; sender: string }> = [];
  private readonly config: LlmConfig;
  private readonly logger: PluginLogger;
  private lastCallMs = 0;
  private readonly cooldownMs = 5000;

  constructor(config: LlmConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Buffer a message. Returns analysis when batch is full, null otherwise.
   */
  async addMessage(
    content: string,
    sender: string,
    role: "user" | "assistant",
  ): Promise<LlmAnalysis | null> {
    if (!this.config.enabled) return null;

    this.buffer.push({ role, content, sender });

    if (this.buffer.length < this.config.batchSize) return null;

    // Cooldown check
    const now = Date.now();
    if (now - this.lastCallMs < this.cooldownMs) return null;
    this.lastCallMs = now;

    // Flush buffer
    const batch = this.buffer.splice(0);
    return this.analyze(batch);
  }

  /**
   * Force-analyze remaining buffer (e.g. before compaction).
   */
  async flush(): Promise<LlmAnalysis | null> {
    if (!this.config.enabled || this.buffer.length === 0) return null;
    const batch = this.buffer.splice(0);
    return this.analyze(batch);
  }

  private async analyze(
    messages: Array<{ role: string; content: string; sender: string }>,
  ): Promise<LlmAnalysis | null> {
    const snippet = messages
      .map((m) => `[${m.sender}]: ${m.content}`)
      .join("\n\n");

    const raw = await callLlm(
      this.config,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: snippet },
      ],
      this.logger,
    );

    if (!raw) return null;

    const analysis = parseAnalysis(raw, this.logger);
    if (analysis) {
      const stats = `threads=${analysis.threads.length} decisions=${analysis.decisions.length} closures=${analysis.closures.length}`;
      this.logger.info(`[cortex-llm] Analysis: ${stats}`);
    }
    return analysis;
  }
}

/**
 * Resolve LLM config from plugin config.
 */
export function resolveLlmConfig(raw?: Record<string, unknown>): LlmConfig {
  if (!raw) return { ...LLM_DEFAULTS };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : LLM_DEFAULTS.enabled,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : LLM_DEFAULTS.endpoint,
    model: typeof raw.model === "string" ? raw.model : LLM_DEFAULTS.model,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : LLM_DEFAULTS.apiKey,
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : LLM_DEFAULTS.timeoutMs,
    batchSize: typeof raw.batchSize === "number" ? raw.batchSize : LLM_DEFAULTS.batchSize,
  };
}

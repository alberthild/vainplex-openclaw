/**
 * AgentProof Partner REST API Client
 * Module 6b of the Agent Firewall (RFC §14.4)
 *
 * Talks to BuilderBen's REST API for agent reputation lookups.
 * Zero external dependencies — uses native `fetch`.
 *
 * Auth: Bearer token read from file path at runtime (NO hardcoded keys).
 *
 * @module security/agentproof-rest
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import type { ReputationResult } from "./types.js";
import { classifyTier } from "./erc8004-client.js";

// ── REST API response types ──

interface AgentProfileResponse {
  agentId: number;
  exists: boolean;
  owner?: string | null;
  feedbackCount?: number;
  reputationScore?: number;
  [key: string]: unknown;
}

interface BatchLookupResponse {
  results: AgentProfileResponse[];
}

export interface FeedbackSignal {
  agentId: number;
  signalType: "POLICY_VIOLATION" | "TOXIC_INPUT" | "TOOL_SUCCESS" | "APPROVAL_RATE_DROP";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  context: {
    toolName?: string;
    policyName?: string;
    ruleId?: string;
  };
  timestamp: string;
  nonce: string;
}

interface SignalBatch {
  signals: FeedbackSignal[];
  retries: number;
  nextRetryAt: number;
}

// ── File-based API key loader ──

function expandPath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

async function loadApiKey(filePath: string): Promise<string | null> {
  try {
    const resolved = expandPath(filePath);
    const content = await readFile(resolved, "utf-8");
    const key = content.trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

// ── REST Client ──

export class AgentProofRestClient {
  private readonly baseUrl: string;
  private readonly apiKeyFile: string;
  private apiKey: string | null = null;
  private apiKeyLoaded = false;

  // Ring Buffer Queue
  private signalQueue: FeedbackSignal[] = [];
  private readonly MAX_QUEUE_SIZE = 1000;
  
  // Flusher Worker
  private flusherInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;
  
  // Fail-Open & Retry Strategy
  private pendingBatches: SignalBatch[] = [];
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(baseUrl: string, apiKeyFile: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKeyFile = apiKeyFile;
  }

  startFlusher() {
    if (this.flusherInterval) return;
    this.flusherInterval = setInterval(() => {
      this.flushQueue().catch(() => {});
    }, 5000);
    
    // Graceful Shutdown Hook
    process.on('SIGTERM', this.shutdownHandler);
    process.on('SIGINT', this.shutdownHandler);
  }

  stopFlusher() {
    if (this.flusherInterval) {
      clearInterval(this.flusherInterval);
      this.flusherInterval = null;
    }
    process.off('SIGTERM', this.shutdownHandler);
    process.off('SIGINT', this.shutdownHandler);
  }

  private shutdownHandler = async () => {
    // 1000ms grace period to fire one last synchronous POST batch
    // Using an async wrapper to block/wait for the promise to resolve
    await this.flushQueue(1000).catch(() => {});
  };

  /**
   * Data Leakage Prevention (Deep Sanitization)
   * Only allows specific string literals in context.
   */
  pushSignal(
    agentId: number, 
    signalType: FeedbackSignal["signalType"], 
    severity: FeedbackSignal["severity"], 
    context: any
  ) {
    const safeContext: FeedbackSignal["context"] = {};
    if (context && typeof context === 'object') {
      if (typeof context.toolName === 'string') safeContext.toolName = context.toolName.slice(0, 200);
      if (typeof context.policyName === 'string') safeContext.policyName = context.policyName.slice(0, 200);
      if (typeof context.ruleId === 'string') safeContext.ruleId = context.ruleId.slice(0, 200);
    }

    const signal: FeedbackSignal = {
      agentId,
      signalType,
      severity,
      context: safeContext,
      timestamp: new Date().toISOString(),
      nonce: randomUUID(),
    };

    this.signalQueue.push(signal);
    
    // Ring Buffer semantics
    if (this.signalQueue.length > this.MAX_QUEUE_SIZE) {
      this.signalQueue.shift(); // Drop oldest
    }

    if (this.signalQueue.length >= 20) {
      this.flushQueue().catch(() => {});
    }
  }

  private async flushQueue(timeoutMs = 200) {
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const now = Date.now();
      
      // Circuit Breaker check
      if (now < this.circuitOpenUntil) {
        return;
      }

      // Check for retries that are due
      const batchesToProcess: SignalBatch[] = [];
      
      // Extract due batches
      for (let i = this.pendingBatches.length - 1; i >= 0; i--) {
        if (now >= (this.pendingBatches[i]?.nextRetryAt ?? 0)) {
          batchesToProcess.push(...this.pendingBatches.splice(i, 1));
        }
      }

      // Create new batch if we have enough items or a timer triggered it
      if (this.signalQueue.length > 0) {
        const signals = this.signalQueue.splice(0, 20);
        batchesToProcess.push({ signals, retries: 0, nextRetryAt: 0 });
      }

      // Process batches using Promise.allSettled
      await Promise.allSettled(
        batchesToProcess.map(batch => this.sendBatch(batch, timeoutMs))
      );
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendBatch(batch: SignalBatch, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = await this.buildHeaders();
      const resp = await fetch(`${this.baseUrl}/trust/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify(batch.signals),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (resp.ok) {
        this.consecutiveFailures = 0;
        return;
      }

      // Exponential Backoff
      if ([429, 500, 502, 504].includes(resp.status)) {
        this.handleFailedBatch(batch);
      } else {
        // Discard on other errors
      }
    } catch (err) {
      clearTimeout(timeout);
      this.handleFailedBatch(batch);
    }
  }

  private handleFailedBatch(batch: SignalBatch) {
    if (batch.retries < 3) {
      const delay = Math.pow(2, batch.retries) * 1000; // 1s, 2s, 4s
      batch.retries++;
      batch.nextRetryAt = Date.now() + delay;
      this.pendingBatches.unshift(batch); // Push to head
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      this.circuitOpenUntil = Date.now() + 60000; // 60 seconds
      this.consecutiveFailures = 0;
    }
  }

  // --- Read Methods remain mostly unchanged ---

  private async ensureApiKey(): Promise<string | null> {
    if (!this.apiKeyLoaded) {
      this.apiKey = await loadApiKey(this.apiKeyFile);
      this.apiKeyLoaded = true;
    }
    return this.apiKey;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const key = await this.ensureApiKey();
    if (key) {
      headers["X-API-Key"] = key;
    }
    return headers;
  }

  async getAgentProfile(agentId: number): Promise<ReputationResult | null> {
    try {
      const headers = await this.buildHeaders();
      const resp = await fetch(`${this.baseUrl}/trust/${agentId}`, {
        method: "GET",
        headers,
      });

      if (!resp.ok) return null;

      const data = (await resp.json()) as AgentProfileResponse;
      return this.mapToResult(data);
    } catch {
      return null;
    }
  }

  async batchLookup(
    agentIds: number[],
  ): Promise<(ReputationResult | null)[]> {
    if (agentIds.length === 0) return [];

    try {
      const headers = await this.buildHeaders();
      const resp = await fetch(`${this.baseUrl}/trust/batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentIds }),
      });

      if (!resp.ok) return agentIds.map(() => null);

      const data = (await resp.json()) as BatchLookupResponse;
      if (!Array.isArray(data.results)) return agentIds.map(() => null);

      return data.results.map((entry) => this.mapToResult(entry));
    } catch {
      return agentIds.map(() => null);
    }
  }

  private mapToResult(data: AgentProfileResponse): ReputationResult | null {
    if (data == null || typeof data.agentId !== "number") return null;

    const exists = data.exists === true;
    const owner =
      typeof data.owner === "string" && data.owner.length > 0
        ? data.owner
        : null;
    const feedbackCount =
      typeof data.feedbackCount === "number" ? data.feedbackCount : 0;
    const reputationScore =
      typeof data.reputationScore === "number"
        ? Math.min(100, Math.max(0, data.reputationScore))
        : 0;
    const tier = classifyTier(exists, reputationScore, feedbackCount);

    return {
      agentId: data.agentId,
      exists,
      owner,
      feedbackCount,
      reputationScore,
      tier,
      source: "rest",
    };
  }
}

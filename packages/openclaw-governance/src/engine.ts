import type {
  AuditContext,
  AuditFilter,
  AuditRecord,
  AuditVerdict,
  AgentTrust,
  ConditionDeps,
  EvaluationContext,
  EvaluationStats,
  GovernanceConfig,
  GovernanceStatus,
  OutputValidationResult,
  PluginLogger,
  PolicyIndex,
  RiskAssessment,
  RiskLevel,
  SessionTrust,
  TrustStore,
  Verdict,
} from "./types.js";
import { buildPolicyIndex, loadPolicies } from "./policy-loader.js";
import { PolicyEvaluator } from "./policy-evaluator.js";
import { createConditionEvaluators } from "./conditions/index.js";
import { RiskAssessor } from "./risk-assessor.js";
import { TrustManager } from "./trust-manager.js";
import { SessionTrustManager } from "./session-trust-manager.js";
import { CrossAgentManager } from "./cross-agent.js";
import { AuditTrail } from "./audit-trail.js";
import { OutputValidator } from "./output-validator.js";
import { FrequencyTrackerImpl } from "./frequency-tracker.js";
import { nowUs } from "./util.js";

export class GovernanceEngine {
  private readonly config: GovernanceConfig;
  private readonly logger: PluginLogger;
  private policyIndex: PolicyIndex;
  private readonly evaluator: PolicyEvaluator;
  private readonly riskAssessor: RiskAssessor;
  private readonly trustManager: TrustManager;
  private readonly sessionTrustManager: SessionTrustManager;
  private readonly crossAgentManager: CrossAgentManager;
  private readonly auditTrail: AuditTrail;
  private readonly outputValidator: OutputValidator;
  private readonly frequencyTracker: FrequencyTrackerImpl;
  private readonly stats: EvaluationStats;
  private workspace: string;

  private knownAgentIds: readonly string[] = [];

  constructor(
    config: GovernanceConfig,
    logger: PluginLogger,
    workspace?: string,
  ) {
    this.config = config;
    this.logger = logger;
    this.workspace =
      workspace ??
      `${process.env["HOME"] ?? "/tmp"}/.openclaw/plugins/openclaw-governance`;

    const conditionEvaluators = createConditionEvaluators();
    this.evaluator = new PolicyEvaluator(conditionEvaluators);
    this.riskAssessor = new RiskAssessor(config.toolRiskOverrides);
    this.trustManager = new TrustManager(
      config.trust,
      this.workspace,
      logger,
    );
    this.sessionTrustManager = new SessionTrustManager(
      config.trust.sessionTrust,
      this.trustManager,
    );
    this.crossAgentManager = new CrossAgentManager(this.trustManager, logger);
    this.auditTrail = new AuditTrail(config.audit, this.workspace, logger);
    this.outputValidator = new OutputValidator(config.outputValidation, logger);
    this.frequencyTracker = new FrequencyTrackerImpl(
      config.performance.frequencyBufferSize,
    );
    // Load policies eagerly so getStatus() is accurate before start()
    const allPolicies = loadPolicies(
      this.config.policies,
      this.config.builtinPolicies,
      this.logger,
    );
    this.policyIndex = buildPolicyIndex(allPolicies);
    this.stats = {
      totalEvaluations: 0,
      allowCount: 0,
      denyCount: 0,
      errorCount: 0,
      avgEvaluationUs: 0,
    };
  }

  /**
   * Provide the list of known agent IDs from OpenClaw config.
   * Call this before start() so trust sync can register all agents.
   */
  setKnownAgents(agentIds: readonly string[]): void {
    this.knownAgentIds = agentIds;
  }

  async start(): Promise<void> {
    this.trustManager.load();

    // Sync trust entries with known agents
    if (this.knownAgentIds.length > 0) {
      this.syncAgentTrust();
    }

    this.auditTrail.load();
    this.frequencyTracker.clear();

    this.trustManager.startPersistence();
    this.auditTrail.startAutoFlush();

    const policyCount = this.getStatus().policyCount;
    this.logger.info(
      `[governance] Engine started: ${policyCount} policies loaded`,
    );
  }

  /**
   * Ensure every known agent has a trust entry.
   * New agents get the configured default (or wildcard).
   * Removed agents are kept (historical data) but logged.
   */
  private syncAgentTrust(): void {
    const store = this.trustManager.getStore();
    const knownSet = new Set(this.knownAgentIds);
    const storeAgents = new Set(Object.keys(store.agents));

    // Register new agents
    const added: string[] = [];
    for (const agentId of this.knownAgentIds) {
      if (!storeAgents.has(agentId)) {
        // getAgentTrust auto-creates with resolveDefault()
        this.trustManager.getAgentTrust(agentId);
        added.push(agentId);
      }
    }

    // Detect removed agents on first sync only (avoid noise on every restart)
    const removed: string[] = [];
    for (const agentId of storeAgents) {
      if (!knownSet.has(agentId) && agentId !== "unresolved") {
        removed.push(agentId);
      }
    }

    if (added.length > 0) {
      this.logger.info(
        `[governance] Auto-registered ${added.length} new agent(s): ${added.join(
          ", ",
        )}`,
      );
    }
    if (removed.length > 0) {
      this.logger.debug?.(
        `[governance] ${
          removed.length
        } agent(s) not in current config (trust data kept): ${removed.join(
          ", ",
        )}`,
      );
    }
  }

  async stop(): Promise<void> {
    try {
      this.trustManager.stopPersistence();
    } catch (e) {
      this.logger.error(
        `[governance] Error stopping trust persistence: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    try {
      this.auditTrail.stopAutoFlush();
    } catch (e) {
      this.logger.error(
        `[governance] Error stopping audit flush: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    this.logger.info("[governance] Engine stopped");
  }

  async evaluate(ctx: EvaluationContext): Promise<Verdict> {
    const startUs = nowUs();
    try {
      const verdict = this.runPipeline(ctx, startUs);
      this.updateStats(verdict.action, verdict.evaluationUs);
      return verdict;
    } catch (e) {
      if (e instanceof Error) this.logger.error(`[governance] Pipeline crash: ${e.message}\n${e.stack}`);
      return this.handleEvalError(e, ctx, startUs);
    }
  }

  private buildDeps(risk: RiskAssessment): ConditionDeps {
    return {
      regexCache: this.policyIndex.regexCache,
      timeWindows: this.config.timeWindows,
      risk,
      frequencyTracker: this.frequencyTracker,
    };
  }

  private runPipeline(ctx: EvaluationContext, startUs: number): Verdict {
    const enrichedCtx = this.crossAgentManager.enrichContext(ctx);
    this.frequencyTracker.record({
      timestamp: Date.now(),
      agentId: enrichedCtx.agentId,
      sessionKey: enrichedCtx.sessionKey,
      toolName: enrichedCtx.toolName,
    });

    const risk = this.riskAssessor.assess(enrichedCtx, this.frequencyTracker);
    const policies = this.crossAgentManager.resolveEffectivePolicies(
      enrichedCtx,
      this.policyIndex,
    );
    const evalResult = this.evaluator.evaluateWithDeps(
      enrichedCtx,
      policies,
      risk,
      this.buildDeps(risk),
    );

    const elapsedUs = nowUs() - startUs;

    // Handle "approve" effect: check trust bypass before creating verdict
    let finalAction = evalResult.action;
    let approvalConfig: Verdict["approvalConfig"] = undefined;

    if (evalResult.action === "approve") {
      const approveMatch = evalResult.matches.find(
        (m) => m.effect.action === "approve",
      );
      if (approveMatch && approveMatch.effect.action === "approve") {
        const minTrust = approveMatch.effect.minTrust ?? 0;
        // Trust bypass: if agent trust >= minTrust, auto-allow
        if (enrichedCtx.trust.agent.score >= minTrust && minTrust > 0) {
          finalAction = "allow";
          this.logger.info(
            `[governance] Approval bypassed for ${enrichedCtx.agentId} (trust ${enrichedCtx.trust.agent.score} >= minTrust ${minTrust})`,
          );
        } else {
          approvalConfig = {
            timeoutSeconds: approveMatch.effect.timeoutSeconds ?? this.config.approvalManager?.defaultTimeoutSeconds ?? 300,
            defaultAction: approveMatch.effect.defaultAction ?? this.config.approvalManager?.defaultAction ?? "deny",
          };
        }
      }
    }

    const verdict: Verdict = {
      action: finalAction,
      reason: evalResult.reason,
      risk,
      matchedPolicies: evalResult.matches,
      trust: {
        score: enrichedCtx.trust.session.score,
        tier: enrichedCtx.trust.session.tier,
      },
      evaluationUs: elapsedUs,
      approvalConfig,
    };

    // Trust learning from governance denial
    // Skip violation recording for time-based policy blocks (e.g. night mode)
    // — timer-triggered agents can't control when they run, penalizing them
    // creates an unrecoverable trust death spiral.
    if (verdict.action === "deny" && this.config.trust.enabled) {
      const isTimeBasedDeny = evalResult.matches.some(
        (m) => m.policyId === "builtin-night-mode",
      );
      if (!isTimeBasedDeny) {
        this.trustManager.recordViolation(
          enrichedCtx.agentId,
          `Policy denial: ${verdict.reason}`,
        );
        this.sessionTrustManager.applySignal(
          enrichedCtx.sessionKey,
          enrichedCtx.agentId,
          "policyBlock",
        );
      }
    }

    this.recordAudit(enrichedCtx, verdict, risk, elapsedUs);
    return verdict;
  }

  private recordAudit(
    ctx: EvaluationContext,
    verdict: Verdict,
    risk: { level: RiskLevel; score: number },
    elapsedUs: number,
  ): void {
    if (!this.config.audit.enabled) return;
    const auditCtx: AuditContext = {
      hook: ctx.hook,
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      channel: ctx.channel,
      toolName: ctx.toolName,
      toolParams: ctx.toolParams,
      messageContent: ctx.messageContent,
      messageTo: ctx.messageTo,
      crossAgent: ctx.crossAgent,
    };
    this.auditTrail.record(
      verdict.action as AuditVerdict,
      verdict.reason,
      auditCtx,
      {
        score: ctx.trust.session.score,
        tier: ctx.trust.session.tier,
      },
      { level: risk.level, score: risk.score },
      verdict.matchedPolicies,
      elapsedUs,
    );
  }

  private handleEvalError(
    e: unknown,
    ctx: EvaluationContext,
    startUs: number,
  ): Verdict {
    const elapsedUs = nowUs() - startUs;
    this.stats.errorCount++;
    this.logger.error(
      `[governance] Evaluation error: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    const fallback = this.config.failMode === "closed" ? "deny" : "allow";
    const reason =
      fallback === "deny"
        ? "Governance engine error (fail-closed)"
        : "Governance engine error (fail-open)";

    if (this.config.audit.enabled) {
      this.auditTrail.record(
        "error_fallback",
        reason,
        {
          hook: ctx.hook,
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          toolName: ctx.toolName,
        },
        {
          score: ctx.trust.session.score,
          tier: ctx.trust.session.tier,
        },
        { level: "critical", score: 100 },
        [],
        elapsedUs,
      );
    }

    return {
      action: fallback,
      reason,
      risk: { level: "critical", score: 100, factors: [] },
      matchedPolicies: [],
      trust: {
        score: ctx.trust.session.score,
        tier: ctx.trust.session.tier,
      },
      evaluationUs: elapsedUs,
    };
  }

  /**
   * Set the LLM validator for Stage 3 external communication validation.
   */
  setLlmValidator(validator: unknown): void {
    // Delegate to output validator — import type avoidance
    this.outputValidator.setLlmValidator(
      validator as Parameters<OutputValidator["setLlmValidator"]>[0],
    );
  }

  /**
   * Validate agent output text against fact registries.
   * Synchronous for Stage 1+2. Async when isExternal triggers Stage 3.
   * Used by before_message_write and message_sending hooks.
   */
  validateOutput(
    text: string,
    agentId: string,
    opts?: { isExternal?: boolean },
  ): OutputValidationResult | Promise<OutputValidationResult> {
    if (!this.config.outputValidation.enabled) {
      return {
        verdict: "pass",
        claims: [],
        factCheckResults: [],
        contradictions: [],
        reason: "Output validation disabled",
        evaluationUs: 0,
      };
    }

    const trust = this.trustManager.getAgentTrust(agentId);
    const resultOrPromise = this.outputValidator.validate(
      text,
      trust.score,
      opts?.isExternal,
    );

    const recordAudit = (
      result: OutputValidationResult,
    ): OutputValidationResult => {
      if (this.config.audit.enabled) {
        const auditVerdict =
          `output_${result.verdict}` as "output_pass" | "output_flag" | "output_block";
        this.auditTrail.record(
          auditVerdict,
          result.reason,
          {
            hook: "output_validation",
            agentId,
            sessionKey: `agent:${agentId}`,
            messageContent:
              text.length > 200 ? text.substring(0, 200) + "..." : text,
          },
          { score: trust.score, tier: trust.tier },
          { level: "low", score: 0 },
          [],
          result.evaluationUs,
        );
      }
      return result;
    };

    if (resultOrPromise instanceof Promise) {
      return resultOrPromise.then(recordAudit);
    }

    return recordAudit(resultOrPromise);
  }

  recordOutcome(
    agentId: string,
    sessionId: string,
    success: boolean,
  ): void {
    if (!this.config.trust.enabled) return;

    if (success) {
      this.trustManager.recordSuccess(agentId);
      this.sessionTrustManager.applySignal(sessionId, agentId, "success");
    } else {
      // Non-policy-related failures do not currently impact session trust.
      // This could be a new signal type in the future.
      this.trustManager.recordViolation(agentId);
    }
  }

  handleSessionStart(sessionId: string, agentId: string): void {
    this.sessionTrustManager.initializeSession(sessionId, agentId);
  }

  handleSessionEnd(sessionId: string): void {
    this.sessionTrustManager.destroySession(sessionId);
  }

  registerSubAgent(
    parentSessionKey: string,
    childSessionKey: string,
  ): void {
    this.crossAgentManager.registerRelationship(
      parentSessionKey,
      childSessionKey,
    );
  }

  getStatus(): GovernanceStatus {
    let policyCount = 0;
    const counted = new Set<string>();
    for (const policies of this.policyIndex.byHook.values()) {
      for (const p of policies) {
        if (!counted.has(p.id)) {
          counted.add(p.id);
          policyCount++;
        }
      }
    }

    return {
      enabled: this.config.enabled,
      policyCount,
      trustEnabled: this.config.trust.enabled,
      auditEnabled: this.config.audit.enabled,
      failMode: this.config.failMode,
      stats: { ...this.stats },
    };
  }

  getTrust(
    agentId: string,
    sessionId?: string,
  ): { agent: AgentTrust; session: SessionTrust };
  getTrust(): TrustStore;
  getTrust(
    agentId?: string,
    sessionId?: string,
  ): { agent: AgentTrust; session: SessionTrust } | TrustStore {
    if (agentId && sessionId) {
      const agent = this.trustManager.getAgentTrust(agentId);
      const session = this.sessionTrustManager.getSessionTrust(
        sessionId,
        agentId,
      );
      return { agent, session };
    }
    if (agentId && !sessionId) {
      // This case is ambiguous now. For backward compatibility of the CLI/API,
      // just return agent trust. The core system should always pass both IDs.
      this.logger.warn(
        `[governance] getTrust called with only agentId. Returning agent trust only.`,
      );
      const agent = this.trustManager.getAgentTrust(agentId);
      // Create a dummy session trust for type compatibility
      const session = {
        sessionId: "unknown",
        agentId: agent.agentId,
        score: agent.score,
        tier: agent.tier,
        cleanStreak: 0,
        createdAt: 0,
      };
      return { agent, session };
    }
    return this.trustManager.getStore();
  }

  setTrust(agentId: string, score: number): void {
    this.trustManager.setScore(agentId, score);
  }

  setTrustScore(agentId: string, score: number): void {
    this.trustManager.setScore(agentId, score);
  }

  resetAgentTrust(agentId: string, defaultScore: number): void {
    this.trustManager.resetHistory(agentId);
    this.trustManager.setScore(agentId, defaultScore);
  }

  /** Get a read-only snapshot of all active session trust entries. */
  getSessionTrustMap(): ReadonlyMap<string, SessionTrust> {
    return this.sessionTrustManager._getSessions();
  }

  /** Expose audit trail query for dashboard/commands (RFC-010) */
  queryAudit(filter: AuditFilter): AuditRecord[] {
    return this.auditTrail.query(filter);
  }

  /** Expose config for dashboard shield-score calculation (RFC-010) */
  getConfig(): GovernanceConfig {
    return this.config;
  }

  /** Expose workspace path for dashboard state persistence (RFC-010) */
  getWorkspace(): string {
    return this.workspace;
  }

  private updateStats(action: "allow" | "deny" | "approve", us: number): void {
    this.stats.totalEvaluations++;
    if (action === "allow") this.stats.allowCount++;
    else if (action === "deny") this.stats.denyCount++;
    // "approve" counts as neither allow nor deny until resolved

    // Running average
    this.stats.avgEvaluationUs =
      (this.stats.avgEvaluationUs * (this.stats.totalEvaluations - 1) + us) /
      this.stats.totalEvaluations;
  }
}

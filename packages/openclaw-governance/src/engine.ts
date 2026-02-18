import type {
  AuditContext,
  AuditVerdict,
  AgentTrust,
  ConditionDeps,
  EvaluationContext,
  EvaluationStats,
  GovernanceConfig,
  GovernanceStatus,
  PluginLogger,
  PolicyIndex,
  RiskAssessment,
  RiskLevel,
  TrustStore,
  Verdict,
} from "./types.js";
import { buildPolicyIndex, loadPolicies } from "./policy-loader.js";
import { PolicyEvaluator } from "./policy-evaluator.js";
import { createConditionEvaluators } from "./conditions/index.js";
import { RiskAssessor } from "./risk-assessor.js";
import { TrustManager } from "./trust-manager.js";
import { CrossAgentManager } from "./cross-agent.js";
import { AuditTrail } from "./audit-trail.js";
import { FrequencyTrackerImpl } from "./frequency-tracker.js";
import { nowUs } from "./util.js";

export class GovernanceEngine {
  private readonly config: GovernanceConfig;
  private readonly logger: PluginLogger;
  private policyIndex: PolicyIndex;
  private readonly evaluator: PolicyEvaluator;
  private readonly riskAssessor: RiskAssessor;
  private readonly trustManager: TrustManager;
  private readonly crossAgentManager: CrossAgentManager;
  private readonly auditTrail: AuditTrail;
  private readonly frequencyTracker: FrequencyTrackerImpl;
  private readonly stats: EvaluationStats;
  private workspace: string;

  constructor(
    config: GovernanceConfig,
    logger: PluginLogger,
    workspace?: string,
  ) {
    this.config = config;
    this.logger = logger;
    this.workspace =
      workspace ?? `${process.env["HOME"] ?? "/tmp"}/.openclaw/plugins/openclaw-governance`;

    const conditionEvaluators = createConditionEvaluators();
    this.evaluator = new PolicyEvaluator(conditionEvaluators);
    this.riskAssessor = new RiskAssessor(config.toolRiskOverrides);
    this.trustManager = new TrustManager(
      config.trust,
      this.workspace,
      logger,
    );
    this.crossAgentManager = new CrossAgentManager(this.trustManager, logger);
    this.auditTrail = new AuditTrail(config.audit, this.workspace, logger);
    this.frequencyTracker = new FrequencyTrackerImpl(
      config.performance.frequencyBufferSize,
    );
    this.policyIndex = { byHook: new Map(), byAgent: new Map(), regexCache: new Map() };
    this.stats = {
      totalEvaluations: 0,
      allowCount: 0,
      denyCount: 0,
      errorCount: 0,
      avgEvaluationUs: 0,
    };
  }

  async start(): Promise<void> {
    const allPolicies = loadPolicies(
      this.config.policies,
      this.config.builtinPolicies,
      this.logger,
    );
    this.policyIndex = buildPolicyIndex(allPolicies);

    this.trustManager.load();
    this.auditTrail.load();
    this.frequencyTracker.clear();

    this.trustManager.startPersistence();
    this.auditTrail.startAutoFlush();

    this.logger.info(
      `[governance] Engine started: ${allPolicies.length} policies loaded`,
    );
  }

  async stop(): Promise<void> {
    try { this.trustManager.stopPersistence(); } catch (e) {
      this.logger.error(`[governance] Error stopping trust persistence: ${e instanceof Error ? e.message : String(e)}`);
    }
    try { this.auditTrail.stopAutoFlush(); } catch (e) {
      this.logger.error(`[governance] Error stopping audit flush: ${e instanceof Error ? e.message : String(e)}`);
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
      enrichedCtx, this.policyIndex,
    );
    const evalResult = this.evaluator.evaluateWithDeps(
      enrichedCtx, policies, risk, this.buildDeps(risk),
    );

    const elapsedUs = nowUs() - startUs;
    const verdict: Verdict = {
      action: evalResult.action, reason: evalResult.reason, risk,
      matchedPolicies: evalResult.matches,
      trust: enrichedCtx.trust, evaluationUs: elapsedUs,
    };

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
      auditCtx, verdict.trust,
      { level: risk.level, score: risk.score },
      verdict.matchedPolicies, elapsedUs,
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
      `[governance] Evaluation error: ${e instanceof Error ? e.message : String(e)}`,
    );
    const fallback = this.config.failMode === "closed" ? "deny" : "allow";

    if (this.config.audit.enabled) {
      this.auditTrail.record(
        "error_fallback",
        { hook: ctx.hook, agentId: ctx.agentId, sessionKey: ctx.sessionKey, toolName: ctx.toolName },
        ctx.trust, { level: "critical", score: 100 }, [], elapsedUs,
      );
    }

    return {
      action: fallback,
      reason: fallback === "deny"
        ? "Governance engine error (fail-closed)"
        : "Governance engine error (fail-open)",
      risk: { level: "critical", score: 100, factors: [] },
      matchedPolicies: [],
      trust: ctx.trust,
      evaluationUs: elapsedUs,
    };
  }

  recordOutcome(
    agentId: string,
    _toolName: string,
    success: boolean,
  ): void {
    if (!this.config.trust.enabled) return;
    if (success) {
      this.trustManager.recordSuccess(agentId);
    } else {
      this.trustManager.recordViolation(agentId);
    }
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

  getTrust(agentId?: string): AgentTrust | TrustStore {
    if (agentId) return this.trustManager.getAgentTrust(agentId);
    return this.trustManager.getStore();
  }

  setTrust(agentId: string, score: number): void {
    this.trustManager.setScore(agentId, score);
  }

  private updateStats(action: "allow" | "deny", us: number): void {
    this.stats.totalEvaluations++;
    if (action === "allow") this.stats.allowCount++;
    else this.stats.denyCount++;

    // Running average
    this.stats.avgEvaluationUs =
      (this.stats.avgEvaluationUs * (this.stats.totalEvaluations - 1) + us) /
      this.stats.totalEvaluations;
  }
}

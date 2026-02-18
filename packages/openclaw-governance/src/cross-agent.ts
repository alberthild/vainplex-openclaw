import type {
  AgentGraph,
  AgentRelationship,
  EvaluationContext,
  PluginLogger,
  Policy,
  PolicyIndex,
} from "./types.js";
import type { TrustManager } from "./trust-manager.js";
import {
  extractAgentId,
  extractParentSessionKey,
  isSubAgent,
  scoreToTier,
} from "./util.js";

export class CrossAgentManager {
  private readonly graph: AgentGraph;
  private readonly trustManager: TrustManager;
  private readonly logger: PluginLogger;

  constructor(trustManager: TrustManager, logger: PluginLogger) {
    this.graph = { relationships: new Map() };
    this.trustManager = trustManager;
    this.logger = logger;
  }

  registerRelationship(
    parentSessionKey: string,
    childSessionKey: string,
  ): void {
    const parentAgentId = extractAgentId(parentSessionKey);
    const childAgentId = extractAgentId(childSessionKey);

    const rel: AgentRelationship = {
      parentAgentId,
      parentSessionKey,
      childAgentId,
      childSessionKey,
      createdAt: Date.now(),
    };

    this.graph.relationships.set(childSessionKey, rel);
    this.logger.info(
      `[governance] Registered sub-agent: ${childAgentId} → parent ${parentAgentId}`,
    );
  }

  removeRelationship(childSessionKey: string): void {
    this.graph.relationships.delete(childSessionKey);
  }

  getParent(childSessionKey: string): AgentRelationship | null {
    // First check explicit registrations
    const explicit = this.graph.relationships.get(childSessionKey);
    if (explicit) return explicit;

    // Fall back to session key parsing
    if (!isSubAgent(childSessionKey)) return null;

    const parentKey = extractParentSessionKey(childSessionKey);
    if (!parentKey) return null;

    return {
      parentAgentId: extractAgentId(parentKey),
      parentSessionKey: parentKey,
      childAgentId: extractAgentId(childSessionKey),
      childSessionKey,
      createdAt: 0,
    };
  }

  getChildren(parentSessionKey: string): AgentRelationship[] {
    const children: AgentRelationship[] = [];
    for (const rel of this.graph.relationships.values()) {
      if (rel.parentSessionKey === parentSessionKey) {
        children.push(rel);
      }
    }
    return children;
  }

  enrichContext(ctx: EvaluationContext): EvaluationContext {
    const parent = this.getParent(ctx.sessionKey);
    if (!parent) return ctx;

    const ceiling = this.computeTrustCeiling(ctx.sessionKey);
    const cappedScore = Math.min(ctx.trust.score, ceiling);
    const cappedTier = scoreToTier(cappedScore);

    // Collect inherited policy IDs (we'll resolve them later)
    const inheritedPolicyIds = this.getInheritedPolicyIds(parent);

    return {
      ...ctx,
      trust: { score: cappedScore, tier: cappedTier },
      crossAgent: {
        parentAgentId: parent.parentAgentId,
        parentSessionKey: parent.parentSessionKey,
        inheritedPolicyIds,
        trustCeiling: ceiling,
      },
    };
  }

  resolveEffectivePolicies(
    ctx: EvaluationContext,
    index: PolicyIndex,
  ): Policy[] {
    // Collect own policies
    const ownPolicies = this.collectAgentPolicies(ctx.agentId, ctx.hook, index);

    const parent = this.getParent(ctx.sessionKey);
    if (!parent) return ownPolicies;

    // Collect parent policies (1-level only)
    const parentPolicies = this.collectAgentPolicies(
      parent.parentAgentId,
      ctx.hook,
      index,
    );

    // Merge with deduplication by policy ID
    return this.mergePolicies(ownPolicies, parentPolicies);
  }

  computeTrustCeiling(sessionKey: string): number {
    const parent = this.getParent(sessionKey);
    if (!parent) return Infinity;

    const parentTrust = this.trustManager.getAgentTrust(
      parent.parentAgentId,
    );
    return parentTrust.score;
  }

  getGraphSummary(): {
    agentCount: number;
    relationships: AgentRelationship[];
  } {
    return {
      agentCount: this.graph.relationships.size,
      relationships: [...this.graph.relationships.values()],
    };
  }

  private getInheritedPolicyIds(
    parent: AgentRelationship,
  ): string[] {
    // We don't have the index here, so just record the parent info
    return [`inherited-from:${parent.parentAgentId}`];
  }

  private collectAgentPolicies(
    agentId: string,
    hook: string,
    index: PolicyIndex,
  ): Policy[] {
    const result: Policy[] = [];
    const seen = new Set<string>();

    // Agent-specific policies
    const agentPolicies = index.byAgent.get(agentId) ?? [];
    for (const p of agentPolicies) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        result.push(p);
      }
    }

    // Global policies
    const globalPolicies = index.byAgent.get("*") ?? [];
    for (const p of globalPolicies) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        result.push(p);
      }
    }

    // Filter by hook
    const hookPolicies = index.byHook.get(
      hook as EvaluationContext["hook"],
    );
    if (hookPolicies) {
      const hookIds = new Set(hookPolicies.map((p) => p.id));
      return result.filter((p) => hookIds.has(p.id));
    }

    return result;
  }

  private mergePolicies(
    own: Policy[],
    parent: Policy[],
  ): Policy[] {
    const merged = [...own];
    const seenIds = new Set(own.map((p) => p.id));

    for (const p of parent) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push(p);
      }
    }

    return merged;
  }
}

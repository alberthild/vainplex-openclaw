import type {
  EvaluationContext,
  FrequencyTracker,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from "./types.js";
import { clamp } from "./util.js";

const DEFAULT_TOOL_RISK: Record<string, number> = {
  gateway: 95, cron: 90, elevated: 95,
  exec: 70, write: 65, edit: 60,
  sessions_spawn: 45, sessions_send: 50,
  browser: 40, message: 40,
  read: 10, memory_search: 5, memory_get: 5,
  web_search: 15, web_fetch: 20, image: 10, canvas: 15,
};

function lookupToolRisk(
  toolName: string | undefined,
  overrides: Record<string, number>,
): number {
  if (!toolName) return 30;
  const override = overrides[toolName];
  if (override !== undefined) return override;
  return DEFAULT_TOOL_RISK[toolName] ?? 30;
}

function isExternalTarget(ctx: EvaluationContext): boolean {
  if (ctx.messageTo) return true;
  if (!ctx.toolParams) return false;
  const host = ctx.toolParams["host"];
  if (typeof host === "string" && host !== "sandbox") return true;
  return ctx.toolParams["elevated"] === true;
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

export class RiskAssessor {
  private readonly overrides: Record<string, number>;

  constructor(toolRiskOverrides: Record<string, number>) {
    this.overrides = toolRiskOverrides;
  }

  assess(
    ctx: EvaluationContext,
    frequencyTracker: FrequencyTracker,
  ): RiskAssessment {
    const factors = this.computeFactors(ctx, frequencyTracker);
    const total = clamp(
      factors.reduce((sum, f) => sum + f.value, 0), 0, 100,
    );
    return { level: scoreToRiskLevel(total), score: Math.round(total), factors };
  }

  private computeFactors(
    ctx: EvaluationContext,
    frequencyTracker: FrequencyTracker,
  ): RiskFactor[] {
    const toolRaw = lookupToolRisk(ctx.toolName, this.overrides);
    const isOff = ctx.time.hour < 8 || ctx.time.hour >= 23;
    const recentCount = frequencyTracker.count(
      60, "agent", ctx.agentId, ctx.sessionKey,
    );

    return [
      {
        name: "tool_sensitivity", weight: 30,
        value: (toolRaw / 100) * 30,
        description: `Tool ${ctx.toolName ?? "unknown"} risk=${toolRaw}`,
      },
      {
        name: "time_of_day", weight: 15,
        value: isOff ? 15 : 0,
        description: isOff ? "Off-hours operation" : "Business hours",
      },
      {
        name: "trust_deficit", weight: 20,
        value: ((100 - ctx.trust.score) / 100) * 20,
        description: `Trust score ${ctx.trust.score}/100`,
      },
      {
        name: "frequency", weight: 15,
        value: Math.min(recentCount / 20, 1) * 15,
        description: `${recentCount} actions in last 60s`,
      },
      {
        name: "target_scope", weight: 20,
        value: isExternalTarget(ctx) ? 20 : 0,
        description: isExternalTarget(ctx) ? "External target" : "Internal target",
      },
    ];
  }
}

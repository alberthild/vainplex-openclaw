import { readFileSync, existsSync } from "node:fs";
import type { SitrepConfig, OpenClawPluginApi, SitrepReport } from "./types.js";
import { generateSitrep } from "./aggregator.js";
import { writeSitrep } from "./output.js";

/**
 * Register plugin hooks for sitrep integration.
 */
export function registerSitrepHooks(api: OpenClawPluginApi, config: SitrepConfig): void {
  const logger = api.logger;

  // Command: /sitrep — show latest report
  api.registerCommand({
    name: "sitrep",
    description: "Show latest situation report",
    requireAuth: true,
    handler: (params) => {
      const sub = typeof params?.["sub"] === "string" ? params["sub"] : "";

      if (sub === "refresh") {
        // Force regenerate
        generateSitrep(config, logger)
          .then((report) => writeSitrep(report, config.outputPath, config.previousPath, logger))
          .catch((err) => logger.error(`[sitrep] Refresh failed: ${err}`, err as Error));
        return { text: "🔄 Sitrep refresh started." };
      }

      if (sub === "collectors") {
        try {
          const report = loadLatestReport(config.outputPath);
          if (!report) return { text: "No sitrep available yet. Run `/sitrep refresh`." };

          const lines = Object.entries(report.collectors).map(
            ([name, info]) => `  ${info.status === "ok" ? "✅" : info.status === "error" ? "❌" : "⚠️"} ${name}: ${info.status} (${info.duration_ms}ms)`,
          );
          return { text: `**Collectors:**\n${lines.join("\n")}` };
        } catch {
          return { text: "Failed to read sitrep." };
        }
      }

      // Default: show summary
      try {
        const report = loadLatestReport(config.outputPath);
        if (!report) return { text: "No sitrep available yet. Run `/sitrep refresh`." };

        const health = report.health.overall === "ok" ? "🟢" : report.health.overall === "warn" ? "🟡" : "🔴";
        const lines = [
          `**📋 Situation Report** — ${report.generated}`,
          `${health} Overall: **${report.health.overall.toUpperCase()}**`,
          "",
          report.summary,
          "",
          `Items: ${report.items.length} total | ${report.categories.needs_owner.length} need attention | ${report.categories.auto_fixable.length} auto-fixable`,
          `Delta: +${report.delta.new_items} new, -${report.delta.resolved_items} resolved`,
        ];

        // Show top 5 items
        if (report.items.length > 0) {
          lines.push("", "**Top items:**");
          for (const item of report.items.slice(0, 5)) {
            const icon = item.severity === "critical" ? "🔴" : item.severity === "warn" ? "🟡" : "ℹ️";
            lines.push(`  ${icon} ${item.title}`);
          }
        }

        return { text: lines.join("\n") };
      } catch {
        return { text: "Failed to read sitrep." };
      }
    },
  });
}

function loadLatestReport(path: string): SitrepReport | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as SitrepReport;
  } catch {
    return null;
  }
}

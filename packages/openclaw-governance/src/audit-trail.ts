import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AuditConfig,
  AuditContext,
  AuditFilter,
  AuditRecord,
  AuditStats,
  AuditVerdict,
  MatchedPolicy,
  PluginLogger,
  RiskLevel,
  TrustTier,
} from "./types.js";
import { createRedactor } from "./audit-redactor.js";

const ISO_CONTROLS_MAP: Record<string, string[]> = {
  before_tool_call: ["A.8.3", "A.8.5"],
  message_sending: ["A.5.14"],
  trust_adjustment: ["A.5.15", "A.8.2"],
  violation: ["A.5.24", "A.5.28"],
  config_change: ["A.8.9"],
};

function getControls(hook: string, verdict: AuditVerdict): string[] {
  const controls = ISO_CONTROLS_MAP[hook] ?? [];
  if (verdict === "deny") {
    return [...controls, "A.5.24", "A.5.28"];
  }
  return controls;
}

function dateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class AuditTrail {
  private readonly config: AuditConfig;
  private readonly auditDir: string;
  private readonly logger: PluginLogger;
  private readonly redact: (ctx: AuditContext) => AuditContext;
  private buffer: AuditRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private todayRecordCount = 0;

  constructor(
    config: AuditConfig,
    workspace: string,
    logger: PluginLogger,
  ) {
    this.config = config;
    this.auditDir = join(workspace, "governance", "audit");
    this.logger = logger;
    this.redact = createRedactor(config.redactPatterns);
  }

  load(): void {
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
    this.cleanOldFiles();
    this.countTodayRecords();
    this.logger.info("[governance] Audit trail loaded");
  }

  record(
    verdict: AuditVerdict,
    context: AuditContext,
    trust: { score: number; tier: TrustTier },
    risk: { level: RiskLevel; score: number },
    matchedPolicies: MatchedPolicy[],
    evaluationUs: number,
  ): AuditRecord {
    const now = Date.now();
    const redacted = this.redact(context);

    const rec: AuditRecord = {
      id: randomUUID(),
      timestamp: now,
      timestampIso: new Date(now).toISOString(),
      verdict,
      context: redacted,
      trust,
      risk,
      matchedPolicies,
      evaluationUs,
      controls: [...new Set(getControls(context.hook, verdict))],
    };

    this.buffer.push(rec);
    this.todayRecordCount++;

    if (this.buffer.length >= 100) {
      this.flush();
    }

    return rec;
  }

  query(filter: AuditFilter): AuditRecord[] {
    const results: AuditRecord[] = [];
    const limit = filter.limit ?? 100;

    if (!existsSync(this.auditDir)) return results;

    const files = readdirSync(this.auditDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    for (const file of files) {
      const content = readFileSync(join(this.auditDir, file), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines.reverse()) {
        try {
          const rec = JSON.parse(line) as AuditRecord;
          if (matchesFilter(rec, filter)) {
            results.push(rec);
            if (results.length >= limit) return results;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Also include buffered records
    for (const rec of [...this.buffer].reverse()) {
      if (matchesFilter(rec, filter)) {
        results.push(rec);
        if (results.length >= limit) return results;
      }
    }

    return results;
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }

    const groups = new Map<string, AuditRecord[]>();
    for (const rec of this.buffer) {
      const day = dateStr(rec.timestamp);
      const list = groups.get(day) ?? [];
      list.push(rec);
      groups.set(day, list);
    }

    for (const [day, records] of groups) {
      const filePath = join(this.auditDir, `${day}.jsonl`);
      const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      try {
        appendFileSync(filePath, lines);
      } catch (e) {
        this.logger.error(
          `[governance] Failed to write audit: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    this.buffer = [];
  }

  startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), 1000);
    this.flushTimer.unref();
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  getStats(): AuditStats {
    const files = existsSync(this.auditDir)
      ? readdirSync(this.auditDir)
          .filter((f) => f.endsWith(".jsonl"))
          .sort()
      : [];

    return {
      totalRecords: this.todayRecordCount,
      todayRecords: this.todayRecordCount,
      oldestRecord: files[0]?.replace(".jsonl", ""),
      newestRecord: files[files.length - 1]?.replace(".jsonl", ""),
    };
  }

  private cleanOldFiles(): void {
    if (!existsSync(this.auditDir)) return;

    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(this.auditDir).filter((f) =>
      f.endsWith(".jsonl"),
    );

    for (const file of files) {
      const dateStr = file.replace(".jsonl", "");
      const fileDate = new Date(dateStr).getTime();
      if (!Number.isNaN(fileDate) && fileDate < cutoff) {
        try {
          unlinkSync(join(this.auditDir, file));
          this.logger.info(`[governance] Cleaned old audit file: ${file}`);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  private countTodayRecords(): void {
    const today = dateStr(Date.now());
    const filePath = join(this.auditDir, `${today}.jsonl`);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      this.todayRecordCount = content.trim().split("\n").filter(Boolean).length;
    }
  }
}

function matchesFilter(rec: AuditRecord, filter: AuditFilter): boolean {
  if (filter.agentId && rec.context.agentId !== filter.agentId) return false;
  if (filter.verdict && rec.verdict !== filter.verdict) return false;
  if (filter.after && rec.timestamp < filter.after) return false;
  if (filter.before && rec.timestamp > filter.before) return false;
  return true;
}

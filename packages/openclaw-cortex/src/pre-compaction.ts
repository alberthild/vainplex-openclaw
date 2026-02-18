import { join } from "node:path";
import type {
  CompactingMessage,
  PreCompactionResult,
  PluginLogger,
  CortexConfig,
} from "./types.js";
import { ThreadTracker } from "./thread-tracker.js";
import { NarrativeGenerator } from "./narrative-generator.js";
import { BootContextGenerator } from "./boot-context.js";
import { saveText, rebootDir, ensureRebootDir } from "./storage.js";

/**
 * Build a hot snapshot markdown from compacting messages.
 */
export function buildHotSnapshot(
  messages: CompactingMessage[],
  maxMessages: number,
): string {
  const now = new Date().toISOString().slice(0, 19) + "Z";
  const parts: string[] = [
    `# Hot Snapshot — ${now}`,
    "## Last conversation before compaction",
    "",
  ];

  const recent = messages.slice(-maxMessages);
  if (recent.length > 0) {
    parts.push("**Recent messages:**");
    for (const msg of recent) {
      const content = msg.content.trim();
      const short = content.length > 200 ? content.slice(0, 200) + "..." : content;
      parts.push(`- [${msg.role}] ${short}`);
    }
  } else {
    parts.push("(No recent messages captured)");
  }

  parts.push("");
  return parts.join("\n");
}

/**
 * Pre-Compaction Pipeline — orchestrates all modules before memory compaction.
 */
export class PreCompaction {
  private readonly workspace: string;
  private readonly config: CortexConfig;
  private readonly logger: PluginLogger;
  private readonly threadTracker: ThreadTracker;

  constructor(
    workspace: string,
    config: CortexConfig,
    logger: PluginLogger,
    threadTracker: ThreadTracker,
  ) {
    this.workspace = workspace;
    this.config = config;
    this.logger = logger;
    this.threadTracker = threadTracker;
  }

  /**
   * Run the full pre-compaction pipeline.
   */
  run(compactingMessages?: CompactingMessage[]): PreCompactionResult {
    const warnings: string[] = [];
    const now = new Date().toISOString();
    let messagesSnapshotted = 0;

    ensureRebootDir(this.workspace, this.logger);

    // 1. Flush thread tracker state
    try {
      this.threadTracker.flush();
      this.logger.info("[cortex] Pre-compaction: thread state flushed");
    } catch (err) {
      warnings.push(`Thread flush failed: ${err}`);
      this.logger.warn(`[cortex] Pre-compaction: thread flush failed: ${err}`);
    }

    // 2. Build and write hot snapshot
    try {
      const messages = compactingMessages ?? [];
      messagesSnapshotted = Math.min(
        messages.length,
        this.config.preCompaction.maxSnapshotMessages,
      );
      const snapshot = buildHotSnapshot(
        messages,
        this.config.preCompaction.maxSnapshotMessages,
      );
      const snapshotPath = join(rebootDir(this.workspace), "hot-snapshot.md");
      const ok = saveText(snapshotPath, snapshot, this.logger);
      if (!ok) warnings.push("Hot snapshot write failed");
      this.logger.info(
        `[cortex] Pre-compaction: hot snapshot (${messagesSnapshotted} messages)`,
      );
    } catch (err) {
      warnings.push(`Hot snapshot failed: ${err}`);
      this.logger.warn(`[cortex] Pre-compaction: hot snapshot failed: ${err}`);
    }

    // 3. Generate narrative
    try {
      if (this.config.narrative.enabled) {
        const narrative = new NarrativeGenerator(this.workspace, this.logger);
        narrative.write();
        this.logger.info("[cortex] Pre-compaction: narrative generated");
      }
    } catch (err) {
      warnings.push(`Narrative generation failed: ${err}`);
      this.logger.warn(
        `[cortex] Pre-compaction: narrative generation failed: ${err}`,
      );
    }

    // 4. Generate boot context
    try {
      if (this.config.bootContext.enabled) {
        const boot = new BootContextGenerator(
          this.workspace,
          this.config.bootContext,
          this.logger,
        );
        boot.write();
        this.logger.info("[cortex] Pre-compaction: boot context generated");
      }
    } catch (err) {
      warnings.push(`Boot context generation failed: ${err}`);
      this.logger.warn(
        `[cortex] Pre-compaction: boot context generation failed: ${err}`,
      );
    }

    return {
      success: warnings.length === 0,
      timestamp: now,
      messagesSnapshotted,
      warnings,
    };
  }
}

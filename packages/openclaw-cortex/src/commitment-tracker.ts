import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Commitment, CommitmentsData, PluginLogger } from "./types.js";
import { loadJson, saveJson, rebootDir } from "./storage.js";
import { detectCommitments } from "./commitment-patterns.js";

const OVERDUE_DAYS = 7;
const SAVE_DEBOUNCE_MS = 15_000;

function commitmentsPath(workspace: string): string {
  return join(rebootDir(workspace), "commitments.json");
}

/** Load commitments from disk. */
export function loadCommitments(workspace: string): Commitment[] {
  const data = loadJson<Partial<CommitmentsData>>(commitmentsPath(workspace));
  return data.commitments ?? [];
}

/** Save commitments to disk. */
export function saveCommitments(
  workspace: string, commitments: Commitment[], logger: PluginLogger,
): boolean {
  const data: CommitmentsData = {
    version: 1,
    updated: new Date().toISOString(),
    commitments,
  };
  return saveJson(commitmentsPath(workspace), data, logger);
}

/** Mark overdue commitments (open + older than OVERDUE_DAYS). */
export function markOverdue(commitments: Commitment[]): Commitment[] {
  const cutoff = Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000;
  return commitments.map((c) => {
    if (c.status === "open" && new Date(c.created).getTime() < cutoff) {
      return { ...c, status: "overdue" as const };
    }
    return c;
  });
}

/** In-memory commitment tracker with debounced saves. */
export class CommitmentTracker {
  private commitments: Commitment[];
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly workspace: string,
    private readonly logger: PluginLogger,
  ) {
    this.commitments = loadCommitments(workspace);
  }

  /** Process a message for commitment detection. */
  processMessage(text: string, who: string): Commitment[] {
    const matches = detectCommitments(text);
    if (matches.length === 0) return [];

    const seen = new Set<string>();
    const newCommitments: Commitment[] = [];
    for (const match of matches) {
      const regexMatch = match.pattern.exec(text);
      const what = regexMatch?.[1]?.trim() || regexMatch?.[0]?.trim() || text.slice(0, 200);
      if (seen.has(what)) continue;
      seen.add(what);
      newCommitments.push({
        id: randomUUID(),
        what,
        who,
        status: "open" as const,
        created: new Date().toISOString(),
        source_message: text.slice(0, 500),
      });
    }

    this.commitments.push(...newCommitments);
    this.scheduleSave();
    return newCommitments;
  }

  /** Get all commitments (with overdue marking). */
  getAll(): Commitment[] {
    return markOverdue(this.commitments);
  }

  /** Flush pending saves to disk. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.dirty) {
      this.commitments = markOverdue(this.commitments);
      saveCommitments(this.workspace, this.commitments, this.logger);
      this.dirty = false;
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }
}

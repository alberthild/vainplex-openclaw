/**
 * Trace-to-Facts Bridge — RFC-006
 *
 * Reads trace report JSON files (from Cortex or any analyzer)
 * and extracts factCorrection fields into Fact objects.
 * Writes to an external fact registry JSON file for the
 * FactRegistry file loader to consume.
 *
 * No direct dependency on Cortex internals — only reads standard
 * TraceFinding JSON format (RFC-006 §8.2).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Fact, PluginLogger, TraceFinding } from "./types.js";

/** Fact registry file format (RFC-006 §8.3) */
type FactRegistryFile = {
  id: string;
  generatedAt: string;
  facts: Fact[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Make a deduplication key for a fact.
 */
function factKey(subject: string, predicate: string): string {
  return `${subject.toLowerCase()}|${predicate.toLowerCase()}`;
}

export class TraceToFactsBridge {
  private readonly logger: PluginLogger;
  private readonly outputPath: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(outputPath: string, logger: PluginLogger) {
    this.outputPath = outputPath;
    this.logger = logger;
  }

  /**
   * Process a trace report file and extract facts from findings
   * with factCorrection fields.
   */
  extractFactsFromFile(filePath: string): Fact[] {
    try {
      if (!existsSync(filePath)) {
        this.logger.warn(`[governance] Trace report not found: ${filePath}`);
        return [];
      }

      const raw = readFileSync(filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      return this.extractFactsFromParsed(parsed);
    } catch (e) {
      this.logger.warn(
        `[governance] Failed to read trace report ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  /**
   * Extract facts from a parsed trace report object.
   * Accepts both `{ findings: [...] }` and direct `[...]` array format.
   */
  extractFactsFromParsed(parsed: unknown): Fact[] {
    let findings: unknown[];

    if (Array.isArray(parsed)) {
      findings = parsed;
    } else if (isRecord(parsed) && Array.isArray(parsed["findings"])) {
      findings = parsed["findings"];
    } else {
      this.logger.warn("[governance] Trace report has unexpected format");
      return [];
    }

    const facts: Fact[] = [];

    for (const item of findings) {
      if (!isRecord(item)) continue;

      const finding = item as unknown as TraceFinding;
      if (!finding.factCorrection) continue;

      const { subject, actual, predicate } = finding.factCorrection;
      if (!subject || !actual) continue;

      facts.push({
        subject,
        predicate: predicate ?? "value",
        value: actual,
        source: "trace-analyzer",
        updatedAt: Date.now(),
      });
    }

    return facts;
  }

  /**
   * Process trace report(s) and write deduplicated facts to the output file.
   * Merges with any existing facts in the output file.
   */
  processAndWrite(traceFilePaths: string[]): number {
    // Read existing facts from output file
    const existingFacts = this.readExistingFacts();

    // Extract new facts from all trace reports
    const newFacts: Fact[] = [];
    for (const path of traceFilePaths) {
      const extracted = this.extractFactsFromFile(path);
      newFacts.push(...extracted);
    }

    if (newFacts.length === 0) {
      return existingFacts.length;
    }

    // Merge and deduplicate (newer facts override older ones)
    const merged = this.deduplicateFacts([...existingFacts, ...newFacts]);

    // Write to output file
    this.writeFacts(merged);

    this.logger.info(
      `[governance] Trace bridge: wrote ${merged.length} facts (${newFacts.length} new from ${traceFilePaths.length} report(s))`,
    );

    return merged.length;
  }

  /**
   * Start periodic processing of trace reports.
   */
  startTimer(traceFilePaths: string[], intervalMs: number): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.processAndWrite(traceFilePaths);
    }, intervalMs);
    // Don't keep the Node process alive just for fact updates
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Stop periodic processing.
   */
  stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Deduplicate facts by subject+predicate. Later facts win.
   */
  deduplicateFacts(facts: Fact[]): Fact[] {
    const map = new Map<string, Fact>();

    for (const fact of facts) {
      const key = factKey(fact.subject, fact.predicate);
      map.set(key, fact);
    }

    return Array.from(map.values());
  }

  private readExistingFacts(): Fact[] {
    try {
      if (!existsSync(this.outputPath)) return [];

      const raw = readFileSync(this.outputPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (isRecord(parsed) && Array.isArray(parsed["facts"])) {
        return parsed["facts"] as Fact[];
      }

      return [];
    } catch (e) {
      this.logger.warn(
        `[governance] Failed to read existing facts file: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  private writeFacts(facts: Fact[]): void {
    const dir = dirname(this.outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const file: FactRegistryFile = {
      id: "trace-learned",
      generatedAt: new Date().toISOString(),
      facts,
    };

    writeFileSync(this.outputPath, JSON.stringify(file, null, 2) + "\n", "utf-8");
  }
}

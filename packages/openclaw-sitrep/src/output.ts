import {
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SitrepReport, PluginLogger } from "./types.js";

/**
 * Write sitrep.json atomically (write to tmp, then rename).
 * Also backs up previous report.
 */
export function writeSitrep(
  report: SitrepReport,
  outputPath: string,
  previousPath: string,
  logger: PluginLogger,
): void {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Backup current → previous
  if (existsSync(outputPath)) {
    try {
      const prevDir = dirname(previousPath);
      if (!existsSync(prevDir)) mkdirSync(prevDir, { recursive: true });
      copyFileSync(outputPath, previousPath);
    } catch (err) {
      logger.warn(
        `[sitrep] Failed to backup previous report: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Atomic write: tmp → rename
  const tmpPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, outputPath);
    logger.info(`[sitrep] Written to ${outputPath}`);
  } catch (err) {
    // Clean up temp file on failure
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

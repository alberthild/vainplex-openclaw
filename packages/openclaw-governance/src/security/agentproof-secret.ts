import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

function expandPath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

export async function loadAgentProofApiKey(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(expandPath(filePath), "utf-8");
    const key = content.trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

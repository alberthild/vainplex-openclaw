import { join } from "node:path";

export function getOllamaBaseUrl(): string {
  const host = process.env.OLLAMA_HOST;
  return host ? `http://${host}` : "http://localhost:11434";
}

export function getGovernanceNotifySecretsPath(): string {
  return join(
    process.env.HOME || "/home/keller",
    ".openclaw/plugins/openclaw-governance/matrix-notify.json",
  );
}

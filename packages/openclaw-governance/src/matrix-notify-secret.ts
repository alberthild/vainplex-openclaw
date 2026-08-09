import { readFileSync } from "node:fs";

export interface MatrixNotifyConfig {
  homeserverUrl: string;
  accessToken: string;
}

export function loadMatrixNotifyConfig(secretsPath: string): MatrixNotifyConfig | null {
  try {
    const secrets = JSON.parse(readFileSync(secretsPath, "utf8")) as Record<string, string>;
    const homeserverUrl = secrets["homeserverUrl"] || "";
    const accessToken = secrets["accessToken"] || "";
    return homeserverUrl && accessToken ? { homeserverUrl, accessToken } : null;
  } catch {
    return null;
  }
}

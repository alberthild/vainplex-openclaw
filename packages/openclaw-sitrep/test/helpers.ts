import { vi } from "vitest";
import type { PluginLogger } from "../src/types.js";

export function createMockLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

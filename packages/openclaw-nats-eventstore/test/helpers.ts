import { vi } from "vitest";
import { DEFAULTS } from "../src/config.js";
import type { NatsEventStoreConfig } from "../src/config.js";
import type { NatsClient } from "../src/nats-client.js";

export function defaultConfig(overrides?: Partial<NatsEventStoreConfig>): NatsEventStoreConfig {
  return { ...DEFAULTS, ...overrides };
}

export function createMockClient(overrides?: Partial<NatsClient>): NatsClient {
  return {
    publish: vi.fn(async () => {}),
    isConnected: () => true,
    getStatus: () => ({ connected: true, stream: "test", disconnectCount: 0, publishFailures: 0 }),
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

export function createMockApi() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      (handlers[name] ??= []).push(handler);
    }),
    _fire(name: string, ...args: unknown[]) {
      for (const h of handlers[name] ?? []) {
        h(...args);
      }
    },
    _handlers: handlers,
  };
}

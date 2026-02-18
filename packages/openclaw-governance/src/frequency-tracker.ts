import type { FrequencyEntry, FrequencyTracker as IFrequencyTracker } from "./types.js";

export class FrequencyTrackerImpl implements IFrequencyTracker {
  private buffer: FrequencyEntry[];
  private head: number;
  private size: number;
  private readonly capacity: number;

  constructor(bufferSize: number) {
    this.capacity = bufferSize;
    this.buffer = new Array<FrequencyEntry>(bufferSize);
    this.head = 0;
    this.size = 0;
  }

  record(entry: FrequencyEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  count(
    windowSeconds: number,
    scope: "agent" | "session" | "global",
    agentId: string,
    sessionKey: string,
  ): number {
    const cutoff = Date.now() - windowSeconds * 1000;
    let total = 0;

    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const entry = this.buffer[idx];
      if (!entry || entry.timestamp < cutoff) continue;

      if (scope === "global") {
        total++;
      } else if (scope === "agent" && entry.agentId === agentId) {
        total++;
      } else if (scope === "session" && entry.sessionKey === sessionKey) {
        total++;
      }
    }

    return total;
  }

  clear(): void {
    this.buffer = new Array<FrequencyEntry>(this.capacity);
    this.head = 0;
    this.size = 0;
  }
}

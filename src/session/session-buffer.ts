import type { SpeechAlignment } from "./types";

export interface SessionBufferEntry {
  sentenceIndex: number;
  audioBase64: string;
  byteLength: number;
  alignment: SpeechAlignment | null;
}

export interface SessionBufferDecision {
  accepted: boolean;
  evictedSentenceIndices: number[];
  stopPrefetch: boolean;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class SessionBuffer {
  private entries = new Map<number, SessionBufferEntry>();

  constructor(private readonly maximumBytes = DEFAULT_MAX_BYTES) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new Error("Session Buffer ceiling must be a positive byte count.");
    }
  }

  store(
    entry: SessionBufferEntry,
    currentSentenceIndex: number,
  ): SessionBufferDecision {
    if (
      !Number.isSafeInteger(entry.sentenceIndex) ||
      entry.sentenceIndex < 0 ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0
    ) {
      return {
        accepted: false,
        evictedSentenceIndices: [],
        stopPrefetch: true,
      };
    }

    const previousEntries = new Map(this.entries);
    this.entries.set(entry.sentenceIndex, structuredClone(entry));
    const evictedSentenceIndices = this.pruneWindow(currentSentenceIndex);

    const played = [...this.entries.keys()]
      .filter((sentenceIndex) => sentenceIndex < currentSentenceIndex)
      .sort((left, right) => left - right);
    while (this.bytesInUse() > this.maximumBytes && played.length > 0) {
      const sentenceIndex = played.shift();
      if (sentenceIndex === undefined) break;
      this.entries.delete(sentenceIndex);
      evictedSentenceIndices.push(sentenceIndex);
    }

    if (this.bytesInUse() > this.maximumBytes) {
      this.entries = previousEntries;
      this.pruneWindow(currentSentenceIndex);
      return {
        accepted: false,
        evictedSentenceIndices: [],
        stopPrefetch: true,
      };
    }

    return {
      accepted: true,
      evictedSentenceIndices: [...new Set(evictedSentenceIndices)].sort(
        (left, right) => left - right,
      ),
      stopPrefetch: false,
    };
  }

  restore(entries: SessionBufferEntry[], currentSentenceIndex: number): void {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.sentenceIndex, structuredClone(entry));
    }
    this.pruneWindow(currentSentenceIndex);
  }

  get(sentenceIndex: number): SessionBufferEntry | null {
    const entry = this.entries.get(sentenceIndex);
    return entry ? structuredClone(entry) : null;
  }

  sentenceIndices(): number[] {
    return [...this.entries.keys()].sort((left, right) => left - right);
  }

  values(): SessionBufferEntry[] {
    return this.sentenceIndices().flatMap((sentenceIndex) => {
      const entry = this.entries.get(sentenceIndex);
      return entry ? [structuredClone(entry)] : [];
    });
  }

  bytesInUse(): number {
    return [...this.entries.values()].reduce(
      (total, entry) => total + entry.byteLength,
      0,
    );
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneWindow(currentSentenceIndex: number): number[] {
    const minimum = Math.max(0, currentSentenceIndex - 1);
    const maximum = currentSentenceIndex + 2;
    const evicted: number[] = [];
    for (const sentenceIndex of this.entries.keys()) {
      if (sentenceIndex < minimum || sentenceIndex > maximum) {
        this.entries.delete(sentenceIndex);
        evicted.push(sentenceIndex);
      }
    }
    return evicted;
  }
}

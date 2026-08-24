import {
  SessionBuffer,
  type SessionBufferEntry,
} from "../../src/session/session-buffer";

function entry(sentenceIndex: number, byteLength: number): SessionBufferEntry {
  return {
    sentenceIndex,
    audioBase64: "A".repeat(byteLength),
    byteLength,
    alignment: null,
  };
}

describe("Session Buffer", () => {
  it("retains previous/current/upcoming audio, evicts played content first, and stops prefetch before required audio", () => {
    const buffer = new SessionBuffer(10);

    expect(buffer.store(entry(0, 4), 1)).toMatchObject({ accepted: true });
    expect(buffer.store(entry(1, 4), 1)).toMatchObject({ accepted: true });
    expect(buffer.store(entry(2, 4), 1)).toEqual({
      accepted: true,
      evictedSentenceIndices: [0],
      stopPrefetch: false,
    });
    expect(buffer.sentenceIndices()).toEqual([1, 2]);

    expect(buffer.store(entry(3, 4), 1)).toEqual({
      accepted: false,
      evictedSentenceIndices: [],
      stopPrefetch: true,
    });
    expect(buffer.sentenceIndices()).toEqual([1, 2]);
    expect(buffer.bytesInUse()).toBe(8);
  });

  it("drops entries outside the previous/current/two-upcoming window", () => {
    const buffer = new SessionBuffer();
    buffer.restore(
      [entry(1, 2), entry(2, 2), entry(3, 2), entry(4, 2), entry(8, 2)],
      2,
    );

    expect(buffer.sentenceIndices()).toEqual([1, 2, 3, 4]);
  });
});

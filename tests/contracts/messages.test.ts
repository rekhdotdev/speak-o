import { parseRuntimeMessage } from "../../src/contracts/messages";
import {
  isExtensionMessage,
  isReadingSessionDescriptor,
  isSessionBufferEntries,
} from "../../src/contracts/runtime-guards";

describe("runtime message contract", () => {
  it("accepts a versioned command and rejects unknown or untrusted payloads", () => {
    expect(
      parseRuntimeMessage({
        version: 1,
        target: "background",
        type: "session.command",
        sessionId: "session-1",
        generationEpoch: 3,
        command: { type: "pause" },
      }),
    ).toEqual({
      version: 1,
      target: "background",
      type: "session.command",
      sessionId: "session-1",
      generationEpoch: 3,
      command: { type: "pause" },
    });

    expect(
      parseRuntimeMessage({
        version: 2,
        target: "page",
        type: "run-code",
        articleHtml: "<script>alert(1)</script>",
      }),
    ).toBeNull();

    expect(
      parseRuntimeMessage({
        version: 1,
        target: "background",
        type: "session.command",
        sessionId: "session-1",
        generationEpoch: -1,
        command: { type: "pause" },
      }),
    ).toBeNull();
  });

  it("rejects unknown cross-context message types", () => {
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "execute.arbitrary-code",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "offscreen",
        type: "audio.pause",
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "settings.changed",
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "content",
        type: "content.debug.snapshot",
      }),
    ).toBe(true);
  });

  it("validates recovered descriptors and bounded session audio", () => {
    expect(
      isReadingSessionDescriptor({
        version: 1,
        sessionId: "session:1",
        generationEpoch: 4,
        sourceTabId: 7,
        sourceFrameId: 0,
        mode: "cloud",
        currentSentenceIndex: 2,
        mediaTimeMs: 1200,
        status: "paused",
      }),
    ).toBe(true);
    expect(
      isReadingSessionDescriptor({
        version: 1,
        sessionId: "session:1",
        generationEpoch: 4,
        sourceTabId: 7,
        mode: "cloud",
        currentSentenceIndex: 2,
        status: "paused",
      }),
    ).toBe(false);

    expect(
      isSessionBufferEntries([
        {
          sentenceIndex: 2,
          audioBase64: "AQID",
          byteLength: 3,
          alignment: null,
        },
      ]),
    ).toBe(true);
    expect(
      isSessionBufferEntries([
        {
          sentenceIndex: 2,
          audioBase64: "AQID",
          byteLength: 2,
          alignment: null,
        },
      ]),
    ).toBe(false);
  });
});

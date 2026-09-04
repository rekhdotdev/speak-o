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
        target: "background",
        type: "session.command",
        sessionId: "session-settings",
        generationEpoch: 7,
        command: "settings.open",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "session.command",
        sessionId: "session-settings",
        generationEpoch: 7,
        command: "seek",
        value: 12,
      }),
    ).toBe(true);
    expect(
      isReadingSessionDescriptor({
        version: 1,
        sessionId: "session:speechify",
        generationEpoch: 2,
        sourceTabId: 7,
        sourceFrameId: 0,
        mode: "cloud",
        provider: "speechify",
        currentSentenceIndex: 0,
        mediaTimeMs: 0,
        status: "paused",
        submittedCharacters: 12,
        submittedSentenceIndices: [0],
      }),
    ).toBe(true);
    expect(
      isReadingSessionDescriptor({
        version: 1,
        sessionId: "session:mismatch",
        generationEpoch: 2,
        sourceTabId: 7,
        sourceFrameId: 0,
        mode: "browser",
        provider: "speechify",
        currentSentenceIndex: 0,
        mediaTimeMs: 0,
        status: "paused",
        submittedCharacters: 0,
        submittedSentenceIndices: [],
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
        type: "preferences.patch",
        patch: { theme: "dark" },
        sessionId: "session-settings",
        generationEpoch: 7,
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "preferences.patch",
        patch: { playbackSpeed: 99 },
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "preferences.patch",
        patch: { theme: "dark" },
        sessionId: "partial-context",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "settings.changed",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "settings.changed",
        sessionId: "session-settings",
        generationEpoch: 7,
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "background",
        type: "settings.open",
        sessionId: "session-settings",
        generationEpoch: -1,
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        version: 1,
        target: "content",
        type: "content.debug.snapshot",
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "options",
        type: "onboarding.requested",
        narrationLanguage: "en-US",
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        version: 1,
        target: "options",
        type: "onboarding.requested",
        narrationLanguage: "",
      }),
    ).toBe(false);
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
        submittedCharacters: 240,
        submittedSentenceIndices: [0, 1, 2],
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
        submittedCharacters: 240,
        submittedSentenceIndices: [0, 1, 2],
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

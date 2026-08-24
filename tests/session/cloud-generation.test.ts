import type { ArticleSnapshot } from "../../src/extraction/types";
import { ReadingSessionController } from "../../src/session/reading-session";
import { DEFAULT_PREFERENCES } from "../../src/storage/preferences";

function cloudArticle(): ArticleSnapshot {
  const texts = [
    "One cloud sentence.",
    "Two cloud sentence.",
    "Three cloud sentence.",
    "Four cloud sentence.",
  ];
  return {
    id: "cloud-article",
    extractor: "generic",
    title: "Cloud test",
    author: null,
    narrationLanguage: "en-US",
    characterCount: texts.join("").length,
    blocks: texts.map((text, index) => ({
      id: `block-${index}`,
      kind: "paragraph",
      text,
      mappingIds: [`mapping-${index}`],
    })),
    sentences: texts.map((text, index) => ({
      id: `sentence-${index}`,
      text,
      blockIndex: index,
      startOffset: 0,
      endOffset: text.length,
      mappingIds: [`mapping-${index}`],
    })),
  };
}

describe("Cloud Voice Generation Window", () => {
  it("submits one bounded burst containing the current and no more than two upcoming sentences", () => {
    const controller = new ReadingSessionController(() => "cloud-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        defaultVoiceMode: "cloud",
        voiceByLanguage: { "en-US": "voice-1" },
        region: "india",
      },
    });

    const preparing = controller.dispatch({
      type: "play",
      sessionId: "cloud-session",
      generationEpoch: 1,
    });

    expect(preparing.snapshot).toMatchObject({
      status: "preparing",
      notice: "Preparing next sentence",
      submittedCharacters: 59,
    });
    expect(
      preparing.effects.filter((effect) => effect.type === "provider.generate"),
    ).toEqual([
      {
        type: "provider.generate",
        sessionId: "cloud-session",
        generationEpoch: 1,
        requestId: "cloud-session:1:0-2",
        sentences: [
          { index: 0, text: "One cloud sentence." },
          { index: 1, text: "Two cloud sentence." },
          { index: 2, text: "Three cloud sentence." },
        ],
        language: "en-US",
        voiceId: "voice-1",
        modelId: "eleven_multilingual_v2",
        region: "india",
      },
    ]);
  });

  it("fills the window only up to the configured Provider Usage guard", () => {
    const controller = new ReadingSessionController(() => "guarded-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
        usageGuardCharacters: 40,
      },
    });

    const transition = controller.dispatch({
      type: "play",
      sessionId: "guarded-session",
      generationEpoch: 1,
    });

    expect(transition.snapshot?.submittedCharacters).toBe(38);
    expect(transition.effects).toContainEqual(
      expect.objectContaining({
        type: "provider.generate",
        sentences: [
          { index: 0, text: "One cloud sentence." },
          { index: 1, text: "Two cloud sentence." },
        ],
      }),
    );
  });

  it("buffers acknowledged audio for offscreen playback without exposing credentials", () => {
    const controller = new ReadingSessionController(() => "audio-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
      },
    });
    controller.dispatch({
      type: "play",
      sessionId: "audio-session",
      generationEpoch: 1,
    });
    const alignment = {
      chars: ["O", "n", "e"],
      charStartTimesMs: [0, 50, 100],
      charDurationsMs: [50, 50, 60],
    };

    const received = controller.dispatch({
      type: "provider.event",
      sessionId: "audio-session",
      generationEpoch: 1,
      event: {
        type: "audio",
        sentenceIndex: 0,
        audioBase64: "AQID",
        alignment,
        acknowledged: true,
        isFinal: true,
      },
    });

    expect(received.snapshot).toMatchObject({
      status: "playing",
      notice: null,
    });
    expect(received.effects).toContainEqual({
      type: "buffer.store",
      sessionId: "audio-session",
      generationEpoch: 1,
      entry: {
        sentenceIndex: 0,
        audioBase64: "AQID",
        byteLength: 3,
        alignment,
      },
    });
    expect(received.effects).toContainEqual(
      expect.objectContaining({
        type: "audio.play",
        sentenceIndex: 0,
        audioBase64: "AQID",
        playbackSpeed: 1,
      }),
    );
    expect(JSON.stringify(received.effects)).not.toContain("credential");
    expect(JSON.stringify(received.effects)).not.toContain("apiKey");
  });

  it("retries only unacknowledged empty failures automatically", () => {
    const controller = new ReadingSessionController(() => "retry-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
      },
    });
    controller.dispatch({
      type: "play",
      sessionId: "retry-session",
      generationEpoch: 1,
    });

    const safeRetry = controller.dispatch({
      type: "provider.event",
      sessionId: "retry-session",
      generationEpoch: 1,
      event: {
        type: "failure",
        errorCode: "NETWORK_LOST",
        acknowledged: false,
        receivedAudio: false,
      },
    });
    expect(safeRetry.snapshot?.submittedCharacters).toBe(59);
    expect(safeRetry.effects).toContainEqual(
      expect.objectContaining({
        type: "provider.generate",
        requestId: "retry-session:1:retry-1",
      }),
    );

    const billableFailure = controller.dispatch({
      type: "provider.event",
      sessionId: "retry-session",
      generationEpoch: 1,
      event: {
        type: "failure",
        errorCode: "CONNECTION_DROPPED",
        acknowledged: true,
        receivedAudio: false,
      },
    });
    expect(billableFailure.snapshot).toMatchObject({
      status: "provider-issue",
      retryRequiresConfirmation: true,
    });
    expect(
      billableFailure.effects.some(
        (effect) => effect.type === "provider.generate",
      ),
    ).toBe(false);

    const confirmed = controller.dispatch({
      type: "retry-provider",
      sessionId: "retry-session",
      generationEpoch: 1,
    });
    expect(confirmed.effects).toContainEqual(
      expect.objectContaining({ type: "provider.generate" }),
    );
  });

  it("requires a deliberate continuation at the usage guard", () => {
    const controller = new ReadingSessionController(() => "limit-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
        usageGuardCharacters: 59,
      },
    });
    const active = controller.currentSnapshot();
    if (!active) throw new Error("Session did not activate");
    controller.dispatch({
      type: "play",
      sessionId: active.id,
      generationEpoch: active.generationEpoch,
    });
    controller.dispatch({
      type: "provider.event",
      sessionId: active.id,
      generationEpoch: active.generationEpoch,
      event: {
        type: "audio",
        sentenceIndex: 0,
        audioBase64: "AQID",
        alignment: null,
        acknowledged: true,
        isFinal: true,
      },
    });
    controller.dispatch({
      type: "seek",
      sessionId: active.id,
      generationEpoch: active.generationEpoch,
      sentenceIndex: 3,
    });

    const limited = controller.dispatch({
      type: "play",
      sessionId: active.id,
      generationEpoch: active.generationEpoch,
    });
    expect(limited.snapshot?.status).toBe("usage-limit");

    const continued = controller.dispatch({
      type: "continue-after-usage-limit",
      sessionId: active.id,
      generationEpoch: active.generationEpoch,
    });
    expect(continued.snapshot?.usageGuardCharacters).toBeNull();
    expect(continued.effects).toContainEqual(
      expect.objectContaining({ type: "provider.generate" }),
    );
  });

  it("switches explicitly from a failed Cloud Voice to Chrome Voice", () => {
    const controller = new ReadingSessionController(() => "switch-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
      },
    });
    controller.dispatch({
      type: "play",
      sessionId: "switch-session",
      generationEpoch: 1,
    });

    const switched = controller.dispatch({
      type: "switch-to-browser",
      sessionId: "switch-session",
      generationEpoch: 1,
    });
    expect(switched.snapshot).toMatchObject({
      mode: "browser",
      status: "playing",
    });
    expect(switched.effects.map((effect) => effect.type)).toEqual([
      "provider.abort",
      "audio.stop",
      "browser.speak",
      "content.render",
      "storage.save-descriptor",
    ]);
  });

  it("navigates to buffered Cloud Voice audio without regenerating it", () => {
    const controller = new ReadingSessionController(() => "navigate-session");
    controller.dispatch({
      type: "activate",
      article: cloudArticle(),
      sourceTabId: 11,
      sourceFrameId: 0,
      mode: "cloud",
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
      },
    });
    controller.dispatch({
      type: "play",
      sessionId: "navigate-session",
      generationEpoch: 1,
    });
    for (const sentenceIndex of [0, 1]) {
      controller.dispatch({
        type: "provider.event",
        sessionId: "navigate-session",
        generationEpoch: 1,
        event: {
          type: "audio",
          sentenceIndex,
          audioBase64: sentenceIndex === 0 ? "AQID" : "BAUG",
          alignment: null,
          acknowledged: true,
          isFinal: sentenceIndex === 1,
        },
      });
    }

    const next = controller.dispatch({
      type: "next",
      sessionId: "navigate-session",
      generationEpoch: 1,
    });
    expect(next.snapshot).toMatchObject({
      status: "playing",
      currentSentenceIndex: 1,
      currentMediaTimeMs: 0,
    });
    expect(next.effects).toContainEqual(
      expect.objectContaining({
        type: "audio.play",
        sentenceIndex: 1,
        audioBase64: "BAUG",
        startAtMs: 0,
      }),
    );
    expect(
      next.effects.some((effect) => effect.type === "provider.generate"),
    ).toBe(false);
  });
});

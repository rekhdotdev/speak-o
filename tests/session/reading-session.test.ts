import type { ArticleSnapshot } from "../../src/extraction/types";
import { ReadingSessionController } from "../../src/session/reading-session";
import { DEFAULT_PREFERENCES } from "../../src/storage/preferences";

function article(id: string, sentences: string[]): ArticleSnapshot {
  return {
    id,
    extractor: "generic",
    title: "A test Article",
    author: "Ada Example",
    narrationLanguage: "en-US",
    characterCount: sentences.join("").length,
    blocks: sentences.map((text, index) => ({
      id: `block-${index + 1}`,
      kind: "paragraph",
      text,
      mappingIds: [`mapping-${index + 1}`],
    })),
    sentences: sentences.map((text, index) => ({
      id: `sentence-${index + 1}`,
      text,
      blockIndex: index,
      startOffset: 0,
      endOffset: text.length,
      mappingIds: [`mapping-${index + 1}`],
    })),
  };
}

describe("Reading Session interface", () => {
  it("owns Browser Voice sentence progress and rejects stale asynchronous events", () => {
    const ids = ["session-a", "session-b"];
    const controller = new ReadingSessionController(
      () => ids.shift() ?? "session-z",
    );

    const activated = controller.dispatch({
      type: "activate",
      article: article("article-a", ["First sentence.", "Second sentence."]),
      sourceTabId: 7,
      sourceFrameId: 0,
      mode: "browser",
      preferences: DEFAULT_PREFERENCES,
    });

    expect(activated.snapshot).toMatchObject({
      version: 1,
      id: "session-a",
      generationEpoch: 1,
      status: "ready",
      currentSentenceIndex: 0,
      sentenceCount: 2,
      progressPercent: 0,
    });

    const playing = controller.dispatch({
      type: "play",
      sessionId: "session-a",
      generationEpoch: 1,
    });
    expect(playing.snapshot?.status).toBe("playing");
    expect(playing.effects).toContainEqual({
      type: "browser.speak",
      sessionId: "session-a",
      generationEpoch: 1,
      sentenceIndex: 0,
      text: "First sentence.",
      language: "en-US",
      voiceId: null,
      playbackSpeed: 1,
    });

    const started = controller.dispatch({
      type: "browser.event",
      sessionId: "session-a",
      generationEpoch: 1,
      event: { type: "start", sentenceIndex: 0 },
    });
    expect(started.effects).toContainEqual({
      type: "content.highlight",
      sessionId: "session-a",
      generationEpoch: 1,
      sentenceIndex: 0,
      word: null,
    });

    const advanced = controller.dispatch({
      type: "browser.event",
      sessionId: "session-a",
      generationEpoch: 1,
      event: { type: "end", sentenceIndex: 0 },
    });
    expect(advanced.snapshot).toMatchObject({
      currentSentenceIndex: 1,
      progressPercent: 50,
      status: "playing",
    });
    expect(advanced.effects).toContainEqual(
      expect.objectContaining({
        type: "browser.speak",
        sentenceIndex: 1,
        text: "Second sentence.",
      }),
    );

    const stale = controller.dispatch({
      type: "browser.event",
      sessionId: "session-a",
      generationEpoch: 0,
      event: { type: "end", sentenceIndex: 1 },
    });
    expect(stale.snapshot?.currentSentenceIndex).toBe(1);
    expect(stale.effects).toEqual([]);

    const stopped = controller.dispatch({
      type: "stop",
      sessionId: "session-a",
      generationEpoch: 1,
    });
    expect(stopped.snapshot).toBeNull();
    expect(stopped.effects.map((effect) => effect.type)).toEqual([
      "browser.stop",
      "provider.abort",
      "audio.stop",
      "content.clear",
      "storage.clear-session",
      "offscreen.close",
    ]);
  });

  it("applies sentence navigation, Browser Voice speed changes, and source-change recovery predictably", () => {
    const controller = new ReadingSessionController(() => "session-nav");
    controller.dispatch({
      type: "activate",
      article: article("article-nav", ["One.", "Two.", "Three."]),
      sourceTabId: 9,
      sourceFrameId: 0,
      mode: "browser",
      preferences: DEFAULT_PREFERENCES,
    });
    controller.dispatch({
      type: "play",
      sessionId: "session-nav",
      generationEpoch: 1,
    });

    const restarted = controller.dispatch({
      type: "previous",
      sessionId: "session-nav",
      generationEpoch: 1,
      elapsedInSentenceMs: 2_000,
    });
    expect(restarted.snapshot?.currentSentenceIndex).toBe(0);
    expect(restarted.effects).toContainEqual(
      expect.objectContaining({ type: "browser.speak", sentenceIndex: 0 }),
    );

    const next = controller.dispatch({
      type: "next",
      sessionId: "session-nav",
      generationEpoch: 1,
    });
    expect(next.snapshot).toMatchObject({
      currentSentenceIndex: 1,
      progressPercent: 33,
    });
    expect(next.effects.map((effect) => effect.type)).toContain("browser.stop");
    expect(next.effects).toContainEqual(
      expect.objectContaining({ type: "browser.speak", sentenceIndex: 1 }),
    );

    const previous = controller.dispatch({
      type: "previous",
      sessionId: "session-nav",
      generationEpoch: 1,
      elapsedInSentenceMs: 400,
    });
    expect(previous.snapshot?.currentSentenceIndex).toBe(0);

    const speedChanged = controller.dispatch({
      type: "set-playback-speed",
      sessionId: "session-nav",
      generationEpoch: 1,
      playbackSpeed: 2,
    });
    expect(speedChanged.snapshot).toMatchObject({
      playbackSpeed: 2,
      notice:
        "Playback Speed applies at the next sentence in Browser Voice Mode.",
    });
    expect(
      speedChanged.effects.some((effect) => effect.type === "browser.speak"),
    ).toBe(false);

    const changed = controller.dispatch({
      type: "source.changed",
      sessionId: "session-nav",
      generationEpoch: 1,
    });
    expect(changed.snapshot?.status).toBe("page-changed");
    expect(changed.effects.map((effect) => effect.type)).toContain(
      "browser.stop",
    );

    const continued = controller.dispatch({
      type: "continue-without-highlights",
      sessionId: "session-nav",
      generationEpoch: 1,
    });
    expect(continued.snapshot).toMatchObject({
      status: "playing",
      highlightsEnabled: false,
    });
    expect(continued.effects).toContainEqual(
      expect.objectContaining({
        type: "browser.speak",
        playbackSpeed: 2,
      }),
    );
  });

  it("rehydrates a suspended service-worker session as paused with a fresh epoch", () => {
    const controller = new ReadingSessionController(() => "unused");
    const restored = controller.dispatch({
      type: "restore",
      article: article("article-recovery", ["One.", "Two.", "Three."]),
      descriptor: {
        version: 1,
        sessionId: "session-recovery",
        generationEpoch: 9,
        sourceTabId: 12,
        sourceFrameId: 3,
        mode: "cloud",
        currentSentenceIndex: 1,
        mediaTimeMs: 740,
        status: "playing",
      },
      preferences: {
        ...DEFAULT_PREFERENCES,
        voiceByLanguage: { "en-US": "voice-1" },
      },
      bufferedAudio: [
        {
          sentenceIndex: 1,
          audioBase64: "AQID",
          alignment: null,
        },
      ],
    });

    expect(restored.snapshot).toMatchObject({
      id: "session-recovery",
      generationEpoch: 10,
      sourceTabId: 12,
      sourceFrameId: 3,
      currentSentenceIndex: 1,
      status: "paused",
      notice: "Paused after Chrome restored the Reading Session.",
    });
    expect(restored.effects.map((effect) => effect.type)).toEqual([
      "browser.stop",
      "provider.abort",
      "audio.pause",
      "content.render",
      "storage.save-descriptor",
    ]);

    const stale = controller.dispatch({
      type: "audio.event",
      sessionId: "session-recovery",
      generationEpoch: 9,
      event: { type: "ended", sentenceIndex: 1 },
    });
    expect(stale.effects).toEqual([]);
    expect(stale.snapshot?.currentSentenceIndex).toBe(1);

    const resumed = controller.dispatch({
      type: "play",
      sessionId: "session-recovery",
      generationEpoch: 10,
    });
    expect(resumed.effects).toContainEqual(
      expect.objectContaining({
        type: "audio.play",
        sentenceIndex: 1,
        audioBase64: "AQID",
        startAtMs: 740,
      }),
    );
    expect(
      resumed.effects.some((effect) => effect.type === "provider.generate"),
    ).toBe(false);
  });
});

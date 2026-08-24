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
  it("applies a Narration Language override and its matching Browser Voice", () => {
    const controller = new ReadingSessionController(() => "session-language");
    const activated = controller.dispatch({
      type: "activate",
      article: article("article-language", ["Bonjour. Salut."]),
      sourceTabId: 7,
      sourceFrameId: 0,
      mode: "browser",
      preferences: {
        ...DEFAULT_PREFERENCES,
        narrationLanguageOverride: "fr-FR",
        browserVoiceByLanguage: { "fr-FR": "French Voice" },
      },
    });
    expect(activated.snapshot).toMatchObject({
      narrationLanguage: "fr-FR",
      voiceId: "French Voice",
    });

    const playing = controller.dispatch({
      type: "play",
      sessionId: "session-language",
      generationEpoch: 1,
    });
    expect(playing.effects).toContainEqual(
      expect.objectContaining({
        type: "browser.speak",
        language: "fr-FR",
        voiceId: "French Voice",
      }),
    );
  });
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

  it("resumes paused media and starts paused sentence navigation immediately", () => {
    const controller = new ReadingSessionController(() => "session-resume");
    controller.dispatch({
      type: "activate",
      article: article("article-resume", ["One.", "Two.", "Three."]),
      sourceTabId: 9,
      sourceFrameId: 0,
      mode: "browser",
      preferences: DEFAULT_PREFERENCES,
    });
    controller.dispatch({
      type: "play",
      sessionId: "session-resume",
      generationEpoch: 1,
    });

    const paused = controller.dispatch({
      type: "pause",
      sessionId: "session-resume",
      generationEpoch: 1,
    });
    expect(paused.effects).toContainEqual(
      expect.objectContaining({ type: "browser.pause" }),
    );

    const resumed = controller.dispatch({
      type: "play",
      sessionId: "session-resume",
      generationEpoch: 1,
    });
    expect(resumed.snapshot).toMatchObject({
      status: "paused",
      notice: "Resuming Chrome Voice…",
    });
    expect(resumed.effects).toContainEqual(
      expect.objectContaining({ type: "browser.resume" }),
    );
    expect(
      resumed.effects.some((effect) => effect.type === "browser.speak"),
    ).toBe(false);

    const resumeConfirmed = controller.dispatch({
      type: "browser.event",
      sessionId: "session-resume",
      generationEpoch: 1,
      event: { type: "resume", sentenceIndex: 0 },
    });
    expect(resumeConfirmed.snapshot).toMatchObject({
      status: "playing",
      notice: null,
    });

    controller.dispatch({
      type: "pause",
      sessionId: "session-resume",
      generationEpoch: 1,
    });
    const next = controller.dispatch({
      type: "next",
      sessionId: "session-resume",
      generationEpoch: 1,
    });
    expect(next.snapshot).toMatchObject({
      status: "playing",
      currentSentenceIndex: 1,
    });
    expect(next.effects).toContainEqual(
      expect.objectContaining({ type: "browser.speak", sentenceIndex: 1 }),
    );

    controller.dispatch({
      type: "pause",
      sessionId: "session-resume",
      generationEpoch: 1,
    });
    const previous = controller.dispatch({
      type: "previous",
      sessionId: "session-resume",
      generationEpoch: 1,
      elapsedInSentenceMs: 2_000,
    });
    expect(previous.snapshot).toMatchObject({
      status: "playing",
      currentSentenceIndex: 0,
    });
    expect(previous.effects).toContainEqual(
      expect.objectContaining({ type: "browser.speak", sentenceIndex: 0 }),
    );
  });

  it("pauses with an actionable state when Chrome unexpectedly cancels speech", () => {
    const controller = new ReadingSessionController(() => "session-cancelled");
    controller.dispatch({
      type: "activate",
      article: article("article-cancelled", ["One."]),
      sourceTabId: 9,
      sourceFrameId: 0,
      mode: "browser",
      preferences: DEFAULT_PREFERENCES,
    });
    controller.dispatch({
      type: "play",
      sessionId: "session-cancelled",
      generationEpoch: 1,
    });

    const cancelled = controller.dispatch({
      type: "browser.event",
      sessionId: "session-cancelled",
      generationEpoch: 1,
      event: { type: "cancelled", sentenceIndex: 0 },
    });
    expect(cancelled.snapshot).toMatchObject({
      status: "paused",
      notice:
        "Chrome Voice stopped unexpectedly. Press play to restart the sentence.",
      errorCode: "BROWSER_TTS_CANCELLED",
    });
  });

  it("applies sentence navigation, immediate Browser Voice speed changes, and source-change recovery predictably", () => {
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
      notice: null,
    });
    expect(speedChanged.effects).toContainEqual(
      expect.objectContaining({ type: "browser.stop" }),
    );
    expect(speedChanged.effects).toContainEqual(
      expect.objectContaining({
        type: "browser.speak",
        sentenceIndex: 0,
        playbackSpeed: 2,
      }),
    );

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

  it("repaints highlights immediately and clears them when narration completes", () => {
    const controller = new ReadingSessionController(() => "session-highlight");
    controller.dispatch({
      type: "activate",
      article: article("article-highlight", ["Only sentence."]),
      sourceTabId: 10,
      sourceFrameId: 0,
      mode: "browser",
      preferences: DEFAULT_PREFERENCES,
    });
    controller.dispatch({
      type: "play",
      sessionId: "session-highlight",
      generationEpoch: 1,
    });

    const hidden = controller.dispatch({
      type: "set-highlights",
      sessionId: "session-highlight",
      generationEpoch: 1,
      enabled: false,
    });
    expect(hidden.effects).toContainEqual(
      expect.objectContaining({ type: "content.clear-highlights" }),
    );

    const shown = controller.dispatch({
      type: "set-highlights",
      sessionId: "session-highlight",
      generationEpoch: 1,
      enabled: true,
    });
    expect(shown.effects).toContainEqual(
      expect.objectContaining({
        type: "content.highlight",
        sentenceIndex: 0,
        word: null,
      }),
    );

    const completed = controller.dispatch({
      type: "browser.event",
      sessionId: "session-highlight",
      generationEpoch: 1,
      event: { type: "end", sentenceIndex: 0 },
    });
    expect(completed.snapshot?.status).toBe("completed");
    expect(completed.effects).toContainEqual(
      expect.objectContaining({ type: "content.clear-highlights" }),
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

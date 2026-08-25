import {
  BrowserVoiceAdapter,
  type BrowserTtsOptions,
  type BrowserTtsPort,
} from "../../src/adapters/browser-voice";
import type { ReadingSessionEffect } from "../../src/session/types";

describe("Browser Voice adapter contract", () => {
  it("does not speak an utterance replaced while voice discovery was pending", async () => {
    let finishDiscovery:
      | ((voices: Array<{ voiceName: string; lang: string }>) => void)
      | undefined;
    const discovery = new Promise<Array<{ voiceName: string; lang: string }>>(
      (resolve) => {
        finishDiscovery = resolve;
      },
    );
    const speak = vi.fn(async () => undefined);
    const port: BrowserTtsPort = {
      getVoices: vi.fn(() => discovery),
      speak,
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);
    const first = adapter.speak(
      {
        type: "browser.speak",
        sessionId: "session-discovery",
        generationEpoch: 1,
        sentenceIndex: 0,
        text: "Stale sentence.",
        language: "en-US",
        voiceId: null,
        playbackSpeed: 1,
      },
      vi.fn(),
    );

    adapter.stop();
    await adapter.speak(
      {
        type: "browser.speak",
        sessionId: "session-discovery",
        generationEpoch: 1,
        sentenceIndex: 0,
        text: "Current sentence.",
        language: "en-US",
        voiceId: "Current Voice",
        playbackSpeed: 1,
      },
      vi.fn(),
    );
    finishDiscovery?.([{ voiceName: "Stale Voice", lang: "en-US" }]);
    await first;

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(
      "Current sentence.",
      expect.objectContaining({ voiceName: "Current Voice" }),
    );
  });

  it("ignores late events from an utterance that was replaced after pause", async () => {
    const utterances: BrowserTtsOptions[] = [];
    const port: BrowserTtsPort = {
      async speak(_text, options) {
        utterances.push(options);
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);
    const events: unknown[] = [];
    const effect: Extract<ReadingSessionEffect, { type: "browser.speak" }> = {
      type: "browser.speak",
      sessionId: "session-restart",
      generationEpoch: 1,
      sentenceIndex: 0,
      text: "Restart this sentence.",
      language: "en-US",
      voiceId: "Word Voice",
      playbackSpeed: 1,
    };

    await adapter.speak(effect, (event) => events.push(event));
    adapter.pause();
    adapter.stop();
    await adapter.speak(effect, (event) => events.push(event));

    utterances[0]?.onEvent({ type: "pause" });
    utterances[0]?.onEvent({ type: "word", charIndex: 0, length: 7 });
    utterances[0]?.onEvent({ type: "end" });
    utterances[1]?.onEvent({ type: "start" });

    expect(events).toEqual([{ type: "start", sentenceIndex: 0 }]);
  });

  it("falls back to Chrome's default voice when voice discovery fails", async () => {
    const speak = vi.fn(async () => undefined);
    const port: BrowserTtsPort = {
      getVoices: vi.fn(async () => {
        throw new Error("voice discovery unavailable");
      }),
      speak,
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);

    await adapter.speak(
      {
        type: "browser.speak",
        sessionId: "session-default-voice",
        generationEpoch: 1,
        sentenceIndex: 0,
        text: "Keep speaking.",
        language: "en-US",
        voiceId: null,
        playbackSpeed: 1,
      },
      vi.fn(),
    );

    expect(speak).toHaveBeenCalledWith(
      "Keep speaking.",
      expect.not.objectContaining({ voiceName: expect.anything() }),
    );
  });

  it("chooses a language-compatible word-boundary voice when Chrome has no explicit preference", async () => {
    let capturedOptions: Parameters<BrowserTtsPort["speak"]>[1] | undefined;
    const port: BrowserTtsPort & {
      getVoices(): Promise<
        Array<{ voiceName: string; lang?: string; eventTypes?: string[] }>
      >;
    } = {
      async getVoices() {
        return [
          {
            voiceName: "Sentence Voice",
            lang: "en-US",
            eventTypes: ["start", "end"],
          },
          {
            voiceName: "Word Voice",
            lang: "en-GB",
            eventTypes: ["start", "word", "end"],
          },
        ];
      },
      async speak(_text, options) {
        capturedOptions = options;
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);

    await adapter.speak(
      {
        type: "browser.speak",
        sessionId: "session-word-voice",
        generationEpoch: 1,
        sentenceIndex: 0,
        text: "Highlight every word.",
        language: "en-US",
        voiceId: null,
        playbackSpeed: 1,
      },
      vi.fn(),
    );

    expect(capturedOptions?.voiceName).toBe("Word Voice");
  });
  it("speaks one sentence through chrome.tts options and reports capability events", async () => {
    let capturedText = "";
    let capturedOptions: Parameters<BrowserTtsPort["speak"]>[1] | undefined;
    const port: BrowserTtsPort = {
      async speak(text, options) {
        capturedText = text;
        capturedOptions = options;
        options.onEvent({ type: "word", charIndex: 6, length: 5 });
        options.onEvent({ type: "pause" });
        options.onEvent({ type: "resume" });
        options.onEvent({ type: "interrupted" });
        options.onEvent({ type: "cancelled" });
        options.onEvent({ type: "end", charIndex: text.length });
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);
    const events: unknown[] = [];
    const effect: Extract<ReadingSessionEffect, { type: "browser.speak" }> = {
      type: "browser.speak",
      sessionId: "session-1",
      generationEpoch: 2,
      sentenceIndex: 3,
      text: "Hello world.",
      language: "en-US",
      voiceId: "System Voice",
      playbackSpeed: 1.5,
    };

    await adapter.speak(effect, (event) => events.push(event));

    expect(capturedText).toBe("Hello world.");
    expect(capturedOptions).toMatchObject({
      lang: "en-US",
      voiceName: "System Voice",
      rate: 1.5,
      enqueue: false,
      desiredEventTypes: [
        "start",
        "word",
        "sentence",
        "end",
        "error",
        "pause",
        "resume",
        "interrupted",
        "cancelled",
      ],
    });
    expect(events).toEqual([
      { type: "word", sentenceIndex: 3, charIndex: 6, length: 5 },
      { type: "pause", sentenceIndex: 3 },
      { type: "resume", sentenceIndex: 3 },
      { type: "interrupted", sentenceIndex: 3 },
      { type: "cancelled", sentenceIndex: 3 },
      { type: "end", sentenceIndex: 3 },
    ]);
  });

  it("derives a word range when a Chrome voice omits the event length", async () => {
    const port: BrowserTtsPort = {
      async speak(_text, options) {
        options.onEvent({ type: "word", charIndex: 6 });
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);
    const events: unknown[] = [];

    await adapter.speak(
      {
        type: "browser.speak",
        sessionId: "session-1",
        generationEpoch: 2,
        sentenceIndex: 3,
        text: "Hello world again.",
        language: "en-US",
        voiceId: null,
        playbackSpeed: 1,
      },
      (event) => events.push(event),
    );

    expect(events).toEqual([
      { type: "word", sentenceIndex: 3, charIndex: 6, length: 5 },
    ]);
  });

  it("suppresses cancellation from its own stop but reports unexpected cancellation", async () => {
    let options: Parameters<BrowserTtsPort["speak"]>[1] | undefined;
    const port: BrowserTtsPort = {
      async speak(_text, nextOptions) {
        options = nextOptions;
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const adapter = new BrowserVoiceAdapter(port);
    const events: unknown[] = [];
    const effect: Extract<ReadingSessionEffect, { type: "browser.speak" }> = {
      type: "browser.speak",
      sessionId: "session-1",
      generationEpoch: 2,
      sentenceIndex: 0,
      text: "A sentence.",
      language: "en-US",
      voiceId: null,
      playbackSpeed: 1,
    };

    await adapter.speak(effect, (event) => events.push(event));
    adapter.stop();
    options?.onEvent({ type: "cancelled" });
    expect(events).toEqual([]);

    await adapter.speak(effect, (event) => events.push(event));
    options?.onEvent({ type: "cancelled" });
    expect(events).toEqual([{ type: "cancelled", sentenceIndex: 0 }]);
  });
});

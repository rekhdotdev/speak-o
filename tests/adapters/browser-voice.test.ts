import {
  BrowserVoiceAdapter,
  type BrowserTtsPort,
} from "../../src/adapters/browser-voice";
import type { ReadingSessionEffect } from "../../src/session/types";

describe("Browser Voice adapter contract", () => {
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

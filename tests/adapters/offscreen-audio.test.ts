type RuntimeMessageListener = (
  message: unknown,
  sender: { id?: string },
) => void;

class FakeAudioElement extends EventTarget {
  static latest: FakeAudioElement | null = null;

  currentTime = 0;
  paused = true;
  playbackRate = 1;
  preservesPitch = false;
  preload = "";
  readyState = HTMLMediaElement.HAVE_METADATA;
  src: string;

  constructor(src: string) {
    super();
    this.src = src;
    FakeAudioElement.latest = this;
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  load(): void {}
}

describe("Cloud Voice offscreen audio", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    FakeAudioElement.latest = null;
  });

  it("samples the active media clock often enough to expose short words", async () => {
    vi.useFakeTimers();
    let listener: RuntimeMessageListener | null = null;
    const sendMessage = vi.fn((_message: Record<string, unknown>) =>
      Promise.resolve(),
    );
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        onMessage: {
          addListener: vi.fn((registered: RuntimeMessageListener) => {
            listener = registered;
          }),
        },
        sendMessage,
      },
    });
    vi.stubGlobal("Audio", FakeAudioElement);
    vi.stubGlobal(
      "URL",
      class extends globalThis.URL {
        static override createObjectURL(): string {
          return "blob:short-words";
        }

        static override revokeObjectURL(): void {}
      },
    );

    await import("../../entrypoints/offscreen/main");
    const registeredListener = listener as RuntimeMessageListener | null;
    if (!registeredListener) {
      throw new Error("Offscreen listener was not registered");
    }

    registeredListener(
      {
        version: 1,
        target: "offscreen",
        type: "audio.play",
        sessionId: "session-short-words",
        generationEpoch: 1,
        sentenceIndex: 0,
        audioBase64: btoa("audio"),
        startAtMs: 0,
        playbackSpeed: 1,
      },
      { id: "extension-id" },
    );
    await Promise.resolve();

    const media = FakeAudioElement.latest;
    if (!media) throw new Error("Audio was not created");
    for (const mediaTimeMs of [60, 120, 180]) {
      media.currentTime = mediaTimeMs / 1_000;
      await vi.advanceTimersByTimeAsync(50);
    }

    const progressTimes = sendMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter(
        (message) =>
          message.type === "audio.event" &&
          (message.event as Record<string, unknown>).type === "progress",
      )
      .map(
        (message) =>
          (message.event as Record<string, unknown>).mediaTimeMs as number,
      );
    expect(progressTimes).toEqual([0, 60, 120, 180]);

    registeredListener(
      { version: 1, target: "offscreen", type: "audio.pause" },
      { id: "extension-id" },
    );
    media.currentTime = 0.24;
    await vi.advanceTimersByTimeAsync(100);
    expect(sendMessage).toHaveBeenCalledTimes(4);

    registeredListener(
      { version: 1, target: "offscreen", type: "audio.resume" },
      { id: "extension-id" },
    );
    await Promise.resolve();
    media.currentTime = 0.3;
    await vi.advanceTimersByTimeAsync(50);
    const resumedProgressTimes = sendMessage.mock.calls.map(
      ([message]) =>
        (message.event as Record<string, unknown>).mediaTimeMs as number,
    );
    expect(resumedProgressTimes).toEqual([0, 60, 120, 180, 240, 300]);
  });
});

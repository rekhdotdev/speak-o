import {
  ElevenLabsMetadataClient,
  ElevenLabsTransport,
  elevenLabsOrigin,
  type WebSocketLike,
} from "../../src/provider/elevenlabs";
import { RuntimeDebugBuffer } from "../../src/diagnostics/runtime-debug";

class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  readonly listeners = new Map<
    string,
    Array<(event: Event | MessageEvent) => void>
  >();
  closed = false;

  addEventListener(
    type: string,
    listener: (event: Event | MessageEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: Event | MessageEvent = new Event(type)): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe("ElevenLabs adapter contract", () => {
  it("uses the exact current origin for each configured API Region", () => {
    expect(elevenLabsOrigin("global")).toBe("https://api.elevenlabs.io");
    expect(elevenLabsOrigin("us")).toBe("https://api.us.elevenlabs.io");
    expect(elevenLabsOrigin("eu")).toBe(
      "https://api.eu.residency.elevenlabs.io",
    );
    expect(elevenLabsOrigin("india")).toBe(
      "https://api.in.residency.elevenlabs.io",
    );
    expect(elevenLabsOrigin("singapore")).toBe(
      "https://api.sg.residency.elevenlabs.io",
    );
  });

  it("binds the platform fetch receiver before making metadata requests", async () => {
    const receivers: unknown[] = [];
    const unboundFetch = function (
      this: unknown,
      input: RequestInfo | URL,
    ): Promise<Response> {
      receivers.push(this);
      return String(input).endsWith("/v1/models")
        ? Promise.resolve(
            Response.json([
              {
                model_id: "eleven_multilingual_v2",
                name: "Multilingual v2",
                can_do_text_to_speech: true,
              },
            ]),
          )
        : Promise.resolve(Response.json({ voices: [] }));
    } as typeof fetch;
    const client = new ElevenLabsMetadataClient(unboundFetch);

    await client.validateAndLoad("sk_test_123456789", "global");

    expect(receivers).toEqual([globalThis, globalThis]);
  });

  it("validates a credential with metadata requests and returns sanitized Voices and Models", async () => {
    const calls: Array<{ url: string; apiKey: string | null }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, apiKey: headers.get("xi-api-key") });
      if (url.endsWith("/v1/models")) {
        return Response.json([
          {
            model_id: "eleven_multilingual_v2",
            name: "Multilingual v2",
            can_do_text_to_speech: true,
            languages: [{ language_id: "en" }, { language_id: "hi" }],
          },
          { model_id: "not-tts", name: "Other", can_do_text_to_speech: false },
        ]);
      }
      return Response.json({
        voices: [
          {
            voice_id: "voice-1",
            name: "Calm Voice",
            preview_url: "https://cdn.example.invalid/preview.mp3",
            labels: { accent: "Indian" },
          },
          { voice_id: "", name: "Malformed" },
        ],
      });
    };
    const client = new ElevenLabsMetadataClient(fakeFetch);

    const metadata = await client.validateAndLoad("sk_test_123456789", "india");

    expect(calls).toEqual([
      {
        url: "https://api.in.residency.elevenlabs.io/v1/models",
        apiKey: "sk_test_123456789",
      },
      {
        url: "https://api.in.residency.elevenlabs.io/v2/voices?page_size=100",
        apiKey: "sk_test_123456789",
      },
    ]);
    expect(metadata).toEqual({
      voices: [
        {
          id: "voice-1",
          name: "Calm Voice",
          previewUrl: "https://cdn.example.invalid/preview.mp3",
          labels: { accent: "Indian" },
        },
      ],
      models: [
        {
          id: "eleven_multilingual_v2",
          name: "Multilingual v2",
          languages: ["en", "hi"],
        },
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain("sk_test");
  });

  it("captures redacted provider status and error details for a failed metadata request", async () => {
    const debug = new RuntimeDebugBuffer(20, () => 1);
    const fakeFetch: typeof fetch = async () =>
      Response.json(
        {
          detail: {
            code: "workspace_not_found",
            message: "Workspace sk_test_secret not found",
          },
        },
        {
          status: 404,
          headers: {
            "content-type": "application/json",
            "x-trace-id": "trace-123",
          },
        },
      );
    const client = new ElevenLabsMetadataClient(fakeFetch, (event, data) =>
      debug.record("background", event, data),
    );

    await expect(
      client.validateAndLoad("sk_test_secret", "global"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const log = debug.format();
    expect(log).toContain('"resource":"models"');
    expect(log).toContain('"status":404');
    expect(log).toContain('"traceId":"trace-123"');
    expect(log).toContain('"providerCodePresent":true');
    expect(log).toContain('"providerMessagePresent":true');
    expect(log).not.toContain("workspace_not_found");
    expect(log).not.toContain("Workspace");
    expect(log).not.toContain("sk_test_secret");
  });

  it("captures sanitized network and JSON failures", async () => {
    const debug = new RuntimeDebugBuffer(20, () => 1);
    const networkFailure = new ElevenLabsMetadataClient(
      (async () => {
        throw new TypeError("Failed to fetch https://api.invalid/key=secret");
      }) as typeof fetch,
      (event, data) => debug.record("background", event, data),
    );

    await expect(
      networkFailure.validateAndLoad("sk_test_secret", "global"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const invalidJsonResponse = new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(invalidJsonResponse, "json", {
      value: () =>
        Promise.reject(
          new SyntaxError("Private Article prose echoed in response"),
        ),
    });
    const jsonFailure = new ElevenLabsMetadataClient(
      (async () => invalidJsonResponse) as typeof fetch,
      (event, data) => debug.record("background", event, data),
    );
    await expect(
      jsonFailure.validateAndLoad("sk_test_secret", "global"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const log = debug.format();
    expect(log).toContain("provider.metadata.network-error");
    expect(log).toContain('"errorName":"TypeError"');
    expect(log).toContain('"errorMessage":"Failed to fetch <URL>"');
    expect(log).toContain("provider.metadata.json-error");
    expect(log).toContain('"errorName":"SyntaxError"');
    expect(log).not.toContain("Private Article prose");
    expect(log).not.toContain("key=secret");
    expect(log).not.toContain("sk_test_secret");
  });

  it("streams a real bounded burst without credential URLs or whitespace keepalives", () => {
    const sockets: FakeSocket[] = [];
    const openedUrls: string[] = [];
    const events: unknown[] = [];
    const debug = new RuntimeDebugBuffer(100, () => 1);
    const transport = new ElevenLabsTransport(
      (url) => {
        openedUrls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-1",
        sentences: [
          { index: 4, text: "One real sentence." },
          { index: 5, text: "Another real sentence." },
        ],
        voiceId: "voice/with spaces",
        modelId: "eleven_multilingual_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    expect(openedUrls[0]).toContain(
      "wss://api.elevenlabs.io/v1/text-to-speech/voice%2Fwith%20spaces/stream-input",
    );
    expect(openedUrls[0]).toContain("sync_alignment=true");
    expect(openedUrls[0]).not.toContain("sk_secret_123");

    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error("Socket was not created");
    firstSocket.emit("open");
    const sent = firstSocket.sent.map(
      (message) => JSON.parse(message) as Record<string, unknown>,
    );
    expect(sent[0]).toMatchObject({
      text: "One real sentence. ",
      xi_api_key: "sk_secret_123",
      flush: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent.some((message) => message.text === " ")).toBe(false);

    firstSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "AQID",
          alignment: {
            chars: ["O", "n", "e"],
            charStartTimesMs: [0, 40, 80],
            charDurationsMs: [40, 40, 50],
          },
          isFinal: false,
        }),
      }),
    );
    expect(events).toEqual([]);

    transport.pausePrefetch();
    const remainingText = " real sentence. ";
    firstSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "BAUG",
          alignment: {
            chars: Array.from(remainingText),
            char_start_times_ms: Array.from(
              { length: remainingText.length },
              (_, index) => 130 + index * 40,
            ),
            char_durations_ms: Array.from(
              { length: remainingText.length },
              () => 40,
            ),
          },
          is_final: false,
        }),
      }),
    );
    expect(events).toEqual([]);
    expect(firstSocket.sent).toHaveLength(1);

    transport.resumePrefetch();
    const resumedSent = firstSocket.sent.map(
      (message) => JSON.parse(message) as Record<string, unknown>,
    );
    expect(resumedSent[1]).toMatchObject({
      text: "Another real sentence. ",
      flush: true,
    });
    expect(resumedSent[1]).not.toHaveProperty("xi_api_key");
    expect(resumedSent[2]).toEqual({ text: "" });
    const secondText = "Another real sentence. ";
    firstSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "BwgJ",
          alignment: {
            chars: Array.from(secondText),
            charStartTimesMs: Array.from(
              { length: secondText.length },
              (_, index) => 900 + index * 40,
            ),
            charDurationsMs: Array.from(
              { length: secondText.length },
              () => 40,
            ),
          },
          isFinal: true,
        }),
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "audio",
        sentenceIndex: 4,
        audioBase64: "AQIDBAUG",
        isFinal: false,
      }),
      expect.objectContaining({
        type: "audio",
        sentenceIndex: 5,
        audioBase64: "BwgJ",
        isFinal: true,
      }),
    ]);
    expect(sockets).toHaveLength(1);

    transport.abortAll();

    const log = debug.format();
    expect(log).toContain("provider.generation.start");
    expect(log).toContain("provider.socket.open");
    expect(log).toContain('"messageType":"initial-text"');
    expect(log).toContain('"messageType":"end-input"');
    expect(log).toContain('"alignmentFormat":"camelCase"');
    expect(log).toContain('"alignmentFormat":"snake_case"');
    expect(log).toContain('"alignmentCharCount":16');
    expect(log).not.toContain("sk_secret_123");
    expect(log).not.toContain("One real sentence.");
  });

  it("accumulates fragmented audio and chunk-relative alignment before advancing the sentence", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const firstAudioBytes = Buffer.alloc(1_600, 1);
    const secondAudioBytes = Buffer.alloc(1_600, 2);
    const tailAudioBytes = Buffer.alloc(320, 3);
    const firstAudio = firstAudioBytes.toString("base64");
    const secondAudio = secondAudioBytes.toString("base64");
    const tailAudio = tailAudioBytes.toString("base64");
    const alignment = (text: string) => ({
      chars: Array.from(text),
      charStartTimesMs: Array.from(
        { length: text.length },
        (_, index) => index * 10,
      ),
      charDurationsMs: Array.from({ length: text.length }, () => 10),
    });
    const transport = new ElevenLabsTransport(() => socket);

    transport.generateBurst(
      {
        requestId: "request-fragmented",
        sentences: [{ index: 0, text: "First sentence." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: firstAudio,
          alignment: alignment("First "),
          isFinal: false,
        }),
      }),
    );

    expect(events).toEqual([]);
    expect(socket.sent).toHaveLength(2);

    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: secondAudio,
          alignment: alignment("sentence."),
          isFinal: false,
        }),
      }),
    );

    expect(events).toEqual([]);
    expect(
      socket.sent.map(
        (message) => (JSON.parse(message) as Record<string, unknown>).text,
      ),
    ).toEqual(["First sentence. ", ""]);

    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: tailAudio,
          alignment: {
            chars: [],
            charStartTimesMs: [],
            charDurationsMs: [],
          },
          isFinal: true,
        }),
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "audio",
        requestId: "request-fragmented",
        sentenceIndex: 0,
        audioBase64: Buffer.concat([
          firstAudioBytes,
          secondAudioBytes,
          tailAudioBytes,
        ]).toString("base64"),
        alignment: null,
        acknowledged: true,
        isFinal: true,
      }),
    ]);
  });

  it("does not delay words when fragmented alignment is already sentence-relative", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const firstAudioBytes = Buffer.alloc(16_000, 1);
    const secondAudioBytes = Buffer.alloc(16_000, 2);
    const debug = new RuntimeDebugBuffer(40, () => 1);
    const transport = new ElevenLabsTransport(
      () => socket,
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-sentence-relative",
        sentences: [{ index: 0, text: "One two." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: firstAudioBytes.toString("base64"),
          alignment: {
            chars: Array.from("One "),
            charStartTimesMs: [0, 100, 200, 300],
            charDurationsMs: [100, 100, 100, 100],
          },
          isFinal: false,
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: secondAudioBytes.toString("base64"),
          alignment: {
            chars: Array.from("two."),
            charStartTimesMs: [1000, 1100, 1200, 1300],
            charDurationsMs: [100, 100, 100, 100],
          },
          isFinal: false,
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ audio: "", isFinal: true }),
      }),
    );

    const audioEvent = events[0] as {
      type: string;
      sentenceIndex: number;
      alignment: unknown;
    };
    expect(audioEvent).toMatchObject({ type: "audio", sentenceIndex: 0 });
    expect(audioEvent.alignment).toEqual({
      chars: Array.from("One two."),
      charStartTimesMs: [0, 100, 200, 300, 1000, 1100, 1200, 1300],
      charDurationsMs: [100, 100, 100, 100, 100, 100, 100, 100],
    });
    expect(debug.format()).toContain('"alignmentTimeline":"sentence"');
    expect(debug.format()).toContain('"sentenceRelativeFragments":1');
  });

  it("falls back to sentence highlighting for an ambiguous fragment timeline", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const transport = new ElevenLabsTransport(() => socket);

    transport.generateBurst(
      {
        requestId: "request-ambiguous-alignment",
        sentences: [{ index: 0, text: "One two." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: Buffer.alloc(16_000, 1).toString("base64"),
          alignment: {
            chars: Array.from("One "),
            charStartTimesMs: [0, 100, 200, 300],
            charDurationsMs: [100, 100, 100, 100],
          },
          isFinal: false,
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: Buffer.alloc(16_000, 2).toString("base64"),
          alignment: {
            chars: Array.from("two."),
            charStartTimesMs: [300, 400, 500, 600],
            charDurationsMs: [100, 100, 100, 100],
          },
          isFinal: true,
        }),
      }),
    );

    expect(events[0]).toMatchObject({
      type: "audio",
      sentenceIndex: 0,
      alignment: null,
    });
  });

  it("normalizes stream-global alignment within one rolling burst", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const firstSentence = "Intro.";
    const secondSentence =
      "How do you ship a software product with 0 lines of manually-written code?";
    const firstAudioBytes = Buffer.alloc(16_000, 1);
    const secondAudioBytes = Buffer.alloc(64_000, 2);
    const alignment = (text: string, startMs: number) => ({
      chars: Array.from(`${text} `),
      charStartTimesMs: Array.from(
        { length: text.length + 1 },
        (_, index) => startMs + index * 50,
      ),
      charDurationsMs: Array.from({ length: text.length + 1 }, () => 50),
    });
    const transport = new ElevenLabsTransport(() => socket);

    transport.generateBurst(
      {
        requestId: "request-batch-global-alignment",
        sentences: [
          { index: 0, text: firstSentence },
          { index: 1, text: secondSentence },
        ],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: firstAudioBytes.toString("base64"),
          alignment: alignment(firstSentence, 0),
          isFinal: false,
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: secondAudioBytes.toString("base64"),
          alignment: alignment(secondSentence, 500),
          isFinal: true,
        }),
      }),
    );

    const secondAudioEvent = events[1] as {
      type: string;
      sentenceIndex: number;
      alignment: {
        charStartTimesMs: number[];
      } | null;
    };
    expect(secondAudioEvent).toMatchObject({
      type: "audio",
      sentenceIndex: 1,
    });
    expect(secondAudioEvent.alignment?.charStartTimesMs[0]).toBe(0);
    expect(secondAudioEvent.alignment?.charStartTimesMs.at(-1)).toBe(3_600);
    expect(socket.sent).toHaveLength(3);
  });

  it("falls back when alignment timestamps exceed the sentence audio", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const transport = new ElevenLabsTransport(() => socket);
    const sentence = "Out of range.";

    transport.generateBurst(
      {
        requestId: "request-out-of-range",
        sentences: [{ index: 0, text: sentence }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: Buffer.alloc(16_000, 1).toString("base64"),
          alignment: {
            chars: Array.from(`${sentence} `),
            charStartTimesMs: Array.from(
              { length: sentence.length + 1 },
              (_, index) => 2_000 + index * 200,
            ),
            charDurationsMs: Array.from(
              { length: sentence.length + 1 },
              () => 50,
            ),
          },
          isFinal: true,
        }),
      }),
    );

    expect(events[0]).toMatchObject({
      type: "audio",
      sentenceIndex: 0,
      alignment: null,
    });
  });

  it("does not copy malformed provider payload text into parse diagnostics", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const debug = new RuntimeDebugBuffer(20, () => 1);
    const transport = new ElevenLabsTransport(
      () => socket,
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-malformed-json",
        sentences: [{ index: 0, text: "A sentence." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: '{"message":"Private Article prose echoed by provider"',
      }),
    );

    expect(events).toEqual([]);
    expect(debug.format()).toContain('"errorName":"SyntaxError"');
    expect(debug.format()).not.toContain("Private Article prose");
  });

  it("advances after final audio without alignment and falls back to sentence highlighting", () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const transport = new ElevenLabsTransport(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    transport.generateBurst(
      {
        requestId: "request-missing-alignment",
        sentences: [
          { index: 2, text: "No timing here." },
          { index: 3, text: "Timing returns." },
        ],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error("First socket was not created");
    firstSocket.emit("open");
    firstSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ audio: "AQID", isFinal: true }),
      }),
    );

    expect(events[0]).toMatchObject({
      type: "audio",
      sentenceIndex: 2,
      alignment: null,
      isFinal: false,
    });
    expect(sockets).toHaveLength(2);

    const secondSocket = sockets[1];
    if (!secondSocket) throw new Error("Second socket was not created");
    secondSocket.emit("open");
    secondSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "BAUG",
          alignment: {
            chars: Array.from("Timing returns. "),
            charStartTimesMs: Array.from(
              { length: 16 },
              (_, index) => index * 40,
            ),
            charDurationsMs: Array.from({ length: 16 }, () => 40),
          },
          isFinal: true,
        }),
      }),
    );

    expect(events[1]).toMatchObject({
      type: "audio",
      sentenceIndex: 3,
      isFinal: true,
    });
  });

  it("reports an unexpected close after text submission as possibly billable", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const debug = new RuntimeDebugBuffer(20, () => 1);
    const transport = new ElevenLabsTransport(
      () => socket,
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-close",
        sentences: [{ index: 0, text: "Possibly submitted." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    const closeEvent = new Event("close");
    Object.defineProperties(closeEvent, {
      code: { value: 1008 },
      reason: { value: "Private Article prose echoed by provider" },
      wasClean: { value: true },
    });
    socket.emit("close", closeEvent);

    expect(events).toEqual([
      {
        type: "failure",
        requestId: "request-close",
        errorCode: "PROVIDER_SOCKET_FAILED",
        acknowledged: true,
        receivedAudio: false,
      },
    ]);
    expect(debug.format()).toContain('"closeReasonPresent":true');
    expect(debug.format()).not.toContain("Private Article prose");
  });

  it("does not publish partial audio when a stream fails before its final marker", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const transport = new ElevenLabsTransport(() => socket);

    transport.generateBurst(
      {
        requestId: "request-partial-failure",
        sentences: [{ index: 0, text: "Partial sentence." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ audio: "AQID", isFinal: false }),
      }),
    );
    socket.emit("error");

    expect(events).toEqual([
      {
        type: "failure",
        requestId: "request-partial-failure",
        errorCode: "PROVIDER_SOCKET_FAILED",
        acknowledged: true,
        receivedAudio: true,
      },
    ]);
  });

  it("surfaces provider WebSocket errors and closes as actionable debug events", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const debug = new RuntimeDebugBuffer(40, () => 1);
    const transport = new ElevenLabsTransport(
      () => socket,
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-error",
        sentences: [{ index: 1, text: "A sentence." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          message: "The model is not available for this voice.",
          error: "invalid_model",
          code: 400,
          param: "model_id",
        }),
      }),
    );

    expect(events).toContainEqual({
      type: "failure",
      requestId: "request-error",
      errorCode: "PROVIDER_SOCKET_FAILED",
      acknowledged: true,
      receivedAudio: false,
    });
    const log = debug.format();
    expect(log).toContain("provider.socket.provider-error");
    expect(log).toContain('"providerCodePresent":true');
    expect(log).toContain('"providerCloseCode":400');
    expect(log).not.toContain("invalid_model");
    expect(log).not.toContain("The model is not available for this voice.");
    expect(log).not.toContain("sk_secret_123");
  });

  it("recognizes the camelCase final response and completes without a close failure", () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const debug = new RuntimeDebugBuffer(40, () => 1);
    const transport = new ElevenLabsTransport(
      () => socket,
      (event, data) => debug.record("background", event, data),
    );

    transport.generateBurst(
      {
        requestId: "request-final",
        sentences: [{ index: 0, text: "Done." }],
        voiceId: "voice-1",
        modelId: "eleven_flash_v2",
        region: "global",
      },
      "sk_secret_123",
      (event) => events.push(event),
    );

    socket.emit("open");
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "AQID",
          alignment: {
            chars: ["D", "o", "n", "e", ".", " "],
            charStartTimesMs: [0, 40, 80, 120, 160, 200],
            charDurationsMs: [40, 40, 40, 40, 40, 40],
          },
          isFinal: false,
        }),
      }),
    );
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ audio: "", isFinal: true }),
      }),
    );

    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "failure" }),
    );
    expect(debug.format()).toContain("provider.socket.complete");
  });
});

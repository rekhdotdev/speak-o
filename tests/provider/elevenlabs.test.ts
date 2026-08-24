import {
  ElevenLabsMetadataClient,
  ElevenLabsTransport,
  elevenLabsOrigin,
  type WebSocketLike,
} from "../../src/provider/elevenlabs";

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

  it("streams a real bounded burst without credential URLs or whitespace keepalives", () => {
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

    let socket: FakeSocket | null = null;
    let openedUrl = "";
    const events: unknown[] = [];
    const transport = new ElevenLabsTransport((url) => {
      openedUrl = url;
      socket = new FakeSocket();
      return socket;
    });

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

    expect(openedUrl).toContain(
      "wss://api.elevenlabs.io/v1/text-to-speech/voice%2Fwith%20spaces/stream-input",
    );
    expect(openedUrl).toContain("sync_alignment=true");
    expect(openedUrl).not.toContain("sk_secret_123");

    const activeSocket = socket as FakeSocket | null;
    if (!activeSocket) throw new Error("Socket was not created");
    activeSocket.emit("open");
    let sent = activeSocket.sent.map(
      (message) => JSON.parse(message) as Record<string, unknown>,
    );
    expect(sent[0]).toMatchObject({
      text: "One real sentence. ",
      xi_api_key: "sk_secret_123",
      flush: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent.some((message) => message.text === " ")).toBe(false);

    activeSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "AQID",
          alignment: {
            chars: ["O", "n", "e"],
            char_start_times_ms: [0, 40, 80],
            char_durations_ms: [40, 40, 50],
          },
          is_final: false,
        }),
      }),
    );
    expect(events).toContainEqual({
      type: "audio",
      requestId: "request-1",
      sentenceIndex: 4,
      audioBase64: "AQID",
      alignment: {
        chars: ["O", "n", "e"],
        charStartTimesMs: [0, 40, 80],
        charDurationsMs: [40, 40, 50],
      },
      acknowledged: true,
      isFinal: false,
    });

    transport.pausePrefetch();
    const remainingText = " real sentence. ";
    activeSocket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({
          audio: "BAUG",
          alignment: {
            chars: Array.from(remainingText),
            char_start_times_ms: Array.from(
              { length: remainingText.length },
              (_, index) => index * 40,
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
    expect(activeSocket.sent).toHaveLength(1);

    transport.resumePrefetch();
    sent = activeSocket.sent.map(
      (message) => JSON.parse(message) as Record<string, unknown>,
    );
    expect(sent[1]).toMatchObject({
      text: "Another real sentence. ",
      flush: true,
    });
    expect(sent.at(-1)).toEqual({ text: "" });

    transport.abortAll();
    expect(activeSocket.closed).toBe(true);
  });
});

import {
  SPEECHIFY_DEFAULT_MODEL,
  SpeechifyMetadataClient,
  SpeechifyProviderError,
  SpeechifyTransport,
} from "../../src/provider/speechify";

const credential = "sk_test_speechify_credential";

function voice(id: string, name: string, locale = "en-US") {
  return {
    id,
    type: "shared",
    display_name: name,
    models: [
      {
        name: "simba-3.0",
        languages: [{ locale, preview_audio: null }],
      },
    ],
    gender: "female",
    locale,
    preview_audio: `https://example.com/${id}.mp3`,
  };
}

describe("Speechify metadata", () => {
  it("loads every page of the live voices response envelope", async () => {
    const urls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return Response.json(
        url.includes("cursor=next-page")
          ? { voices: [voice("alec", "Alec", "en-GB")], has_more: false }
          : {
              voices: [voice("alicia", "Alicia")],
              next_cursor: "next-page",
              has_more: true,
            },
      );
    };

    const metadata = await new SpeechifyMetadataClient(
      fakeFetch,
    ).validateAndLoad(credential);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("limit=200");
    expect(urls[1]).toContain("cursor=next-page");
    expect(metadata.voices.map((item) => item.id)).toEqual(["alec", "alicia"]);
    expect(metadata.models).toEqual([
      {
        id: "simba-3.0",
        name: "Simba 3.0",
        languages: ["en-GB", "en-US"],
      },
    ]);
  });

  it("rejects a repeated pagination cursor", async () => {
    const fakeFetch: typeof fetch = async () =>
      Response.json({
        voices: [],
        next_cursor: "repeat",
        has_more: true,
      });

    await expect(
      new SpeechifyMetadataClient(fakeFetch).validateAndLoad(credential),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps authentication failures without reading provider response text", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("provider secret detail", { status: 401 });

    await expect(
      new SpeechifyMetadataClient(fakeFetch).validateAndLoad(credential),
    ).rejects.toEqual(new SpeechifyProviderError("AUTH_FAILED"));
  });
});

describe("Speechify transport", () => {
  it("streams one bounded MP3 per sentence with sentence-level highlighting", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const events: unknown[] = [];
    const transport = new SpeechifyTransport(fakeFetch);

    transport.generateBurst(
      {
        requestId: "request-1",
        sentences: [
          { index: 2, text: "First sentence." },
          { index: 3, text: "Second sentence." },
        ],
        language: "en-US",
        voiceId: "alicia",
        modelId: SPEECHIFY_DEFAULT_MODEL,
        region: "global",
      },
      credential,
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(2));

    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      input: "First sentence.",
      voice_id: "alicia",
      model: "simba-3.0",
      language: "en-US",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "audio",
        sentenceIndex: 2,
        audioBase64: "AQID",
        alignment: null,
        isFinal: false,
      }),
      expect.objectContaining({
        type: "audio",
        sentenceIndex: 3,
        alignment: null,
        isFinal: true,
      }),
    ]);
  });

  it("does not report an aborted request as a provider failure", async () => {
    const events: unknown[] = [];
    const fakeFetch: typeof fetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    const transport = new SpeechifyTransport(fakeFetch);
    transport.generateBurst(
      {
        requestId: "request-abort",
        sentences: [{ index: 0, text: "Stop me." }],
        language: "en-US",
        voiceId: "alicia",
        modelId: "simba-3.0",
        region: "global",
      },
      credential,
      (event) => events.push(event),
    );
    transport.abortAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it("pauses prefetch after the current sentence", async () => {
    const requests: string[] = [];
    const events: unknown[] = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      requests.push(String(JSON.parse(String(init?.body)).input));
      return new Response(new Uint8Array([1]), {
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const transport = new SpeechifyTransport(fakeFetch);
    transport.pausePrefetch();
    transport.generateBurst(
      {
        requestId: "request-paused",
        sentences: [
          { index: 0, text: "Current." },
          { index: 1, text: "Prefetched." },
        ],
        language: "en-US",
        voiceId: "alicia",
        modelId: "simba-3.0",
        region: "global",
      },
      credential,
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(requests).toEqual(["Current."]);
    transport.resumePrefetch();
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(requests).toEqual(["Current.", "Prefetched."]);
  });
});

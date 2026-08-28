import type {
  ElevenLabsRegion,
  ProviderGenerationRequest,
  ProviderMetadata,
  ProviderModel,
  ProviderTransportEvent,
  ProviderVoice,
} from "./types";
import type { SpeechAlignment } from "../session/types";

const ORIGINS: Record<ElevenLabsRegion, string> = {
  global: "https://api.elevenlabs.io",
  us: "https://api.us.elevenlabs.io",
  eu: "https://api.eu.residency.elevenlabs.io",
  india: "https://api.in.residency.elevenlabs.io",
  singapore: "https://api.sg.residency.elevenlabs.io",
};

export type ElevenLabsVoice = ProviderVoice;
export type ElevenLabsModel = ProviderModel;
export type ElevenLabsMetadata = ProviderMetadata;

type ElevenLabsMetadataResource = "models" | "voices";
type ElevenLabsDebugValue = string | number | boolean | null;
export type ElevenLabsDebugLogger = (
  event: string,
  data: Record<string, ElevenLabsDebugValue>,
) => void;

export class ElevenLabsProviderError extends Error {
  constructor(
    readonly code: "AUTH_FAILED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE",
  ) {
    super(
      code === "AUTH_FAILED"
        ? "ElevenLabs rejected the Provider Credential."
        : code === "RATE_LIMITED"
          ? "ElevenLabs rate limited the metadata request."
          : "ElevenLabs metadata is currently unavailable.",
    );
    this.name = "ElevenLabsProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanLabels(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length <= 120,
    ),
  );
}

function parseVoices(value: unknown): ElevenLabsVoice[] {
  if (!isRecord(value) || !Array.isArray(value.voices)) return [];
  return value.voices.flatMap((voice): ElevenLabsVoice[] => {
    if (
      !isRecord(voice) ||
      typeof voice.voice_id !== "string" ||
      voice.voice_id.length === 0 ||
      typeof voice.name !== "string" ||
      voice.name.length === 0
    ) {
      return [];
    }
    const previewUrl =
      typeof voice.preview_url === "string" &&
      voice.preview_url.startsWith("https://")
        ? voice.preview_url
        : null;
    return [
      {
        id: voice.voice_id.slice(0, 160),
        name: voice.name.slice(0, 200),
        previewUrl,
        labels: cleanLabels(voice.labels),
        models: [],
      },
    ];
  });
}

function parseModels(value: unknown): ElevenLabsModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((model): ElevenLabsModel[] => {
    if (
      !isRecord(model) ||
      model.can_do_text_to_speech !== true ||
      typeof model.model_id !== "string" ||
      model.model_id.length === 0 ||
      typeof model.name !== "string" ||
      model.name.length === 0
    ) {
      return [];
    }
    const languages = Array.isArray(model.languages)
      ? model.languages.flatMap((language): string[] =>
          isRecord(language) &&
          typeof language.language_id === "string" &&
          language.language_id.length <= 35
            ? [language.language_id]
            : [],
        )
      : [];
    return [
      {
        id: model.model_id.slice(0, 160),
        name: model.name.slice(0, 200),
        languages,
      },
    ];
  });
}

export function elevenLabsOrigin(region: ElevenLabsRegion): string {
  return ORIGINS[region];
}

export function elevenLabsOriginPattern(region: ElevenLabsRegion): string {
  return `${elevenLabsOrigin(region)}/*`;
}

export class ElevenLabsMetadataClient {
  private readonly fetcher: typeof fetch;

  constructor(
    fetcher: typeof fetch = globalThis.fetch,
    private readonly debug?: ElevenLabsDebugLogger,
  ) {
    this.fetcher = fetcher.bind(globalThis);
  }

  async validateAndLoad(
    credential: string,
    region: ElevenLabsRegion,
  ): Promise<ElevenLabsMetadata> {
    const origin = elevenLabsOrigin(region);
    const headers = { accept: "application/json", "xi-api-key": credential };
    const modelResponse = await this.fetchMetadata(
      `${origin}/v1/models`,
      "models",
      region,
      headers,
    );
    const voiceResponse = await this.fetchMetadata(
      `${origin}/v2/voices?page_size=100`,
      "voices",
      region,
      headers,
    );
    return {
      voices: parseVoices(voiceResponse),
      models: parseModels(modelResponse),
    };
  }

  private async fetchMetadata(
    url: string,
    resource: ElevenLabsMetadataResource,
    region: ElevenLabsRegion,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const startedAt = Date.now();
    this.debug?.("provider.metadata.request", { region, resource });
    let response: Response;
    try {
      response = await this.fetcher(url, { headers, method: "GET" });
    } catch (error) {
      this.debug?.("provider.metadata.network-error", {
        region,
        resource,
        errorName:
          error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
        errorMessage:
          error instanceof Error
            ? error.message.slice(0, 240)
            : String(error).slice(0, 240),
      });
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
    }
    const contentType =
      response.headers.get("content-type")?.slice(0, 120) ?? null;
    const rawTraceId = response.headers.get("x-trace-id");
    const traceId =
      rawTraceId && /^[A-Za-z0-9_-]{1,120}$/.test(rawTraceId)
        ? rawTraceId
        : null;
    this.debug?.("provider.metadata.response", {
      region,
      resource,
      status: response.status,
      ok: response.ok,
      contentType,
      traceId,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    if (response.status === 401 || response.status === 403) {
      await this.logProviderError(response, resource, region);
      throw new ElevenLabsProviderError("AUTH_FAILED");
    }
    if (response.status === 429) {
      await this.logProviderError(response, resource, region);
      throw new ElevenLabsProviderError("RATE_LIMITED");
    }
    if (!response.ok) {
      await this.logProviderError(response, resource, region);
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
    }
    try {
      return await response.json();
    } catch (error) {
      this.debug?.("provider.metadata.json-error", {
        region,
        resource,
        errorName:
          error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      });
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
    }
  }

  private async logProviderError(
    response: Response,
    resource: ElevenLabsMetadataResource,
    region: ElevenLabsRegion,
  ): Promise<void> {
    try {
      const body: unknown = await response.json();
      const detail =
        isRecord(body) && isRecord(body.detail) ? body.detail : null;
      this.debug?.("provider.metadata.provider-error", {
        region,
        resource,
        providerCodePresent: detail && typeof detail.code === "string",
        providerMessagePresent: detail && typeof detail.message === "string",
      });
    } catch (error: unknown) {
      this.debug?.("provider.metadata.error-body-error", {
        region,
        resource,
        errorName:
          error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      });
    }
  }
}

export interface WebSocketLike {
  addEventListener(
    type: string,
    listener: (event: Event | MessageEvent) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type ElevenLabsGenerationRequest = Omit<
  ProviderGenerationRequest,
  "language"
> & { language?: string };

export type ElevenLabsTransportEvent = ProviderTransportEvent;

export type WebSocketFactory = (url: string) => WebSocketLike;

function alignmentCharacters(value: unknown): string[] | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.chars) ||
    !value.chars.every((character) => typeof character === "string")
  ) {
    return null;
  }
  return value.chars as string[];
}

function parseAlignment(value: unknown): SpeechAlignment | null {
  const chars = alignmentCharacters(value);
  if (!chars || !isRecord(value)) return null;

  const startTimes = value.charStartTimesMs ?? value.char_start_times_ms;
  const durations =
    value.charDurationsMs ??
    value.char_durations_ms ??
    value.chars_durations_ms;
  if (
    !Array.isArray(startTimes) ||
    !Array.isArray(durations) ||
    chars.length !== startTimes.length ||
    chars.length !== durations.length ||
    !startTimes.every(
      (time) => typeof time === "number" && Number.isFinite(time) && time >= 0,
    ) ||
    !durations.every(
      (duration) =>
        typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration >= 0,
    )
  ) {
    return null;
  }

  const starts = startTimes as number[];
  if (
    starts.some((start, index) => index > 0 && start < (starts[index - 1] ?? 0))
  ) {
    return null;
  }
  return {
    chars,
    charStartTimesMs: starts,
    charDurationsMs: durations as number[],
  };
}

function alignmentFormat(value: unknown): string {
  if (!isRecord(value)) return "missing";
  if (Array.isArray(value.charStartTimesMs)) return "camelCase";
  if (Array.isArray(value.char_start_times_ms)) return "snake_case";
  return "unknown";
}

const MP3_128_KILOBITS_BYTES_PER_MILLISECOND = 16;

interface SentenceAudioAccumulator {
  audioChunks: Uint8Array[];
  audioByteLength: number;
  alignment: SpeechAlignment;
  alignmentUsable: boolean;
  generatedCharacters: number;
  fragmentCount: number;
  textComplete: boolean;
  chunkRelativeAlignmentFragments: number;
  sentenceRelativeAlignmentFragments: number;
  ambiguousAlignmentFragments: number;
  lastAlignmentOffsetMs: number;
  lastAlignmentTimeline:
    "none" | "initial" | "chunk" | "sentence" | "ambiguous";
}

function createSentenceAudioAccumulator(): SentenceAudioAccumulator {
  return {
    audioChunks: [],
    audioByteLength: 0,
    alignment: {
      chars: [],
      charStartTimesMs: [],
      charDurationsMs: [],
    },
    alignmentUsable: true,
    generatedCharacters: 0,
    fragmentCount: 0,
    textComplete: false,
    chunkRelativeAlignmentFragments: 0,
    sentenceRelativeAlignmentFragments: 0,
    ambiguousAlignmentFragments: 0,
    lastAlignmentOffsetMs: 0,
    lastAlignmentTimeline: "none",
  };
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encodeBase64(chunks: Uint8Array[], byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  let binary = "";
  const encodingChunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += encodingChunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + encodingChunkSize),
    );
  }
  return globalThis.btoa(binary);
}

function alignmentTimelineOffset(
  accumulator: SentenceAudioAccumulator,
  alignment: SpeechAlignment,
): {
  offsetMs: number;
  timeline: "none" | "initial" | "chunk" | "sentence" | "ambiguous";
} {
  const firstStartMs = alignment.charStartTimesMs[0];
  if (firstStartMs === undefined) return { offsetMs: 0, timeline: "none" };
  const previousAlignmentIndex = accumulator.alignment.chars.length - 1;
  if (previousAlignmentIndex < 0) {
    return { offsetMs: 0, timeline: "initial" };
  }

  const previousStartMs =
    accumulator.alignment.charStartTimesMs[previousAlignmentIndex] ?? 0;
  const previousEndMs =
    previousStartMs +
    (accumulator.alignment.charDurationsMs[previousAlignmentIndex] ?? 0);
  const estimatedFragmentStartMs =
    accumulator.audioByteLength / MP3_128_KILOBITS_BYTES_PER_MILLISECOND;
  const mediaDurationToleranceMs = 250;
  if (
    firstStartMs >= previousEndMs &&
    firstStartMs + mediaDurationToleranceMs >= estimatedFragmentStartMs
  ) {
    return { offsetMs: 0, timeline: "sentence" };
  }
  return { offsetMs: 0, timeline: "ambiguous" };
}

function appendSentenceAudioFragment(
  accumulator: SentenceAudioAccumulator,
  audioBase64: string,
  alignment: SpeechAlignment | null,
  generatedCharacterCount: number,
): boolean {
  const audioBytes = decodeBase64(audioBase64);
  if (!audioBytes) return false;

  const timeline = alignment
    ? alignmentTimelineOffset(accumulator, alignment)
    : { offsetMs: 0, timeline: "none" as const };
  accumulator.lastAlignmentOffsetMs = timeline.offsetMs;
  accumulator.lastAlignmentTimeline = timeline.timeline;
  if (timeline.timeline === "chunk") {
    accumulator.chunkRelativeAlignmentFragments += 1;
  } else if (timeline.timeline === "sentence") {
    accumulator.sentenceRelativeAlignmentFragments += 1;
  } else if (timeline.timeline === "ambiguous") {
    accumulator.ambiguousAlignmentFragments += 1;
    accumulator.alignmentUsable = false;
  }

  accumulator.audioChunks.push(audioBytes);
  accumulator.audioByteLength += audioBytes.length;
  accumulator.fragmentCount += 1;

  accumulator.generatedCharacters += generatedCharacterCount;
  if (!alignment) {
    accumulator.alignmentUsable = false;
    return true;
  }

  if (accumulator.alignmentUsable) {
    accumulator.alignment.chars.push(...alignment.chars);
    accumulator.alignment.charStartTimesMs.push(
      ...alignment.charStartTimesMs.map((time) => time + timeline.offsetMs),
    );
    accumulator.alignment.charDurationsMs.push(...alignment.charDurationsMs);
  }
  return true;
}

function alignmentForSentence(
  accumulator: SentenceAudioAccumulator,
  sentenceText: string,
): {
  alignment: SpeechAlignment | null;
} {
  if (!accumulator.alignmentUsable) {
    return { alignment: null };
  }

  let alignedText = "";
  let alignedCharacterCount = 0;
  for (const character of accumulator.alignment.chars) {
    alignedText += character;
    alignedCharacterCount += 1;
    if (!sentenceText.startsWith(alignedText)) {
      return { alignment: null };
    }
    if (alignedText === sentenceText) break;
  }
  if (alignedText !== sentenceText) {
    return { alignment: null };
  }

  const alignmentOriginMs = accumulator.alignment.charStartTimesMs[0] ?? 0;
  const lastAlignmentIndex = alignedCharacterCount - 1;
  const alignmentEndMs =
    (accumulator.alignment.charStartTimesMs[lastAlignmentIndex] ?? 0) -
    alignmentOriginMs +
    (accumulator.alignment.charDurationsMs[lastAlignmentIndex] ?? 0);
  const estimatedMediaDurationMs =
    accumulator.audioByteLength / MP3_128_KILOBITS_BYTES_PER_MILLISECOND;
  const mediaDurationToleranceMs = 250;
  if (alignmentEndMs > estimatedMediaDurationMs + mediaDurationToleranceMs) {
    return { alignment: null };
  }

  return {
    alignment: {
      chars: accumulator.alignment.chars.slice(0, alignedCharacterCount),
      charStartTimesMs: accumulator.alignment.charStartTimesMs
        .slice(0, alignedCharacterCount)
        .map((time) => time - alignmentOriginMs),
      charDurationsMs: accumulator.alignment.charDurationsMs.slice(
        0,
        alignedCharacterCount,
      ),
    },
  };
}

function websocketOrigin(region: ElevenLabsRegion): string {
  return elevenLabsOrigin(region).replace(/^https:/, "wss:");
}

function errorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  return {
    errorName:
      error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
    errorMessage:
      error instanceof Error
        ? error.message.slice(0, 240)
        : String(error).slice(0, 240),
  };
}

function closeDetails(event: Event | MessageEvent): {
  closeCode: number | null;
  closeReasonPresent: boolean;
  wasClean: boolean | null;
} {
  const candidate = event as Event & {
    code?: unknown;
    reason?: unknown;
    wasClean?: unknown;
  };
  return {
    closeCode:
      typeof candidate.code === "number" && Number.isFinite(candidate.code)
        ? candidate.code
        : null,
    closeReasonPresent:
      typeof candidate.reason === "string" && candidate.reason.length > 0,
    wasClean:
      typeof candidate.wasClean === "boolean" ? candidate.wasClean : null,
  };
}

export class ElevenLabsTransport {
  private readonly sockets = new Set<WebSocketLike>();
  private readonly abortedSockets = new Set<WebSocketLike>();
  private readonly continueBursts = new Map<WebSocketLike, () => void>();
  private prefetchPaused = false;

  constructor(
    private readonly createSocket: WebSocketFactory = (url) =>
      new WebSocket(url) as WebSocketLike,
    private readonly debug?: ElevenLabsDebugLogger,
  ) {}

  generateBurst(
    request: ElevenLabsGenerationRequest,
    credential: string,
    onEvent: (event: ElevenLabsTransportEvent) => void,
  ): void {
    if (request.sentences.length === 0) return;
    this.debug?.("provider.generation.start", {
      requestId: request.requestId.slice(-24),
      region: request.region,
      modelId: request.modelId,
      voiceId: request.voiceId,
      sentenceCount: request.sentences.length,
      firstSentenceIndex: request.sentences[0]?.index ?? null,
      lastSentenceIndex: request.sentences.at(-1)?.index ?? null,
    });

    const query = new URLSearchParams({
      model_id: request.modelId,
      output_format: "mp3_44100_128",
      sync_alignment: "true",
    });
    const url = `${websocketOrigin(request.region)}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}/stream-input?${query.toString()}`;
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(url);
    } catch (error) {
      this.debug?.("provider.socket.create-error", {
        requestId: request.requestId.slice(-24),
        ...errorDetails(error),
      });
      onEvent({
        type: "failure",
        requestId: request.requestId,
        errorCode: "PROVIDER_SOCKET_FAILED",
        acknowledged: false,
        receivedAudio: false,
      });
      return;
    }

    this.sockets.add(socket);
    let acknowledged = false;
    let receivedAudio = false;
    let completed = false;
    let inputClosed = false;
    let fallbackAfterFinal = false;
    let unrecoverableMissingAlignment = false;
    let sentenceCursor = 0;
    let nextSentenceToSend = 0;
    let sentenceAudio = createSentenceAudioAccumulator();

    this.debug?.("provider.socket.created", {
      requestId: request.requestId.slice(-24),
      sentenceCount: request.sentences.length,
    });

    const fail = (
      eventType: "error" | "close" | "provider-error" | "send-error",
      details: Record<string, string | number | boolean | null> = {},
    ) => {
      if (completed || this.abortedSockets.has(socket)) return;
      completed = true;
      this.sockets.delete(socket);
      this.continueBursts.delete(socket);
      this.debug?.("provider.socket.failed", {
        requestId: request.requestId.slice(-24),
        eventType,
        acknowledged,
        receivedAudio,
        sentenceCursor,
        nextSentenceToSend,
        ...details,
      });
      onEvent({
        type: "failure",
        requestId: request.requestId,
        errorCode: "PROVIDER_SOCKET_FAILED",
        acknowledged,
        receivedAudio,
      });
    };

    const sendEndInput = () => {
      if (completed || inputClosed || this.abortedSockets.has(socket)) return;
      try {
        socket.send(JSON.stringify({ text: "" }));
        inputClosed = true;
        this.debug?.("provider.socket.send", {
          requestId: request.requestId.slice(-24),
          messageType: "end-input",
          sentenceOrdinal: nextSentenceToSend,
          flush: false,
          apiKeyIncluded: false,
        });
      } catch (error) {
        this.debug?.("provider.socket.send-error", {
          requestId: request.requestId.slice(-24),
          messageType: "end-input",
          ...errorDetails(error),
        });
        fail("send-error");
      }
    };

    const sendNextSentence = () => {
      if (
        completed ||
        inputClosed ||
        fallbackAfterFinal ||
        unrecoverableMissingAlignment ||
        this.abortedSockets.has(socket) ||
        (this.prefetchPaused && nextSentenceToSend > 0)
      ) {
        return;
      }
      const sentence = request.sentences[nextSentenceToSend];
      if (!sentence) return;
      const sentenceOrdinal = nextSentenceToSend;
      try {
        socket.send(
          JSON.stringify({
            text: `${sentence.text} `,
            ...(sentenceOrdinal === 0 ? { xi_api_key: credential } : {}),
            flush: true,
          }),
        );
        acknowledged = true;
      } catch (error) {
        this.debug?.("provider.socket.send-error", {
          requestId: request.requestId.slice(-24),
          sentenceIndex: sentence.index,
          sentenceOrdinal,
          ...errorDetails(error),
        });
        fail("send-error");
        return;
      }
      this.debug?.("provider.socket.send", {
        requestId: request.requestId.slice(-24),
        messageType: sentenceOrdinal === 0 ? "initial-text" : "text",
        sentenceIndex: sentence.index,
        sentenceOrdinal,
        sentenceTextLength: sentence.text.length,
        flush: true,
        apiKeyIncluded: sentenceOrdinal === 0,
      });
      nextSentenceToSend += 1;
      if (nextSentenceToSend >= request.sentences.length) sendEndInput();
    };
    this.continueBursts.set(socket, sendNextSentence);

    const finalizeSentenceAudio = (isFinal: boolean): boolean => {
      const sentence = request.sentences[sentenceCursor];
      if (!sentence || sentenceAudio.audioByteLength === 0) return false;
      const completeAudio = sentenceAudio;
      const completeAlignment = alignmentForSentence(
        completeAudio,
        sentence.text,
      ).alignment;
      onEvent({
        type: "audio",
        requestId: request.requestId,
        sentenceIndex: sentence.index,
        audioBase64: encodeBase64(
          completeAudio.audioChunks,
          completeAudio.audioByteLength,
        ),
        alignment: completeAlignment,
        acknowledged: true,
        isFinal,
      });
      sentenceCursor += 1;
      sentenceAudio = createSentenceAudioAccumulator();
      this.debug?.("provider.socket.sentence-complete", {
        requestId: request.requestId.slice(-24),
        sentenceIndex: sentence.index,
        nextSentenceIndex: request.sentences[sentenceCursor]?.index ?? null,
        fragmentCount: completeAudio.fragmentCount,
        bufferedAudioBytes: completeAudio.audioByteLength,
        alignmentUsable: completeAlignment !== null,
        alignmentStartMs: completeAlignment?.charStartTimesMs[0] ?? null,
        estimatedMediaDurationMs: Math.round(
          completeAudio.audioByteLength /
            MP3_128_KILOBITS_BYTES_PER_MILLISECOND,
        ),
        alignmentEndMs: completeAlignment
          ? (completeAlignment.charStartTimesMs.at(-1) ?? 0) +
            (completeAlignment.charDurationsMs.at(-1) ?? 0)
          : null,
        chunkRelativeFragments: completeAudio.chunkRelativeAlignmentFragments,
        sentenceRelativeFragments:
          completeAudio.sentenceRelativeAlignmentFragments,
        ambiguousAlignmentFragments: completeAudio.ambiguousAlignmentFragments,
      });
      return true;
    };

    socket.addEventListener("open", () => {
      this.debug?.("provider.socket.open", {
        requestId: request.requestId.slice(-24),
        sentenceCursor,
        nextSentenceToSend,
      });
      sendNextSentence();
    });

    socket.addEventListener("message", (rawEvent) => {
      if (completed || this.abortedSockets.has(socket)) return;
      const event = rawEvent as MessageEvent;
      if (typeof event.data !== "string") {
        this.debug?.("provider.socket.message.ignored", {
          requestId: request.requestId.slice(-24),
          dataType: typeof event.data,
        });
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        this.debug?.("provider.socket.message-parse-error", {
          requestId: request.requestId.slice(-24),
          errorName:
            error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
        });
        return;
      }
      if (!isRecord(message)) {
        this.debug?.("provider.socket.message.ignored", {
          requestId: request.requestId.slice(-24),
          dataType: Array.isArray(message) ? "array" : typeof message,
        });
        return;
      }

      acknowledged = true;
      const messageType =
        typeof message.message_type === "string" ? message.message_type : null;
      const providerError =
        typeof message.error === "string" ? message.error : null;
      const providerMessage =
        typeof message.message === "string" ? message.message : null;
      const providerCloseCode =
        typeof message.code === "number" && Number.isFinite(message.code)
          ? message.code
          : null;
      const isProviderError =
        providerError !== null ||
        messageType?.toLowerCase().includes("error") === true ||
        (providerCloseCode !== null && providerMessage !== null);
      if (isProviderError) {
        this.debug?.("provider.socket.provider-error", {
          requestId: request.requestId.slice(-24),
          messageTypePresent: messageType !== null,
          providerCodePresent: providerError !== null,
          providerMessagePresent: providerMessage !== null,
          providerCloseCode,
          paramPresent: typeof message.param === "string",
        });
        fail("provider-error", {
          providerCodePresent: providerError !== null,
          providerMessagePresent: providerMessage !== null,
          providerCloseCode,
        });
        return;
      }

      const isFinal = message.isFinal === true || message.is_final === true;
      const alignment = parseAlignment(message.alignment);
      const alignedCharacters = alignmentCharacters(message.alignment);
      const alignedText = alignedCharacters?.join("") ?? "";
      if (sentenceAudio.textComplete && /\S/u.test(alignedText)) {
        finalizeSentenceAudio(false);
      }
      this.debug?.("provider.socket.message", {
        requestId: request.requestId.slice(-24),
        messageTypePresent: messageType !== null,
        isFinal,
        hasAudio: typeof message.audio === "string" && message.audio.length > 0,
        audioLength:
          typeof message.audio === "string" ? message.audio.length : 0,
        hasAlignment: message.alignment !== undefined,
        alignmentFormat: alignmentFormat(message.alignment),
        alignmentCharCount: alignment?.chars.length ?? 0,
        sentenceCursor,
        nextSentenceToSend,
        generatedCharacters: sentenceAudio.generatedCharacters,
      });

      if (typeof message.audio === "string" && message.audio.length > 0) {
        receivedAudio = true;
        const sentence = request.sentences[sentenceCursor];
        if (sentence) {
          const generatedCharactersBefore = sentenceAudio.generatedCharacters;
          if (
            !appendSentenceAudioFragment(
              sentenceAudio,
              message.audio,
              alignment,
              alignedText.length,
            )
          ) {
            this.debug?.("provider.socket.audio-decode-error", {
              requestId: request.requestId.slice(-24),
              sentenceIndex: sentence.index,
              audioLength: message.audio.length,
            });
            fail("provider-error", {
              internalErrorCode: "INVALID_AUDIO_PAYLOAD",
            });
            return;
          }
          const sentenceBoundary = sentence.text.length;
          const sentenceComplete =
            sentenceAudio.generatedCharacters >= sentenceBoundary;
          this.debug?.("provider.socket.audio", {
            requestId: request.requestId.slice(-24),
            sentenceIndex: sentence.index,
            audioLength: message.audio.length,
            alignmentFormat: alignmentFormat(message.alignment),
            alignmentCharCount: alignment?.chars.length ?? 0,
            generatedCharactersBefore,
            generatedCharacters: sentenceAudio.generatedCharacters,
            sentenceBoundary,
            sentenceComplete,
            fragmentCount: sentenceAudio.fragmentCount,
            bufferedAudioBytes: sentenceAudio.audioByteLength,
            rawAlignmentStartMs: alignment?.charStartTimesMs[0] ?? null,
            alignmentOffsetMs: sentenceAudio.lastAlignmentOffsetMs,
            alignmentTimeline: sentenceAudio.lastAlignmentTimeline,
          });
          if (sentenceComplete && !sentenceAudio.textComplete) {
            sentenceAudio.textComplete = true;
            this.debug?.("provider.socket.sentence-text-complete", {
              requestId: request.requestId.slice(-24),
              sentenceIndex: sentence.index,
              generatedCharacters: sentenceAudio.generatedCharacters,
              sentenceBoundary,
            });
            sendNextSentence();
          }
          if (alignment === null && alignedCharacters === null) {
            if (
              !sentenceAudio.textComplete &&
              nextSentenceToSend === sentenceCursor + 1
            ) {
              fallbackAfterFinal = true;
              sendEndInput();
            } else if (nextSentenceToSend > sentenceCursor + 1) {
              unrecoverableMissingAlignment = true;
              sendEndInput();
            }
          }
        }
      }

      if (isFinal) {
        if (unrecoverableMissingAlignment) {
          fail("provider-error", {
            internalErrorCode: "UNRESOLVED_ALIGNMENT_BOUNDARY",
          });
          return;
        }
        if (
          !fallbackAfterFinal &&
          nextSentenceToSend < request.sentences.length
        ) {
          fail("provider-error", {
            internalErrorCode: "PREMATURE_FINAL_MARKER",
          });
          return;
        }
        const remainingSentences = fallbackAfterFinal
          ? request.sentences.slice(nextSentenceToSend)
          : [];
        if (!finalizeSentenceAudio(remainingSentences.length === 0)) {
          fail("provider-error", {
            internalErrorCode: "EMPTY_AUDIO_PAYLOAD",
          });
          return;
        }
        completed = true;
        this.sockets.delete(socket);
        this.continueBursts.delete(socket);
        this.debug?.("provider.socket.complete", {
          requestId: request.requestId.slice(-24),
          sentenceCursor,
          nextSentenceToSend,
          fallbackRemainingSentenceCount: remainingSentences.length,
          receivedAudio,
        });
        if (remainingSentences.length > 0) {
          this.generateBurst(
            {
              ...request,
              requestId: `${request.requestId}:alignment-fallback-${nextSentenceToSend}`,
              sentences: remainingSentences,
            },
            credential,
            onEvent,
          );
        }
      }
    });

    socket.addEventListener("error", (event) => {
      this.debug?.("provider.socket.error", {
        requestId: request.requestId.slice(-24),
        ...errorDetails(event),
      });
      fail("error");
    });
    socket.addEventListener("close", (event) => {
      const details = closeDetails(event);
      const wasAborted = this.abortedSockets.delete(socket);
      this.sockets.delete(socket);
      this.debug?.("provider.socket.close", {
        requestId: request.requestId.slice(-24),
        ...details,
        completed,
        aborted: wasAborted,
      });
      if (!wasAborted) fail("close", details);
    });
  }

  pausePrefetch(): void {
    this.prefetchPaused = true;
  }

  resumePrefetch(): void {
    this.prefetchPaused = false;
    for (const continueBurst of this.continueBursts.values()) continueBurst();
  }

  abortAll(): void {
    for (const socket of this.sockets) {
      this.abortedSockets.add(socket);
      socket.close(1000, "Reading Session ended");
    }
    this.sockets.clear();
    this.continueBursts.clear();
  }
}

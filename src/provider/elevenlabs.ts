import type { ElevenLabsRegion } from "../storage/preferences";
import type { SpeechAlignment } from "../session/types";

const ORIGINS: Record<ElevenLabsRegion, string> = {
  global: "https://api.elevenlabs.io",
  us: "https://api.us.elevenlabs.io",
  eu: "https://api.eu.residency.elevenlabs.io",
  india: "https://api.in.residency.elevenlabs.io",
  singapore: "https://api.sg.residency.elevenlabs.io",
};

export interface ElevenLabsVoice {
  id: string;
  name: string;
  previewUrl: string | null;
  labels: Record<string, string>;
}

export interface ElevenLabsModel {
  id: string;
  name: string;
  languages: string[];
}

export interface ElevenLabsMetadata {
  voices: ElevenLabsVoice[];
  models: ElevenLabsModel[];
}

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
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async validateAndLoad(
    credential: string,
    region: ElevenLabsRegion,
  ): Promise<ElevenLabsMetadata> {
    const origin = elevenLabsOrigin(region);
    const headers = { accept: "application/json", "xi-api-key": credential };
    const modelResponse = await this.fetchMetadata(
      `${origin}/v1/models`,
      headers,
    );
    const voiceResponse = await this.fetchMetadata(
      `${origin}/v2/voices?page_size=100`,
      headers,
    );
    return {
      voices: parseVoices(voiceResponse),
      models: parseModels(modelResponse),
    };
  }

  private async fetchMetadata(
    url: string,
    headers: Record<string, string>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, { headers, method: "GET" });
    } catch {
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ElevenLabsProviderError("AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new ElevenLabsProviderError("RATE_LIMITED");
    }
    if (!response.ok) {
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
    }
    try {
      return await response.json();
    } catch {
      throw new ElevenLabsProviderError("PROVIDER_UNAVAILABLE");
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

export interface ElevenLabsGenerationRequest {
  requestId: string;
  sentences: Array<{ index: number; text: string }>;
  voiceId: string;
  modelId: string;
  region: ElevenLabsRegion;
}

export type ElevenLabsTransportEvent =
  | {
      type: "audio";
      requestId: string;
      sentenceIndex: number;
      audioBase64: string;
      alignment: SpeechAlignment | null;
      acknowledged: true;
      isFinal: boolean;
    }
  | {
      type: "failure";
      requestId: string;
      errorCode: "PROVIDER_SOCKET_FAILED";
      acknowledged: boolean;
      receivedAudio: boolean;
    };

export type WebSocketFactory = (url: string) => WebSocketLike;

function parseAlignment(value: unknown): SpeechAlignment | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.chars) ||
    !Array.isArray(value.char_start_times_ms) ||
    !Array.isArray(value.char_durations_ms) ||
    value.chars.length !== value.char_start_times_ms.length ||
    value.chars.length !== value.char_durations_ms.length ||
    !value.chars.every((character) => typeof character === "string") ||
    !value.char_start_times_ms.every(
      (time) => typeof time === "number" && Number.isFinite(time) && time >= 0,
    ) ||
    !value.char_durations_ms.every(
      (duration) =>
        typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration >= 0,
    )
  ) {
    return null;
  }

  const starts = value.char_start_times_ms as number[];
  if (
    starts.some((start, index) => index > 0 && start < (starts[index - 1] ?? 0))
  ) {
    return null;
  }
  return {
    chars: value.chars as string[],
    charStartTimesMs: starts,
    charDurationsMs: value.char_durations_ms as number[],
  };
}

function websocketOrigin(region: ElevenLabsRegion): string {
  return elevenLabsOrigin(region).replace(/^https:/, "wss:");
}

export class ElevenLabsTransport {
  private readonly sockets = new Set<WebSocketLike>();
  private readonly abortedSockets = new Set<WebSocketLike>();

  constructor(
    private readonly createSocket: WebSocketFactory = (url) =>
      new WebSocket(url) as WebSocketLike,
  ) {}

  generateBurst(
    request: ElevenLabsGenerationRequest,
    credential: string,
    onEvent: (event: ElevenLabsTransportEvent) => void,
  ): void {
    if (request.sentences.length === 0) return;
    const query = new URLSearchParams({
      model_id: request.modelId,
      output_format: "mp3_44100_128",
      sync_alignment: "true",
    });
    const url = `${websocketOrigin(request.region)}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}/stream-input?${query.toString()}`;
    const socket = this.createSocket(url);
    this.sockets.add(socket);
    let acknowledged = false;
    let receivedAudio = false;
    let completed = false;
    let sentenceCursor = 0;
    let generatedCharacters = 0;

    socket.addEventListener("open", () => {
      request.sentences.forEach((sentence, index) => {
        socket.send(
          JSON.stringify({
            text: `${sentence.text} `,
            ...(index === 0 ? { xi_api_key: credential } : {}),
            flush: true,
          }),
        );
      });
      socket.send(JSON.stringify({ text: "" }));
    });

    socket.addEventListener("message", (rawEvent) => {
      if (this.abortedSockets.has(socket) || completed) return;
      const event = rawEvent as MessageEvent;
      if (typeof event.data !== "string") return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      acknowledged = true;
      const isFinal = message.is_final === true;
      if (typeof message.audio === "string" && message.audio.length > 0) {
        receivedAudio = true;
        const sentence = request.sentences[sentenceCursor];
        if (sentence) {
          const alignment = parseAlignment(message.alignment);
          onEvent({
            type: "audio",
            requestId: request.requestId,
            sentenceIndex: sentence.index,
            audioBase64: message.audio,
            alignment,
            acknowledged: true,
            isFinal,
          });
          generatedCharacters += alignment?.chars.join("").length ?? 0;
          const sentenceBoundary = sentence.text.length + 1;
          if (generatedCharacters >= sentenceBoundary) {
            generatedCharacters -= sentenceBoundary;
            sentenceCursor += 1;
          }
        }
      }
      if (isFinal) {
        completed = true;
        this.sockets.delete(socket);
      }
    });

    const fail = () => {
      if (completed || this.abortedSockets.has(socket)) return;
      completed = true;
      this.sockets.delete(socket);
      onEvent({
        type: "failure",
        requestId: request.requestId,
        errorCode: "PROVIDER_SOCKET_FAILED",
        acknowledged,
        receivedAudio,
      });
    };
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
  }

  abortAll(): void {
    for (const socket of this.sockets) {
      this.abortedSockets.add(socket);
      socket.close(1000, "Reading Session ended");
    }
    this.sockets.clear();
  }
}

import type {
  ProviderGenerationRequest,
  ProviderMetadata,
  ProviderModel,
  ProviderTransport,
  ProviderTransportEvent,
  ProviderVoice,
  ProviderVoiceModel,
} from "./types";

export const SPEECHIFY_ORIGIN = "https://api.speechify.ai";
export const SPEECHIFY_ORIGIN_PATTERN = `${SPEECHIFY_ORIGIN}/*`;
export const SPEECHIFY_DEFAULT_MODEL = "simba-3.0";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_PAGES = 50;
const VOICE_PAGE_LIMIT = 200;

export type SpeechifyErrorCode =
  | "AUTH_FAILED"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "AUDIO_TOO_LARGE";

type SpeechifyDebugValue = string | number | boolean | null;
export type SpeechifyDebugLogger = (
  event: string,
  data: Record<string, SpeechifyDebugValue>,
) => void;

export class SpeechifyProviderError extends Error {
  constructor(readonly code: SpeechifyErrorCode) {
    super(
      code === "AUTH_FAILED"
        ? "Speechify rejected the Provider Credential."
        : code === "PAYMENT_REQUIRED"
          ? "Speechify reports that this account needs additional balance."
          : code === "RATE_LIMITED"
            ? "Speechify rate limited the request."
            : code === "AUDIO_TOO_LARGE"
              ? "Speechify returned more audio than the per-sentence limit."
              : code === "INVALID_RESPONSE"
                ? "Speechify returned an unexpected response."
                : "Speechify is currently unavailable.",
    );
    this.name = "SpeechifyProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : null;
}

function cleanHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanVoiceModels(value: unknown): ProviderVoiceModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((model): ProviderVoiceModel[] => {
    if (!isRecord(model)) return [];
    const id = cleanText(model.name, 160);
    if (!id) return [];
    const languages = Array.isArray(model.languages)
      ? model.languages.flatMap((language): string[] => {
          const locale = isRecord(language)
            ? cleanText(language.locale, 35)
            : null;
          return locale ? [locale] : [];
        })
      : [];
    return [{ id, languages: [...new Set(languages)].sort() }];
  });
}

function parseVoicePage(value: unknown): {
  voices: ProviderVoice[];
  hasMore: boolean;
  nextCursor: string | null;
} {
  const envelope = Array.isArray(value)
    ? { voices: value, has_more: false, next_cursor: null }
    : value;
  if (!isRecord(envelope) || !Array.isArray(envelope.voices)) {
    throw new SpeechifyProviderError("INVALID_RESPONSE");
  }
  const hasMore = envelope.has_more === true;
  const nextCursor =
    typeof envelope.next_cursor === "string" &&
    envelope.next_cursor.length > 0 &&
    envelope.next_cursor.length <= 2_000
      ? envelope.next_cursor
      : null;
  if (hasMore && !nextCursor) {
    throw new SpeechifyProviderError("INVALID_RESPONSE");
  }
  const voices = envelope.voices.flatMap((voice): ProviderVoice[] => {
    if (!isRecord(voice)) return [];
    const id = cleanText(voice.id, 160);
    const name = cleanText(voice.display_name, 200);
    if (!id || !name) return [];
    const labels = Object.fromEntries(
      ["locale", "gender", "type"].flatMap((key): Array<[string, string]> => {
        const label = cleanText(voice[key], 120);
        return label ? [[key, label]] : [];
      }),
    );
    return [
      {
        id,
        name,
        previewUrl: cleanHttpsUrl(voice.preview_audio),
        labels,
        models: cleanVoiceModels(voice.models),
      },
    ];
  });
  return { voices, hasMore, nextCursor };
}

function deriveModels(voices: ProviderVoice[]): ProviderModel[] {
  const languagesByModel = new Map<string, Set<string>>();
  for (const voice of voices) {
    for (const model of voice.models) {
      const languages = languagesByModel.get(model.id) ?? new Set<string>();
      model.languages.forEach((language) => languages.add(language));
      languagesByModel.set(model.id, languages);
    }
  }
  return [...languagesByModel.entries()]
    .map(([id, languages]) => ({
      id,
      name: id
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      languages: [...languages].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function validCredential(value: string): boolean {
  return value.length >= 8 && value.length <= 512 && !/\s/.test(value);
}

function errorCodeForStatus(status: number): SpeechifyErrorCode {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 402) return "PAYMENT_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_UNAVAILABLE";
}

export class SpeechifyMetadataClient {
  private readonly fetcher: typeof fetch;

  constructor(
    fetcher: typeof fetch = globalThis.fetch,
    private readonly debug?: SpeechifyDebugLogger,
  ) {
    this.fetcher = fetcher.bind(globalThis);
  }

  async validateAndLoad(credential: string): Promise<ProviderMetadata> {
    if (!validCredential(credential)) {
      throw new SpeechifyProviderError("AUTH_FAILED");
    }
    const voices: ProviderVoice[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < MAX_VOICE_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(VOICE_PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      this.debug?.("provider.metadata.request", {
        provider: "speechify",
        resource: "voices",
        page: page + 1,
      });
      let response: Response;
      try {
        response = await this.fetcher(
          `${SPEECHIFY_ORIGIN}/v1/voices?${query.toString()}`,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${credential}`,
            },
          },
        );
      } catch {
        throw new SpeechifyProviderError("PROVIDER_UNAVAILABLE");
      }
      this.debug?.("provider.metadata.response", {
        provider: "speechify",
        resource: "voices",
        page: page + 1,
        status: response.status,
        ok: response.ok,
      });
      if (!response.ok) {
        throw new SpeechifyProviderError(errorCodeForStatus(response.status));
      }
      let parsed: ReturnType<typeof parseVoicePage>;
      try {
        parsed = parseVoicePage(await response.json());
      } catch (error) {
        if (error instanceof SpeechifyProviderError) throw error;
        throw new SpeechifyProviderError("INVALID_RESPONSE");
      }
      voices.push(...parsed.voices);
      if (!parsed.hasMore) {
        const uniqueVoices = [
          ...new Map(voices.map((voice) => [voice.id, voice])).values(),
        ].sort((left, right) => left.name.localeCompare(right.name));
        if (uniqueVoices.length === 0) {
          throw new SpeechifyProviderError("INVALID_RESPONSE");
        }
        return { voices: uniqueVoices, models: deriveModels(uniqueVoices) };
      }
      if (!parsed.nextCursor || seenCursors.has(parsed.nextCursor)) {
        throw new SpeechifyProviderError("INVALID_RESPONSE");
      }
      seenCursors.add(parsed.nextCursor);
      cursor = parsed.nextCursor;
    }
    throw new SpeechifyProviderError("INVALID_RESPONSE");
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
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary);
}

async function readAudio(response: Response): Promise<string> {
  const contentType =
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (
    !["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(
      contentType,
    )
  ) {
    throw new SpeechifyProviderError("INVALID_RESPONSE");
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      byteLength += value.length;
      if (byteLength > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new SpeechifyProviderError("AUDIO_TOO_LARGE");
      }
      chunks.push(value);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    byteLength = bytes.length;
    if (byteLength > MAX_AUDIO_BYTES) {
      throw new SpeechifyProviderError("AUDIO_TOO_LARGE");
    }
    if (byteLength > 0) chunks.push(bytes);
  }
  if (byteLength === 0) throw new SpeechifyProviderError("INVALID_RESPONSE");
  return encodeBase64(chunks, byteLength);
}

export class SpeechifyTransport implements ProviderTransport {
  private readonly fetcher: typeof fetch;
  private readonly controllers = new Set<AbortController>();
  private readonly resumeWaiters = new Set<() => void>();
  private prefetchPaused = false;

  constructor(
    fetcher: typeof fetch = globalThis.fetch,
    private readonly debug?: SpeechifyDebugLogger,
  ) {
    this.fetcher = fetcher.bind(globalThis);
  }

  generateBurst(
    request: ProviderGenerationRequest,
    credential: string,
    onEvent: (event: ProviderTransportEvent) => void,
  ): void {
    if (request.sentences.length === 0) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    void this.runBurst(request, credential, controller, onEvent).finally(() => {
      this.controllers.delete(controller);
    });
  }

  pausePrefetch(): void {
    this.prefetchPaused = true;
  }

  resumePrefetch(): void {
    this.prefetchPaused = false;
    for (const resume of this.resumeWaiters) resume();
    this.resumeWaiters.clear();
  }

  abortAll(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    for (const resume of this.resumeWaiters) resume();
    this.resumeWaiters.clear();
  }

  private async waitForResume(signal: AbortSignal): Promise<void> {
    if (!this.prefetchPaused || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const resume = () => {
        signal.removeEventListener("abort", resume);
        this.resumeWaiters.delete(resume);
        resolve();
      };
      this.resumeWaiters.add(resume);
      signal.addEventListener("abort", resume, { once: true });
    });
  }

  private async runBurst(
    request: ProviderGenerationRequest,
    credential: string,
    controller: AbortController,
    onEvent: (event: ProviderTransportEvent) => void,
  ): Promise<void> {
    let acknowledged = false;
    let receivedAudio = false;
    try {
      if (!validCredential(credential)) {
        throw new SpeechifyProviderError("AUTH_FAILED");
      }
      for (let index = 0; index < request.sentences.length; index += 1) {
        if (index > 0) await this.waitForResume(controller.signal);
        if (controller.signal.aborted) return;
        const sentence = request.sentences[index];
        if (!sentence) continue;
        this.debug?.("provider.generation.request", {
          provider: "speechify",
          requestId: request.requestId.slice(-24),
          sentenceIndex: sentence.index,
          textLength: sentence.text.length,
          modelId: request.modelId,
        });
        acknowledged = true;
        let response: Response;
        try {
          response = await this.fetcher(`${SPEECHIFY_ORIGIN}/v1/audio/stream`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              accept: "audio/mpeg",
              authorization: `Bearer ${credential}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              input: sentence.text,
              voice_id: request.voiceId,
              model: request.modelId,
              language: request.language,
            }),
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          throw error;
        }
        if (!response.ok) {
          throw new SpeechifyProviderError(errorCodeForStatus(response.status));
        }
        const audioBase64 = await readAudio(response);
        if (controller.signal.aborted) return;
        receivedAudio = true;
        onEvent({
          type: "audio",
          requestId: request.requestId,
          sentenceIndex: sentence.index,
          audioBase64,
          alignment: null,
          acknowledged: true,
          isFinal: index === request.sentences.length - 1,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorCode =
        error instanceof SpeechifyProviderError
          ? error.code
          : "PROVIDER_UNAVAILABLE";
      this.debug?.("provider.generation.failed", {
        provider: "speechify",
        requestId: request.requestId.slice(-24),
        errorCode,
        acknowledged,
        receivedAudio,
      });
      onEvent({
        type: "failure",
        requestId: request.requestId,
        errorCode,
        acknowledged,
        receivedAudio,
      });
    }
  }
}

import type { SpeechAlignment } from "../session/types";

export const CLOUD_PROVIDER_IDS = ["elevenlabs", "speechify"] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];
export type SpeechProviderId = "browser" | CloudProviderId;
export type ElevenLabsRegion = "global" | "us" | "eu" | "india" | "singapore";

export function isCloudProviderId(value: unknown): value is CloudProviderId {
  return CLOUD_PROVIDER_IDS.includes(value as CloudProviderId);
}

export function isSpeechProviderId(value: unknown): value is SpeechProviderId {
  return value === "browser" || isCloudProviderId(value);
}

export interface ProviderVoiceModel {
  id: string;
  languages: string[];
}

export interface ProviderVoice {
  id: string;
  name: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  models: ProviderVoiceModel[];
}

export interface ProviderModel {
  id: string;
  name: string;
  languages: string[];
}

export interface ProviderMetadata {
  voices: ProviderVoice[];
  models: ProviderModel[];
}

export const EMPTY_PROVIDER_METADATA: ProviderMetadata = {
  voices: [],
  models: [],
};

export interface ProviderGenerationRequest {
  requestId: string;
  sentences: Array<{ index: number; text: string }>;
  language: string;
  voiceId: string;
  modelId: string;
  region: ElevenLabsRegion;
}

export type ProviderTransportEvent =
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
      errorCode: string;
      acknowledged: boolean;
      receivedAudio: boolean;
    };

export interface ProviderTransport {
  generateBurst(
    request: ProviderGenerationRequest,
    credential: string,
    onEvent: (event: ProviderTransportEvent) => void,
  ): void;
  pausePrefetch(): void;
  resumePrefetch(): void;
  abortAll(): void;
}

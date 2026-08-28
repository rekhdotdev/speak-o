import {
  isSpeechProviderId,
  type CloudProviderId,
  type ElevenLabsRegion,
  type SpeechProviderId,
} from "../provider/types";

export type { ElevenLabsRegion, SpeechProviderId } from "../provider/types";

export const PLAYBACK_SPEEDS = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export type Theme = "system" | "light" | "dark";
export type Dock = "bottom" | "top";
export type VoiceMode = "browser" | "cloud";

export interface ElevenLabsPreferences {
  voiceByLanguage: Record<string, string>;
  region: ElevenLabsRegion;
  modelId: string;
}

export interface SpeechifyPreferences {
  voiceByLanguage: Record<string, string>;
  modelId: string;
}

export interface Preferences {
  playbackSpeed: PlaybackSpeed;
  browserVoiceByLanguage: Record<string, string>;
  narrationLanguageOverride: string | null;
  highlightsEnabled: boolean;
  followEnabled: boolean;
  theme: Theme;
  dock: Dock;
  defaultProvider: SpeechProviderId;
  elevenLabs: ElevenLabsPreferences;
  speechify: SpeechifyPreferences;
  usageGuardCharacters: number | null;
}

export type PreferencePatch = Partial<Preferences>;

export interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  playbackSpeed: 1,
  browserVoiceByLanguage: {},
  narrationLanguageOverride: null,
  highlightsEnabled: true,
  followEnabled: true,
  theme: "system",
  dock: "bottom",
  defaultProvider: "browser",
  elevenLabs: {
    voiceByLanguage: {},
    region: "global",
    modelId: "eleven_multilingual_v2",
  },
  speechify: {
    voiceByLanguage: {},
    modelId: "simba-3.0",
  },
  usageGuardCharacters: 25_000,
};

export const PREFERENCES_STORAGE_KEY = "preferences";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback;
}

function sanitizeVoices(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      ([language, voice]) =>
        /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) &&
        typeof voice === "string" &&
        voice.length > 0 &&
        voice.length <= 160,
    ),
  ) as Record<string, string>;
}

function isVoiceMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(
    ([language, voice]) =>
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) &&
      typeof voice === "string" &&
      voice.length > 0 &&
      voice.length <= 160,
  );
}

function sanitizeLanguage(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
    ? value
    : null;
}

function sanitizeModelId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 160
    ? value
    : fallback;
}

function isModelId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function sanitizeElevenLabs(
  candidate: Record<string, unknown>,
): ElevenLabsPreferences {
  return {
    voiceByLanguage: sanitizeVoices(candidate.voiceByLanguage),
    region: oneOf(
      candidate.region,
      ["global", "us", "eu", "india", "singapore"],
      DEFAULT_PREFERENCES.elevenLabs.region,
    ),
    modelId: sanitizeModelId(
      candidate.modelId,
      DEFAULT_PREFERENCES.elevenLabs.modelId,
    ),
  };
}

function sanitizeSpeechify(
  candidate: Record<string, unknown>,
): SpeechifyPreferences {
  return {
    voiceByLanguage: sanitizeVoices(candidate.voiceByLanguage),
    modelId: sanitizeModelId(
      candidate.modelId,
      DEFAULT_PREFERENCES.speechify.modelId,
    ),
  };
}

function isElevenLabsPreferences(
  value: unknown,
): value is ElevenLabsPreferences {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    isVoiceMap(value.voiceByLanguage) &&
    ["global", "us", "eu", "india", "singapore"].includes(
      String(value.region),
    ) &&
    isModelId(value.modelId)
  );
}

function isSpeechifyPreferences(value: unknown): value is SpeechifyPreferences {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isVoiceMap(value.voiceByLanguage) &&
    isModelId(value.modelId)
  );
}

export function providerPreferences(
  preferences: Preferences,
  provider: CloudProviderId,
): ElevenLabsPreferences | SpeechifyPreferences {
  return provider === "elevenlabs"
    ? preferences.elevenLabs
    : preferences.speechify;
}

export function sanitizePreferences(value: unknown): Preferences {
  const candidate = isRecord(value) ? value : {};
  const playbackSpeed = PLAYBACK_SPEEDS.includes(
    candidate.playbackSpeed as PlaybackSpeed,
  )
    ? (candidate.playbackSpeed as PlaybackSpeed)
    : DEFAULT_PREFERENCES.playbackSpeed;
  const usageGuardCharacters =
    candidate.usageGuardCharacters === null
      ? null
      : Number.isSafeInteger(candidate.usageGuardCharacters) &&
          (candidate.usageGuardCharacters as number) >= 500 &&
          (candidate.usageGuardCharacters as number) <= 500_000
        ? (candidate.usageGuardCharacters as number)
        : DEFAULT_PREFERENCES.usageGuardCharacters;
  const legacyElevenLabs = {
    voiceByLanguage: candidate.voiceByLanguage,
    region: candidate.region,
    modelId: candidate.modelId,
  };
  const elevenLabsCandidate = isRecord(candidate.elevenLabs)
    ? candidate.elevenLabs
    : legacyElevenLabs;
  const speechifyCandidate = isRecord(candidate.speechify)
    ? candidate.speechify
    : {};
  const defaultProvider = isSpeechProviderId(candidate.defaultProvider)
    ? candidate.defaultProvider
    : candidate.defaultVoiceMode === "cloud"
      ? "elevenlabs"
      : DEFAULT_PREFERENCES.defaultProvider;

  return {
    playbackSpeed,
    browserVoiceByLanguage: sanitizeVoices(candidate.browserVoiceByLanguage),
    narrationLanguageOverride: sanitizeLanguage(
      candidate.narrationLanguageOverride,
    ),
    highlightsEnabled:
      typeof candidate.highlightsEnabled === "boolean"
        ? candidate.highlightsEnabled
        : DEFAULT_PREFERENCES.highlightsEnabled,
    followEnabled:
      typeof candidate.followEnabled === "boolean"
        ? candidate.followEnabled
        : DEFAULT_PREFERENCES.followEnabled,
    theme: oneOf(
      candidate.theme,
      ["system", "light", "dark"],
      DEFAULT_PREFERENCES.theme,
    ),
    dock: oneOf(candidate.dock, ["bottom", "top"], DEFAULT_PREFERENCES.dock),
    defaultProvider,
    elevenLabs: sanitizeElevenLabs(elevenLabsCandidate),
    speechify: sanitizeSpeechify(speechifyCandidate),
    usageGuardCharacters,
  };
}

export function isPreferencePatch(value: unknown): value is PreferencePatch {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    keys.length > Object.keys(DEFAULT_PREFERENCES).length
  ) {
    return false;
  }

  return keys.every((key) => {
    const candidate = value[key];
    switch (key) {
      case "playbackSpeed":
        return PLAYBACK_SPEEDS.includes(candidate as PlaybackSpeed);
      case "browserVoiceByLanguage":
        return isVoiceMap(candidate);
      case "narrationLanguageOverride":
        return candidate === null || sanitizeLanguage(candidate) === candidate;
      case "highlightsEnabled":
      case "followEnabled":
        return typeof candidate === "boolean";
      case "theme":
        return ["system", "light", "dark"].includes(String(candidate));
      case "dock":
        return ["bottom", "top"].includes(String(candidate));
      case "defaultProvider":
        return isSpeechProviderId(candidate);
      case "elevenLabs":
        return isElevenLabsPreferences(candidate);
      case "speechify":
        return isSpeechifyPreferences(candidate);
      case "usageGuardCharacters":
        return (
          candidate === null ||
          (Number.isSafeInteger(candidate) &&
            (candidate as number) >= 500 &&
            (candidate as number) <= 500_000)
        );
      default:
        return false;
    }
  });
}

export class PreferenceStore {
  private settledPatch: Promise<void> = Promise.resolve();

  constructor(private readonly local: ExtensionStorageArea) {}

  async load(): Promise<Preferences> {
    const stored = await this.local.get(PREFERENCES_STORAGE_KEY);
    return sanitizePreferences(stored[PREFERENCES_STORAGE_KEY]);
  }

  async save(preferences: Preferences): Promise<void> {
    await this.local.set({
      [PREFERENCES_STORAGE_KEY]: sanitizePreferences(preferences),
    });
  }

  patch(patch: PreferencePatch): Promise<Preferences> {
    const pending = this.settledPatch.then(async () => {
      const current = await this.load();
      const merged = sanitizePreferences({ ...current, ...patch });
      await this.save(merged);
      return merged;
    });
    this.settledPatch = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

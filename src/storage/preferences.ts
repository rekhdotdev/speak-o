export const PLAYBACK_SPEEDS = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export type Theme = "system" | "light" | "dark";
export type Dock = "bottom" | "top";
export type VoiceMode = "browser" | "cloud";
export type ElevenLabsRegion = "global" | "us" | "eu" | "india" | "singapore";

export interface Preferences {
  playbackSpeed: PlaybackSpeed;
  voiceByLanguage: Record<string, string>;
  browserVoiceByLanguage: Record<string, string>;
  highlightsEnabled: boolean;
  followEnabled: boolean;
  theme: Theme;
  dock: Dock;
  defaultVoiceMode: VoiceMode;
  region: ElevenLabsRegion;
  modelId: string;
  usageGuardCharacters: number | null;
}

export interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  playbackSpeed: 1,
  voiceByLanguage: {},
  browserVoiceByLanguage: {},
  highlightsEnabled: true,
  followEnabled: true,
  theme: "system",
  dock: "bottom",
  defaultVoiceMode: "browser",
  region: "global",
  modelId: "eleven_multilingual_v2",
  usageGuardCharacters: 25_000,
};

const STORAGE_KEY = "preferences";

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

  return {
    playbackSpeed,
    voiceByLanguage: sanitizeVoices(candidate.voiceByLanguage),
    browserVoiceByLanguage: sanitizeVoices(candidate.browserVoiceByLanguage),
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
    defaultVoiceMode: oneOf(
      candidate.defaultVoiceMode,
      ["browser", "cloud"],
      DEFAULT_PREFERENCES.defaultVoiceMode,
    ),
    region: oneOf(
      candidate.region,
      ["global", "us", "eu", "india", "singapore"],
      DEFAULT_PREFERENCES.region,
    ),
    modelId:
      typeof candidate.modelId === "string" &&
      candidate.modelId.length > 0 &&
      candidate.modelId.length <= 160
        ? candidate.modelId
        : DEFAULT_PREFERENCES.modelId,
    usageGuardCharacters,
  };
}

export class PreferenceStore {
  constructor(private readonly local: ExtensionStorageArea) {}

  async load(): Promise<Preferences> {
    const stored = await this.local.get(STORAGE_KEY);
    return sanitizePreferences(stored[STORAGE_KEY]);
  }

  async save(preferences: Preferences): Promise<void> {
    await this.local.set({ [STORAGE_KEY]: sanitizePreferences(preferences) });
  }
}

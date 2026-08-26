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
  narrationLanguageOverride: string | null;
  highlightsEnabled: boolean;
  followEnabled: boolean;
  theme: Theme;
  dock: Dock;
  defaultVoiceMode: VoiceMode;
  region: ElevenLabsRegion;
  modelId: string;
  usageGuardCharacters: number | null;
}

export type PreferencePatch = Partial<Preferences>;

export interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  playbackSpeed: 1,
  voiceByLanguage: {},
  browserVoiceByLanguage: {},
  narrationLanguageOverride: null,
  highlightsEnabled: true,
  followEnabled: true,
  theme: "system",
  dock: "bottom",
  defaultVoiceMode: "browser",
  region: "global",
  modelId: "eleven_multilingual_v2",
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
      case "voiceByLanguage":
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
      case "defaultVoiceMode":
        return ["browser", "cloud"].includes(String(candidate));
      case "region":
        return ["global", "us", "eu", "india", "singapore"].includes(
          String(candidate),
        );
      case "modelId":
        return (
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate.length <= 160
        );
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

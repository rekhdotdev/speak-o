import {
  PreferenceStore,
  type ExtensionStorageArea,
} from "../../src/storage/preferences";

const expectedDefaults = {
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
} as const;

class MemoryStorage implements ExtensionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

describe("PreferenceStore", () => {
  it("returns safe local defaults and persists only validated preferences", async () => {
    const local = new MemoryStorage();
    const store = new PreferenceStore(local);

    await expect(store.load()).resolves.toEqual(expectedDefaults);

    await store.save({
      ...expectedDefaults,
      playbackSpeed: 1.75,
      theme: "dark",
      dock: "top",
      usageGuardCharacters: null,
    });

    await expect(store.load()).resolves.toMatchObject({
      playbackSpeed: 1.75,
      theme: "dark",
      dock: "top",
      usageGuardCharacters: null,
    });

    local.values.preferences = {
      playbackSpeed: 99,
      theme: "neon",
      dock: "side",
      usageGuardCharacters: -20,
    };

    await expect(store.load()).resolves.toEqual(expectedDefaults);
  });
});

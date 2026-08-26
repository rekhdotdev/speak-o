import type { ReadingSessionCommand } from "../../src/session/types";
import { SerialTaskQueue } from "../../src/session/serial-task-queue";
import {
  DEFAULT_PREFERENCES,
  PreferenceStore,
} from "../../src/storage/preferences";
import { persistSessionPreferenceIfCurrent } from "../../src/storage/session-preferences";

describe("Reading Session preference persistence", () => {
  it("persists accepted floating-reader preferences for the next session", async () => {
    const values: Record<string, unknown> = {};
    const store = new PreferenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      },
    });
    const current = { id: "session-current", generationEpoch: 4 };
    const speedCommand = {
      type: "set-playback-speed",
      playbackSpeed: 1.5,
      sessionId: current.id,
      generationEpoch: current.generationEpoch,
    } satisfies ReadingSessionCommand;
    const highlightsCommand = {
      type: "set-highlights",
      enabled: false,
      sessionId: current.id,
      generationEpoch: current.generationEpoch,
    } satisfies ReadingSessionCommand;

    await persistSessionPreferenceIfCurrent(store, speedCommand, current);
    await persistSessionPreferenceIfCurrent(store, highlightsCommand, current);

    expect(await store.load()).toEqual({
      ...DEFAULT_PREFERENCES,
      playbackSpeed: 1.5,
      highlightsEnabled: false,
    });
  });

  it("serializes overlapping preference patches without losing either update", async () => {
    const values: Record<string, unknown> = {};
    let setCalls = 0;
    let releaseFirstSet: (() => void) | undefined;
    const firstSetCanFinish = new Promise<void>((resolve) => {
      releaseFirstSet = resolve;
    });
    let markFirstSetStarted: (() => void) | undefined;
    const firstSetStarted = new Promise<void>((resolve) => {
      markFirstSetStarted = resolve;
    });
    const store = new PreferenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        setCalls += 1;
        if (setCalls === 1) {
          markFirstSetStarted?.();
          await firstSetCanFinish;
        }
        Object.assign(values, items);
      },
    });
    const current = { id: "session-current", generationEpoch: 4 };

    const speedWrite = persistSessionPreferenceIfCurrent(
      store,
      {
        type: "set-playback-speed",
        playbackSpeed: 1.5,
        sessionId: current.id,
        generationEpoch: current.generationEpoch,
      },
      current,
    );
    await firstSetStarted;
    const highlightsWrite = persistSessionPreferenceIfCurrent(
      store,
      {
        type: "set-highlights",
        enabled: false,
        sessionId: current.id,
        generationEpoch: current.generationEpoch,
      },
      current,
    );

    await Promise.resolve();
    expect(setCalls).toBe(1);
    releaseFirstSet?.();
    await Promise.all([speedWrite, highlightsWrite]);

    expect(await store.load()).toEqual({
      ...DEFAULT_PREFERENCES,
      playbackSpeed: 1.5,
      highlightsEnabled: false,
    });
  });

  it("orders Options application before a later floating-reader update", async () => {
    const values: Record<string, unknown> = {};
    let releaseOptionsWrite: (() => void) | undefined;
    const optionsWriteCanFinish = new Promise<void>((resolve) => {
      releaseOptionsWrite = resolve;
    });
    let markOptionsWriteStarted: (() => void) | undefined;
    const optionsWriteStarted = new Promise<void>((resolve) => {
      markOptionsWriteStarted = resolve;
    });
    let setCalls = 0;
    const store = new PreferenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        setCalls += 1;
        if (setCalls === 1) {
          markOptionsWriteStarted?.();
          await optionsWriteCanFinish;
        }
        Object.assign(values, items);
      },
    });
    const updates = new SerialTaskQueue();
    let livePreferences = DEFAULT_PREFERENCES;

    const optionsUpdate = updates.run(async () => {
      livePreferences = await store.patch({ theme: "dark" });
    });
    await optionsWriteStarted;
    const readerUpdate = updates.run(async () => {
      const command = {
        type: "set-playback-speed",
        playbackSpeed: 1.5,
        sessionId: "session-current",
        generationEpoch: 4,
      } satisfies ReadingSessionCommand;
      await persistSessionPreferenceIfCurrent(store, command, {
        id: command.sessionId,
        generationEpoch: command.generationEpoch,
      });
      livePreferences = {
        ...livePreferences,
        playbackSpeed: command.playbackSpeed,
      };
    });

    releaseOptionsWrite?.();
    await Promise.all([optionsUpdate, readerUpdate]);

    expect(livePreferences).toMatchObject({
      theme: "dark",
      playbackSpeed: 1.5,
    });
    await expect(store.load()).resolves.toMatchObject({
      theme: "dark",
      playbackSpeed: 1.5,
    });
  });

  it("does not persist a stale session command", async () => {
    const set = vi.fn(async () => undefined);
    const store = new PreferenceStore({
      get: async () => ({}),
      set,
    });
    const staleCommand = {
      type: "set-playback-speed",
      playbackSpeed: 2,
      sessionId: "session-current",
      generationEpoch: 3,
    } satisfies ReadingSessionCommand;

    await expect(
      persistSessionPreferenceIfCurrent(store, staleCommand, {
        id: "session-current",
        generationEpoch: 4,
      }),
    ).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});

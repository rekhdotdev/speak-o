import {
  rebaseSessionCommandAfterRecovery,
  StartupBarrier,
  togglePlaybackAfterRecovery,
} from "../../src/session/startup-barrier";

describe("Reading Session startup barrier", () => {
  it("does not start extraction and narration until recovery has settled", async () => {
    const events: string[] = [];
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const barrier = new StartupBarrier(recovery);

    const activation = barrier.afterRecovery(async () => {
      events.push("extraction started");
    });

    await Promise.resolve();
    expect(events).toEqual([]);
    finishRecovery?.();
    await activation;
    expect(events).toEqual(["extraction started"]);
  });

  it("defers and rebases the command that woke a suspended service worker", async () => {
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const barrier = new StartupBarrier(recovery);
    const staleCommand = {
      type: "session.command",
      sessionId: "session-recovered",
      generationEpoch: 3,
      command: "toggle",
    };
    let replayedCommand: typeof staleCommand | undefined;

    const replay = barrier.afterRecovery(async () => {
      replayedCommand = rebaseSessionCommandAfterRecovery(
        staleCommand,
        { id: "session-recovered", generationEpoch: 4 },
        true,
      );
    });

    await Promise.resolve();
    expect(replayedCommand).toBeUndefined();

    finishRecovery?.();
    await replay;

    expect(replayedCommand).toEqual({
      ...staleCommand,
      generationEpoch: 4,
    });
  });

  it("toggles the recovered current session when the global command wakes the worker", async () => {
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const barrier = new StartupBarrier(recovery);
    let currentSnapshot: {
      id: string;
      generationEpoch: number;
      status: "paused";
    } | null = null;
    const execute = vi.fn(async () => undefined);

    const toggle = togglePlaybackAfterRecovery(
      barrier,
      () => currentSnapshot,
      execute,
    );

    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();

    currentSnapshot = {
      id: "session-recovered",
      generationEpoch: 8,
      status: "paused",
    };
    finishRecovery?.();

    await expect(toggle).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith({
      type: "play",
      sessionId: "session-recovered",
      generationEpoch: 8,
    });
  });

  it("does nothing when recovery settles without an active session", async () => {
    const barrier = new StartupBarrier(Promise.resolve());
    const execute = vi.fn(async () => undefined);

    await expect(
      togglePlaybackAfterRecovery(barrier, () => null, execute),
    ).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

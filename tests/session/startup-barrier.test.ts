import {
  rebaseSessionCommandAfterRecovery,
  StartupBarrier,
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
});

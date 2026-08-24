import { StopBarrier } from "../../src/session/stop-barrier";

describe("Reading Session stop barrier", () => {
  it("does not start a new extraction until close cleanup has settled", async () => {
    const events: string[] = [];
    let finishCleanup: (() => void) | undefined;
    const cleanupFinished = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const barrier = new StopBarrier();

    const stop = barrier.track(async () => {
      events.push("cleanup started");
      await cleanupFinished;
      events.push("cleanup finished");
    });
    const reopen = barrier.afterStop(async () => {
      events.push("extraction started");
    });

    await Promise.resolve();
    expect(events).toEqual(["cleanup started"]);
    finishCleanup?.();
    await Promise.all([stop, reopen]);
    expect(events).toEqual([
      "cleanup started",
      "cleanup finished",
      "extraction started",
    ]);
  });
});

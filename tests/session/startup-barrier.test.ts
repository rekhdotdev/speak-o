import { StartupBarrier } from "../../src/session/startup-barrier";

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
});

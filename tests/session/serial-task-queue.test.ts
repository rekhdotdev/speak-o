import { SerialTaskQueue } from "../../src/session/serial-task-queue";

describe("SerialTaskQueue", () => {
  it("keeps a later stop from being overwritten by an older delayed effect", async () => {
    const queue = new SerialTaskQueue();
    let releaseOlderEffect: (() => void) | undefined;
    const olderEffectCanFinish = new Promise<void>((resolve) => {
      releaseOlderEffect = resolve;
    });
    let storedDescriptor: string | null = "current-session";

    const olderTransition = queue.run(async () => {
      await olderEffectCanFinish;
      storedDescriptor = "older-session";
    });
    const stopTransition = queue.run(async () => {
      storedDescriptor = null;
    });

    await Promise.resolve();
    expect(storedDescriptor).toBe("current-session");
    releaseOlderEffect?.();
    await Promise.all([olderTransition, stopTransition]);

    expect(storedDescriptor).toBeNull();
  });

  it("continues after a failed task", async () => {
    const queue = new SerialTaskQueue();
    const failed = queue.run(async () => {
      throw new Error("expected");
    });
    const recovered = queue.run(async () => "recovered");

    await expect(failed).rejects.toThrow("expected");
    await expect(recovered).resolves.toBe("recovered");
  });
});

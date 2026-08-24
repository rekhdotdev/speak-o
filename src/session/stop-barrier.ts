export class StopBarrier {
  private settled: Promise<void> = Promise.resolve();

  track(task: () => Promise<void>): Promise<void> {
    const pending = task();
    this.settled = pending.catch(() => undefined);
    return pending;
  }

  async afterStop<T>(task: () => Promise<T>): Promise<T> {
    await this.settled;
    return task();
  }
}

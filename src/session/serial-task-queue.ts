export class SerialTaskQueue {
  private settled: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.settled.then(task);
    this.settled = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

export class StartupBarrier {
  private readonly settled: Promise<void>;

  constructor(recovery: Promise<void>) {
    this.settled = recovery.catch(() => undefined);
  }

  async afterRecovery<T>(task: () => Promise<T>): Promise<T> {
    await this.settled;
    return task();
  }
}

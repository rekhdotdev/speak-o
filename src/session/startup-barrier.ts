interface SessionIdentity {
  id: string;
  generationEpoch: number;
}

export function rebaseSessionCommandAfterRecovery<
  T extends Record<string, unknown>,
>(
  message: T,
  snapshot: SessionIdentity | null,
  arrivedDuringRecovery: boolean,
): T {
  if (
    arrivedDuringRecovery &&
    snapshot &&
    message.sessionId === snapshot.id &&
    Number.isSafeInteger(message.generationEpoch) &&
    (message.generationEpoch as number) < snapshot.generationEpoch
  ) {
    return {
      ...message,
      generationEpoch: snapshot.generationEpoch,
    };
  }
  return message;
}

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

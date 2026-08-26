import type { ReadingSessionStatus } from "./types";

interface SessionIdentity {
  id: string;
  generationEpoch: number;
}

interface TogglePlaybackSnapshot extends SessionIdentity {
  status: ReadingSessionStatus;
}

export interface TogglePlaybackCommand {
  type: "play" | "pause";
  sessionId: string;
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

export function togglePlaybackAfterRecovery(
  barrier: StartupBarrier,
  currentSnapshot: () => TogglePlaybackSnapshot | null,
  execute: (command: TogglePlaybackCommand) => Promise<void>,
): Promise<boolean> {
  return barrier.afterRecovery(async () => {
    const snapshot = currentSnapshot();
    if (!snapshot) return false;
    await execute({
      type: snapshot.status === "playing" ? "pause" : "play",
      sessionId: snapshot.id,
      generationEpoch: snapshot.generationEpoch,
    });
    return true;
  });
}

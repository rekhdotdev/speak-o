import type { CommandContext, ReadingSessionCommand } from "../session/types";
import type { PreferenceStore, Preferences } from "./preferences";

type StoredPreferenceCommand = Extract<
  ReadingSessionCommand,
  { type: "set-playback-speed" | "set-highlights" }
>;

interface CurrentSessionContext {
  id: string;
  generationEpoch: number;
}

function isStoredPreferenceCommand(
  command: ReadingSessionCommand,
): command is StoredPreferenceCommand {
  return (
    command.type === "set-playback-speed" || command.type === "set-highlights"
  );
}

function matchesCurrentSession(
  command: CommandContext,
  current: CurrentSessionContext | null,
): boolean {
  return (
    current !== null &&
    command.sessionId === current.id &&
    command.generationEpoch === current.generationEpoch
  );
}

export async function persistSessionPreferenceIfCurrent(
  store: PreferenceStore,
  command: ReadingSessionCommand,
  current: CurrentSessionContext | null,
): Promise<boolean> {
  if (
    !isStoredPreferenceCommand(command) ||
    !matchesCurrentSession(command, current)
  ) {
    return false;
  }

  let patch: Partial<Preferences> | null = null;
  if (command.type === "set-playback-speed") {
    patch = { playbackSpeed: command.playbackSpeed };
  } else if (command.type === "set-highlights") {
    patch = { highlightsEnabled: command.enabled };
  }
  if (!patch) return false;

  await store.patch(patch);
  return true;
}

export const MESSAGE_VERSION = 1 as const;

export type SessionCommand = { type: "pause" };

export interface SessionCommandMessage {
  version: typeof MESSAGE_VERSION;
  target: "background";
  type: "session.command";
  sessionId: string;
  generationEpoch: number;
  command: SessionCommand;
}

export type RuntimeMessage = SessionCommandMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9._:-]+$/.test(value)
  );
}

export function parseRuntimeMessage(value: unknown): RuntimeMessage | null {
  if (
    !isRecord(value) ||
    value.version !== MESSAGE_VERSION ||
    value.target !== "background" ||
    value.type !== "session.command" ||
    !isSafeIdentifier(value.sessionId) ||
    !Number.isSafeInteger(value.generationEpoch) ||
    (value.generationEpoch as number) < 0 ||
    !isRecord(value.command) ||
    value.command.type !== "pause"
  ) {
    return null;
  }

  return {
    version: MESSAGE_VERSION,
    target: "background",
    type: "session.command",
    sessionId: value.sessionId,
    generationEpoch: value.generationEpoch as number,
    command: { type: "pause" },
  };
}

type SendRuntimeMessage = (message: Record<string, unknown>) => unknown;

function isInvalidatedExtensionContext(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase().includes("extension context invalidated")
  );
}

function isMissingRuntimeMessageReceiver(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase().includes("receiving end does not exist")
  );
}

export async function sendOptionalRuntimeMessage(
  sendMessage: SendRuntimeMessage,
  message: Record<string, unknown>,
): Promise<boolean> {
  try {
    await sendMessage(message);
    return true;
  } catch (error) {
    if (isMissingRuntimeMessageReceiver(error)) return false;
    throw error;
  }
}

export async function sendRuntimeMessageSafely(
  sendMessage: SendRuntimeMessage,
  message: Record<string, unknown>,
  onInvalidated?: (error: Error) => void,
): Promise<unknown> {
  try {
    return await sendMessage(message);
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) {
      onInvalidated?.(error);
      return undefined;
    }
    throw error;
  }
}

type SendRuntimeMessage = (message: Record<string, unknown>) => unknown;

function isInvalidatedExtensionContext(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase().includes("extension context invalidated")
  );
}

export async function sendRuntimeMessageSafely(
  sendMessage: SendRuntimeMessage,
  message: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await sendMessage(message);
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) return undefined;
    throw error;
  }
}

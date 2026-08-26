import {
  sendOptionalRuntimeMessage,
  sendRuntimeMessageSafely,
} from "../../src/runtime/safe-runtime-message";

describe("content-script runtime messaging", () => {
  it("absorbs an invalidated extension context after an unpacked reload", async () => {
    const sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    const onInvalidated = vi.fn();

    await expect(
      sendRuntimeMessageSafely(
        sendMessage,
        { type: "source.changed" },
        onInvalidated,
      ),
    ).resolves.toBeUndefined();
    expect(onInvalidated).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Extension context invalidated." }),
    );
  });

  it("does not hide unrelated messaging failures", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Unexpected transport failure");
    });

    await expect(
      sendRuntimeMessageSafely(sendMessage, { type: "source.changed" }),
    ).rejects.toThrow("Unexpected transport failure");
  });

  it("treats a missing receiver as an already-complete optional cleanup", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error(
        "Could not establish connection. Receiving end does not exist.",
      );
    });

    await expect(
      sendOptionalRuntimeMessage(sendMessage, { type: "audio.stop" }),
    ).resolves.toBe(false);
  });

  it("does not hide unrelated optional-message failures", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Unexpected transport failure");
    });

    await expect(
      sendOptionalRuntimeMessage(sendMessage, { type: "audio.stop" }),
    ).rejects.toThrow("Unexpected transport failure");
  });
});

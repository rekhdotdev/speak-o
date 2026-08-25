import { sendRuntimeMessageSafely } from "../../src/runtime/safe-runtime-message";

describe("content-script runtime messaging", () => {
  it("absorbs an invalidated extension context after an unpacked reload", async () => {
    const sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });

    await expect(
      sendRuntimeMessageSafely(sendMessage, { type: "source.changed" }),
    ).resolves.toBeUndefined();
  });

  it("does not hide unrelated messaging failures", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Unexpected transport failure");
    });

    await expect(
      sendRuntimeMessageSafely(sendMessage, { type: "source.changed" }),
    ).rejects.toThrow("Unexpected transport failure");
  });
});

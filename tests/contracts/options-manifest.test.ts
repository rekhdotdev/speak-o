import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Options manifest contract", () => {
  it("opens Options in a full tab instead of Chrome's fixed-width dialog", async () => {
    const html = await readFile(
      resolve(process.cwd(), "entrypoints/options/index.html"),
      "utf8",
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(
      document
        .querySelector('meta[name="manifest.open_in_tab"]')
        ?.getAttribute("content"),
    ).toBe("true");
  });
});

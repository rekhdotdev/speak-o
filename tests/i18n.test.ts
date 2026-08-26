import {
  applyInterfaceDirection,
  interfaceDirection,
  message,
} from "../src/i18n";

describe("extension UI localization", () => {
  it("uses the English catalog as the fallback and expands named placeholders", () => {
    vi.stubGlobal("chrome", {
      i18n: { getMessage: vi.fn(() => "") },
    });

    expect(message("readerMinutesLeft", 3)).toBe("3 min left");
    expect(message("optionsPreviewVoiceLabel", "Rachel")).toBe(
      "Preview Rachel using ElevenLabs media",
    );
  });

  it("prefers Chrome catalog lookup and passes string substitutions", () => {
    const getMessage = vi.fn((key: string, substitutions?: string[]) =>
      key === "readerPercentRead"
        ? `Localized ${substitutions?.[0] ?? ""}`
        : "",
    );
    vi.stubGlobal("chrome", { i18n: { getMessage } });

    expect(message("readerPercentRead", 25)).toBe("Localized 25");
    expect(getMessage).toHaveBeenCalledWith("readerPercentRead", ["25"]);
  });

  it("applies Chrome's predefined bidi direction to a UI root", () => {
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: vi.fn((key: string) => (key === "@@bidi_dir" ? "rtl" : "")),
      },
    });
    const root = document.createElement("div");

    expect(interfaceDirection()).toBe("rtl");
    expect(applyInterfaceDirection(root)).toBe("rtl");
    expect(root).toHaveAttribute("dir", "rtl");
  });
});

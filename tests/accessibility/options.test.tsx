import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { OptionsApp } from "../../src/ui/OptionsApp";

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
  commands: {
    getAll: vi.fn(async () => [
      {
        name: "read-article",
        description: "Read Article",
        shortcut: "Alt+Shift+R",
      },
    ]),
  },
  runtime: {
    sendMessage: vi.fn(async () => ({
      connection: { connected: false, remembered: false, maskedSuffix: null },
      metadata: { voices: [], models: [] },
    })),
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
  },
  permissions: {
    request: vi.fn(async () => false),
    remove: vi.fn(async () => true),
  },
  tabs: { create: vi.fn(async () => undefined) },
  tts: {
    getVoices: vi.fn(async () => []),
    onVoicesChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  i18n: { getUILanguage: vi.fn(() => "en-US") },
};

describe("options accessibility", () => {
  it("has landmark, label, and control semantics without automated violations", async () => {
    vi.stubGlobal("chrome", chromeMock);
    const view = render(<OptionsApp />);
    expect(
      await screen.findByRole("heading", {
        name: "Make reading sound like you.",
      }),
    ).toBeVisible();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});

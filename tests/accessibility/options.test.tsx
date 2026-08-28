import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { DEFAULT_PREFERENCES } from "../../src/storage/preferences";
import { OptionsApp } from "../../src/ui/OptionsApp";

const settingsPortMock = {
  disconnect: vi.fn(),
  postMessage: vi.fn(),
};

const activeOptionsState = {
  connections: {
    elevenlabs: { connected: false, remembered: false, maskedSuffix: null },
    speechify: { connected: false, remembered: false, maskedSuffix: null },
  },
  preferences: DEFAULT_PREFERENCES,
  metadata: {
    elevenlabs: { voices: [], models: [] },
    speechify: { voices: [], models: [] },
  },
  sessionContext: {
    sessionId: "session-options",
    generationEpoch: 4,
  },
  diagnosticsEvidence: {
    extractor: "x-articles",
    extractionStage: "ready",
    mappedBlockCount: 12,
    mappedCharacterCount: 4_280,
    mappingCoverage: 1,
    narrationLanguage: "en-IN",
    provider: "browser",
    modelId: null,
    errorCodes: [],
  },
  debugLog:
    'Speak-O DEBUG_MODE=true\nprovider.metadata.response {"status":404}\nprovider.connection.failed {"error":"Provider unavailable"}',
} as const;

const storageChangedMock = {
  addListener: vi.fn(),
  removeListener: vi.fn(),
};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
    onChanged: storageChangedMock,
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
    connect: vi.fn(() => settingsPortMock),
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
  },
  permissions: {
    request: vi.fn(async () => false),
    remove: vi.fn(async () => true),
  },
  tabs: { create: vi.fn(async () => undefined) },
  tts: {
    getVoices: vi.fn<() => Promise<chrome.tts.TtsVoice[]>>(async () => []),
    onVoicesChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  i18n: {
    getUILanguage: vi.fn(() => "en-US"),
    getMessage: vi.fn((_key: string) => ""),
  },
};

describe("options accessibility", () => {
  beforeEach(() => {
    chromeMock.storage.local.set.mockClear();
    chromeMock.runtime.sendMessage.mockClear();
    chromeMock.permissions.request.mockReset();
    chromeMock.permissions.request.mockResolvedValue(false);
    chromeMock.runtime.sendMessage.mockImplementation(
      async (request: Record<string, unknown>) => {
        if (request.type === "preferences.patch") {
          return {
            ok: true,
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...(request.patch as object),
            },
          };
        }
        return activeOptionsState;
      },
    );
    chromeMock.i18n.getMessage.mockImplementation((_key: string) => "");
    settingsPortMock.postMessage.mockClear();
    storageChangedMock.addListener.mockClear();
    storageChangedMock.removeListener.mockClear();
    chromeMock.tts.getVoices.mockResolvedValue([]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("has landmark, label, and control semantics without automated violations", async () => {
    vi.stubGlobal("chrome", chromeMock);
    const view = render(<OptionsApp />);
    expect(
      await screen.findByRole("heading", {
        name: "Make reading sound like you.",
      }),
    ).toBeVisible();
    expect((await axe.run(view.container)).violations).toEqual([]);
  }, 10_000);

  it("uses localized accessibility names and bidi direction", async () => {
    chromeMock.i18n.getMessage.mockImplementation((key) => {
      if (key === "@@bidi_dir") return "rtl";
      if (key === "optionsHomeLabel") return "Localized settings home";
      return "";
    });
    vi.stubGlobal("chrome", chromeMock);
    render(<OptionsApp />);

    expect(
      await screen.findByRole("link", { name: "Localized settings home" }),
    ).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("dir", "rtl");
  });

  it("saves a selected Chrome Voice for both the exact and base language", async () => {
    chromeMock.tts.getVoices.mockResolvedValue([
      {
        voiceName: "Word Voice",
        lang: "en-US",
        eventTypes: ["start", "word", "end"],
      },
    ]);
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    render(<OptionsApp />);

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Chrome Voice" }),
      "Word Voice",
    );

    await waitFor(() =>
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        version: 1,
        target: "background",
        type: "preferences.patch",
        patch: {
          browserVoiceByLanguage: {
            "en-US": "Word Voice",
            en: "Word Voice",
          },
        },
        sessionId: "session-options",
        generationEpoch: 4,
      }),
    );
    expect(settingsPortMock.postMessage).toHaveBeenCalledWith({
      version: 1,
      target: "background",
      type: "settings.open",
      sessionId: "session-options",
      generationEpoch: 4,
    });
  });

  it("connects Speechify with its own host permission and provider identity", async () => {
    chromeMock.permissions.request.mockResolvedValueOnce(true);
    chromeMock.runtime.sendMessage.mockImplementation(
      async (request: Record<string, unknown>) => {
        if (request.type === "provider.connect") {
          return {
            ok: true,
            connection: {
              connected: true,
              remembered: false,
              maskedSuffix: "••••5678",
            },
            metadata: { voices: [], models: [] },
          };
        }
        return activeOptionsState;
      },
    );
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    render(<OptionsApp />);

    const credentialInputs = await screen.findAllByLabelText(
      "Provider Credential",
    );
    await user.type(credentialInputs[1]!, "sk_speechify_5678");
    await user.click(screen.getByRole("button", { name: "Connect Speechify" }));

    expect(chromeMock.permissions.request).toHaveBeenCalledWith({
      origins: ["https://api.speechify.ai/*"],
    });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "provider.connect",
        provider: "speechify",
        credential: "sk_speechify_5678",
      }),
    );
  });

  it("commits typed language and usage values only after editing finishes", async () => {
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    render(<OptionsApp />);

    const language = await screen.findByRole("combobox", {
      name: "Narration Language",
    });
    chromeMock.runtime.sendMessage.mockClear();
    await user.type(language, "fr-FR");
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() =>
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "preferences.patch",
          patch: { narrationLanguageOverride: "fr-FR" },
        }),
      ),
    );

    const usageGuard = screen.getByRole("spinbutton", {
      name: /Provider Usage guard/,
    });
    chromeMock.runtime.sendMessage.mockClear();
    await user.clear(usageGuard);
    await user.type(usageGuard, "30000");
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() =>
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "preferences.patch",
          patch: { usageGuardCharacters: 30_000 },
        }),
      ),
    );
  });

  it("shows a save error when the background rejects a preference patch", async () => {
    chromeMock.runtime.sendMessage.mockImplementation(
      async (request: Record<string, unknown>) =>
        request.type === "preferences.patch" ? undefined : activeOptionsState,
    );
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    render(<OptionsApp />);

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Theme" }),
      "dark",
    );

    expect(
      await screen.findByText("Preferences could not be saved. Try again."),
    ).toBeVisible();
  });

  it("copies diagnostics from the active runtime evidence", async () => {
    vi.stubGlobal("chrome", chromeMock);
    render(<OptionsApp />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy redacted diagnostics" }),
    );

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    expect(JSON.parse(String(copied))).toMatchObject({
      extractor: "x-articles",
      mappedBlockCount: 12,
      mappedCharacterCount: 4_280,
      narrationLanguage: "en-IN",
      provider: "browser",
      modelId: null,
    });
  });

  it("shows and copies the provider debug log without credentials", async () => {
    vi.stubGlobal("chrome", chromeMock);
    render(<OptionsApp />);

    const debugLog = await screen.findByRole("textbox", {
      name: "Speak-O debug log",
    });
    expect((debugLog as HTMLTextAreaElement).value).toContain('"status":404');

    fireEvent.click(screen.getByRole("button", { name: "Copy debug log" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("provider.connection.failed"),
      ),
    );
    const copied = vi
      .mocked(navigator.clipboard.writeText)
      .mock.calls.at(-1)?.[0];
    expect(String(copied)).not.toContain("sk_");
  });

  it("does not fabricate diagnostics without an active session", async () => {
    chromeMock.runtime.sendMessage
      .mockResolvedValueOnce(activeOptionsState as never)
      .mockResolvedValueOnce({
        ...activeOptionsState,
        sessionContext: null,
        diagnosticsEvidence: null,
      } as never);
    vi.stubGlobal("chrome", chromeMock);
    render(<OptionsApp />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy redacted diagnostics" }),
    );

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "No active Reading Session is available for diagnostics.",
      ),
    ).toBeVisible();
  });
});

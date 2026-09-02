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
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
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
        name: "Speech",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText("Make reading sound like you."),
    ).not.toBeInTheDocument();
    expect(view.container.querySelectorAll(".eyebrow")).toHaveLength(0);
    expect((await axe.run(view.container)).violations).toEqual([]);
  }, 10_000);

  it("guides first run from ordered provider choice through Chrome Voice completion", async () => {
    chromeMock.tts.getVoices.mockResolvedValue([
      {
        voiceName: "Calm Voice",
        lang: "en-US",
        eventTypes: ["start", "word", "end"],
      },
    ]);
    chromeMock.runtime.sendMessage.mockImplementation(
      async (request: Record<string, unknown>) => {
        if (request.type === "options.get-state") {
          return {
            ...activeOptionsState,
            sessionContext: null,
            onboarding: { pending: true, narrationLanguage: "en-US" },
          };
        }
        if (request.type === "preferences.patch") {
          return {
            ok: true,
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...(request.patch as object),
            },
          };
        }
        if (request.type === "onboarding.complete") return { ok: true };
        return undefined;
      },
    );
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    const view = render(<OptionsApp />);

    expect(
      await screen.findByRole("heading", { name: "Choose a speech provider" }),
    ).toBeVisible();
    expect(screen.queryByText(/this Article/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Setup progress" }),
    ).toHaveAttribute("aria-valuenow", "1");
    const providerButtons = screen.getAllByRole("button", {
      name: /ElevenLabs|Speechify|Chrome Voice/,
    });
    expect(providerButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("ElevenLabs"),
      expect.stringContaining("Speechify"),
      expect.stringContaining("Chrome Voice"),
    ]);
    expect(
      Array.from(
        view.container.querySelectorAll("[data-provider-logo]"),
        (logo) => logo.getAttribute("data-provider-logo"),
      ),
    ).toEqual(["elevenlabs", "speechify", "browser"]);
    expect(
      view.container.querySelectorAll(".primary-provider-choice"),
    ).toHaveLength(0);

    await user.click(
      screen.getByRole("button", {
        name: /Chrome Voice.*No Provider Credential required/,
      }),
    );
    expect(
      screen.getByRole("progressbar", { name: "Setup progress" }),
    ).toHaveAttribute("aria-valuenow", "3");
    const finish = screen.getByRole("button", {
      name: "Finish and start listening",
    });
    expect(finish).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Chrome Voice" })).toHaveValue(
      "__unselected__",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Chrome Voice" }),
      "Calm Voice",
    );
    expect(finish).toBeEnabled();
    await user.click(finish);

    await waitFor(() =>
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        version: 1,
        target: "background",
        type: "onboarding.complete",
        provider: "browser",
      }),
    );
    expect((await axe.run(view.container)).violations).toEqual([]);
  }, 10_000);

  it("checks a cloud connection before requiring a provider Voice", async () => {
    const audio = document.createElement("audio");
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    const pause = vi.spyOn(audio, "pause").mockImplementation(() => undefined);
    vi.spyOn(audio, "load").mockImplementation(() => undefined);
    const audioConstructor = vi.fn(function MockAudio() {
      return audio;
    });
    vi.stubGlobal("Audio", audioConstructor);
    chromeMock.permissions.request.mockResolvedValueOnce(true);
    chromeMock.runtime.sendMessage.mockImplementation(
      async (request: Record<string, unknown>) => {
        if (request.type === "options.get-state") {
          return {
            ...activeOptionsState,
            sessionContext: null,
            onboarding: { pending: true, narrationLanguage: "en-US" },
          };
        }
        if (request.type === "provider.connect") {
          return {
            ok: true,
            connection: {
              connected: true,
              remembered: false,
              maskedSuffix: "••••1234",
            },
            metadata: {
              voices: [
                {
                  id: "voice-rachel",
                  name: "Rachel",
                  previewUrl: "https://cdn.example.invalid/rachel.mp3",
                  labels: {
                    accent: "american_english",
                    useCase: "conversational_voice",
                  },
                  models: [],
                },
              ],
              models: [],
            },
          };
        }
        if (request.type === "preferences.patch") {
          return {
            ok: true,
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...(request.patch as object),
            },
          };
        }
        if (request.type === "onboarding.complete") return { ok: true };
        return undefined;
      },
    );
    vi.stubGlobal("chrome", chromeMock);
    const user = userEvent.setup();
    render(<OptionsApp />);

    await user.click(
      await screen.findByRole("button", {
        name: /ElevenLabs.*Recommended Cloud Voice/,
      }),
    );
    const credential = screen.getByLabelText("Provider Credential");
    expect(credential).toHaveAttribute("type", "password");
    const reveal = screen.getByRole("button", { name: "Reveal" });
    expect(reveal).toHaveTextContent("");
    await user.click(reveal);
    expect(credential).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide" })).toBeVisible();
    await user.type(credential, "sk_elevenlabs_1234");
    await user.click(screen.getByRole("button", { name: "Check connection" }));
    expect(
      await screen.findByRole("heading", { name: "Choose a Voice" }),
    ).toBeVisible();

    const finish = screen.getByRole("button", {
      name: "Finish and start listening",
    });
    expect(finish).toBeDisabled();
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-selected",
      "false",
    );
    const preview = screen.getByRole("button", {
      name: "Play Rachel preview using provider media",
    });
    expect(preview).toHaveAttribute("aria-pressed", "false");
    expect(preview).toHaveTextContent("");
    expect(screen.getByText("American English")).toHaveClass("setup-voice-tag");
    expect(screen.getByText("Conversational Voice")).toHaveClass(
      "setup-voice-tag",
    );
    await user.click(preview);
    expect(audioConstructor).toHaveBeenCalledOnce();
    expect(audio.preload).toBe("none");
    expect(audio.src).toBe("https://cdn.example.invalid/rachel.mp3");
    expect(play).toHaveBeenCalledOnce();
    const pausePreview = screen.getByRole("button", {
      name: "Pause Rachel preview",
    });
    expect(pausePreview).toHaveAttribute("aria-pressed", "true");
    await user.click(pausePreview);
    expect(pause).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Rachel.*Choose/ }));
    expect(finish).toBeEnabled();
    expect(screen.getByRole("img", { name: "Rachel selected" })).toHaveClass(
      "setup-voice-selected",
    );
    expect(screen.getByRole("listitem").getAttribute("data-selected")).toBe(
      "true",
    );
    expect(
      screen.queryByRole("button", {
        name: "Play Rachel preview using provider media",
      }),
    ).not.toBeInTheDocument();
    await user.click(finish);

    await waitFor(() =>
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        version: 1,
        target: "background",
        type: "onboarding.complete",
        provider: "elevenlabs",
      }),
    );
  });

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

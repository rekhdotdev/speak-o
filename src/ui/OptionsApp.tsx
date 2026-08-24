import { useEffect, useMemo, useState } from "react";
import { buildRedactedDiagnostics } from "../diagnostics/diagnostics";
import {
  DEFAULT_PREFERENCES,
  PLAYBACK_SPEEDS,
  PreferenceStore,
  type ElevenLabsRegion,
  type Preferences,
} from "../storage/preferences";
import {
  elevenLabsOriginPattern,
  type ElevenLabsMetadata,
} from "../provider/elevenlabs";

interface ConnectionState {
  connected: boolean;
  remembered: boolean;
  maskedSuffix: string | null;
}

interface ShortcutState {
  name: string;
  description?: string;
  shortcut?: string;
}

const localPreferences = new PreferenceStore({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});

const emptyConnection: ConnectionState = {
  connected: false,
  remembered: false,
  maskedSuffix: null,
};

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="settings-section"
      aria-labelledby={`${id}-title`}
    >
      <header className="section-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="section-content">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className="setting-row toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

export function OptionsApp() {
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const [connection, setConnection] =
    useState<ConnectionState>(emptyConnection);
  const [metadata, setMetadata] = useState<ElevenLabsMetadata>({
    voices: [],
    models: [],
  });
  const [credential, setCredential] = useState("");
  const [remember, setRemember] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [browserVoices, setBrowserVoices] = useState<chrome.tts.TtsVoice[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutState[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const settingsPort = chrome.runtime.connect({ name: "speech-settings" });
    void localPreferences.load().then(setPreferences);
    void chrome.commands.getAll().then((commands) =>
      setShortcuts(
        commands.map((command, index) => ({
          name: command.name ?? `command-${index}`,
          ...(command.description === undefined
            ? {}
            : { description: command.description }),
          ...(command.shortcut === undefined
            ? {}
            : { shortcut: command.shortcut }),
        })),
      ),
    );
    void chrome.runtime
      .sendMessage({
        version: 1,
        target: "background",
        type: "options.get-state",
      })
      .then((response: unknown) => {
        if (typeof response !== "object" || response === null) return;
        const state = response as {
          connection?: ConnectionState;
          metadata?: ElevenLabsMetadata;
        };
        if (state.connection) setConnection(state.connection);
        if (state.metadata) setMetadata(state.metadata);
      });
    const loadBrowserVoices = () => {
      void chrome.tts.getVoices().then(setBrowserVoices);
    };
    loadBrowserVoices();
    chrome.tts.onVoicesChanged.addListener(loadBrowserVoices);
    return () => {
      chrome.tts.onVoicesChanged.removeListener(loadBrowserVoices);
      settingsPort.disconnect();
    };
  }, []);

  const interfaceLanguage = chrome.i18n.getUILanguage();
  const narrationLanguage =
    preferences.narrationLanguageOverride ?? interfaceLanguage;
  const baseNarrationLanguage =
    narrationLanguage.split("-")[0] ?? narrationLanguage;
  const availableNarrationLanguages = useMemo(
    () =>
      Array.from(
        new Set([
          interfaceLanguage,
          ...browserVoices.flatMap((voice) => (voice.lang ? [voice.lang] : [])),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
    [browserVoices, interfaceLanguage],
  );
  const compatibleBrowserVoices = browserVoices.filter((voice) => {
    if (!voice.lang) return true;
    return voice.lang
      .toLocaleLowerCase()
      .startsWith(baseNarrationLanguage.toLocaleLowerCase());
  });

  const savePreferences = async (next: Preferences) => {
    setPreferences(next);
    await localPreferences.save(next);
    setStatus("Preferences saved locally.");
  };

  const connect = async () => {
    if (credential.trim().length < 8) {
      setStatus("Enter a valid ElevenLabs API key.");
      return;
    }
    setBusy(true);
    setStatus("Requesting access to the selected API Region…");
    const originPattern = elevenLabsOriginPattern(preferences.region);
    try {
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });
      if (!granted) {
        setStatus("Access was not granted. Speak-O did not save the key.");
        return;
      }
      const response = (await chrome.runtime.sendMessage({
        version: 1,
        target: "background",
        type: "provider.connect",
        credential: credential.trim(),
        rememberOnDevice: remember,
        region: preferences.region,
      })) as {
        ok: boolean;
        message?: string;
        connection?: ConnectionState;
        metadata?: ElevenLabsMetadata;
      };
      if (!response.ok) {
        await chrome.permissions.remove({ origins: [originPattern] });
        setStatus(response.message ?? "ElevenLabs could not be connected.");
        return;
      }
      setConnection(response.connection ?? emptyConnection);
      setMetadata(response.metadata ?? { voices: [], models: [] });
      setStatus("ElevenLabs connected.");
    } finally {
      setCredential("");
      setReveal(false);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    const response = (await chrome.runtime.sendMessage({
      version: 1,
      target: "background",
      type: "provider.disconnect",
      region: preferences.region,
    })) as { ok: boolean };
    if (response.ok) {
      setConnection(emptyConnection);
      setMetadata({ voices: [], models: [] });
      setStatus("ElevenLabs disconnected and local provider data cleared.");
    }
    setBusy(false);
  };

  const visibleVoices = useMemo(() => {
    const query = voiceSearch.trim().toLocaleLowerCase();
    if (!query) return metadata.voices;
    return metadata.voices.filter((voice) =>
      `${voice.name} ${Object.values(voice.labels).join(" ")}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [metadata.voices, voiceSearch]);

  const copyDiagnostics = async () => {
    const diagnostics = buildRedactedDiagnostics({
      extensionVersion: chrome.runtime.getManifest().version,
      extractor: "generic",
      extractionStage: "ready",
      mappedBlockCount: 0,
      mappedCharacterCount: 0,
      mappingCoverage: 0,
      narrationLanguage: chrome.i18n.getUILanguage(),
      provider: connection.connected ? "elevenlabs" : "none",
      modelId: preferences.modelId,
      errorCodes: [],
      generatedAt: new Date(),
    });
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setStatus(
      "Redacted diagnostics copied. No Article text, key, audio, or URL was included.",
    );
  };

  return (
    <main className="options-layout">
      <aside className="options-sidebar">
        <a
          className="product-lockup"
          href="#speech"
          aria-label="Speak-O settings home"
        >
          <span className="product-mark">S</span>
          <span>
            <strong>Speak-O</strong>
            <small>Public beta · 0.1.0</small>
          </span>
        </a>
        <nav aria-label="Settings sections">
          <a href="#speech">Speech</a>
          <a href="#reading">Reading</a>
          <a href="#appearance">Appearance</a>
          <a href="#shortcuts">Shortcuts</a>
          <a href="#privacy">Privacy & diagnostics</a>
        </nav>
        <p className="publisher">Open-source software published by Rekh.</p>
      </aside>
      <div className="options-content">
        <header className="page-heading">
          <span className="eyebrow">Open-source BYOK Article Reader</span>
          <h1>Make reading sound like you.</h1>
          <p>
            Choose a calm Chrome Voice or connect ElevenLabs directly with your
            own Provider Credential. Speak-O has no account or subscription.
          </p>
        </header>

        <Section
          id="speech"
          eyebrow="01"
          title="Speech"
          description="Select how Speak-O turns an Article into a controlled spoken experience."
        >
          <div className="provider-card">
            <div className="provider-heading">
              <div>
                <strong>ElevenLabs Cloud Voice</strong>
                <small>Direct BYOK connection</small>
              </div>
              <span
                className={`connection-badge ${connection.connected ? "connected" : ""}`}
              >
                {connection.connected
                  ? `Connected ${connection.maskedSuffix ?? ""}`
                  : "Not connected"}
              </span>
            </div>
            {connection.connected ? (
              <button
                className="danger-button"
                disabled={busy}
                type="button"
                onClick={disconnect}
              >
                Disconnect ElevenLabs
              </button>
            ) : (
              <div className="credential-form">
                <label>
                  <span>Provider Credential</span>
                  <div className="credential-input">
                    <input
                      autoComplete="off"
                      type={reveal ? "text" : "password"}
                      value={credential}
                      placeholder="Paste your ElevenLabs API key"
                      onChange={(event) =>
                        setCredential(event.currentTarget.value)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((value) => !value)}
                    >
                      {reveal ? "Hide" : "Reveal"}
                    </button>
                  </div>
                </label>
                <label className="remember-row">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) =>
                      setRemember(event.currentTarget.checked)
                    }
                  />
                  <span>
                    <strong>Remember on this device</strong>
                    <small>
                      Chrome profile storage protects a remembered key; Speak-O
                      does not add application-level encryption.
                    </small>
                  </span>
                </label>
                <button
                  className="primary-button"
                  disabled={busy}
                  type="button"
                  onClick={connect}
                >
                  {busy ? "Connecting…" : "Connect ElevenLabs"}
                </button>
              </div>
            )}
          </div>

          <div className="setting-grid">
            <label className="field">
              <span>Narration Language</span>
              <input
                list="speak-o-narration-languages"
                value={preferences.narrationLanguageOverride ?? ""}
                placeholder="Detect from each Article"
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    narrationLanguageOverride:
                      event.currentTarget.value || null,
                  })
                }
              />
              <datalist id="speak-o-narration-languages">
                {availableNarrationLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Default Voice Mode</span>
              <select
                value={preferences.defaultVoiceMode}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    defaultVoiceMode: event.currentTarget
                      .value as Preferences["defaultVoiceMode"],
                  })
                }
              >
                <option value="browser">Chrome Voice</option>
                <option value="cloud">Cloud Voice</option>
              </select>
            </label>
            <label className="field">
              <span>Chrome Voice</span>
              <select
                value={
                  preferences.browserVoiceByLanguage[narrationLanguage] ?? ""
                }
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    browserVoiceByLanguage: {
                      ...preferences.browserVoiceByLanguage,
                      [narrationLanguage]: event.currentTarget.value,
                    },
                  })
                }
              >
                <option value="">Chrome default for {narrationLanguage}</option>
                {compatibleBrowserVoices.map((voice) => (
                  <option
                    key={`${voice.voiceName}:${voice.lang ?? ""}`}
                    value={voice.voiceName}
                  >
                    {voice.voiceName}
                    {voice.lang ? ` · ${voice.lang}` : ""}
                    {voice.remote ? " · may use a remote service" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Playback Speed</span>
              <select
                value={preferences.playbackSpeed}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    playbackSpeed: Number(
                      event.currentTarget.value,
                    ) as Preferences["playbackSpeed"],
                  })
                }
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Advanced API Region</span>
              <select
                value={preferences.region}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    region: event.currentTarget.value as ElevenLabsRegion,
                  })
                }
              >
                <option value="global">Global</option>
                <option value="us">United States</option>
                <option value="eu">European Union residency</option>
                <option value="india">India residency</option>
                <option value="singapore">Singapore residency</option>
              </select>
            </label>
            <label className="field">
              <span>Model</span>
              <select
                value={preferences.modelId}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    modelId: event.currentTarget.value,
                  })
                }
              >
                {metadata.models.length === 0 ? (
                  <option value={preferences.modelId}>Multilingual v2</option>
                ) : (
                  metadata.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          {connection.connected ? (
            <div className="voice-picker">
              <label className="field">
                <span>Search Voices</span>
                <input
                  type="search"
                  value={voiceSearch}
                  placeholder="Name, accent, or label"
                  onChange={(event) =>
                    setVoiceSearch(event.currentTarget.value)
                  }
                />
              </label>
              <div
                className="voice-list"
                role="list"
                aria-label="Available ElevenLabs Voices"
              >
                {visibleVoices.map((voice) => (
                  <div className="voice-option" key={voice.id} role="listitem">
                    <button
                      type="button"
                      onClick={() =>
                        void savePreferences({
                          ...preferences,
                          voiceByLanguage: {
                            ...preferences.voiceByLanguage,
                            [narrationLanguage]: voice.id,
                            [baseNarrationLanguage]: voice.id,
                          },
                        })
                      }
                    >
                      <span dir="auto">
                        <strong>{voice.name}</strong>
                        <small>
                          {Object.values(voice.labels).join(" · ") ||
                            "ElevenLabs Voice"}
                        </small>
                      </span>
                      <span>
                        {preferences.voiceByLanguage[narrationLanguage] ===
                          voice.id ||
                        preferences.voiceByLanguage[baseNarrationLanguage] ===
                          voice.id
                          ? "Selected"
                          : "Choose"}
                      </span>
                    </button>
                    {voice.previewUrl ? (
                      <a
                        href={voice.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Preview ${voice.name} using ElevenLabs media`}
                      >
                        Preview
                      </a>
                    ) : (
                      <small>
                        Preview unavailable; Speak-O will not generate a paid
                        preview.
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        <Section
          id="reading"
          eyebrow="02"
          title="Reading"
          description="Keep Reading Position and visual orientation under your control."
        >
          <Toggle
            checked={preferences.highlightsEnabled}
            label="Highlight active text"
            description="Use exact CSS Highlight ranges on the original Source Page."
            onChange={(value) =>
              void savePreferences({ ...preferences, highlightsEnabled: value })
            }
          />
          <Toggle
            checked={preferences.followEnabled}
            label="Follow the active sentence"
            description="Scroll only when the current sentence leaves a comfortable viewport area."
            onChange={(value) =>
              void savePreferences({ ...preferences, followEnabled: value })
            }
          />
          <label className="setting-row">
            <span>
              <strong>Provider Usage guard</strong>
              <small>
                Pause before submitting more source characters in one Cloud
                Voice Reading Session.
              </small>
            </span>
            <input
              className="number-input"
              min="500"
              step="500"
              type="number"
              value={preferences.usageGuardCharacters ?? ""}
              placeholder="Disabled"
              onChange={(event) =>
                void savePreferences({
                  ...preferences,
                  usageGuardCharacters: event.currentTarget.value
                    ? Number(event.currentTarget.value)
                    : null,
                })
              }
            />
          </label>
        </Section>

        <Section
          id="appearance"
          eyebrow="03"
          title="Appearance"
          description="Use a neutral interface that stays independent from the Source Page."
        >
          <div className="setting-grid">
            <label className="field">
              <span>Theme</span>
              <select
                value={preferences.theme}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    theme: event.currentTarget.value as Preferences["theme"],
                  })
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="field">
              <span>Floating bar dock</span>
              <select
                value={preferences.dock}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    dock: event.currentTarget.value as Preferences["dock"],
                  })
                }
              >
                <option value="bottom">Bottom center</option>
                <option value="top">Top center</option>
              </select>
            </label>
          </div>
        </Section>

        <Section
          id="shortcuts"
          eyebrow="04"
          title="Shortcuts"
          description="Chrome owns global assignments and reports conflicts or missing keys."
        >
          <div className="shortcut-list">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.name} className="setting-row">
                <span>
                  <strong>{shortcut.description ?? shortcut.name}</strong>
                  <small>{shortcut.name}</small>
                </span>
                <kbd>{shortcut.shortcut || "Not assigned"}</kbd>
              </div>
            ))}
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
            }
          >
            Open Chrome extension shortcuts
          </button>
        </Section>

        <Section
          id="privacy"
          eyebrow="05"
          title="Privacy & diagnostics"
          description="Speak-O keeps Rekh outside the Article and Provider Credential data path."
        >
          <div className="privacy-copy">
            <p>
              <strong>
                Rekh receives no Article text, Provider Credentials, Provider
                Usage, diagnostics, or behavioral data.
              </strong>
            </p>
            <p>
              Chrome Voice Mode creates no Speech Provider request from Speak-O.
              Cloud Voice Mode sends only the submitted source text directly to
              ElevenLabs using your credential. Preferences stay in local
              extension storage; active audio uses session storage and is
              cleared by Chrome when the extension session ends.
            </p>
            <p>
              <a
                href="https://elevenlabs.io/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Read ElevenLabs privacy material
              </a>
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={copyDiagnostics}
          >
            Copy redacted diagnostics
          </button>
        </Section>

        <footer>
          <strong>Speak-O 0.1.0 public beta</strong>
          <span>
            Apache-2.0 · Published by Rekh · No Speak-O account required
          </span>
        </footer>
        <div className="status-toast" role="status" aria-live="polite">
          {status}
        </div>
      </div>
    </main>
  );
}

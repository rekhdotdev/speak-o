import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildRedactedDiagnostics,
  type RuntimeDiagnosticEvidence,
} from "../diagnostics/diagnostics";
import {
  DEBUG_MODE,
  EMPTY_RUNTIME_DEBUG_LOG,
} from "../diagnostics/runtime-debug";
import {
  DEFAULT_PREFERENCES,
  PLAYBACK_SPEEDS,
  PREFERENCES_STORAGE_KEY,
  isPreferencePatch,
  sanitizePreferences,
  type ElevenLabsRegion,
  type PreferencePatch,
  type Preferences,
} from "../storage/preferences";
import { elevenLabsOriginPattern } from "../provider/elevenlabs";
import { SPEECHIFY_ORIGIN_PATTERN } from "../provider/speechify";
import {
  type CloudProviderId,
  type ProviderMetadata,
  type ProviderVoice,
  type SpeechProviderId,
} from "../provider/types";
import type { CommandContext } from "../session/types";
import { interfaceDirection, message } from "../i18n";

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

const emptyConnection: ConnectionState = {
  connected: false,
  remembered: false,
  maskedSuffix: null,
};

const emptyConnections: Record<CloudProviderId, ConnectionState> = {
  elevenlabs: emptyConnection,
  speechify: emptyConnection,
};

const emptyMetadata: Record<CloudProviderId, ProviderMetadata> = {
  elevenlabs: { voices: [], models: [] },
  speechify: { voices: [], models: [] },
};

const providerName = (provider: CloudProviderId) =>
  provider === "elevenlabs" ? "ElevenLabs" : "Speechify";

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
  const [connections, setConnections] =
    useState<Record<CloudProviderId, ConnectionState>>(emptyConnections);
  const [metadata, setMetadata] =
    useState<Record<CloudProviderId, ProviderMetadata>>(emptyMetadata);
  const [credentials, setCredentials] = useState<
    Record<CloudProviderId, string>
  >({
    elevenlabs: "",
    speechify: "",
  });
  const [remember, setRemember] = useState<Record<CloudProviderId, boolean>>({
    elevenlabs: false,
    speechify: false,
  });
  const [revealed, setRevealed] = useState<Record<CloudProviderId, boolean>>({
    elevenlabs: false,
    speechify: false,
  });
  const [voiceSearch, setVoiceSearch] = useState<
    Record<CloudProviderId, string>
  >({
    elevenlabs: "",
    speechify: "",
  });
  const [browserVoices, setBrowserVoices] = useState<chrome.tts.TtsVoice[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutState[]>([]);
  const [status, setStatus] = useState("");
  const [busyProvider, setBusyProvider] = useState<CloudProviderId | null>(
    null,
  );
  const [debugLog, setDebugLog] = useState(EMPTY_RUNTIME_DEBUG_LOG);
  const [debugCopyStatus, setDebugCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const debugTextArea = useRef<HTMLTextAreaElement>(null);
  const [narrationLanguageDraft, setNarrationLanguageDraft] = useState("");
  const [usageGuardDraft, setUsageGuardDraft] = useState(
    String(DEFAULT_PREFERENCES.usageGuardCharacters ?? ""),
  );
  const [sessionContext, setSessionContext] = useState<CommandContext | null>(
    null,
  );
  useEffect(() => {
    const settingsPort = chrome.runtime.connect({ name: "speech-settings" });
    let disposed = false;
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
          connections?: Record<CloudProviderId, ConnectionState>;
          connection?: ConnectionState;
          preferences?: Preferences;
          metadata?:
            ProviderMetadata | Record<CloudProviderId, ProviderMetadata>;
          debugLog?: string;
          sessionContext?: CommandContext | null;
        };
        if (state.connections) {
          setConnections(state.connections);
        } else if (state.connection) {
          setConnections({
            elevenlabs: state.connection,
            speechify: emptyConnection,
          });
        }
        if (state.preferences) setPreferences(state.preferences);
        if (state.metadata) {
          if ("elevenlabs" in state.metadata) {
            setMetadata(state.metadata);
          } else {
            setMetadata({
              elevenlabs: state.metadata,
              speechify: { voices: [], models: [] },
            });
          }
        }
        if (typeof state.debugLog === "string") setDebugLog(state.debugLog);
        const context = state.sessionContext;
        if (
          !disposed &&
          context &&
          typeof context.sessionId === "string" &&
          context.sessionId.length > 0 &&
          Number.isSafeInteger(context.generationEpoch) &&
          context.generationEpoch >= 0
        ) {
          setSessionContext(context);
          settingsPort.postMessage({
            version: 1,
            target: "background",
            type: "settings.open",
            sessionId: context.sessionId,
            generationEpoch: context.generationEpoch,
          });
        }
      });
    const loadBrowserVoices = () => {
      void chrome.tts.getVoices().then(setBrowserVoices);
    };
    const refreshPreferences = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      const change = changes[PREFERENCES_STORAGE_KEY];
      if (areaName === "local" && change) {
        setPreferences(sanitizePreferences(change.newValue));
      }
    };
    loadBrowserVoices();
    chrome.tts.onVoicesChanged.addListener(loadBrowserVoices);
    chrome.storage.onChanged.addListener(refreshPreferences);
    return () => {
      disposed = true;
      chrome.tts.onVoicesChanged.removeListener(loadBrowserVoices);
      chrome.storage.onChanged.removeListener(refreshPreferences);
      settingsPort.disconnect();
    };
  }, []);

  useEffect(() => {
    setNarrationLanguageDraft(preferences.narrationLanguageOverride ?? "");
    setUsageGuardDraft(String(preferences.usageGuardCharacters ?? ""));
  }, [preferences.narrationLanguageOverride, preferences.usageGuardCharacters]);

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
          ...Object.values(metadata).flatMap((providerMetadata) => [
            ...providerMetadata.models.flatMap((model) => model.languages),
            ...providerMetadata.voices.flatMap((voice) =>
              voice.labels.locale ? [voice.labels.locale] : [],
            ),
          ]),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
    [browserVoices, interfaceLanguage, metadata],
  );
  const compatibleBrowserVoices = browserVoices.filter((voice) => {
    if (!voice.lang) return true;
    return voice.lang
      .toLocaleLowerCase()
      .startsWith(baseNarrationLanguage.toLocaleLowerCase());
  });

  const savePreferences = async (patch: PreferencePatch) => {
    try {
      const response = (await chrome.runtime.sendMessage({
        version: 1,
        target: "background",
        type: "preferences.patch",
        patch,
        ...(sessionContext ?? {}),
      })) as { ok?: boolean; preferences?: Preferences } | undefined;
      if (response?.ok && response.preferences) {
        setPreferences(response.preferences);
        setStatus(message("optionsPreferencesSaved"));
        return;
      }
    } catch {
      // The status below keeps a stale/invalidated extension context visible.
    }
    setStatus(message("optionsPreferencesSaveFailed"));
  };

  const commitNarrationLanguage = () => {
    const value = narrationLanguageDraft.trim() || null;
    const patch = { narrationLanguageOverride: value };
    if (!isPreferencePatch(patch)) {
      setNarrationLanguageDraft(preferences.narrationLanguageOverride ?? "");
      setStatus(message("optionsInvalidNarrationLanguage"));
      return;
    }
    void savePreferences(patch);
  };

  const commitUsageGuard = () => {
    const value = usageGuardDraft.trim();
    const patch = {
      usageGuardCharacters: value === "" ? null : Number(value),
    };
    if (!isPreferencePatch(patch)) {
      setUsageGuardDraft(String(preferences.usageGuardCharacters ?? ""));
      setStatus(message("optionsInvalidUsageGuard"));
      return;
    }
    void savePreferences(patch);
  };

  const connect = async (provider: CloudProviderId) => {
    const credential = credentials[provider].trim();
    if (credential.length < 8) {
      setStatus(message("optionsInvalidCredential"));
      return;
    }
    setBusyProvider(provider);
    setStatus(message("optionsRequestingAccess"));
    const originPattern =
      provider === "elevenlabs"
        ? elevenLabsOriginPattern(preferences.elevenLabs.region)
        : SPEECHIFY_ORIGIN_PATTERN;
    try {
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });
      if (!granted) {
        setStatus(message("optionsAccessDenied"));
        return;
      }
      const response = (await chrome.runtime.sendMessage({
        version: 1,
        target: "background",
        type: "provider.connect",
        provider,
        credential,
        rememberOnDevice: remember[provider],
        region: preferences.elevenLabs.region,
      })) as {
        ok: boolean;
        message?: string;
        connection?: ConnectionState;
        metadata?: ProviderMetadata;
        debugLog?: string;
      };
      if (typeof response.debugLog === "string") {
        setDebugLog(response.debugLog);
      }
      if (!response.ok) {
        await chrome.permissions.remove({ origins: [originPattern] });
        setStatus(response.message ?? message("optionsConnectionFailed"));
        return;
      }
      setConnections((current) => ({
        ...current,
        [provider]: response.connection ?? emptyConnection,
      }));
      setMetadata((current) => ({
        ...current,
        [provider]: response.metadata ?? { voices: [], models: [] },
      }));
      setStatus(message("optionsConnectionSucceeded"));
    } finally {
      setCredentials((current) => ({ ...current, [provider]: "" }));
      setRevealed((current) => ({ ...current, [provider]: false }));
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: CloudProviderId) => {
    setBusyProvider(provider);
    const response = (await chrome.runtime.sendMessage({
      version: 1,
      target: "background",
      type: "provider.disconnect",
      provider,
      region: preferences.elevenLabs.region,
    })) as { ok: boolean };
    if (response.ok) {
      setConnections((current) => ({
        ...current,
        [provider]: emptyConnection,
      }));
      setMetadata((current) => ({
        ...current,
        [provider]: { voices: [], models: [] },
      }));
      setStatus(message("optionsDisconnected"));
    }
    setBusyProvider(null);
  };

  const visibleVoices = (provider: CloudProviderId): ProviderVoice[] => {
    const query = voiceSearch[provider].trim().toLocaleLowerCase();
    const selectedModel =
      preferences[provider === "elevenlabs" ? "elevenLabs" : "speechify"]
        .modelId;
    return metadata[provider].voices.filter((voice) => {
      const voiceModels = Array.isArray(voice.models) ? voice.models : [];
      const modelCompatible =
        voiceModels.length === 0 ||
        voiceModels.some(
          (model) =>
            model.id === selectedModel &&
            (model.languages.length === 0 ||
              model.languages.some((language) =>
                language
                  .toLowerCase()
                  .startsWith(baseNarrationLanguage.toLowerCase()),
              )),
        );
      return (
        modelCompatible &&
        (!query ||
          `${voice.name} ${Object.values(voice.labels).join(" ")}`
            .toLocaleLowerCase()
            .includes(query))
      );
    });
  };

  const copyDiagnostics = async () => {
    const response = (await chrome.runtime.sendMessage({
      version: 1,
      target: "background",
      type: "options.get-state",
    })) as { diagnosticsEvidence?: RuntimeDiagnosticEvidence | null };
    const evidence = response.diagnosticsEvidence ?? null;
    if (!evidence) {
      setStatus(message("optionsNoDiagnostics"));
      return;
    }
    const diagnostics = buildRedactedDiagnostics({
      extensionVersion: chrome.runtime.getManifest().version,
      ...evidence,
      generatedAt: new Date(),
    });
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setStatus(message("optionsDiagnosticsCopied"));
  };

  const copyDebugLog = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debugLog);
      } else {
        debugTextArea.current?.select();
        if (!document.execCommand("copy")) throw new Error("Copy failed");
      }
      setDebugCopyStatus("copied");
      setStatus(message("optionsDebugCopied"));
    } catch {
      debugTextArea.current?.select();
      setDebugCopyStatus("failed");
      setStatus(message("optionsDebugCopyFailed"));
    }
  };

  return (
    <main className="options-layout" dir={interfaceDirection()}>
      <aside className="options-sidebar">
        <a
          className="product-lockup"
          href="#speech"
          aria-label={message("optionsHomeLabel")}
        >
          <span className="product-mark">S</span>
          <span>
            <strong>{message("extensionName")}</strong>
            <small>{message("optionsPublicBetaVersion")}</small>
          </span>
        </a>
        <nav aria-label={message("optionsSectionsLabel")}>
          <a href="#speech">{message("optionsSpeech")}</a>
          <a href="#reading">{message("optionsReading")}</a>
          <a href="#appearance">{message("optionsAppearance")}</a>
          <a href="#shortcuts">{message("optionsShortcuts")}</a>
          <a href="#privacy">{message("optionsPrivacyDiagnostics")}</a>
        </nav>
        <p className="publisher">{message("optionsPublisher")}</p>
      </aside>
      <div className="options-content">
        <header className="page-heading">
          <span className="eyebrow">{message("optionsEyebrow")}</span>
          <h1>{message("optionsHeading")}</h1>
          <p>{message("optionsIntroduction")}</p>
        </header>

        <Section
          id="speech"
          eyebrow="01"
          title={message("optionsSpeech")}
          description={message("optionsSpeechDescription")}
        >
          {(["elevenlabs", "speechify"] as const).map((provider) => {
            const connection = connections[provider];
            const busy = busyProvider !== null;
            return (
              <div
                className="provider-card"
                data-provider={provider}
                key={provider}
              >
                <div className="provider-heading">
                  <div>
                    <strong>
                      {message(
                        provider === "elevenlabs"
                          ? "optionsElevenLabsCloudVoice"
                          : "optionsSpeechifyCloudVoice",
                      )}
                    </strong>
                    <small>{message("optionsDirectByok")}</small>
                  </div>
                  <span
                    className={`connection-badge ${connection.connected ? "connected" : ""}`}
                  >
                    {connection.connected
                      ? message(
                          "optionsConnected",
                          connection.maskedSuffix ?? "",
                        )
                      : message("optionsNotConnected")}
                  </span>
                </div>
                {connection.connected ? (
                  <button
                    className="danger-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void disconnect(provider)}
                  >
                    {message(
                      provider === "elevenlabs"
                        ? "optionsDisconnectElevenLabs"
                        : "optionsDisconnectSpeechify",
                    )}
                  </button>
                ) : (
                  <div className="credential-form">
                    <label>
                      <span>{message("optionsProviderCredential")}</span>
                      <div className="credential-input">
                        <input
                          autoComplete="off"
                          type={revealed[provider] ? "text" : "password"}
                          value={credentials[provider]}
                          placeholder={message(
                            provider === "elevenlabs"
                              ? "optionsCredentialPlaceholder"
                              : "optionsSpeechifyCredentialPlaceholder",
                          )}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setCredentials((current) => ({
                              ...current,
                              [provider]: value,
                            }));
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRevealed((current) => ({
                              ...current,
                              [provider]: !current[provider],
                            }))
                          }
                        >
                          {message(
                            revealed[provider]
                              ? "optionsHide"
                              : "optionsReveal",
                          )}
                        </button>
                      </div>
                    </label>
                    <label className="remember-row">
                      <input
                        type="checkbox"
                        checked={remember[provider]}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setRemember((current) => ({
                            ...current,
                            [provider]: checked,
                          }));
                        }}
                      />
                      <span>
                        <strong>{message("optionsRememberDevice")}</strong>
                        <small>{message("optionsRememberDescription")}</small>
                      </span>
                    </label>
                    <button
                      className="primary-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void connect(provider)}
                    >
                      {message(
                        busyProvider === provider
                          ? "optionsConnecting"
                          : provider === "elevenlabs"
                            ? "optionsConnectElevenLabs"
                            : "optionsConnectSpeechify",
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="setting-grid">
            <label className="field">
              <span>{message("optionsNarrationLanguage")}</span>
              <input
                list="speak-o-narration-languages"
                value={narrationLanguageDraft}
                placeholder={message("optionsDetectLanguage")}
                onChange={(event) =>
                  setNarrationLanguageDraft(event.currentTarget.value)
                }
                onBlur={commitNarrationLanguage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
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
              <span>{message("optionsDefaultProvider")}</span>
              <select
                value={preferences.defaultProvider}
                onChange={(event) =>
                  void savePreferences({
                    defaultProvider: event.currentTarget
                      .value as SpeechProviderId,
                  })
                }
              >
                <option value="browser">{message("optionsChromeVoice")}</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="speechify">Speechify</option>
              </select>
            </label>
            <label className="field">
              <span>{message("optionsChromeVoice")}</span>
              <select
                value={
                  preferences.browserVoiceByLanguage[narrationLanguage] ?? ""
                }
                onChange={(event) => {
                  const voiceName = event.currentTarget.value;
                  void savePreferences({
                    browserVoiceByLanguage: {
                      ...preferences.browserVoiceByLanguage,
                      [narrationLanguage]: voiceName,
                      [baseNarrationLanguage]: voiceName,
                    },
                  });
                }}
              >
                <option value="">
                  {message("optionsAutomaticVoice", narrationLanguage)}
                </option>
                {compatibleBrowserVoices.map((voice) => (
                  <option
                    key={`${voice.voiceName}:${voice.lang ?? ""}`}
                    value={voice.voiceName}
                  >
                    {voice.voiceName}
                    {voice.lang
                      ? message("optionsVoiceLanguageSuffix", voice.lang)
                      : ""}
                    {voice.eventTypes?.includes("word")
                      ? message("optionsWordHighlightingSuffix")
                      : message("optionsSentenceHighlightingSuffix")}
                    {voice.remote ? message("optionsRemoteVoiceSuffix") : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{message("optionsPlaybackSpeed")}</span>
              <select
                value={preferences.playbackSpeed}
                onChange={(event) =>
                  void savePreferences({
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
              <span>{message("optionsApiRegion")}</span>
              <select
                value={preferences.elevenLabs.region}
                onChange={(event) =>
                  void savePreferences({
                    elevenLabs: {
                      ...preferences.elevenLabs,
                      region: event.currentTarget.value as ElevenLabsRegion,
                    },
                  })
                }
              >
                <option value="global">{message("optionsRegionGlobal")}</option>
                <option value="us">{message("optionsRegionUs")}</option>
                <option value="eu">{message("optionsRegionEu")}</option>
                <option value="india">{message("optionsRegionIndia")}</option>
                <option value="singapore">
                  {message("optionsRegionSingapore")}
                </option>
              </select>
            </label>
            {(["elevenlabs", "speechify"] as const).map((provider) => {
              const preferenceKey =
                provider === "elevenlabs" ? "elevenLabs" : "speechify";
              const providerPreferences = preferences[preferenceKey];
              return (
                <label className="field" key={provider}>
                  <span>
                    {providerName(provider)} {message("optionsModel")}
                  </span>
                  <select
                    value={providerPreferences.modelId}
                    onChange={(event) =>
                      void savePreferences({
                        [preferenceKey]: {
                          ...providerPreferences,
                          modelId: event.currentTarget.value,
                        },
                      })
                    }
                  >
                    {metadata[provider].models.length === 0 ? (
                      <option value={providerPreferences.modelId}>
                        {providerPreferences.modelId}
                      </option>
                    ) : (
                      metadata[provider].models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              );
            })}
          </div>

          {(["elevenlabs", "speechify"] as const).map((provider) => {
            if (!connections[provider].connected) return null;
            const preferenceKey =
              provider === "elevenlabs" ? "elevenLabs" : "speechify";
            const providerPreferences = preferences[preferenceKey];
            return (
              <div className="voice-picker" key={provider}>
                <label className="field">
                  <span>
                    {message("optionsSearchVoices")} · {providerName(provider)}
                  </span>
                  <input
                    type="search"
                    value={voiceSearch[provider]}
                    placeholder={message("optionsVoiceSearchPlaceholder")}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setVoiceSearch((current) => ({
                        ...current,
                        [provider]: value,
                      }));
                    }}
                  />
                </label>
                <div
                  className="voice-list"
                  role="list"
                  aria-label={`${providerName(provider)} voices`}
                >
                  {visibleVoices(provider).map((voice) => (
                    <div
                      className="voice-option"
                      key={voice.id}
                      role="listitem"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void savePreferences({
                            [preferenceKey]: {
                              ...providerPreferences,
                              voiceByLanguage: {
                                ...providerPreferences.voiceByLanguage,
                                [narrationLanguage]: voice.id,
                                [baseNarrationLanguage]: voice.id,
                              },
                            },
                          })
                        }
                      >
                        <span dir="auto">
                          <strong>{voice.name}</strong>
                          <small>
                            {Object.values(voice.labels).join(" · ") ||
                              `${providerName(provider)} Voice`}
                          </small>
                        </span>
                        <span>
                          {providerPreferences.voiceByLanguage[
                            narrationLanguage
                          ] === voice.id ||
                          providerPreferences.voiceByLanguage[
                            baseNarrationLanguage
                          ] === voice.id
                            ? message("optionsSelected")
                            : message("optionsChoose")}
                        </span>
                      </button>
                      {voice.previewUrl ? (
                        <a
                          href={voice.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={message(
                            "optionsPreviewVoiceLabel",
                            voice.name,
                          )}
                        >
                          {message("optionsPreview")}
                        </a>
                      ) : (
                        <small>{message("optionsPreviewUnavailable")}</small>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Section>

        <Section
          id="reading"
          eyebrow="02"
          title={message("optionsReading")}
          description={message("optionsReadingDescription")}
        >
          <Toggle
            checked={preferences.highlightsEnabled}
            label={message("optionsHighlightActive")}
            description={message("optionsHighlightDescription")}
            onChange={(value) =>
              void savePreferences({ highlightsEnabled: value })
            }
          />
          <Toggle
            checked={preferences.followEnabled}
            label={message("optionsFollowSentence")}
            description={message("optionsFollowDescription")}
            onChange={(value) => void savePreferences({ followEnabled: value })}
          />
          <label className="setting-row">
            <span>
              <strong>{message("optionsUsageGuard")}</strong>
              <small>{message("optionsUsageGuardDescription")}</small>
            </span>
            <input
              className="number-input"
              min="500"
              step="500"
              type="number"
              value={usageGuardDraft}
              placeholder={message("optionsDisabled")}
              onChange={(event) =>
                setUsageGuardDraft(event.currentTarget.value)
              }
              onBlur={commitUsageGuard}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </Section>

        <Section
          id="appearance"
          eyebrow="03"
          title={message("optionsAppearance")}
          description={message("optionsAppearanceDescription")}
        >
          <div className="setting-grid">
            <label className="field">
              <span>{message("optionsTheme")}</span>
              <select
                value={preferences.theme}
                onChange={(event) =>
                  void savePreferences({
                    theme: event.currentTarget.value as Preferences["theme"],
                  })
                }
              >
                <option value="system">{message("optionsThemeSystem")}</option>
                <option value="light">{message("optionsThemeLight")}</option>
                <option value="dark">{message("optionsThemeDark")}</option>
              </select>
            </label>
            <label className="field">
              <span>{message("optionsFloatingDock")}</span>
              <select
                value={preferences.dock}
                onChange={(event) =>
                  void savePreferences({
                    dock: event.currentTarget.value as Preferences["dock"],
                  })
                }
              >
                <option value="bottom">{message("optionsDockBottom")}</option>
                <option value="top">{message("optionsDockTop")}</option>
              </select>
            </label>
          </div>
        </Section>

        <Section
          id="shortcuts"
          eyebrow="04"
          title={message("optionsShortcuts")}
          description={message("optionsShortcutsDescription")}
        >
          <div className="shortcut-list">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.name} className="setting-row">
                <span>
                  <strong>{shortcut.description ?? shortcut.name}</strong>
                  <small>{shortcut.name}</small>
                </span>
                <kbd>{shortcut.shortcut || message("optionsNotAssigned")}</kbd>
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
            {message("optionsOpenShortcuts")}
          </button>
        </Section>

        <Section
          id="privacy"
          eyebrow="05"
          title={message("optionsPrivacyDiagnostics")}
          description={message("optionsPrivacyDescription")}
        >
          <div className="privacy-copy">
            <p>
              <strong>{message("optionsPrivacySummary")}</strong>
            </p>
            <p>{message("optionsPrivacyDetail")}</p>
            <p>
              <a
                href="https://elevenlabs.io/privacy"
                target="_blank"
                rel="noreferrer"
              >
                {message("optionsElevenLabsPrivacy")}
              </a>
              {" · "}
              <a
                href="https://speechify.com/privacy/"
                target="_blank"
                rel="noreferrer"
              >
                {message("optionsSpeechifyPrivacy")}
              </a>
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={copyDiagnostics}
          >
            {message("optionsCopyDiagnostics")}
          </button>
          {DEBUG_MODE ? (
            <div className="debug-log-card">
              <div className="debug-log-heading">
                <strong>{message("optionsDebugModeOn")}</strong>
                <small>{message("optionsDebugPrivacy")}</small>
              </div>
              <textarea
                ref={debugTextArea}
                aria-label={message("optionsDebugLogLabel")}
                readOnly
                spellCheck={false}
                value={debugLog}
              />
              <div className="debug-log-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void copyDebugLog()}
                >
                  {message("optionsCopyDebugLog")}
                </button>
                <span role="status">
                  {debugCopyStatus === "copied"
                    ? message("optionsDebugCopied")
                    : debugCopyStatus === "failed"
                      ? message("optionsDebugCopyFailed")
                      : message("optionsDebugPrivacy")}
                </span>
              </div>
            </div>
          ) : null}
        </Section>

        <footer>
          <strong>{message("optionsFooterTitle")}</strong>
          <span>{message("optionsFooterDetail")}</span>
        </footer>
        <div className="status-toast" role="status" aria-live="polite">
          {status}
        </div>
      </div>
    </main>
  );
}

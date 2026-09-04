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
import { isExtensionMessage } from "../contracts/runtime-guards";
import type { CommandContext } from "../session/types";
import { interfaceDirection, message } from "../i18n";
import {
  OnboardingWizard,
  type ProviderConnectionState,
} from "./OnboardingWizard";
import { CloudVoiceList } from "./CloudVoiceList";
import { CredentialVisibilityButton } from "./CredentialVisibilityButton";
import { ProductLogo } from "./ProductLogo";
import { ProviderCredentialHelp } from "./ProviderCredentialHelp";
import { ProviderLogo } from "./ProviderLogo";

interface ShortcutState {
  name: string;
  description?: string;
  shortcut?: string;
}

const emptyConnection: ProviderConnectionState = {
  connected: false,
  remembered: false,
  maskedSuffix: null,
};

const emptyConnections: Record<CloudProviderId, ProviderConnectionState> = {
  elevenlabs: emptyConnection,
  speechify: emptyConnection,
};

const emptyMetadata: Record<CloudProviderId, ProviderMetadata> = {
  elevenlabs: { voices: [], models: [] },
  speechify: { voices: [], models: [] },
};

const speechProviders = ["elevenlabs", "speechify", "browser"] as const;
const settingsSectionIds = [
  "speech",
  "reading",
  "appearance",
  "shortcuts",
  "privacy",
] as const;

type SettingsSectionId = (typeof settingsSectionIds)[number];

const providerName = (provider: SpeechProviderId) =>
  provider === "elevenlabs"
    ? "ElevenLabs"
    : provider === "speechify"
      ? "Speechify"
      : message("optionsChromeVoice");

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="settings-section"
      aria-labelledby={`${id}-title`}
    >
      <header className="section-heading">
        <h2 id={`${id}-title`}>{title}</h2>
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
    useState<Record<CloudProviderId, ProviderConnectionState>>(
      emptyConnections,
    );
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
  const [activeProvider, setActiveProvider] = useState<SpeechProviderId>(
    DEFAULT_PREFERENCES.defaultProvider,
  );
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("speech");
  const pendingSectionNavigation = useRef<SettingsSectionId | null>(null);
  const pendingSectionNavigationTimeout = useRef<number | null>(null);
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
  const [stateLoaded, setStateLoaded] = useState(false);
  const [setupNarrationLanguage, setSetupNarrationLanguage] = useState<
    string | null
  >(null);
  useEffect(() => {
    const settingsPort = chrome.runtime.connect({ name: "speech-settings" });
    let disposed = false;
    const handleRuntimeMessage = (runtimeMessage: unknown) => {
      if (
        !isExtensionMessage(runtimeMessage) ||
        runtimeMessage.target !== "options" ||
        runtimeMessage.type !== "onboarding.requested" ||
        typeof runtimeMessage.narrationLanguage !== "string"
      ) {
        return;
      }
      setSetupNarrationLanguage(runtimeMessage.narrationLanguage);
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    void chrome.commands.getAll().then((commands) =>
      setShortcuts(
        commands.map((command, index) => {
          const name = command.name ?? `command-${index}`;
          const description =
            command.description?.trim() ||
            (name === "_execute_action" ? message("actionTitle") : undefined);
          return {
            name,
            ...(description === undefined ? {} : { description }),
            ...(command.shortcut === undefined
              ? {}
              : { shortcut: command.shortcut }),
          };
        }),
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
          connections?: Record<CloudProviderId, ProviderConnectionState>;
          connection?: ProviderConnectionState;
          preferences?: Preferences;
          metadata?:
            ProviderMetadata | Record<CloudProviderId, ProviderMetadata>;
          debugLog?: string;
          sessionContext?: CommandContext | null;
          onboarding?: {
            pending?: boolean;
            narrationLanguage?: string;
          };
        };
        if (state.connections) {
          setConnections(state.connections);
        } else if (state.connection) {
          setConnections({
            elevenlabs: state.connection,
            speechify: emptyConnection,
          });
        }
        if (state.preferences) {
          setPreferences(state.preferences);
          setActiveProvider(state.preferences.defaultProvider);
        }
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
        if (
          state.onboarding?.pending === true &&
          typeof state.onboarding.narrationLanguage === "string"
        ) {
          setSetupNarrationLanguage(state.onboarding.narrationLanguage);
        }
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
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setStateLoaded(true);
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
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      settingsPort.disconnect();
    };
  }, []);

  useEffect(() => {
    setNarrationLanguageDraft(preferences.narrationLanguageOverride ?? "");
    setUsageGuardDraft(String(preferences.usageGuardCharacters ?? ""));
  }, [preferences.narrationLanguageOverride, preferences.usageGuardCharacters]);

  useEffect(() => {
    if (!stateLoaded || setupNarrationLanguage) return;

    const sections = settingsSectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;

    let animationFrame = 0;
    const updateActiveSection = () => {
      animationFrame = 0;
      const documentHeight = document.documentElement.scrollHeight;
      if (documentHeight <= window.innerHeight) {
        setActiveSection(pendingSectionNavigation.current ?? "speech");
        return;
      }
      const atPageEnd =
        window.scrollY + window.innerHeight >= documentHeight - 2;
      const marker = Math.min(window.innerHeight * 0.28, 180);
      const currentSection = atPageEnd
        ? sections.at(-1)
        : ([...sections]
            .reverse()
            .find((section) => section.getBoundingClientRect().top <= marker) ??
          sections[0]);

      if (currentSection) {
        const pendingSection = pendingSectionNavigation.current;
        if (pendingSection && currentSection.id !== pendingSection) return;
        if (pendingSectionNavigationTimeout.current !== null) {
          window.clearTimeout(pendingSectionNavigationTimeout.current);
          pendingSectionNavigationTimeout.current = null;
        }
        pendingSectionNavigation.current = null;
        setActiveSection(currentSection.id as SettingsSectionId);
      }
    };
    const scheduleUpdate = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (pendingSectionNavigationTimeout.current !== null) {
        window.clearTimeout(pendingSectionNavigationTimeout.current);
        pendingSectionNavigationTimeout.current = null;
      }
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [setupNarrationLanguage, stateLoaded]);

  const navigateToSection = (section: SettingsSectionId) => {
    pendingSectionNavigation.current = section;
    setActiveSection(section);
    if (pendingSectionNavigationTimeout.current !== null) {
      window.clearTimeout(pendingSectionNavigationTimeout.current);
    }
    pendingSectionNavigationTimeout.current = window.setTimeout(() => {
      pendingSectionNavigation.current = null;
      pendingSectionNavigationTimeout.current = null;
      window.dispatchEvent(new Event("scroll"));
    }, 1_500);
  };

  const interfaceLanguage = chrome.i18n.getUILanguage();
  const narrationLanguage =
    preferences.narrationLanguageOverride ?? interfaceLanguage;
  const baseNarrationLanguage =
    narrationLanguage.split("-")[0] ?? narrationLanguage;
  const extensionVersion = chrome.runtime.getManifest().version;
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

  const savePreferences = async (
    patch: PreferencePatch,
  ): Promise<Preferences | null> => {
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
        return response.preferences;
      }
    } catch {
      // The status below keeps a stale/invalidated extension context visible.
    }
    setStatus(message("optionsPreferencesSaveFailed"));
    return null;
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

  const connect = async (
    provider: CloudProviderId,
    suppliedCredential = credentials[provider],
    rememberOnDevice = remember[provider],
  ): Promise<boolean> => {
    const credential = suppliedCredential.trim();
    if (credential.length < 8) {
      setStatus(message("optionsInvalidCredential"));
      return false;
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
        return false;
      }
      const response = (await chrome.runtime.sendMessage({
        version: 1,
        target: "background",
        type: "provider.connect",
        provider,
        credential,
        rememberOnDevice,
        region: preferences.elevenLabs.region,
      })) as {
        ok: boolean;
        message?: string;
        connection?: ProviderConnectionState;
        metadata?: ProviderMetadata;
        debugLog?: string;
      };
      if (typeof response.debugLog === "string") {
        setDebugLog(response.debugLog);
      }
      if (!response.ok) {
        await chrome.permissions.remove({ origins: [originPattern] });
        setStatus(response.message ?? message("optionsConnectionFailed"));
        return false;
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
      return true;
    } catch {
      setStatus(message("optionsConnectionFailed"));
      return false;
    } finally {
      setCredentials((current) => ({ ...current, [provider]: "" }));
      setRevealed((current) => ({ ...current, [provider]: false }));
      setBusyProvider(null);
    }
  };

  const completeOnboarding = async (
    provider: SpeechProviderId,
  ): Promise<boolean> => {
    try {
      const response = (await chrome.runtime.sendMessage({
        version: 1,
        target: "background",
        type: "onboarding.complete",
        provider,
      })) as { ok?: boolean; message?: string } | undefined;
      if (response?.ok) return true;
      setStatus(response?.message ?? message("setupFinishFailed"));
    } catch {
      setStatus(message("setupFinishFailed"));
    }
    return false;
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

  const handleProviderTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    provider: SpeechProviderId,
  ) => {
    const currentIndex = speechProviders.indexOf(provider);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % speechProviders.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + speechProviders.length) % speechProviders.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = speechProviders.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextProvider = speechProviders[nextIndex];
    if (!nextProvider) return;
    setActiveProvider(nextProvider);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#speech-provider-${nextProvider}-tab`)
      ?.focus();
  };

  const defaultProviderControl = (provider: SpeechProviderId) =>
    preferences.defaultProvider === provider ? (
      <span className="default-provider-badge">
        {message("optionsDefaultProviderBadge")}
      </span>
    ) : (
      <button
        aria-label={message(
          "optionsUseProviderByDefault",
          providerName(provider),
        )}
        className="secondary-button compact-button"
        type="button"
        onClick={() => void savePreferences({ defaultProvider: provider })}
      >
        {message("optionsUseAsDefault")}
      </button>
    );

  const renderCloudProviderPanel = (provider: CloudProviderId) => {
    const connection = connections[provider];
    const busy = busyProvider !== null;
    const preferenceKey =
      provider === "elevenlabs" ? "elevenLabs" : "speechify";
    const providerPreferences = preferences[preferenceKey];
    const selectedVoiceId =
      providerPreferences.voiceByLanguage[narrationLanguage] ??
      providerPreferences.voiceByLanguage[baseNarrationLanguage] ??
      null;

    return (
      <div
        aria-labelledby={`speech-provider-${provider}-tab`}
        className="provider-panel"
        data-provider={provider}
        id={`speech-provider-${provider}-panel`}
        key={provider}
        role="tabpanel"
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
          <div className="provider-actions">
            {defaultProviderControl(provider)}
            <span
              className={`connection-badge ${connection.connected ? "connected" : ""}`}
            >
              {connection.connected
                ? message("optionsConnected", connection.maskedSuffix ?? "")
                : message("optionsNotConnected")}
            </span>
          </div>
        </div>

        {connection.connected ? (
          <div className="provider-connected-settings">
            <div className="setting-grid provider-settings">
              {provider === "elevenlabs" ? (
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
                    <option value="global">
                      {message("optionsRegionGlobal")}
                    </option>
                    <option value="us">{message("optionsRegionUs")}</option>
                    <option value="eu">{message("optionsRegionEu")}</option>
                    <option value="india">
                      {message("optionsRegionIndia")}
                    </option>
                    <option value="singapore">
                      {message("optionsRegionSingapore")}
                    </option>
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>{message("optionsModel")}</span>
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
            </div>

            <div className="voice-picker">
              <label className="field">
                <span>{message("optionsSearchVoices")}</span>
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
              <CloudVoiceList
                ariaLabel={message(
                  "setupAvailableVoices",
                  providerName(provider),
                )}
                emptyMessage={message("setupNoVoices")}
                providerName={providerName(provider)}
                selectedVoiceId={selectedVoiceId}
                voices={visibleVoices(provider)}
                onSelect={(voice) =>
                  savePreferences({
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
              />
            </div>

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
          </div>
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
                <CredentialVisibilityButton
                  revealed={revealed[provider]}
                  onToggle={() =>
                    setRevealed((current) => ({
                      ...current,
                      [provider]: !current[provider],
                    }))
                  }
                />
              </div>
            </label>
            <ProviderCredentialHelp provider={provider} />
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
              <strong>{message("optionsRememberDevice")}</strong>
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
  };

  const renderBrowserProviderPanel = () => (
    <div
      aria-labelledby="speech-provider-browser-tab"
      className="provider-panel"
      data-provider="browser"
      id="speech-provider-browser-panel"
      key="browser"
      role="tabpanel"
    >
      <div className="provider-heading">
        <div>
          <strong>{message("optionsChromeVoice")}</strong>
          <small>{message("setupChromeDescription")}</small>
        </div>
        <div className="provider-actions">
          {defaultProviderControl("browser")}
        </div>
      </div>
      <div className="provider-connected-settings">
        <label className="field">
          <span>{message("optionsChromeVoice")}</span>
          <select
            value={preferences.browserVoiceByLanguage[narrationLanguage] ?? ""}
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
      </div>
    </div>
  );

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

  if (!stateLoaded) {
    return (
      <main className="setup-layout" dir={interfaceDirection()}>
        <div className="setup-loading" role="status">
          <ProductLogo className="setup-logo" />
          <span>{message("optionsLoading")}</span>
        </div>
      </main>
    );
  }

  if (setupNarrationLanguage) {
    return (
      <OnboardingWizard
        narrationLanguage={setupNarrationLanguage}
        connections={connections}
        metadata={metadata}
        browserVoices={browserVoices}
        preferences={preferences}
        busyProvider={busyProvider}
        status={status}
        onConnect={connect}
        onSavePreferences={savePreferences}
        onComplete={completeOnboarding}
      />
    );
  }

  return (
    <main className="options-layout" dir={interfaceDirection()}>
      <aside className="options-sidebar">
        <a
          className="product-lockup"
          href="#speech"
          aria-label={message("optionsHomeLabel")}
          onClick={() => navigateToSection("speech")}
        >
          <ProductLogo className="product-mark" />
          <span>
            <strong>{message("extensionName")}</strong>
            <small>{message("optionsVersion", extensionVersion)}</small>
          </span>
        </a>
        <nav aria-label={message("optionsSectionsLabel")}>
          {(
            [
              ["speech", "optionsSpeech"],
              ["reading", "optionsReading"],
              ["appearance", "optionsAppearance"],
              ["shortcuts", "optionsShortcuts"],
              ["privacy", "optionsPrivacyDiagnostics"],
            ] as const
          ).map(([id, label]) => (
            <a
              aria-current={activeSection === id ? "location" : undefined}
              href={`#${id}`}
              key={id}
              onClick={() => navigateToSection(id)}
            >
              {message(label)}
            </a>
          ))}
        </nav>
      </aside>
      <div className="options-content">
        <h1 className="sr-only">{message("optionsDocumentTitle")}</h1>
        <Section id="speech" title={message("optionsSpeech")}>
          <div className="setting-grid speech-general-settings">
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
          </div>

          <div className="provider-workspace">
            <div
              aria-label={message("optionsProviderTabsLabel")}
              className="provider-tabs"
              role="tablist"
            >
              {speechProviders.map((provider) => (
                <button
                  aria-controls={`speech-provider-${provider}-panel`}
                  aria-label={
                    preferences.defaultProvider === provider
                      ? message(
                          "optionsDefaultProviderTabLabel",
                          providerName(provider),
                        )
                      : undefined
                  }
                  aria-selected={activeProvider === provider}
                  className="provider-tab"
                  id={`speech-provider-${provider}-tab`}
                  key={provider}
                  role="tab"
                  tabIndex={activeProvider === provider ? 0 : -1}
                  type="button"
                  onClick={() => setActiveProvider(provider)}
                  onKeyDown={(event) =>
                    handleProviderTabKeyDown(event, provider)
                  }
                >
                  <ProviderLogo provider={provider} />
                  <span className="provider-tab-label">
                    <strong>{providerName(provider)}</strong>
                    {preferences.defaultProvider === provider ? (
                      <small>{message("optionsDefault")}</small>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>

            {activeProvider === "browser"
              ? renderBrowserProviderPanel()
              : renderCloudProviderPanel(activeProvider)}
          </div>
        </Section>

        <Section id="reading" title={message("optionsReading")}>
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

        <Section id="appearance" title={message("optionsAppearance")}>
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

        <Section id="shortcuts" title={message("optionsShortcuts")}>
          <div className="shortcut-list">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.name} className="setting-row">
                <span>
                  <strong>{shortcut.description ?? shortcut.name}</strong>
                  <small>
                    {shortcut.name === "_execute_action"
                      ? message("optionsToolbarAction")
                      : shortcut.name}
                  </small>
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

        <Section id="privacy" title={message("optionsPrivacyDiagnostics")}>
          <a
            className="privacy-policy-link"
            href="https://rekh.dev/speak-o/privacy/"
            target="_blank"
            rel="noreferrer"
          >
            {message("optionsPrivacyPolicyLink")}
          </a>
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
          <div className="footer-product">
            <strong>{message("optionsFooterTitle", extensionVersion)}</strong>
            <span aria-hidden="true">·</span>
            <span>{message("optionsLicense")}</span>
          </div>
          <a
            className="footer-publisher"
            href="https://rekh.dev/"
            target="_blank"
            rel="noreferrer"
          >
            <img
              alt=""
              aria-hidden="true"
              src={chrome.runtime.getURL("brand/rekh-favicon.svg")}
            />
            {message("optionsPublishedByRekh")}
          </a>
        </footer>
        <div className="status-toast" role="status" aria-live="polite">
          {status}
        </div>
      </div>
    </main>
  );
}

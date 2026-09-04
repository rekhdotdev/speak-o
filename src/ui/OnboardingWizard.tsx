import { useMemo, useState } from "react";
import { interfaceDirection, message } from "../i18n";
import type {
  CloudProviderId,
  ProviderMetadata,
  ProviderVoice,
  SpeechProviderId,
} from "../provider/types";
import type { PreferencePatch, Preferences } from "../storage/preferences";
import { CloudVoiceList } from "./CloudVoiceList";
import { CredentialVisibilityButton } from "./CredentialVisibilityButton";
import { ProductLogo } from "./ProductLogo";
import { ProviderCredentialHelp } from "./ProviderCredentialHelp";
import { ProviderLogo } from "./ProviderLogo";

export interface ProviderConnectionState {
  connected: boolean;
  remembered: boolean;
  maskedSuffix: string | null;
}

interface OnboardingWizardProps {
  narrationLanguage: string;
  connections: Record<CloudProviderId, ProviderConnectionState>;
  metadata: Record<CloudProviderId, ProviderMetadata>;
  browserVoices: chrome.tts.TtsVoice[];
  preferences: Preferences;
  busyProvider: CloudProviderId | null;
  status: string;
  onConnect(
    provider: CloudProviderId,
    credential: string,
    rememberOnDevice: boolean,
  ): Promise<boolean>;
  onSavePreferences(patch: PreferencePatch): Promise<Preferences | null>;
  onComplete(provider: SpeechProviderId): Promise<boolean>;
}

type SetupStep = "provider" | "connection" | "voice";

const providerName = (provider: SpeechProviderId) =>
  provider === "elevenlabs"
    ? "ElevenLabs"
    : provider === "speechify"
      ? "Speechify"
      : message("optionsChromeVoice");

export function OnboardingWizard({
  narrationLanguage,
  connections,
  metadata,
  browserVoices,
  preferences,
  busyProvider,
  status,
  onConnect,
  onSavePreferences,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<SetupStep>("provider");
  const [provider, setProvider] = useState<SpeechProviderId | null>(null);
  const [credential, setCredential] = useState("");
  const [rememberOnDevice, setRememberOnDevice] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [selectedCloudVoiceId, setSelectedCloudVoiceId] = useState<
    string | null
  >(null);
  const [browserVoiceChoice, setBrowserVoiceChoice] = useState<string | null>(
    null,
  );
  const [finishing, setFinishing] = useState(false);
  const baseNarrationLanguage =
    narrationLanguage.split("-")[0] ?? narrationLanguage;

  const compatibleBrowserVoices = useMemo(
    () =>
      browserVoices.filter(
        (voice) =>
          !voice.lang ||
          voice.lang
            .toLocaleLowerCase()
            .startsWith(baseNarrationLanguage.toLocaleLowerCase()),
      ),
    [baseNarrationLanguage, browserVoices],
  );

  const cloudVoices = useMemo(() => {
    if (provider !== "elevenlabs" && provider !== "speechify") return [];
    const preferenceKey =
      provider === "elevenlabs" ? "elevenLabs" : "speechify";
    const selectedModel = preferences[preferenceKey].modelId;
    const query = voiceSearch.trim().toLocaleLowerCase();
    return metadata[provider].voices.filter((voice) => {
      const models = Array.isArray(voice.models) ? voice.models : [];
      const modelCompatible =
        models.length === 0 ||
        models.some(
          (model) =>
            model.id === selectedModel &&
            (model.languages.length === 0 ||
              model.languages.some((language) =>
                language
                  .toLocaleLowerCase()
                  .startsWith(baseNarrationLanguage.toLocaleLowerCase()),
              )),
        );
      const searchable =
        `${voice.name} ${Object.values(voice.labels).join(" ")}`
          .trim()
          .toLocaleLowerCase();
      return modelCompatible && (!query || searchable.includes(query));
    });
  }, [baseNarrationLanguage, metadata, preferences, provider, voiceSearch]);

  const chooseProvider = (nextProvider: SpeechProviderId) => {
    setProvider(nextProvider);
    setVoiceSearch("");
    setSelectedCloudVoiceId(null);
    setBrowserVoiceChoice(null);
    if (nextProvider === "browser" || connections[nextProvider].connected) {
      setStep("voice");
      return;
    }
    setCredential("");
    setRememberOnDevice(false);
    setRevealed(false);
    setStep("connection");
  };

  const connect = async () => {
    if (provider !== "elevenlabs" && provider !== "speechify") return;
    const connected = await onConnect(provider, credential, rememberOnDevice);
    if (!connected) return;
    setCredential("");
    setRevealed(false);
    setStep("voice");
  };

  const selectBrowserVoice = async (voiceName: string) => {
    const voiceByLanguage = { ...preferences.browserVoiceByLanguage };
    if (voiceName) {
      voiceByLanguage[narrationLanguage] = voiceName;
      voiceByLanguage[baseNarrationLanguage] = voiceName;
    } else {
      delete voiceByLanguage[narrationLanguage];
      delete voiceByLanguage[baseNarrationLanguage];
    }
    const saved = await onSavePreferences({
      browserVoiceByLanguage: voiceByLanguage,
    });
    if (saved) setBrowserVoiceChoice(voiceName);
  };

  const selectCloudVoice = async (voice: ProviderVoice) => {
    if (provider !== "elevenlabs" && provider !== "speechify") return;
    const preferenceKey =
      provider === "elevenlabs" ? "elevenLabs" : "speechify";
    const current = preferences[preferenceKey];
    const saved = await onSavePreferences({
      [preferenceKey]: {
        ...current,
        voiceByLanguage: {
          ...current.voiceByLanguage,
          [narrationLanguage]: voice.id,
          [baseNarrationLanguage]: voice.id,
        },
      },
    });
    if (saved) setSelectedCloudVoiceId(voice.id);
  };

  const finish = async () => {
    if (!provider) return;
    setFinishing(true);
    const completed = await onComplete(provider);
    if (!completed) setFinishing(false);
  };

  const stepNumber = step === "provider" ? 1 : step === "connection" ? 2 : 3;
  const canFinish =
    provider === "browser"
      ? browserVoiceChoice !== null
      : selectedCloudVoiceId !== null;

  return (
    <main className="setup-layout" dir={interfaceDirection()}>
      <section className="setup-card" aria-labelledby="setup-title">
        <header className="setup-heading">
          <ProductLogo className="setup-logo" />
          <div>
            <h1 id="setup-title">{message("setupTitle")}</h1>
            <p>{message("setupIntroduction")}</p>
          </div>
        </header>

        <div
          aria-label={message("setupProgressLabel")}
          aria-valuemax={3}
          aria-valuemin={1}
          aria-valuenow={stepNumber}
          aria-valuetext={message("setupStepProgress", [stepNumber, 3])}
          className="setup-stepper"
          role="progressbar"
        >
          {[1, 2, 3].map((number) => (
            <span
              aria-hidden="true"
              className={`setup-step-marker ${number < stepNumber ? "is-complete" : ""} ${number === stepNumber ? "is-current" : ""}`}
              key={number}
            >
              <span>{number}</span>
            </span>
          ))}
        </div>

        {step === "provider" ? (
          <div className="setup-step">
            <div className="setup-step-heading">
              <h2>{message("setupProviderTitle")}</h2>
              <p>{message("setupProviderDescription")}</p>
            </div>
            <div className="provider-choices">
              <button
                className="provider-choice"
                type="button"
                onClick={() => chooseProvider("elevenlabs")}
              >
                <ProviderLogo provider="elevenlabs" />
                <span className="provider-choice-copy">
                  <strong>ElevenLabs</strong>
                  <span>{message("setupElevenLabsDescription")}</span>
                </span>
              </button>
              <button
                className="provider-choice"
                type="button"
                onClick={() => chooseProvider("speechify")}
              >
                <ProviderLogo provider="speechify" />
                <span className="provider-choice-copy">
                  <strong>Speechify</strong>
                  <span>{message("setupSpeechifyDescription")}</span>
                </span>
              </button>
              <button
                className="provider-choice fallback-provider-choice"
                type="button"
                onClick={() => chooseProvider("browser")}
              >
                <ProviderLogo provider="browser" />
                <span className="provider-choice-copy">
                  <strong>{message("optionsChromeVoice")}</strong>
                  <span>{message("setupChromeDescription")}</span>
                </span>
              </button>
            </div>
          </div>
        ) : null}

        {step === "connection" &&
        (provider === "elevenlabs" || provider === "speechify") ? (
          <div className="setup-step">
            <div className="setup-step-heading">
              <h2>{message("setupConnectTitle", providerName(provider))}</h2>
              <p>
                {message("setupConnectDescription", providerName(provider))}
              </p>
            </div>
            <div className="setup-connection-form">
              <label>
                <span>{message("optionsProviderCredential")}</span>
                <div className="credential-input">
                  <input
                    autoComplete="off"
                    type={revealed ? "text" : "password"}
                    value={credential}
                    placeholder={message(
                      provider === "elevenlabs"
                        ? "optionsCredentialPlaceholder"
                        : "optionsSpeechifyCredentialPlaceholder",
                    )}
                    onChange={(event) =>
                      setCredential(event.currentTarget.value)
                    }
                  />
                  <CredentialVisibilityButton
                    revealed={revealed}
                    onToggle={() => setRevealed((current) => !current)}
                  />
                </div>
              </label>
              <ProviderCredentialHelp provider={provider} />
              <label className="remember-row">
                <input
                  type="checkbox"
                  checked={rememberOnDevice}
                  onChange={(event) =>
                    setRememberOnDevice(event.currentTarget.checked)
                  }
                />
                <strong>{message("optionsRememberDevice")}</strong>
              </label>
            </div>
            <div className="setup-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busyProvider !== null}
                onClick={() => setStep("provider")}
              >
                {message("setupBack")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busyProvider !== null}
                onClick={() => void connect()}
              >
                {message(
                  busyProvider === provider
                    ? "optionsConnecting"
                    : "setupCheckConnection",
                )}
              </button>
            </div>
          </div>
        ) : null}

        {step === "voice" && provider ? (
          <div className="setup-step">
            <div className="setup-step-heading">
              <h2>{message("setupVoiceTitle")}</h2>
              <p>{message("setupVoiceDescription", providerName(provider))}</p>
            </div>

            {provider === "browser" ? (
              <label className="field setup-browser-voice">
                <span>{message("optionsChromeVoice")}</span>
                <select
                  value={browserVoiceChoice ?? "__unselected__"}
                  onChange={(event) =>
                    void selectBrowserVoice(event.currentTarget.value)
                  }
                >
                  <option value="__unselected__" disabled>
                    {message("setupChooseChromeVoice")}
                  </option>
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
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="setup-cloud-voices">
                <label className="field">
                  <span>{message("optionsSearchVoices")}</span>
                  <input
                    type="search"
                    value={voiceSearch}
                    placeholder={message("optionsVoiceSearchPlaceholder")}
                    onChange={(event) =>
                      setVoiceSearch(event.currentTarget.value)
                    }
                  />
                </label>
                <CloudVoiceList
                  ariaLabel={message(
                    "setupAvailableVoices",
                    providerName(provider),
                  )}
                  emptyMessage={message("setupNoVoices")}
                  providerName={providerName(provider)}
                  selectedVoiceId={selectedCloudVoiceId}
                  voices={cloudVoices}
                  onSelect={selectCloudVoice}
                />
              </div>
            )}

            <div className="setup-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={finishing}
                onClick={() => {
                  setStep(
                    provider === "browser" || connections[provider].connected
                      ? "provider"
                      : "connection",
                  );
                }}
              >
                {message("setupBack")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!canFinish || finishing}
                onClick={() => void finish()}
              >
                {message(finishing ? "setupFinishing" : "setupFinish")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="setup-status" role="status" aria-live="polite">
          {status}
        </div>
      </section>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "../i18n";
import type { ProviderVoice } from "../provider/types";
import { CheckIcon, PauseIcon, PlayIcon } from "./icons";

interface CloudVoiceListProps {
  ariaLabel: string;
  emptyMessage: string;
  providerName: string;
  selectedVoiceId: string | null;
  voices: ProviderVoice[];
  onSelect(voice: ProviderVoice): void | Promise<unknown>;
}

const humanizeVoiceLabel = (label: string) =>
  label
    .trim()
    .split(/_+/)
    .filter(Boolean)
    .map((word) =>
      /^[a-z]{2}-[A-Z]{2}$/.test(word)
        ? word
        : `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`,
    )
    .join(" ");

export function CloudVoiceList({
  ariaLabel,
  emptyMessage,
  providerName,
  selectedVoiceId,
  voices,
  onSelect,
}: CloudVoiceListProps) {
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(
    null,
  );
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopVoicePreview = useCallback(() => {
    const audio = previewAudioRef.current;
    previewAudioRef.current = null;
    setPreviewingVoiceId(null);
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const toggleVoicePreview = (voice: ProviderVoice) => {
    if (!voice.previewUrl) return;
    if (previewAudioRef.current && previewingVoiceId === voice.id) {
      stopVoicePreview();
      return;
    }

    stopVoicePreview();
    const audio = new Audio();
    audio.preload = "none";
    audio.src = voice.previewUrl;
    const settle = () => {
      if (previewAudioRef.current !== audio) return;
      previewAudioRef.current = null;
      setPreviewingVoiceId(null);
    };
    audio.addEventListener("ended", settle, { once: true });
    audio.addEventListener("error", settle, { once: true });
    previewAudioRef.current = audio;
    setPreviewingVoiceId(voice.id);
    void audio.play().catch(() => {
      audio.pause();
      audio.removeAttribute("src");
      settle();
    });
  };

  useEffect(() => () => stopVoicePreview(), [stopVoicePreview]);

  useEffect(() => {
    if (
      previewingVoiceId !== null &&
      !voices.some((voice) => voice.id === previewingVoiceId)
    ) {
      stopVoicePreview();
    }
  }, [previewingVoiceId, stopVoicePreview, voices]);

  const selectVoice = async (voice: ProviderVoice) => {
    stopVoicePreview();
    await onSelect(voice);
  };

  return (
    <div className="voice-list" role="list" aria-label={ariaLabel}>
      {voices.map((voice) => {
        const selected = selectedVoiceId === voice.id;
        const previewing = previewingVoiceId === voice.id;
        const labels = [
          ...new Set(
            Object.values(voice.labels).map(humanizeVoiceLabel).filter(Boolean),
          ),
        ];
        if (labels.length === 0) labels.push(`${providerName} Voice`);

        return (
          <div
            className="voice-option"
            data-selected={selected}
            key={voice.id}
            role="listitem"
          >
            {selected ? (
              <span
                aria-label={message("voiceSelectedLabel", voice.name)}
                className="voice-selected"
                role="img"
                title={message("voiceSelectedLabel", voice.name)}
              >
                <CheckIcon />
              </span>
            ) : voice.previewUrl ? (
              <button
                aria-label={message(
                  previewing
                    ? "voicePausePreviewLabel"
                    : "voicePlayPreviewLabel",
                  voice.name,
                )}
                aria-pressed={previewing}
                className="voice-preview"
                title={message(
                  previewing
                    ? "voicePausePreviewLabel"
                    : "voicePlayPreviewLabel",
                  voice.name,
                )}
                type="button"
                onClick={() => toggleVoicePreview(voice)}
              >
                <span className="voice-preview-glyph">
                  <span data-visible={!previewing}>
                    <PlayIcon />
                  </span>
                  <span data-visible={previewing}>
                    <PauseIcon />
                  </span>
                </span>
              </button>
            ) : (
              <span aria-hidden="true" className="voice-leading-placeholder" />
            )}
            <button
              aria-pressed={selected}
              className="voice-choice"
              type="button"
              onClick={() => void selectVoice(voice)}
            >
              <span className="voice-copy" dir="auto">
                <strong>{voice.name}</strong>
                <span className="voice-tags">
                  {labels.map((label) => (
                    <small className="voice-tag" key={label}>
                      {label}
                    </small>
                  ))}
                </span>
              </span>
              <span>
                {selected
                  ? message("optionsSelected")
                  : message("optionsChoose")}
              </span>
            </button>
          </div>
        );
      })}
      {voices.length === 0 ? (
        <p className="voice-list-empty">{emptyMessage}</p>
      ) : null}
    </div>
  );
}

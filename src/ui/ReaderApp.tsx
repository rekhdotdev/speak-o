import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEBUG_MODE,
  EMPTY_RUNTIME_DEBUG_LOG,
} from "../diagnostics/runtime-debug";
import { interfaceDirection, message, type MessageKey } from "../i18n";
import type {
  ReadingSessionSnapshot,
  ReadingSessionStatus,
} from "../session/types";
import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  type VoiceMode,
} from "../storage/preferences";
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  SettingsIcon,
} from "./icons";

export type ReaderViewState =
  | { kind: "finding" }
  | { kind: "onboarding"; providerConnected: boolean }
  | { kind: "error"; title: string; message: string }
  | { kind: "session"; snapshot: ReadingSessionSnapshot };

interface ReaderAppProps {
  state: ReaderViewState;
  debugLog?: string;
  onChooseMode(mode: VoiceMode): void;
  onCommand(command: string, value?: number): void;
  onOpenSettings(): void;
}

function DebugPanel({ log, dock }: { log: string; dock: "top" | "bottom" }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const textArea = useRef<HTMLTextAreaElement>(null);

  if (!DEBUG_MODE) return null;

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(log);
      } else {
        textArea.current?.select();
        if (!document.execCommand("copy")) throw new Error("Copy failed");
      }
      setCopyStatus("copied");
    } catch {
      textArea.current?.select();
      setCopyStatus("failed");
    }
  };

  return (
    <details className={`debug-panel debug-panel-${dock}`} open>
      <summary>{message("readerDebugModeOn")}</summary>
      <textarea
        ref={textArea}
        aria-label={message("readerDebugLogLabel")}
        readOnly
        spellCheck={false}
        value={log}
      />
      <div className="debug-actions">
        <button type="button" onClick={() => void copy()}>
          {message("readerCopyDebugLog")}
        </button>
        <span role="status">
          {copyStatus === "copied"
            ? message("readerDebugCopied")
            : copyStatus === "failed"
              ? message("readerDebugCopyFailed")
              : message("readerDebugPrivacy")}
        </span>
      </div>
    </details>
  );
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return message("readerFinished");
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return message("readerMinutesLeft", minutes);
}

const statusMessageKeys: Record<ReadingSessionStatus, MessageKey> = {
  ready: "readerStatusReady",
  preparing: "readerStatusPreparing",
  playing: "readerStatusPlaying",
  paused: "readerStatusPaused",
  buffering: "readerStatusBuffering",
  "usage-limit": "readerStatusUsageLimit",
  "provider-issue": "readerStatusProviderIssue",
  "page-changed": "readerStatusPageChanged",
  completed: "readerStatusCompleted",
};

function statusLabel(status: ReadingSessionStatus): string {
  return message(statusMessageKeys[status]);
}

function IconButton({
  label,
  className = "",
  children,
  onClick,
  disabled,
  buttonRef,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      aria-label={label}
      className={`icon-button ${className}`}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ReaderApp({
  state,
  debugLog = EMPTY_RUNTIME_DEBUG_LOG,
  onChooseMode,
  onCommand,
  onOpenSettings,
}: ReaderAppProps) {
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const compactPlayButton = useRef<HTMLButtonElement>(null);
  const mainPlayButton = useRef<HTMLButtonElement>(null);
  const wasMinimized = useRef(false);
  const snapshot = state.kind === "session" ? state.snapshot : null;
  const playing = snapshot?.status === "playing";
  const progress = snapshot?.progressPercent ?? 0;
  const localizedNotice = snapshot?.notice ? message(snapshot.notice) : "";
  const statusAnnouncement = useMemo(() => {
    if (!snapshot) return "";
    if (localizedNotice) return localizedNotice;
    if (
      ["paused", "preparing", "provider-issue", "page-changed"].includes(
        snapshot.status,
      )
    ) {
      return statusLabel(snapshot.status);
    }
    return "";
  }, [localizedNotice, snapshot]);

  useEffect(() => {
    if (minimized) {
      compactPlayButton.current?.focus();
    } else if (wasMinimized.current) {
      mainPlayButton.current?.focus();
    }
    wasMinimized.current = minimized;
  }, [minimized]);

  const command = (name: string, value?: number) => {
    onCommand(name, value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
      moreButton.current?.focus();
      return;
    }
    if (
      target.closest(
        "input, select, textarea, [contenteditable]:not([contenteditable='false'])",
      )
    ) {
      return;
    }
    if (!snapshot) return;
    if (event.key === " ") {
      if (target.closest("button, a[href]")) return;
      event.preventDefault();
      command("toggle");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      command("previous");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      command("next");
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const index = PLAYBACK_SPEEDS.indexOf(snapshot.playbackSpeed);
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const next =
        PLAYBACK_SPEEDS[
          Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, index + direction))
        ];
      if (next) command("set-playback-speed", next);
    }
  };

  const renderWithDebug = (reader: React.ReactNode) => (
    <>
      {reader}
      <DebugPanel log={debugLog} dock={snapshot?.dock ?? "bottom"} />
    </>
  );

  if (state.kind === "finding") {
    return renderWithDebug(
      <section
        className="reader-shell finding"
        aria-label={message("readerLabel")}
        aria-live="polite"
        dir={interfaceDirection()}
      >
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span>{message("readerFindingArticle")}</span>
      </section>,
    );
  }

  if (state.kind === "error") {
    return renderWithDebug(
      <section
        className="reader-shell error-card"
        aria-label={message("readerLabel")}
        dir={interfaceDirection()}
      >
        <div>
          <strong>{state.title}</strong>
          <p>{state.message}</p>
        </div>
        <IconButton
          label={message("readerClose")}
          onClick={() => command("close")}
        >
          <CloseIcon />
        </IconButton>
      </section>,
    );
  }

  if (state.kind === "onboarding") {
    return renderWithDebug(
      <section
        className="reader-shell onboarding"
        aria-label={message("readerOnboardingLabel")}
        dir={interfaceDirection()}
      >
        <div className="onboarding-copy">
          <span className="eyebrow">{message("readerPublicBeta")}</span>
          <h2>{message("readerOnboardingTitle")}</h2>
          <p>{message("readerOnboardingDescription")}</p>
        </div>
        <div className="onboarding-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => onChooseMode("browser")}
          >
            {message("readerContinueChrome")}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onChooseMode("cloud")}
          >
            {message(
              state.providerConnected
                ? "readerUseElevenLabs"
                : "readerConnectElevenLabs",
            )}
          </button>
        </div>
      </section>,
    );
  }

  if (!snapshot) return renderWithDebug(null);
  const dock = snapshot.dock;
  const theme = snapshot.theme;

  if (minimized) {
    return renderWithDebug(
      <section
        className={`reader-shell compact dock-${dock}`}
        data-theme={theme}
        aria-label={message("readerMinimizedLabel")}
        dir={interfaceDirection()}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <span className="brand-mark" aria-label={message("extensionName")}>
          S
        </span>
        <button
          ref={compactPlayButton}
          aria-label={message(playing ? "readerPause" : "readerPlay")}
          className="compact-play"
          type="button"
          onClick={() => command("toggle")}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span
          className="progress-number"
          aria-label={message("readerPercentRead", progress)}
        >
          {progress}%
        </span>
        <IconButton
          label={message("readerMaximize")}
          onClick={() => setMinimized(false)}
        >
          <MaximizeIcon />
        </IconButton>
      </section>,
    );
  }

  return renderWithDebug(
    <section
      className={`reader-shell dock-${dock}`}
      data-theme={theme}
      aria-label={message("readerLabel")}
      dir={interfaceDirection()}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {expanded ? (
        <div className="detail-row">
          <div className="article-detail">
            <span className="eyebrow">{message("readerNowReading")}</span>
            <strong dir="auto">
              {snapshot.title ?? message("readerSelectedText")}
            </strong>
          </div>
          <span>{formatRemaining(snapshot.estimatedRemainingSeconds)}</span>
          <span className={`status-pill status-${snapshot.status}`}>
            {statusLabel(snapshot.status)}
          </span>
          <button
            className="detail-action"
            type="button"
            onClick={() =>
              command("set-highlights", snapshot.highlightsEnabled ? 0 : 1)
            }
          >
            {message(
              snapshot.highlightsEnabled
                ? "readerHideHighlights"
                : "readerShowHighlights",
            )}
          </button>
        </div>
      ) : null}
      <div className="main-row">
        <span
          className="brand-mark desktop-brand"
          aria-label={message("extensionName")}
        >
          S
        </span>
        <div
          className="transport-controls"
          aria-label={message("readerControls")}
        >
          <IconButton
            label={message("readerPreviousSentence")}
            onClick={() => command("previous")}
          >
            <PreviousIcon />
          </IconButton>
          <IconButton
            label={message(playing ? "readerPause" : "readerPlay")}
            className="play-button"
            buttonRef={mainPlayButton}
            onClick={() => command("toggle")}
          >
            <span
              className={`swap-icon ${playing ? "is-hidden" : "is-visible"}`}
            >
              <PlayIcon />
            </span>
            <span
              className={`swap-icon overlay ${playing ? "is-visible" : "is-hidden"}`}
            >
              <PauseIcon />
            </span>
          </IconButton>
          <IconButton
            label={message("readerNextSentence")}
            onClick={() => command("next")}
          >
            <NextIcon />
          </IconButton>
        </div>
        <div className="progress-control">
          <progress
            aria-label={message("readerProgress")}
            aria-valuetext={message("readerPercent", progress)}
            max="100"
            value={progress}
          />
          <span className="progress-number">{progress}%</span>
        </div>
        <label className="speed-control">
          <span className="sr-only">{message("readerPlaybackSpeed")}</span>
          <select
            aria-label={message("readerPlaybackSpeed")}
            value={snapshot.playbackSpeed}
            onChange={(event) =>
              command(
                "set-playback-speed",
                Number(event.currentTarget.value) as PlaybackSpeed,
              )
            }
          >
            {PLAYBACK_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
        <button className="voice-button" type="button" onClick={onOpenSettings}>
          <SettingsIcon />
          <span>
            {message(
              snapshot.mode === "cloud"
                ? "readerCloudVoice"
                : "readerChromeVoice",
            )}
          </span>
        </button>
        <div className="utility-controls">
          <button
            ref={moreButton}
            aria-expanded={expanded}
            aria-label={message("readerMoreDetails")}
            className="icon-button"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            <MoreIcon />
          </button>
          <IconButton
            label={message("readerMinimize")}
            onClick={() => setMinimized(true)}
          >
            <MinimizeIcon />
          </IconButton>
          <IconButton
            label={message("readerCloseAndStop")}
            onClick={() => command("close")}
          >
            <CloseIcon />
          </IconButton>
        </div>
      </div>
      {snapshot.status === "usage-limit" ? (
        <div
          className="recovery-row"
          aria-label={message("readerProviderUsageActions")}
        >
          <span>{localizedNotice}</span>
          <button type="button" onClick={() => command("continue-usage")}>
            {message("readerContinueSession")}
          </button>
          <button type="button" onClick={() => command("switch-to-browser")}>
            {message("readerSwitchChrome")}
          </button>
          <button type="button" onClick={() => command("close")}>
            {message("readerStop")}
          </button>
        </div>
      ) : null}
      {snapshot.status === "provider-issue" ? (
        <div
          className="recovery-row"
          aria-label={message("readerSpeechRecoveryActions")}
        >
          <span>{localizedNotice}</span>
          {snapshot.retryRequiresConfirmation ? (
            <button type="button" onClick={() => command("retry")}>
              {message("readerConfirmRetry")}
            </button>
          ) : null}
          <button type="button" onClick={onOpenSettings}>
            {message(
              snapshot.mode === "cloud"
                ? "readerReconnectVoice"
                : "readerChooseVoice",
            )}
          </button>
          {snapshot.mode === "cloud" ? (
            <button type="button" onClick={() => command("switch-to-browser")}>
              {message("readerSwitchChrome")}
            </button>
          ) : null}
          <button type="button" onClick={() => command("close")}>
            {message("readerStop")}
          </button>
        </div>
      ) : null}
      {snapshot.status === "page-changed" ? (
        <div
          className="recovery-row"
          aria-label={message("readerSourceRecoveryActions")}
        >
          <span>{localizedNotice}</span>
          <button type="button" onClick={() => command("restart")}>
            {message("readerRestartArticle")}
          </button>
          <button
            type="button"
            onClick={() => command("continue-without-highlights")}
          >
            {message("readerContinueWithoutHighlights")}
          </button>
          <button type="button" onClick={() => command("close")}>
            {message("readerStop")}
          </button>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>
    </section>,
  );
}

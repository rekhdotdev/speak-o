import { useEffect, useMemo, useRef, useState } from "react";
import { DEBUG_MODE } from "../diagnostics/runtime-debug";
import type { ReadingSessionSnapshot } from "../session/types";
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
      <summary>DEBUG_MODE is on</summary>
      <textarea
        ref={textArea}
        aria-label="Speak-O debug log"
        readOnly
        spellCheck={false}
        value={log}
      />
      <div className="debug-actions">
        <button type="button" onClick={() => void copy()}>
          Copy debug log
        </button>
        <span role="status">
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "failed"
              ? "Copy failed; press Ctrl/Cmd+C"
              : "No Article text, URLs, credentials, or audio are logged"}
        </span>
      </div>
    </details>
  );
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Finished";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} min left`;
}

function IconButton({
  label,
  className = "",
  children,
  onClick,
  disabled,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
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
  debugLog = "Speak-O DEBUG_MODE=true\nentries=0/160\n<no events>",
  onChooseMode,
  onCommand,
  onOpenSettings,
}: ReaderAppProps) {
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const compactPlayButton = useRef<HTMLButtonElement>(null);
  const snapshot = state.kind === "session" ? state.snapshot : null;
  const playing = snapshot?.status === "playing";
  const progress = snapshot?.progressPercent ?? 0;
  const statusAnnouncement = useMemo(() => {
    if (!snapshot) return "";
    if (snapshot.notice) return snapshot.notice;
    if (
      ["paused", "preparing", "provider-issue", "page-changed"].includes(
        snapshot.status,
      )
    ) {
      return snapshot.status.replace("-", " ");
    }
    return "";
  }, [snapshot]);

  useEffect(() => {
    if (minimized) compactPlayButton.current?.focus();
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
      target.matches(
        "button, a, input, select, textarea, [contenteditable='true']",
      )
    ) {
      return;
    }
    if (!snapshot) return;
    if (event.key === " ") {
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
        aria-label="Speak-O Article Reader"
        aria-live="polite"
      >
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span>Finding the Article…</span>
      </section>,
    );
  }

  if (state.kind === "error") {
    return renderWithDebug(
      <section
        className="reader-shell error-card"
        aria-label="Speak-O Article Reader"
      >
        <div>
          <strong>{state.title}</strong>
          <p>{state.message}</p>
        </div>
        <IconButton label="Close Speak-O" onClick={() => command("close")}>
          <CloseIcon />
        </IconButton>
      </section>,
    );
  }

  if (state.kind === "onboarding") {
    return renderWithDebug(
      <section className="reader-shell onboarding" aria-label="Set up Speak-O">
        <div className="onboarding-copy">
          <span className="eyebrow">Speak-O public beta</span>
          <h2>How would you like to hear this Article?</h2>
          <p>
            Use a Chrome Voice without setup, or connect your own ElevenLabs
            account for Cloud Voice.
          </p>
        </div>
        <div className="onboarding-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => onChooseMode("browser")}
          >
            Continue with Chrome Voice
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onChooseMode("cloud")}
          >
            {state.providerConnected ? "Use ElevenLabs" : "Connect ElevenLabs"}
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
        aria-label="Speak-O minimized Article Reader"
        onKeyDown={handleKeyDown}
      >
        <span className="brand-mark" aria-label="Speak-O">
          S
        </span>
        <button
          ref={compactPlayButton}
          aria-label={playing ? "Pause" : "Play"}
          className="compact-play"
          type="button"
          onClick={() => command("toggle")}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span
          className="progress-number"
          aria-label={`${progress} percent read`}
        >
          {progress}%
        </span>
        <IconButton
          label="Maximize controls"
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
      aria-label="Speak-O Article Reader"
      onKeyDown={handleKeyDown}
    >
      {expanded ? (
        <div className="detail-row">
          <div className="article-detail">
            <span className="eyebrow">Now reading</span>
            <strong dir="auto">{snapshot.title ?? "Selected text"}</strong>
          </div>
          <span>{formatRemaining(snapshot.estimatedRemainingSeconds)}</span>
          <span className={`status-pill status-${snapshot.status}`}>
            {snapshot.status.replace("-", " ")}
          </span>
          <button
            className="detail-action"
            type="button"
            onClick={() =>
              command("set-highlights", snapshot.highlightsEnabled ? 0 : 1)
            }
          >
            {snapshot.highlightsEnabled ? "Hide highlights" : "Show highlights"}
          </button>
        </div>
      ) : null}
      <div className="main-row">
        <span className="brand-mark desktop-brand" aria-label="Speak-O">
          S
        </span>
        <div className="transport-controls" aria-label="Reading controls">
          <IconButton
            label="Previous sentence"
            onClick={() => command("previous")}
          >
            <PreviousIcon />
          </IconButton>
          <IconButton
            label={playing ? "Pause" : "Play"}
            className="play-button"
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
          <IconButton label="Next sentence" onClick={() => command("next")}>
            <NextIcon />
          </IconButton>
        </div>
        <div className="progress-control">
          <progress
            aria-label="Reading progress"
            aria-valuetext={`${progress} percent`}
            max="100"
            value={progress}
          />
          <span className="progress-number">{progress}%</span>
        </div>
        <label className="speed-control">
          <span className="sr-only">Playback Speed</span>
          <select
            aria-label="Playback Speed"
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
            {snapshot.mode === "cloud" ? "Cloud Voice" : "Chrome Voice"}
          </span>
        </button>
        <div className="utility-controls">
          <button
            ref={moreButton}
            aria-expanded={expanded}
            aria-label="More details"
            className="icon-button"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            <MoreIcon />
          </button>
          <IconButton
            label="Minimize controls"
            onClick={() => setMinimized(true)}
          >
            <MinimizeIcon />
          </IconButton>
          <IconButton label="Close and stop" onClick={() => command("close")}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
      {snapshot.status === "usage-limit" ? (
        <div className="recovery-row" aria-label="Provider Usage actions">
          <span>{snapshot.notice}</span>
          <button type="button" onClick={() => command("continue-usage")}>
            Continue this Session
          </button>
          <button type="button" onClick={() => command("switch-to-browser")}>
            Switch to Chrome Voice
          </button>
          <button type="button" onClick={() => command("close")}>
            Stop
          </button>
        </div>
      ) : null}
      {snapshot.status === "provider-issue" ? (
        <div className="recovery-row" aria-label="Speech recovery actions">
          <span>{snapshot.notice}</span>
          {snapshot.retryRequiresConfirmation ? (
            <button type="button" onClick={() => command("retry")}>
              Confirm Retry
            </button>
          ) : null}
          <button type="button" onClick={onOpenSettings}>
            {snapshot.mode === "cloud"
              ? "Reconnect or change Voice"
              : "Choose Voice"}
          </button>
          {snapshot.mode === "cloud" ? (
            <button type="button" onClick={() => command("switch-to-browser")}>
              Switch to Chrome Voice
            </button>
          ) : null}
          <button type="button" onClick={() => command("close")}>
            Stop
          </button>
        </div>
      ) : null}
      {snapshot.status === "page-changed" ? (
        <div className="recovery-row" aria-label="Source Page recovery actions">
          <span>{snapshot.notice}</span>
          <button type="button" onClick={() => command("restart")}>
            Restart Article
          </button>
          <button
            type="button"
            onClick={() => command("continue-without-highlights")}
          >
            Continue without highlights
          </button>
          <button type="button" onClick={() => command("close")}>
            Stop
          </button>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>
    </section>,
  );
}

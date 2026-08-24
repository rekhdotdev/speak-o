import {
  isExtensionMessage,
  isPlaybackSpeed,
} from "../../src/contracts/runtime-guards";

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let context: {
  sessionId: string;
  generationEpoch: number;
  sentenceIndex: number;
} | null = null;

function sendAudioEvent(event: Record<string, unknown>): void {
  if (!context) return;
  void chrome.runtime.sendMessage({
    version: 1,
    target: "background",
    type: "audio.event",
    sessionId: context.sessionId,
    generationEpoch: context.generationEpoch,
    event: { ...event, sentenceIndex: context.sentenceIndex },
  });
}

function stopAudio(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  audio = null;
  objectUrl = null;
  context = null;
}

function decodeBase64(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > 16 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return null;
  }
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    !isExtensionMessage(message) ||
    message.target !== "offscreen"
  ) {
    return;
  }
  if (message.type === "audio.stop") {
    stopAudio();
    return;
  }
  if (message.type === "audio.pause") {
    audio?.pause();
    return;
  }
  if (message.type === "audio.resume") {
    void audio
      ?.play()
      .catch(() =>
        sendAudioEvent({ type: "error", errorCode: "AUDIO_RESUME_FAILED" }),
      );
    return;
  }
  if (
    message.type === "audio.set-rate" &&
    isPlaybackSpeed(message.playbackSpeed)
  ) {
    if (audio) audio.playbackRate = message.playbackSpeed;
    return;
  }
  if (
    message.type !== "audio.play" ||
    typeof message.sessionId !== "string" ||
    !Number.isSafeInteger(message.generationEpoch) ||
    !Number.isSafeInteger(message.sentenceIndex) ||
    typeof message.audioBase64 !== "string" ||
    typeof message.startAtMs !== "number" ||
    !Number.isFinite(message.startAtMs) ||
    message.startAtMs < 0 ||
    !isPlaybackSpeed(message.playbackSpeed)
  ) {
    return;
  }
  const bytes = decodeBase64(message.audioBase64);
  if (!bytes) return;
  const startAtMs = message.startAtMs;
  stopAudio();
  context = {
    sessionId: message.sessionId,
    generationEpoch: message.generationEpoch as number,
    sentenceIndex: message.sentenceIndex as number,
  };
  objectUrl = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" }),
  );
  audio = new Audio(objectUrl);
  audio.preload = "auto";
  audio.playbackRate = message.playbackSpeed;
  audio.preservesPitch = true;
  audio.addEventListener("timeupdate", () => {
    if (audio)
      sendAudioEvent({
        type: "progress",
        mediaTimeMs: Math.round(audio.currentTime * 1_000),
      });
  });
  audio.addEventListener("ended", () => sendAudioEvent({ type: "ended" }), {
    once: true,
  });
  audio.addEventListener(
    "error",
    () => sendAudioEvent({ type: "error", errorCode: "AUDIO_DECODE_FAILED" }),
    { once: true },
  );
  const beginPlayback = () => {
    if (!audio) return;
    if (startAtMs > 0) audio.currentTime = startAtMs / 1_000;
    void audio
      .play()
      .catch(() =>
        sendAudioEvent({ type: "error", errorCode: "AUDIO_PLAY_FAILED" }),
      );
  };
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) beginPlayback();
  else audio.addEventListener("loadedmetadata", beginPlayback, { once: true });
});

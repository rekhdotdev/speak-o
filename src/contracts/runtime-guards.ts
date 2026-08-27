import type { ArticleSnapshot } from "../extraction/types";
import type { SessionBufferEntry } from "../session/session-buffer";
import type {
  CommandContext,
  ReadingSessionDescriptor,
  SpeechAlignment,
} from "../session/types";
import {
  isPreferencePatch,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "../storage/preferences";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlaybackSpeed(value: unknown): value is PlaybackSpeed {
  return PLAYBACK_SPEEDS.includes(value as PlaybackSpeed);
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

export function isCommandContext(value: unknown): value is CommandContext {
  return (
    isRecord(value) &&
    validText(value.sessionId, 128) &&
    value.sessionId.length > 0 &&
    Number.isSafeInteger(value.generationEpoch) &&
    (value.generationEpoch as number) >= 0
  );
}

function isSessionCommandMessage(value: Record<string, unknown>): boolean {
  if (!isCommandContext(value) || typeof value.command !== "string") {
    return false;
  }
  switch (value.command) {
    case "seek":
      return (
        Number.isSafeInteger(value.value) &&
        (value.value as number) >= 0 &&
        (value.value as number) <= 20_000
      );
    case "set-playback-speed":
      return isPlaybackSpeed(value.value);
    case "set-highlights":
      return value.value === 0 || value.value === 1;
    case "toggle":
    case "play":
    case "pause":
    case "next":
    case "previous":
    case "retry":
    case "continue-usage":
    case "switch-to-browser":
    case "continue-without-highlights":
    case "close":
    case "restart":
      return value.value === undefined;
    default:
      return false;
  }
}

function validMappingIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 2_000 &&
    value.every((id) => validText(id, 128))
  );
}

export function isArticleSnapshot(value: unknown): value is ArticleSnapshot {
  if (
    !isRecord(value) ||
    !validText(value.id, 128) ||
    !["selection", "x-articles", "generic"].includes(String(value.extractor)) ||
    !(value.title === null || validText(value.title, 1_000)) ||
    !(value.author === null || validText(value.author, 1_000)) ||
    !validText(value.narrationLanguage, 35) ||
    !Number.isSafeInteger(value.characterCount) ||
    (value.characterCount as number) < 0 ||
    (value.characterCount as number) > 500_000 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length > 20_000 ||
    !Array.isArray(value.sentences) ||
    value.sentences.length > 20_000
  ) {
    return false;
  }

  const blocks = value.blocks;
  const sentences = value.sentences;

  let totalCharacters = 0;
  const blocksAreValid = blocks.every((block) => {
    if (
      !isRecord(block) ||
      !validText(block.id, 128) ||
      ![
        "title",
        "author",
        "heading",
        "paragraph",
        "list-item",
        "blockquote",
        "caption",
        "cue",
      ].includes(String(block.kind)) ||
      !validText(block.text, 500_000) ||
      !validMappingIds(block.mappingIds)
    ) {
      return false;
    }
    totalCharacters += block.text.length;
    return totalCharacters <= 500_000;
  });
  if (!blocksAreValid) return false;

  return sentences.every(
    (sentence) =>
      isRecord(sentence) &&
      validText(sentence.id, 128) &&
      validText(sentence.text, 100_000) &&
      Number.isSafeInteger(sentence.blockIndex) &&
      (sentence.blockIndex as number) >= 0 &&
      (sentence.blockIndex as number) < blocks.length &&
      Number.isSafeInteger(sentence.startOffset) &&
      Number.isSafeInteger(sentence.endOffset) &&
      (sentence.startOffset as number) >= 0 &&
      (sentence.endOffset as number) >= (sentence.startOffset as number) &&
      validMappingIds(sentence.mappingIds),
  );
}

export function isReadingSessionDescriptor(
  value: unknown,
): value is ReadingSessionDescriptor {
  return (
    isRecord(value) &&
    value.version === 1 &&
    validText(value.sessionId, 128) &&
    value.sessionId.length > 0 &&
    Number.isSafeInteger(value.generationEpoch) &&
    (value.generationEpoch as number) >= 0 &&
    Number.isSafeInteger(value.sourceTabId) &&
    (value.sourceTabId as number) >= 0 &&
    Number.isSafeInteger(value.sourceFrameId) &&
    (value.sourceFrameId as number) >= 0 &&
    ["browser", "cloud"].includes(String(value.mode)) &&
    Number.isSafeInteger(value.currentSentenceIndex) &&
    (value.currentSentenceIndex as number) >= 0 &&
    typeof value.mediaTimeMs === "number" &&
    Number.isFinite(value.mediaTimeMs) &&
    value.mediaTimeMs >= 0 &&
    Number.isSafeInteger(value.submittedCharacters) &&
    (value.submittedCharacters as number) >= 0 &&
    (value.submittedCharacters as number) <= 500_000 &&
    Array.isArray(value.submittedSentenceIndices) &&
    value.submittedSentenceIndices.length <= 20_000 &&
    value.submittedSentenceIndices.every(
      (sentenceIndex, index) =>
        Number.isSafeInteger(sentenceIndex) &&
        (sentenceIndex as number) >= 0 &&
        (sentenceIndex as number) < 20_000 &&
        (index === 0 ||
          (sentenceIndex as number) >
            (value.submittedSentenceIndices as number[])[index - 1]!),
    ) &&
    [
      "ready",
      "preparing",
      "playing",
      "paused",
      "buffering",
      "usage-limit",
      "provider-issue",
      "page-changed",
      "completed",
    ].includes(String(value.status))
  );
}

function isSpeechAlignment(value: unknown): value is SpeechAlignment {
  if (
    !isRecord(value) ||
    !Array.isArray(value.chars) ||
    !Array.isArray(value.charStartTimesMs) ||
    !Array.isArray(value.charDurationsMs) ||
    value.chars.length > 100_000 ||
    value.chars.length !== value.charStartTimesMs.length ||
    value.chars.length !== value.charDurationsMs.length
  ) {
    return false;
  }
  return (
    value.chars.every((character) => validText(character, 16)) &&
    value.charStartTimesMs.every(
      (time) => typeof time === "number" && Number.isFinite(time) && time >= 0,
    ) &&
    value.charDurationsMs.every(
      (duration) =>
        typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration >= 0,
    )
  );
}

export function isSessionBufferEntries(
  value: unknown,
): value is SessionBufferEntry[] {
  const entriesAreValid =
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every((entry) => {
      if (
        !isRecord(entry) ||
        !Number.isSafeInteger(entry.sentenceIndex) ||
        (entry.sentenceIndex as number) < 0 ||
        !validText(entry.audioBase64, 16 * 1024 * 1024) ||
        entry.audioBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.audioBase64) ||
        !Number.isSafeInteger(entry.byteLength) ||
        (entry.byteLength as number) < 0 ||
        (entry.byteLength as number) > 8 * 1024 * 1024 ||
        !(entry.alignment === null || isSpeechAlignment(entry.alignment))
      ) {
        return false;
      }
      const padding = entry.audioBase64.endsWith("==")
        ? 2
        : entry.audioBase64.endsWith("=")
          ? 1
          : 0;
      const calculatedBytes = (entry.audioBase64.length * 3) / 4 - padding;
      return calculatedBytes === entry.byteLength;
    });
  return (
    entriesAreValid &&
    value.reduce((total, entry) => total + entry.byteLength, 0) <=
      8 * 1024 * 1024
  );
}

export function isExtensionMessage(
  value: unknown,
): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.type !== "string" ||
    typeof value.target !== "string"
  ) {
    return false;
  }
  const allowedTypes: Record<string, readonly string[]> = {
    background: [
      "extraction.result",
      "extraction.refused",
      "activation.start",
      "session.command",
      "session.reconcile",
      "session.reconcile.failed",
      "source.changed",
      "source.navigated",
      "audio.event",
      "options.get-state",
      "preferences.patch",
      "provider.connect",
      "provider.disconnect",
      "settings.open",
      "settings.changed",
    ],
    content: [
      "extract.request",
      "onboarding.show",
      "pending.resume",
      "content.render",
      "content.highlight",
      "content.clear-highlights",
      "content.clear",
      "content.debug",
      "content.debug.snapshot",
      "session.reconcile.request",
    ],
    offscreen: [
      "audio.play",
      "audio.pause",
      "audio.resume",
      "audio.stop",
      "audio.set-rate",
    ],
  };
  if (allowedTypes[value.target]?.includes(value.type) !== true) return false;
  if (value.target === "background" && value.type === "session.command") {
    return isSessionCommandMessage(value);
  }
  if (
    value.target === "background" &&
    (value.type === "settings.open" || value.type === "settings.changed")
  ) {
    return isCommandContext(value);
  }
  if (value.target === "background" && value.type === "preferences.patch") {
    const hasSessionContext =
      value.sessionId !== undefined || value.generationEpoch !== undefined;
    return (
      isPreferencePatch(value.patch) &&
      (!hasSessionContext || isCommandContext(value))
    );
  }
  return true;
}

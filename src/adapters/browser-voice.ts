import type {
  BrowserSpeechEvent,
  ReadingSessionEffect,
} from "../session/types";

export type BrowserTtsEventType =
  | "start"
  | "word"
  | "sentence"
  | "end"
  | "interrupted"
  | "cancelled"
  | "error"
  | "pause"
  | "resume";

export interface BrowserTtsEvent {
  type: BrowserTtsEventType;
  charIndex?: number;
  length?: number;
  errorMessage?: string;
}

export interface BrowserTtsOptions {
  lang: string;
  voiceName?: string;
  rate: number;
  enqueue: false;
  desiredEventTypes: string[];
  onEvent(event: BrowserTtsEvent): void;
}

export interface BrowserTtsPort {
  speak(text: string, options: BrowserTtsOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

type SpeakEffect = Extract<ReadingSessionEffect, { type: "browser.speak" }>;

function wordLengthAt(
  text: string,
  charIndex: number,
  language: string,
): number {
  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  for (const segment of segmenter.segment(text)) {
    const endOffset = segment.index + segment.segment.length;
    if (
      segment.isWordLike &&
      charIndex >= segment.index &&
      charIndex < endOffset
    ) {
      return endOffset - charIndex;
    }
  }
  return 0;
}

export class BrowserVoiceAdapter {
  private currentUtterance: { intentionallyStopped: boolean } | null = null;

  constructor(private readonly tts: BrowserTtsPort) {}

  async speak(
    effect: SpeakEffect,
    onEvent: (event: BrowserSpeechEvent) => void,
  ): Promise<void> {
    const utterance = { intentionallyStopped: false };
    this.currentUtterance = utterance;
    const options: BrowserTtsOptions = {
      lang: effect.language,
      rate: effect.playbackSpeed,
      enqueue: false,
      desiredEventTypes: [
        "start",
        "word",
        "sentence",
        "end",
        "error",
        "pause",
        "resume",
        "interrupted",
        "cancelled",
      ],
      onEvent: (event) => {
        if (event.type === "word") {
          const charIndex = Math.max(0, event.charIndex ?? 0);
          const reportedLength = Math.max(0, event.length ?? 0);
          onEvent({
            type: "word",
            sentenceIndex: effect.sentenceIndex,
            charIndex,
            length:
              reportedLength > 0
                ? reportedLength
                : wordLengthAt(effect.text, charIndex, effect.language),
          });
        } else if (event.type === "end") {
          onEvent({ type: "end", sentenceIndex: effect.sentenceIndex });
        } else if (event.type === "start") {
          onEvent({ type: "start", sentenceIndex: effect.sentenceIndex });
        } else if (
          event.type === "pause" ||
          event.type === "resume" ||
          event.type === "interrupted" ||
          event.type === "cancelled"
        ) {
          if (
            (event.type === "interrupted" || event.type === "cancelled") &&
            utterance.intentionallyStopped
          ) {
            return;
          }
          onEvent({ type: event.type, sentenceIndex: effect.sentenceIndex });
        } else if (event.type === "error") {
          onEvent({
            type: "error",
            sentenceIndex: effect.sentenceIndex,
            errorCode: "BROWSER_TTS_ERROR",
          });
        }
      },
    };
    if (effect.voiceId) options.voiceName = effect.voiceId;

    try {
      await this.tts.speak(effect.text, options);
    } catch {
      onEvent({
        type: "error",
        sentenceIndex: effect.sentenceIndex,
        errorCode: "BROWSER_TTS_FAILED",
      });
    }
  }

  pause(): void {
    this.tts.pause();
  }

  resume(): void {
    this.tts.resume();
  }

  stop(): void {
    if (this.currentUtterance) {
      this.currentUtterance.intentionallyStopped = true;
    }
    this.tts.stop();
  }
}

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

export class BrowserVoiceAdapter {
  constructor(private readonly tts: BrowserTtsPort) {}

  async speak(
    effect: SpeakEffect,
    onEvent: (event: BrowserSpeechEvent) => void,
  ): Promise<void> {
    const options: BrowserTtsOptions = {
      lang: effect.language,
      rate: effect.playbackSpeed,
      enqueue: false,
      desiredEventTypes: ["start", "word", "sentence", "end", "error"],
      onEvent: (event) => {
        if (event.type === "word") {
          onEvent({
            type: "word",
            sentenceIndex: effect.sentenceIndex,
            charIndex: Math.max(0, event.charIndex ?? 0),
            length: Math.max(0, event.length ?? 0),
          });
        } else if (event.type === "end") {
          onEvent({ type: "end", sentenceIndex: effect.sentenceIndex });
        } else if (event.type === "start") {
          onEvent({ type: "start", sentenceIndex: effect.sentenceIndex });
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
    this.tts.stop();
  }
}

import type { ArticleSnapshot } from "../extraction/types";
import type {
  Dock,
  PlaybackSpeed,
  Preferences,
  VoiceMode,
} from "../storage/preferences";

export type ReadingSessionStatus =
  | "ready"
  | "preparing"
  | "playing"
  | "paused"
  | "buffering"
  | "usage-limit"
  | "provider-issue"
  | "page-changed"
  | "completed";

export interface ReadingSessionSnapshot {
  version: 1;
  id: string;
  generationEpoch: number;
  sourceTabId: number;
  sourceFrameId: number;
  title: string | null;
  status: ReadingSessionStatus;
  mode: VoiceMode;
  currentSentenceIndex: number;
  currentMediaTimeMs: number;
  sentenceCount: number;
  progressPercent: number;
  estimatedRemainingSeconds: number;
  playbackSpeed: PlaybackSpeed;
  theme: Preferences["theme"];
  narrationLanguage: string;
  voiceId: string | null;
  modelId: string;
  highlightsEnabled: boolean;
  followEnabled: boolean;
  dock: Dock;
  minimized: boolean;
  expanded: boolean;
  submittedCharacters: number;
  usageGuardCharacters: number | null;
  notice: string | null;
  errorCode: string | null;
  retryRequiresConfirmation: boolean;
}

export interface ReadingSessionDescriptor {
  version: 1;
  sessionId: string;
  generationEpoch: number;
  sourceTabId: number;
  sourceFrameId: number;
  mode: VoiceMode;
  currentSentenceIndex: number;
  mediaTimeMs: number;
  status: ReadingSessionStatus;
}

export interface SpeechAlignment {
  chars: string[];
  charStartTimesMs: number[];
  charDurationsMs: number[];
}

export type ProviderEvent =
  | {
      type: "audio";
      sentenceIndex: number;
      audioBase64: string;
      alignment: SpeechAlignment | null;
      acknowledged: boolean;
      isFinal: boolean;
    }
  | {
      type: "failure";
      errorCode: string;
      acknowledged: boolean;
      receivedAudio: boolean;
    };

export type AudioEvent =
  | { type: "progress"; sentenceIndex: number; mediaTimeMs: number }
  | { type: "ended"; sentenceIndex: number }
  | { type: "error"; sentenceIndex: number; errorCode: string };

export interface CommandContext {
  sessionId: string;
  generationEpoch: number;
}

export type BrowserSpeechEvent =
  | { type: "start"; sentenceIndex: number }
  | { type: "word"; sentenceIndex: number; charIndex: number; length: number }
  | { type: "end"; sentenceIndex: number }
  | { type: "error"; sentenceIndex: number; errorCode: string };

export type ReadingSessionCommand =
  | {
      type: "activate";
      article: ArticleSnapshot;
      sourceTabId: number;
      sourceFrameId: number;
      mode: VoiceMode;
      preferences: Preferences;
    }
  | {
      type: "restore";
      article: ArticleSnapshot;
      descriptor: ReadingSessionDescriptor;
      preferences: Preferences;
      bufferedAudio?: Array<{
        sentenceIndex: number;
        audioBase64: string;
        alignment: SpeechAlignment | null;
      }>;
    }
  | ({ type: "play" } & CommandContext)
  | ({ type: "pause" } & CommandContext)
  | ({ type: "next" } & CommandContext)
  | ({ type: "previous"; elapsedInSentenceMs: number } & CommandContext)
  | ({ type: "seek"; sentenceIndex: number } & CommandContext)
  | ({
      type: "set-playback-speed";
      playbackSpeed: PlaybackSpeed;
    } & CommandContext)
  | ({ type: "set-highlights"; enabled: boolean } & CommandContext)
  | ({ type: "source.changed" } & CommandContext)
  | ({ type: "continue-without-highlights" } & CommandContext)
  | ({ type: "continue-after-usage-limit" } & CommandContext)
  | ({ type: "switch-to-browser" } & CommandContext)
  | ({ type: "retry-provider" } & CommandContext)
  | ({ type: "stop" } & CommandContext)
  | ({ type: "browser.event"; event: BrowserSpeechEvent } & CommandContext)
  | ({ type: "provider.event"; event: ProviderEvent } & CommandContext)
  | ({ type: "audio.event"; event: AudioEvent } & CommandContext);

interface EffectContext {
  sessionId: string;
  generationEpoch: number;
}

export type ReadingSessionEffect =
  | ({
      type: "browser.speak";
      sentenceIndex: number;
      text: string;
      language: string;
      voiceId: string | null;
      playbackSpeed: PlaybackSpeed;
    } & EffectContext)
  | ({ type: "browser.stop" } & EffectContext)
  | ({ type: "browser.pause" } & EffectContext)
  | ({ type: "browser.resume" } & EffectContext)
  | ({ type: "provider.abort" } & EffectContext)
  | ({
      type: "provider.generate";
      requestId: string;
      sentences: Array<{ index: number; text: string }>;
      language: string;
      voiceId: string;
      modelId: string;
      region: Preferences["region"];
    } & EffectContext)
  | ({ type: "audio.stop" } & EffectContext)
  | ({ type: "audio.pause" } & EffectContext)
  | ({ type: "audio.resume" } & EffectContext)
  | ({ type: "audio.set-rate"; playbackSpeed: PlaybackSpeed } & EffectContext)
  | ({ type: "content.clear" } & EffectContext)
  | ({ type: "storage.clear-session" } & EffectContext)
  | ({ type: "offscreen.close" } & EffectContext)
  | ({ type: "offscreen.ensure" } & EffectContext)
  | ({
      type: "buffer.store";
      entry: {
        sentenceIndex: number;
        audioBase64: string;
        byteLength: number;
        alignment: SpeechAlignment | null;
      };
    } & EffectContext)
  | ({
      type: "audio.play";
      sentenceIndex: number;
      audioBase64: string;
      alignment: SpeechAlignment | null;
      playbackSpeed: PlaybackSpeed;
      startAtMs: number;
      preservesPitch: true;
    } & EffectContext)
  | ({
      type: "storage.save-descriptor";
      descriptor: ReadingSessionDescriptor;
    } & EffectContext)
  | ({
      type: "content.render";
      snapshot: ReadingSessionSnapshot;
    } & EffectContext)
  | ({
      type: "content.highlight";
      sentenceIndex: number;
      word: { startOffset: number; endOffset: number } | null;
    } & EffectContext);

export interface ReadingSessionTransition {
  snapshot: ReadingSessionSnapshot | null;
  effects: ReadingSessionEffect[];
}

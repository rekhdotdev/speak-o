import type { ArticleSnapshot } from "../extraction/types";
import { segmentBlocks } from "../extraction/segmentation";
import type { Preferences } from "../storage/preferences";
import type {
  CommandContext,
  ReadingSessionCommand,
  ReadingSessionEffect,
  ReadingSessionSnapshot,
  ReadingSessionTransition,
  SpeechAlignment,
} from "./types";

interface BufferedAudio {
  audioBase64: string;
  alignment: SpeechAlignment | null;
}

interface LastGeneration {
  sentences: Array<{ index: number; text: string }>;
  language: string;
  voiceId: string;
  modelId: string;
  region: import("../storage/preferences").Preferences["region"];
}

interface SpeechConfiguration {
  narrationLanguage: string;
  voiceId: string | null;
  modelId: string;
  region: Preferences["region"];
}

interface ActiveSession {
  article: ArticleSnapshot;
  snapshot: ReadingSessionSnapshot;
  browserVoiceId: string | null;
  detectedNarrationLanguage: string;
  providerRegion: import("../storage/preferences").Preferences["region"];
  requestedSentenceIndices: Set<number>;
  bufferedAudio: Map<number, BufferedAudio>;
  lastGeneration: LastGeneration | null;
  retryCount: number;
  canResumeMedia: boolean;
  speechSettingsOpen: boolean;
  resumeAfterSettings: boolean;
  settingsConfigurationAtOpen: SpeechConfiguration | null;
}

const SETTINGS_PAUSED_NOTICE =
  "Speech settings open; Cloud Voice preparation is paused.";

function articleForPreferences(
  article: ArticleSnapshot,
  preferences: Preferences,
): ArticleSnapshot {
  const language =
    preferences.narrationLanguageOverride ?? article.narrationLanguage;
  if (language === article.narrationLanguage) return article;
  return {
    ...article,
    narrationLanguage: language,
    sentences: segmentBlocks(article.blocks, language),
  };
}

function progressPercent(current: number, total: number): number {
  return total === 0 ? 0 : Math.round((current / total) * 100);
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function remainingSeconds(
  article: ArticleSnapshot,
  current: number,
  speed: number,
): number {
  const remainingCharacters = article.sentences
    .slice(current)
    .reduce((total, sentence) => total + sentence.text.length, 0);
  return Math.ceil(remainingCharacters / (15 * speed));
}

function preferredVoice(
  voices: Record<string, string>,
  language: string,
): string | null {
  const baseLanguage = language.split("-")[0] ?? language;
  return voices[language] ?? voices[baseLanguage] ?? null;
}

function wordAtMediaTime(
  sentence: string,
  alignment: SpeechAlignment,
  mediaTimeMs: number,
  language: string,
): { startOffset: number; endOffset: number } | null {
  if (
    alignment.chars.length === 0 ||
    alignment.chars.length !== alignment.charStartTimesMs.length ||
    alignment.chars.join("") !== sentence
  ) {
    return null;
  }
  let characterIndex = 0;
  for (let index = 0; index < alignment.charStartTimesMs.length; index += 1) {
    if ((alignment.charStartTimesMs[index] ?? 0) <= mediaTimeMs) {
      characterIndex = index;
    } else {
      break;
    }
  }
  const utf16Offset = alignment.chars.slice(0, characterIndex).join("").length;
  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  for (const segment of segmenter.segment(sentence)) {
    const end = segment.index + segment.segment.length;
    if (
      segment.isWordLike &&
      utf16Offset >= segment.index &&
      utf16Offset < end
    ) {
      return { startOffset: segment.index, endOffset: end };
    }
  }
  return null;
}

export class ReadingSessionController {
  private active: ActiveSession | null = null;
  private nextGenerationEpoch = 1;

  constructor(
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  currentSnapshot(): ReadingSessionSnapshot | null {
    return this.active?.snapshot ?? null;
  }

  dispatch(command: ReadingSessionCommand): ReadingSessionTransition {
    if (command.type === "activate") return this.activate(command);
    if (command.type === "restore") return this.restore(command);
    if (!this.matchesActive(command)) return this.transition([]);

    switch (command.type) {
      case "play":
        return this.play();
      case "pause":
        return this.pause();
      case "next":
        return this.navigateTo(
          this.requireActive().snapshot.currentSentenceIndex + 1,
        );
      case "previous": {
        const snapshot = this.requireActive().snapshot;
        const current = snapshot.currentSentenceIndex;
        const destination =
          snapshot.status === "paused"
            ? current - 1
            : command.elapsedInSentenceMs > 1_500
              ? current
              : current - 1;
        return this.navigateTo(Math.max(0, destination));
      }
      case "seek":
        return this.navigateTo(command.sentenceIndex);
      case "set-playback-speed":
        return this.setPlaybackSpeed(command.playbackSpeed);
      case "set-highlights":
        return this.setHighlights(command.enabled);
      case "settings.opened":
        return this.settingsOpened();
      case "settings.closed":
        return this.settingsClosed(command.preferences);
      case "source.changed":
        return this.sourceChanged();
      case "continue-without-highlights":
        return this.continueWithoutHighlights();
      case "continue-after-usage-limit":
        return this.continueAfterUsageLimit();
      case "switch-to-browser":
        return this.switchToBrowser();
      case "retry-provider":
        return this.retryProvider();
      case "browser.event":
        return this.onBrowserEvent(command.event);
      case "provider.event":
        return this.onProviderEvent(command.event);
      case "audio.event":
        return this.onAudioEvent(command.event);
      case "stop":
        return this.stop();
    }
  }

  private restore(
    command: Extract<ReadingSessionCommand, { type: "restore" }>,
  ): ReadingSessionTransition {
    const { descriptor, preferences } = command;
    const article = articleForPreferences(command.article, preferences);
    const currentSentenceIndex = Math.min(
      Math.max(0, Math.trunc(descriptor.currentSentenceIndex)),
      Math.max(0, article.sentences.length - 1),
    );
    const generationEpoch = descriptor.generationEpoch + 1;
    this.nextGenerationEpoch = Math.max(
      this.nextGenerationEpoch,
      generationEpoch + 1,
    );
    const language = article.narrationLanguage;
    const snapshot: ReadingSessionSnapshot = {
      version: 1,
      id: descriptor.sessionId,
      generationEpoch,
      sourceTabId: descriptor.sourceTabId,
      sourceFrameId: descriptor.sourceFrameId,
      title: article.title,
      status: "paused",
      mode: descriptor.mode,
      currentSentenceIndex,
      currentMediaTimeMs: Math.max(0, descriptor.mediaTimeMs),
      sentenceCount: article.sentences.length,
      progressPercent: progressPercent(
        currentSentenceIndex,
        article.sentences.length,
      ),
      estimatedRemainingSeconds: remainingSeconds(
        article,
        currentSentenceIndex,
        preferences.playbackSpeed,
      ),
      playbackSpeed: preferences.playbackSpeed,
      theme: preferences.theme,
      narrationLanguage: language,
      voiceId: preferredVoice(
        descriptor.mode === "browser"
          ? preferences.browserVoiceByLanguage
          : preferences.voiceByLanguage,
        language,
      ),
      modelId: preferences.modelId,
      highlightsEnabled: preferences.highlightsEnabled,
      followEnabled: preferences.followEnabled,
      dock: preferences.dock,
      minimized: false,
      expanded: false,
      submittedCharacters: 0,
      usageGuardCharacters: preferences.usageGuardCharacters,
      notice: "Paused after Chrome restored the Reading Session.",
      errorCode: null,
      retryRequiresConfirmation: false,
    };
    const bufferedAudio = new Map<number, BufferedAudio>();
    const requestedSentenceIndices = new Set<number>();
    for (const entry of command.bufferedAudio ?? []) {
      if (
        Number.isSafeInteger(entry.sentenceIndex) &&
        entry.sentenceIndex >= 0 &&
        entry.sentenceIndex < article.sentences.length &&
        entry.audioBase64.length > 0
      ) {
        bufferedAudio.set(entry.sentenceIndex, {
          audioBase64: entry.audioBase64,
          alignment: entry.alignment,
        });
        requestedSentenceIndices.add(entry.sentenceIndex);
      }
    }
    this.active = {
      article,
      snapshot,
      browserVoiceId: preferredVoice(
        preferences.browserVoiceByLanguage,
        language,
      ),
      detectedNarrationLanguage: command.article.narrationLanguage,
      providerRegion: preferences.region,
      requestedSentenceIndices,
      bufferedAudio,
      lastGeneration: null,
      retryCount: 0,
      canResumeMedia: false,
      speechSettingsOpen: false,
      resumeAfterSettings: false,
      settingsConfigurationAtOpen: null,
    };

    return this.transition([
      this.contextEffect(snapshot, { type: "browser.stop" }),
      this.contextEffect(snapshot, { type: "provider.abort" }),
      this.contextEffect(snapshot, { type: "audio.pause" }),
      this.renderEffect(snapshot),
      this.saveDescriptorEffect(snapshot),
    ]);
  }

  private activate(
    command: Extract<ReadingSessionCommand, { type: "activate" }>,
  ): ReadingSessionTransition {
    const replacementEffects = this.active
      ? this.cleanupEffects(this.active.snapshot)
      : [];
    const id = this.createId();
    const generationEpoch = this.nextGenerationEpoch;
    this.nextGenerationEpoch += 1;
    const article = articleForPreferences(command.article, command.preferences);
    const language = article.narrationLanguage;
    const snapshot: ReadingSessionSnapshot = {
      version: 1,
      id,
      generationEpoch,
      sourceTabId: command.sourceTabId,
      sourceFrameId: command.sourceFrameId,
      title: command.article.title,
      status: "ready",
      mode: command.mode,
      currentSentenceIndex: 0,
      currentMediaTimeMs: 0,
      sentenceCount: article.sentences.length,
      progressPercent: 0,
      estimatedRemainingSeconds: remainingSeconds(
        article,
        0,
        command.preferences.playbackSpeed,
      ),
      playbackSpeed: command.preferences.playbackSpeed,
      theme: command.preferences.theme,
      narrationLanguage: language,
      voiceId: preferredVoice(
        command.mode === "browser"
          ? command.preferences.browserVoiceByLanguage
          : command.preferences.voiceByLanguage,
        language,
      ),
      modelId: command.preferences.modelId,
      highlightsEnabled: command.preferences.highlightsEnabled,
      followEnabled: command.preferences.followEnabled,
      dock: command.preferences.dock,
      minimized: false,
      expanded: false,
      submittedCharacters: 0,
      usageGuardCharacters: command.preferences.usageGuardCharacters,
      notice: null,
      errorCode: null,
      retryRequiresConfirmation: false,
    };
    this.active = {
      article,
      snapshot,
      browserVoiceId: preferredVoice(
        command.preferences.browserVoiceByLanguage,
        language,
      ),
      detectedNarrationLanguage: command.article.narrationLanguage,
      providerRegion: command.preferences.region,
      requestedSentenceIndices: new Set(),
      bufferedAudio: new Map(),
      lastGeneration: null,
      retryCount: 0,
      canResumeMedia: false,
      speechSettingsOpen: false,
      resumeAfterSettings: false,
      settingsConfigurationAtOpen: null,
    };

    return this.transition([
      ...replacementEffects,
      this.saveDescriptorEffect(snapshot),
      this.contextEffect(snapshot, { type: "content.render", snapshot }),
    ]);
  }

  private playBrowser(): ReadingSessionTransition {
    const active = this.requireActive();
    if (active.snapshot.mode !== "browser") return this.transition([]);
    const sentence =
      active.article.sentences[active.snapshot.currentSentenceIndex];
    if (!sentence) {
      active.snapshot = { ...active.snapshot, status: "completed" };
      active.canResumeMedia = false;
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.clear-highlights",
        }),
        this.renderEffect(active.snapshot),
      ]);
    }

    active.snapshot = { ...active.snapshot, status: "playing", notice: null };
    active.canResumeMedia = true;
    return this.transition([
      this.contextEffect(active.snapshot, {
        type: "browser.speak",
        sentenceIndex: active.snapshot.currentSentenceIndex,
        text: sentence.text,
        language: active.snapshot.narrationLanguage,
        voiceId: active.snapshot.voiceId,
        playbackSpeed: active.snapshot.playbackSpeed,
      }),
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private play(): ReadingSessionTransition {
    const active = this.requireActive();
    if (active.snapshot.status === "paused" && active.canResumeMedia) {
      if (active.snapshot.mode === "browser") {
        active.canResumeMedia = false;
        const restarted = this.playBrowser();
        return {
          snapshot: restarted.snapshot,
          effects: [
            this.contextEffect(active.snapshot, { type: "browser.stop" }),
            ...restarted.effects,
          ],
        };
      }
      active.snapshot = {
        ...active.snapshot,
        status: "playing",
        notice: null,
      };
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "audio.resume",
        }),
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    return this.requireActive().snapshot.mode === "browser"
      ? this.playBrowser()
      : this.playCloud();
  }

  private playCloud(): ReadingSessionTransition {
    const active = this.requireActive();
    const voiceId = active.snapshot.voiceId;
    if (!voiceId) {
      active.snapshot = {
        ...active.snapshot,
        status: "provider-issue",
        notice: "Choose a compatible Voice before using Cloud Voice Mode.",
        errorCode: "VOICE_REQUIRED",
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }

    const start = active.snapshot.currentSentenceIndex;
    const bufferedCurrent = active.bufferedAudio.get(start);
    if (bufferedCurrent) {
      active.snapshot = {
        ...active.snapshot,
        status: "playing",
        notice: null,
        errorCode: null,
      };
      active.canResumeMedia = true;
      return this.transition([
        this.contextEffect(active.snapshot, { type: "offscreen.ensure" }),
        this.contextEffect(active.snapshot, {
          type: "audio.play",
          sentenceIndex: start,
          audioBase64: bufferedCurrent.audioBase64,
          alignment: bufferedCurrent.alignment,
          playbackSpeed: active.snapshot.playbackSpeed,
          startAtMs: active.snapshot.currentMediaTimeMs,
          preservesPitch: true,
        }),
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (active.speechSettingsOpen) {
      active.resumeAfterSettings = true;
      active.snapshot = {
        ...active.snapshot,
        status: "paused",
        notice: SETTINGS_PAUSED_NOTICE,
      };
      return this.transition([
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    const availableCandidates = active.article.sentences
      .slice(start, start + 3)
      .map((sentence, offset) => ({
        index: start + offset,
        text: sentence.text,
      }))
      .filter(
        (sentence) => !active.requestedSentenceIndices.has(sentence.index),
      );
    if (availableCandidates.length === 0) {
      active.snapshot = {
        ...active.snapshot,
        status: "buffering",
        notice: "Preparing next sentence",
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }

    const guard = active.snapshot.usageGuardCharacters;
    const remainingGuard =
      guard === null
        ? Number.POSITIVE_INFINITY
        : guard - active.snapshot.submittedCharacters;
    const candidates: typeof availableCandidates = [];
    let submittedCharacters = 0;
    for (const candidate of availableCandidates) {
      if (submittedCharacters + candidate.text.length > remainingGuard) break;
      candidates.push(candidate);
      submittedCharacters += candidate.text.length;
    }
    if (candidates.length === 0) {
      active.snapshot = {
        ...active.snapshot,
        status: "usage-limit",
        notice: "Provider Usage guard reached",
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }

    submittedCharacters = candidates.reduce(
      (total, sentence) => total + sentence.text.length,
      0,
    );

    candidates.forEach((sentence) =>
      active.requestedSentenceIndices.add(sentence.index),
    );
    active.snapshot = {
      ...active.snapshot,
      status: "preparing",
      submittedCharacters:
        active.snapshot.submittedCharacters + submittedCharacters,
      notice: "Preparing next sentence",
      errorCode: null,
    };
    active.canResumeMedia = false;
    const lastIndex = candidates.at(-1)?.index ?? start;
    active.lastGeneration = {
      sentences: candidates,
      language: active.snapshot.narrationLanguage,
      voiceId,
      modelId: active.snapshot.modelId,
      region: active.providerRegion,
    };
    return this.transition([
      this.contextEffect(active.snapshot, {
        type: "provider.generate",
        requestId: `${active.snapshot.id}:${active.snapshot.generationEpoch}:${start}-${lastIndex}`,
        sentences: candidates,
        language: active.snapshot.narrationLanguage,
        voiceId,
        modelId: active.snapshot.modelId,
        region: active.providerRegion,
      }),
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private onProviderEvent(
    event: Extract<ReadingSessionCommand, { type: "provider.event" }>["event"],
  ): ReadingSessionTransition {
    const active = this.requireActive();
    if (active.snapshot.mode !== "cloud") return this.transition([]);

    if (event.type === "failure") {
      const canRetryAutomatically = !event.acknowledged && !event.receivedAudio;
      if (canRetryAutomatically && active.lastGeneration) {
        active.retryCount += 1;
        active.snapshot = {
          ...active.snapshot,
          status: "preparing",
          notice: "Preparing next sentence",
          errorCode: null,
          retryRequiresConfirmation: false,
        };
        return this.transition([
          this.generationEffect(
            active,
            `${active.snapshot.id}:${active.snapshot.generationEpoch}:retry-${active.retryCount}`,
          ),
          this.renderEffect(active.snapshot),
        ]);
      }

      active.snapshot = {
        ...active.snapshot,
        status: "provider-issue",
        notice:
          "Retry may duplicate Provider Usage. Confirm Retry, switch to Chrome, or stop.",
        errorCode: event.errorCode,
        retryRequiresConfirmation: true,
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }

    if (
      event.sentenceIndex < 0 ||
      event.sentenceIndex >= active.article.sentences.length ||
      event.audioBase64.length === 0
    ) {
      return this.transition([]);
    }
    active.bufferedAudio.set(event.sentenceIndex, {
      audioBase64: event.audioBase64,
      alignment: event.alignment,
    });
    active.snapshot = {
      ...active.snapshot,
      status:
        event.sentenceIndex === active.snapshot.currentSentenceIndex
          ? "playing"
          : active.snapshot.status,
      notice:
        event.sentenceIndex === active.snapshot.currentSentenceIndex
          ? null
          : active.snapshot.notice,
      retryRequiresConfirmation: false,
      currentMediaTimeMs:
        event.sentenceIndex === active.snapshot.currentSentenceIndex
          ? 0
          : active.snapshot.currentMediaTimeMs,
    };
    const effects: ReadingSessionEffect[] = [
      this.contextEffect(active.snapshot, {
        type: "buffer.store",
        entry: {
          sentenceIndex: event.sentenceIndex,
          audioBase64: event.audioBase64,
          byteLength: base64ByteLength(event.audioBase64),
          alignment: event.alignment,
        },
      }),
    ];
    if (event.sentenceIndex === active.snapshot.currentSentenceIndex) {
      active.canResumeMedia = true;
      effects.push(
        this.contextEffect(active.snapshot, { type: "offscreen.ensure" }),
        this.contextEffect(active.snapshot, {
          type: "audio.play",
          sentenceIndex: event.sentenceIndex,
          audioBase64: event.audioBase64,
          alignment: event.alignment,
          playbackSpeed: active.snapshot.playbackSpeed,
          startAtMs: 0,
          preservesPitch: true,
        }),
      );
    }
    effects.push(
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    );
    return this.transition(effects);
  }

  private onAudioEvent(
    event: Extract<ReadingSessionCommand, { type: "audio.event" }>["event"],
  ): ReadingSessionTransition {
    const active = this.requireActive();
    if (
      active.snapshot.mode !== "cloud" ||
      event.sentenceIndex !== active.snapshot.currentSentenceIndex
    ) {
      return this.transition([]);
    }

    if (event.type === "progress") {
      active.snapshot = {
        ...active.snapshot,
        currentMediaTimeMs: Math.max(0, event.mediaTimeMs),
      };
      const buffered = active.bufferedAudio.get(event.sentenceIndex);
      const sentence = active.article.sentences[event.sentenceIndex];
      const word =
        buffered?.alignment && sentence
          ? wordAtMediaTime(
              sentence.text,
              buffered.alignment,
              event.mediaTimeMs,
              active.snapshot.narrationLanguage,
            )
          : null;
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.highlight",
          sentenceIndex: event.sentenceIndex,
          word,
        }),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (event.type === "error") {
      active.canResumeMedia = false;
      active.snapshot = {
        ...active.snapshot,
        status: "provider-issue",
        notice: "Cloud Voice audio could not continue.",
        errorCode: event.errorCode,
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }

    active.canResumeMedia = false;
    const nextIndex = event.sentenceIndex + 1;
    const minimumBufferedSentence = Math.max(0, nextIndex - 1);
    for (const sentenceIndex of active.bufferedAudio.keys()) {
      if (sentenceIndex < minimumBufferedSentence) {
        active.bufferedAudio.delete(sentenceIndex);
        active.requestedSentenceIndices.delete(sentenceIndex);
      }
    }
    if (nextIndex >= active.article.sentences.length) {
      active.snapshot = {
        ...active.snapshot,
        status: "completed",
        progressPercent: 100,
        estimatedRemainingSeconds: 0,
      };
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.clear-highlights",
        }),
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    active.snapshot = {
      ...active.snapshot,
      currentSentenceIndex: nextIndex,
      currentMediaTimeMs: 0,
      progressPercent: progressPercent(
        nextIndex,
        active.article.sentences.length,
      ),
      estimatedRemainingSeconds: remainingSeconds(
        active.article,
        nextIndex,
        active.snapshot.playbackSpeed,
      ),
    };
    const nextAudio = active.bufferedAudio.get(nextIndex);
    if (!nextAudio) return this.playCloud();

    active.snapshot = {
      ...active.snapshot,
      status: "playing",
      notice: null,
    };
    return this.transition([
      this.contextEffect(active.snapshot, { type: "offscreen.ensure" }),
      this.contextEffect(active.snapshot, {
        type: "audio.play",
        sentenceIndex: nextIndex,
        audioBase64: nextAudio.audioBase64,
        alignment: nextAudio.alignment,
        playbackSpeed: active.snapshot.playbackSpeed,
        startAtMs: 0,
        preservesPitch: true,
      }),
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private retryProvider(): ReadingSessionTransition {
    const active = this.requireActive();
    if (!active.snapshot.retryRequiresConfirmation || !active.lastGeneration) {
      return this.transition([]);
    }
    active.retryCount += 1;
    active.snapshot = {
      ...active.snapshot,
      status: "preparing",
      notice: "Preparing next sentence",
      errorCode: null,
      retryRequiresConfirmation: false,
    };
    return this.transition([
      this.generationEffect(
        active,
        `${active.snapshot.id}:${active.snapshot.generationEpoch}:retry-${active.retryCount}`,
      ),
      this.renderEffect(active.snapshot),
    ]);
  }

  private generationEffect(
    active: ActiveSession,
    requestId: string,
  ): ReadingSessionEffect {
    const generation = active.lastGeneration;
    if (!generation) throw new Error("No Cloud Voice generation is available");
    return this.contextEffect(active.snapshot, {
      type: "provider.generate",
      requestId,
      sentences: generation.sentences,
      language: generation.language,
      voiceId: generation.voiceId,
      modelId: generation.modelId,
      region: generation.region,
    });
  }

  private pause(): ReadingSessionTransition {
    const active = this.requireActive();
    active.snapshot = {
      ...active.snapshot,
      status: "paused",
      notice: "Paused",
    };
    const pauseEffect =
      active.snapshot.mode === "browser"
        ? this.contextEffect(active.snapshot, { type: "browser.pause" })
        : this.contextEffect(active.snapshot, { type: "audio.pause" });
    return this.transition([
      pauseEffect,
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private navigateTo(requestedIndex: number): ReadingSessionTransition {
    const active = this.requireActive();
    const destination = Math.min(
      Math.max(0, Math.trunc(requestedIndex)),
      Math.max(0, active.article.sentences.length - 1),
    );
    const shouldStartNarration =
      active.snapshot.status === "playing" ||
      active.snapshot.status === "paused" ||
      active.snapshot.status === "completed";
    active.canResumeMedia = false;
    active.snapshot = {
      ...active.snapshot,
      currentSentenceIndex: destination,
      currentMediaTimeMs: 0,
      progressPercent: progressPercent(
        destination,
        active.article.sentences.length,
      ),
      estimatedRemainingSeconds: remainingSeconds(
        active.article,
        destination,
        active.snapshot.playbackSpeed,
      ),
      status: shouldStartNarration ? "playing" : "paused",
      notice: null,
    };
    const effects: ReadingSessionEffect[] = [
      active.snapshot.mode === "browser"
        ? this.contextEffect(active.snapshot, { type: "browser.stop" })
        : this.contextEffect(active.snapshot, { type: "audio.stop" }),
    ];

    if (active.snapshot.mode === "cloud") {
      effects.push(
        this.contextEffect(active.snapshot, { type: "provider.abort" }),
      );
      for (const sentenceIndex of active.requestedSentenceIndices) {
        if (!active.bufferedAudio.has(sentenceIndex)) {
          active.requestedSentenceIndices.delete(sentenceIndex);
        }
      }
      if (shouldStartNarration) {
        const buffered = active.bufferedAudio.get(destination);
        if (buffered) {
          active.canResumeMedia = true;
          effects.push(
            this.contextEffect(active.snapshot, { type: "offscreen.ensure" }),
            this.contextEffect(active.snapshot, {
              type: "audio.play",
              sentenceIndex: destination,
              audioBase64: buffered.audioBase64,
              alignment: buffered.alignment,
              playbackSpeed: active.snapshot.playbackSpeed,
              startAtMs: 0,
              preservesPitch: true,
            }),
          );
        } else {
          active.snapshot = { ...active.snapshot, status: "paused" };
          const preparing = this.playCloud();
          return {
            snapshot: preparing.snapshot,
            effects: [...effects, ...preparing.effects],
          };
        }
      }
    }

    if (shouldStartNarration && active.snapshot.mode === "browser") {
      const sentence = active.article.sentences[destination];
      if (sentence) {
        active.canResumeMedia = true;
        effects.push(
          this.contextEffect(active.snapshot, {
            type: "browser.speak",
            sentenceIndex: destination,
            text: sentence.text,
            language: active.snapshot.narrationLanguage,
            voiceId: active.snapshot.voiceId,
            playbackSpeed: active.snapshot.playbackSpeed,
          }),
        );
      }
    }
    effects.push(
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    );
    return this.transition(effects);
  }

  private setPlaybackSpeed(
    playbackSpeed: ReadingSessionSnapshot["playbackSpeed"],
  ): ReadingSessionTransition {
    const active = this.requireActive();
    active.snapshot = {
      ...active.snapshot,
      playbackSpeed,
      estimatedRemainingSeconds: remainingSeconds(
        active.article,
        active.snapshot.currentSentenceIndex,
        playbackSpeed,
      ),
      notice: null,
    };
    const effects: ReadingSessionEffect[] = [];
    if (active.snapshot.mode === "cloud") {
      effects.push(
        this.contextEffect(active.snapshot, {
          type: "audio.set-rate",
          playbackSpeed,
        }),
      );
    } else if (active.snapshot.status === "playing") {
      const sentence =
        active.article.sentences[active.snapshot.currentSentenceIndex];
      if (sentence) {
        effects.push(
          this.contextEffect(active.snapshot, { type: "browser.stop" }),
          this.contextEffect(active.snapshot, {
            type: "browser.speak",
            sentenceIndex: active.snapshot.currentSentenceIndex,
            text: sentence.text,
            language: active.snapshot.narrationLanguage,
            voiceId: active.snapshot.voiceId,
            playbackSpeed,
          }),
        );
        active.canResumeMedia = true;
      }
    } else if (active.snapshot.status === "paused" && active.canResumeMedia) {
      effects.push(
        this.contextEffect(active.snapshot, { type: "browser.stop" }),
      );
      active.canResumeMedia = false;
    }
    effects.push(
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    );
    return this.transition(effects);
  }

  private setHighlights(enabled: boolean): ReadingSessionTransition {
    const active = this.requireActive();
    active.snapshot = {
      ...active.snapshot,
      highlightsEnabled: enabled,
      notice: enabled
        ? "Source Page highlighting enabled."
        : "Source Page highlighting hidden.",
    };
    const highlightEffect: ReadingSessionEffect = enabled
      ? this.contextEffect(active.snapshot, {
          type: "content.highlight",
          sentenceIndex: active.snapshot.currentSentenceIndex,
          word: null,
        })
      : this.contextEffect(active.snapshot, {
          type: "content.clear-highlights",
        });
    return this.transition([
      this.renderEffect(active.snapshot),
      highlightEffect,
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private settingsOpened(): ReadingSessionTransition {
    const active = this.requireActive();
    active.speechSettingsOpen = true;
    active.settingsConfigurationAtOpen = {
      narrationLanguage: active.snapshot.narrationLanguage,
      voiceId: active.snapshot.voiceId,
      modelId: active.snapshot.modelId,
      region: active.providerRegion,
    };
    return this.transition(
      active.snapshot.mode === "cloud"
        ? [
            this.contextEffect(active.snapshot, {
              type: "provider.pause-prefetch",
            }),
          ]
        : [],
    );
  }

  private settingsClosed(preferences: Preferences): ReadingSessionTransition {
    const active = this.requireActive();
    active.speechSettingsOpen = false;
    active.providerRegion = preferences.region;
    const narrationLanguage =
      preferences.narrationLanguageOverride ?? active.detectedNarrationLanguage;
    active.browserVoiceId = preferredVoice(
      preferences.browserVoiceByLanguage,
      narrationLanguage,
    );
    const voiceId = preferredVoice(
      active.snapshot.mode === "browser"
        ? preferences.browserVoiceByLanguage
        : preferences.voiceByLanguage,
      narrationLanguage,
    );
    const nextConfiguration: SpeechConfiguration = {
      narrationLanguage,
      voiceId,
      modelId: preferences.modelId,
      region: preferences.region,
    };
    const browserConfigurationChanged =
      active.snapshot.narrationLanguage !== narrationLanguage ||
      active.snapshot.voiceId !== voiceId;
    const configurationChanged =
      active.settingsConfigurationAtOpen !== null &&
      (Object.keys(nextConfiguration) as Array<keyof SpeechConfiguration>).some(
        (key) =>
          active.settingsConfigurationAtOpen?.[key] !== nextConfiguration[key],
      );
    active.settingsConfigurationAtOpen = null;
    active.snapshot = {
      ...active.snapshot,
      narrationLanguage,
      modelId: preferences.modelId,
      voiceId,
      notice:
        active.snapshot.mode === "cloud" && active.bufferedAudio.size > 0
          ? "Buffered audio keeps its earlier Voice and Model."
          : active.snapshot.notice === SETTINGS_PAUSED_NOTICE
            ? null
            : active.snapshot.notice,
    };
    const resumePrefetchEffects: ReadingSessionEffect[] =
      active.snapshot.mode === "cloud"
        ? [
            this.contextEffect(active.snapshot, {
              type: configurationChanged
                ? "provider.abort"
                : "provider.resume-prefetch",
            }),
          ]
        : [];
    if (active.snapshot.mode === "browser" && browserConfigurationChanged) {
      active.canResumeMedia = false;
      const effects: ReadingSessionEffect[] = [
        this.contextEffect(active.snapshot, { type: "browser.stop" }),
      ];
      if (active.snapshot.status === "playing") {
        const sentence =
          active.article.sentences[active.snapshot.currentSentenceIndex];
        if (sentence) {
          active.canResumeMedia = true;
          effects.push(
            this.contextEffect(active.snapshot, {
              type: "browser.speak",
              sentenceIndex: active.snapshot.currentSentenceIndex,
              text: sentence.text,
              language: active.snapshot.narrationLanguage,
              voiceId: active.snapshot.voiceId,
              playbackSpeed: active.snapshot.playbackSpeed,
            }),
          );
        }
      }
      return this.transition([
        ...effects,
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (active.snapshot.mode === "cloud" && configurationChanged) {
      for (const sentenceIndex of active.requestedSentenceIndices) {
        if (!active.bufferedAudio.has(sentenceIndex)) {
          active.requestedSentenceIndices.delete(sentenceIndex);
        }
      }
      const currentBuffered = active.bufferedAudio.has(
        active.snapshot.currentSentenceIndex,
      );
      if (active.lastGeneration && !currentBuffered) {
        if (!voiceId) {
          active.lastGeneration = null;
          active.resumeAfterSettings = false;
          active.snapshot = {
            ...active.snapshot,
            status: "provider-issue",
            notice: "Choose a compatible Voice before continuing Cloud Voice.",
            errorCode: "VOICE_REQUIRED",
            retryRequiresConfirmation: false,
          };
          return this.transition([
            ...resumePrefetchEffects,
            this.renderEffect(active.snapshot),
            this.saveDescriptorEffect(active.snapshot),
          ]);
        }
        const start = active.snapshot.currentSentenceIndex;
        const sentences = active.article.sentences
          .slice(start, start + 3)
          .map((sentence, offset) => ({
            index: start + offset,
            text: sentence.text,
          }));
        sentences.forEach((sentence) =>
          active.requestedSentenceIndices.add(sentence.index),
        );
        active.lastGeneration = {
          sentences,
          language: narrationLanguage,
          voiceId,
          modelId: preferences.modelId,
          region: preferences.region,
        };
        active.resumeAfterSettings = false;
        active.snapshot = {
          ...active.snapshot,
          status: "provider-issue",
          notice:
            "Speech settings changed while Cloud Voice was preparing. Confirm Retry because Provider Usage may already have occurred.",
          errorCode: "SETTINGS_CHANGED_DURING_GENERATION",
          retryRequiresConfirmation: true,
        };
        return this.transition([
          ...resumePrefetchEffects,
          this.renderEffect(active.snapshot),
          this.saveDescriptorEffect(active.snapshot),
        ]);
      }
    }
    if (active.resumeAfterSettings && active.snapshot.mode === "cloud") {
      active.resumeAfterSettings = false;
      const playing = this.playCloud();
      return {
        snapshot: playing.snapshot,
        effects: [...resumePrefetchEffects, ...playing.effects],
      };
    }
    return this.transition([
      ...resumePrefetchEffects,
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private sourceChanged(): ReadingSessionTransition {
    const active = this.requireActive();
    active.canResumeMedia = false;
    active.snapshot = {
      ...active.snapshot,
      status: "page-changed",
      notice:
        "The Source Page changed. Restart, continue without highlighting, or stop.",
    };
    return this.transition([
      this.contextEffect(active.snapshot, { type: "browser.stop" }),
      this.contextEffect(active.snapshot, { type: "provider.abort" }),
      this.contextEffect(active.snapshot, { type: "audio.pause" }),
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private continueWithoutHighlights(): ReadingSessionTransition {
    const active = this.requireActive();
    active.snapshot = {
      ...active.snapshot,
      highlightsEnabled: false,
      status: "paused",
      notice: null,
    };
    return this.play();
  }

  private continueAfterUsageLimit(): ReadingSessionTransition {
    const active = this.requireActive();
    if (active.snapshot.status !== "usage-limit") return this.transition([]);
    active.snapshot = {
      ...active.snapshot,
      usageGuardCharacters: null,
      status: "paused",
      notice: null,
    };
    return this.playCloud();
  }

  private switchToBrowser(): ReadingSessionTransition {
    const active = this.requireActive();
    if (active.snapshot.mode !== "cloud") return this.transition([]);
    active.snapshot = {
      ...active.snapshot,
      mode: "browser",
      voiceId: active.browserVoiceId,
      currentMediaTimeMs: 0,
      status: "paused",
      notice: null,
      errorCode: null,
      retryRequiresConfirmation: false,
    };
    const stopEffects = [
      this.contextEffect(active.snapshot, { type: "provider.abort" }),
      this.contextEffect(active.snapshot, { type: "audio.stop" }),
    ];
    const playing = this.playBrowser();
    return {
      snapshot: playing.snapshot,
      effects: [...stopEffects, ...playing.effects],
    };
  }

  private onBrowserEvent(
    event: Extract<ReadingSessionCommand, { type: "browser.event" }>["event"],
  ): ReadingSessionTransition {
    const active = this.requireActive();
    if (
      event.sentenceIndex !== active.snapshot.currentSentenceIndex ||
      active.snapshot.mode !== "browser"
    ) {
      return this.transition([]);
    }

    if (event.type === "start") {
      active.snapshot = {
        ...active.snapshot,
        status: "playing",
        notice: null,
      };
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.highlight",
          sentenceIndex: event.sentenceIndex,
          word: null,
        }),
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (event.type === "pause") {
      active.snapshot = {
        ...active.snapshot,
        status: "paused",
        notice: "Paused",
      };
      return this.transition([
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (event.type === "resume") {
      active.snapshot = {
        ...active.snapshot,
        status: "playing",
        notice: null,
      };
      return this.transition([
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (event.type === "interrupted" || event.type === "cancelled") {
      active.canResumeMedia = false;
      active.snapshot = {
        ...active.snapshot,
        status: "paused",
        notice:
          "Chrome Voice stopped unexpectedly. Press play to restart the sentence.",
        errorCode:
          event.type === "cancelled"
            ? "BROWSER_TTS_CANCELLED"
            : "BROWSER_TTS_INTERRUPTED",
      };
      return this.transition([
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }
    if (event.type === "word") {
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.highlight",
          sentenceIndex: event.sentenceIndex,
          word: {
            startOffset: event.charIndex,
            endOffset: event.charIndex + Math.max(0, event.length),
          },
        }),
      ]);
    }
    if (event.type === "error") {
      active.canResumeMedia = false;
      active.snapshot = {
        ...active.snapshot,
        status: "provider-issue",
        errorCode: event.errorCode,
        notice: "Chrome Voice could not continue.",
      };
      return this.transition([this.renderEffect(active.snapshot)]);
    }
    if (event.type !== "end" || active.snapshot.status !== "playing") {
      return this.transition([]);
    }

    const nextIndex = active.snapshot.currentSentenceIndex + 1;
    active.canResumeMedia = false;
    if (nextIndex >= active.article.sentences.length) {
      active.snapshot = {
        ...active.snapshot,
        currentSentenceIndex: active.article.sentences.length - 1,
        currentMediaTimeMs: 0,
        progressPercent: 100,
        estimatedRemainingSeconds: 0,
        status: "completed",
      };
      return this.transition([
        this.contextEffect(active.snapshot, {
          type: "content.clear-highlights",
        }),
        this.renderEffect(active.snapshot),
        this.saveDescriptorEffect(active.snapshot),
      ]);
    }

    active.snapshot = {
      ...active.snapshot,
      currentSentenceIndex: nextIndex,
      currentMediaTimeMs: 0,
      progressPercent: progressPercent(
        nextIndex,
        active.article.sentences.length,
      ),
      estimatedRemainingSeconds: remainingSeconds(
        active.article,
        nextIndex,
        active.snapshot.playbackSpeed,
      ),
    };
    const nextSentence = active.article.sentences[nextIndex];
    if (!nextSentence) return this.transition([]);
    return this.transition([
      this.contextEffect(active.snapshot, {
        type: "browser.speak",
        sentenceIndex: nextIndex,
        text: nextSentence.text,
        language: active.snapshot.narrationLanguage,
        voiceId: active.snapshot.voiceId,
        playbackSpeed: active.snapshot.playbackSpeed,
      }),
      this.renderEffect(active.snapshot),
      this.saveDescriptorEffect(active.snapshot),
    ]);
  }

  private stop(): ReadingSessionTransition {
    const active = this.requireActive();
    const effects = this.cleanupEffects(active.snapshot);
    this.active = null;
    return { snapshot: null, effects };
  }

  private matchesActive(command: CommandContext): boolean {
    return (
      this.active !== null &&
      this.active.snapshot.id === command.sessionId &&
      this.active.snapshot.generationEpoch === command.generationEpoch
    );
  }

  private cleanupEffects(
    snapshot: ReadingSessionSnapshot,
  ): ReadingSessionEffect[] {
    return [
      this.contextEffect(snapshot, { type: "browser.stop" }),
      this.contextEffect(snapshot, { type: "provider.abort" }),
      this.contextEffect(snapshot, { type: "audio.stop" }),
      this.contextEffect(snapshot, { type: "content.clear" }),
      this.contextEffect(snapshot, { type: "storage.clear-session" }),
      this.contextEffect(snapshot, { type: "offscreen.close" }),
    ];
  }

  private saveDescriptorEffect(
    snapshot: ReadingSessionSnapshot,
  ): ReadingSessionEffect {
    return this.contextEffect(snapshot, {
      type: "storage.save-descriptor",
      descriptor: {
        version: 1,
        sessionId: snapshot.id,
        generationEpoch: snapshot.generationEpoch,
        sourceTabId: snapshot.sourceTabId,
        sourceFrameId: snapshot.sourceFrameId,
        mode: snapshot.mode,
        currentSentenceIndex: snapshot.currentSentenceIndex,
        mediaTimeMs: snapshot.currentMediaTimeMs,
        status: snapshot.status,
      },
    });
  }

  private renderEffect(snapshot: ReadingSessionSnapshot): ReadingSessionEffect {
    return this.contextEffect(snapshot, { type: "content.render", snapshot });
  }

  private contextEffect<
    T extends Omit<ReadingSessionEffect, keyof CommandContext>,
  >(snapshot: ReadingSessionSnapshot, effect: T): ReadingSessionEffect {
    return {
      ...effect,
      sessionId: snapshot.id,
      generationEpoch: snapshot.generationEpoch,
    } as ReadingSessionEffect;
  }

  private requireActive(): ActiveSession {
    if (!this.active) throw new Error("No active Reading Session");
    return this.active;
  }

  private transition(
    effects: ReadingSessionEffect[],
  ): ReadingSessionTransition {
    return { snapshot: this.active?.snapshot ?? null, effects };
  }
}

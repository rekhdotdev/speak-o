import {
  BrowserVoiceAdapter,
  type BrowserTtsPort,
} from "../src/adapters/browser-voice";
import {
  isArticleSnapshot,
  isCommandContext,
  isExtensionMessage,
  isPlaybackSpeed,
  isReadingSessionDescriptor,
  isRecord,
  isSessionBufferEntries,
} from "../src/contracts/runtime-guards";
import type { ArticleSnapshot } from "../src/extraction/types";
import {
  DEBUG_MODE,
  RuntimeDebugBuffer,
  summarizeDebugError,
  type RuntimeDebugEntry,
  type RuntimeDebugScope,
} from "../src/diagnostics/runtime-debug";
import { buildRuntimeDiagnosticEvidence } from "../src/diagnostics/diagnostics";
import { sendOptionalRuntimeMessage } from "../src/runtime/safe-runtime-message";
import {
  ElevenLabsMetadataClient,
  ElevenLabsTransport,
  elevenLabsOriginPattern,
} from "../src/provider/elevenlabs";
import { ReadingSessionController } from "../src/session/reading-session";
import { SerialTaskQueue } from "../src/session/serial-task-queue";
import { SessionBuffer } from "../src/session/session-buffer";
import {
  rebaseSessionCommandAfterRecovery,
  StartupBarrier,
  togglePlaybackAfterRecovery,
} from "../src/session/startup-barrier";
import { StopBarrier } from "../src/session/stop-barrier";
import type {
  AudioEvent,
  CommandContext,
  ProviderEvent,
  ReadingSessionCommand,
  ReadingSessionDescriptor,
  ReadingSessionTransition,
} from "../src/session/types";
import {
  ProviderCredentialStore,
  type ProtectedStorageArea,
} from "../src/storage/provider-credentials";
import {
  isPreferencePatch,
  PreferenceStore,
  type ElevenLabsRegion,
  type ExtensionStorageArea,
  type Preferences,
  type VoiceMode,
} from "../src/storage/preferences";
import { persistSessionPreferenceIfCurrent } from "../src/storage/session-preferences";
import { message as localizedMessage } from "../src/i18n";

const CONTEXT_MENU_ID = "speak-o-read-selection";
const SESSION_DESCRIPTOR_KEY = "activeSessionDescriptor";
const SESSION_BUFFER_KEY = "activeSessionBuffer";
const PROVIDER_METADATA_KEY = "elevenLabsMetadata";
const FIRST_USE_KEY = "firstUseComplete";
const PENDING_CLOUD_KEY = "pendingCloudActivation";

interface ContentTarget {
  tabId: number;
  frameId: number;
}

function storageArea(area: chrome.storage.StorageArea): ExtensionStorageArea {
  return {
    get: (key) => area.get(key),
    set: (items) => area.set(items),
  };
}

function protectedStorageArea(
  area: chrome.storage.StorageArea,
): ProtectedStorageArea {
  return {
    get: (key) => area.get(key),
    set: (items) => area.set(items),
    remove: (key) => area.remove(key),
    setAccessLevel: ({ accessLevel }) =>
      area.setAccessLevel({
        accessLevel: accessLevel as chrome.storage.AccessLevel,
      }),
  };
}

function isRegion(value: unknown): value is ElevenLabsRegion {
  return ["global", "us", "eu", "india", "singapore"].includes(String(value));
}

function isVoiceMode(value: unknown): value is VoiceMode {
  return value === "browser" || value === "cloud";
}

export default defineBackground(() => {
  const controller = new ReadingSessionController();
  const preferences = new PreferenceStore(storageArea(chrome.storage.local));
  const credentials = new ProviderCredentialStore(
    protectedStorageArea(chrome.storage.session),
    protectedStorageArea(chrome.storage.local),
  );
  const sessionBuffer = new SessionBuffer();
  const transitionEffects = new SerialTaskQueue();
  const preferenceUpdates = new SerialTaskQueue();
  const stopBarrier = new StopBarrier();
  const sessionTargets = new Map<string, ContentTarget>();
  const debug = new RuntimeDebugBuffer();
  let recoveryDescriptor: ReadingSessionDescriptor | null = null;
  let recoveryInFlight = false;
  let settlePendingReconciliation: (() => void) | null = null;
  let sentenceStartedAt = 0;
  let lastDebugWordKey = "";
  let lastCloudProgress: {
    sessionId: string;
    generationEpoch: number;
    sentenceIndex: number;
    receivedAt: number;
    mediaTimeMs: number;
  } | null = null;
  let activeArticle: {
    sessionId: string;
    article: ArticleSnapshot;
  } | null = null;

  debug.record("background", "service-worker.started", {
    extensionVersion: chrome.runtime.getManifest().version,
  });

  const browserTtsPort: BrowserTtsPort = {
    getVoices: async () =>
      (await chrome.tts.getVoices()).flatMap((voice) =>
        voice.voiceName
          ? [
              {
                voiceName: voice.voiceName,
                ...(voice.lang ? { lang: voice.lang } : {}),
                ...(voice.eventTypes ? { eventTypes: voice.eventTypes } : {}),
              },
            ]
          : [],
      ),
    async speak(text, options) {
      const ttsOptions: chrome.tts.TtsOptions = {
        lang: options.lang,
        rate: options.rate,
        enqueue: options.enqueue,
        desiredEventTypes: options.desiredEventTypes,
        onEvent: (event) => {
          debug.record("tts", "chrome.event.raw", {
            eventType: event.type,
            charIndex: event.charIndex,
            length: event.length,
            error: event.errorMessage,
          });
          options.onEvent({
            type: event.type as Parameters<typeof options.onEvent>[0]["type"],
            ...(event.charIndex === undefined
              ? {}
              : { charIndex: event.charIndex }),
            ...(event.length === undefined ? {} : { length: event.length }),
            ...(event.errorMessage === undefined
              ? {}
              : { errorMessage: event.errorMessage }),
          });
        },
      };
      if (options.voiceName) ttsOptions.voiceName = options.voiceName;
      if (options.requiredEventTypes) {
        ttsOptions.requiredEventTypes = options.requiredEventTypes;
      }
      await chrome.tts.speak(text, ttsOptions);
    },
    pause: () => chrome.tts.pause(),
    resume: () => chrome.tts.resume(),
    stop: () => chrome.tts.stop(),
  };
  const browserVoice = new BrowserVoiceAdapter(browserTtsPort);

  const sendDebugEntry = async (
    target: ContentTarget,
    entry: RuntimeDebugEntry,
  ) => {
    if (!DEBUG_MODE) return;
    try {
      await chrome.tabs.sendMessage(
        target.tabId,
        {
          version: 1,
          target: "content",
          type: "content.debug",
          entry,
        },
        { frameId: target.frameId },
      );
    } catch (error) {
      debug.record("background", "debug.delivery.failed", {
        tabId: target.tabId,
        frameId: target.frameId,
        error: summarizeDebugError(error),
      });
    }
  };

  const recordDebug = (
    scope: RuntimeDebugScope,
    event: string,
    data: Record<string, string | number | boolean | null | undefined> = {},
  ) => {
    const entry = debug.record(scope, event, data);
    if (DEBUG_MODE) {
      console.debug(`[Speak-O:${scope}] ${event}`, entry.data ?? {});
    }
    return entry;
  };

  const emitDebug = (
    scope: RuntimeDebugScope,
    event: string,
    data: Record<string, string | number | boolean | null | undefined> = {},
    target?: ContentTarget,
  ) => {
    const entry = recordDebug(scope, event, data);
    if (target) void sendDebugEntry(target, entry);
  };

  const broadcastDebug = (
    scope: RuntimeDebugScope,
    event: string,
    data: Record<string, string | number | boolean | null | undefined> = {},
  ) => {
    const entry = recordDebug(scope, event, data);
    if (DEBUG_MODE) {
      for (const target of new Set(sessionTargets.values())) {
        void sendDebugEntry(target, entry);
      }
    }
    return entry;
  };

  const metadataClient = new ElevenLabsMetadataClient(fetch, (event, data) => {
    broadcastDebug("background", event, data);
  });
  const providerTransport = new ElevenLabsTransport(
    undefined,
    (event, data) => {
      broadcastDebug("background", event, data);
    },
  );

  const sendDebugSnapshot = async (target: ContentTarget) => {
    if (!DEBUG_MODE) return;
    try {
      await chrome.tabs.sendMessage(
        target.tabId,
        {
          version: 1,
          target: "content",
          type: "content.debug.snapshot",
          entries: debug.snapshot(),
        },
        { frameId: target.frameId },
      );
    } catch (error) {
      debug.record("background", "debug.snapshot.failed", {
        tabId: target.tabId,
        frameId: target.frameId,
        error: summarizeDebugError(error),
      });
    }
  };

  const sendToContent = async (
    target: ContentTarget,
    message: Record<string, unknown>,
  ) => {
    try {
      await chrome.tabs.sendMessage(
        target.tabId,
        { version: 1, target: "content", ...message },
        { frameId: target.frameId },
      );
      return true;
    } catch (error) {
      debug.record("background", "content.message.failed", {
        messageType: String(message.type ?? "unknown"),
        tabId: target.tabId,
        frameId: target.frameId,
        error: summarizeDebugError(error),
      });
      // The Source Page may have navigated or closed; lifecycle events own cleanup.
      return false;
    }
  };

  const clearStoredSession = async () => {
    emitDebug("background", "recovery.storage.clear", {});
    recoveryDescriptor = null;
    sessionBuffer.clear();
    await chrome.storage.session.remove([
      SESSION_DESCRIPTOR_KEY,
      SESSION_BUFFER_KEY,
    ]);
  };

  const settleRecoveryReconciliation = () => {
    const settle = settlePendingReconciliation;
    settlePendingReconciliation = null;
    settle?.();
  };

  const requestSessionRecovery = async () => {
    emitDebug("background", "recovery.check.start", {});
    const stored = await chrome.storage.session.get(SESSION_DESCRIPTOR_KEY);
    const descriptor = stored[SESSION_DESCRIPTOR_KEY];
    if (
      !isReadingSessionDescriptor(descriptor) ||
      descriptor.status === "completed"
    ) {
      emitDebug("background", "recovery.check.none", {
        hadDescriptor: descriptor !== undefined,
      });
      if (descriptor !== undefined) await clearStoredSession();
      return;
    }
    recoveryDescriptor = descriptor;
    const reconciliation = new Promise<void>((resolve) => {
      settlePendingReconciliation = resolve;
    });
    const target = {
      tabId: descriptor.sourceTabId,
      frameId: descriptor.sourceFrameId,
    };
    emitDebug(
      "background",
      "recovery.reconcile.request",
      {
        status: descriptor.status,
        sentenceIndex: descriptor.currentSentenceIndex,
        generationEpoch: descriptor.generationEpoch,
        session: descriptor.sessionId.slice(-8),
      },
      target,
    );
    const delivered = await sendToContent(target, {
      type: "session.reconcile.request",
      sessionId: descriptor.sessionId,
      generationEpoch: descriptor.generationEpoch,
      currentSentenceIndex: descriptor.currentSentenceIndex,
    });
    emitDebug(
      "background",
      "recovery.reconcile.delivery",
      { delivered },
      delivered ? target : undefined,
    );
    if (!delivered) {
      try {
        await clearStoredSession();
      } finally {
        settleRecoveryReconciliation();
      }
    }
    await reconciliation;
  };
  const startupBarrier = new StartupBarrier(
    credentials.initialize().then(requestSessionRecovery),
  );

  const ensureOffscreen = async () => {
    const url = chrome.runtime.getURL("offscreen.html");
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification:
        "Play and time Cloud Voice audio for the active Reading Session",
    });
  };

  const closeOffscreen = async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) await chrome.offscreen.closeDocument();
  };

  const sendOffscreen = (message: object) =>
    chrome.runtime.sendMessage({ version: 1, target: "offscreen", ...message });

  const sendOptionalOffscreen = (message: object) =>
    sendOptionalRuntimeMessage(
      (runtimeMessage) => chrome.runtime.sendMessage(runtimeMessage),
      { version: 1, target: "offscreen", ...message },
    );

  const executeTransition = (transition: ReadingSessionTransition) => {
    const queuedAt = Date.now();
    const highlightEffect = transition.effects.find(
      (effect) => effect.type === "content.highlight",
    );
    return transitionEffects.run(() => {
      const queueDelayMs = Math.max(0, Date.now() - queuedAt);
      if (highlightEffect && queueDelayMs >= 750) {
        emitDebug(
          "background",
          "highlight.queue-delay",
          {
            sentenceIndex: highlightEffect.sentenceIndex,
            queueDelayMs,
            generationEpoch: highlightEffect.generationEpoch,
            session: highlightEffect.sessionId.slice(-8),
          },
          sessionTargets.get(highlightEffect.sessionId),
        );
      }
      return performTransition(transition);
    });
  };

  async function performTransition(
    transition: ReadingSessionTransition,
  ): Promise<void> {
    for (const effect of transition.effects) {
      const target = sessionTargets.get(effect.sessionId);
      try {
        switch (effect.type) {
          case "browser.speak":
            lastDebugWordKey = "";
            emitDebug(
              "tts",
              "speak.request",
              {
                sentenceIndex: effect.sentenceIndex,
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
                language: effect.language,
                rate: effect.playbackSpeed,
                voice: effect.voiceId ?? "automatic",
              },
              target,
            );
            sentenceStartedAt = Date.now();
            await browserVoice.speak(
              effect,
              (event) => {
                const wordKey = `${effect.sessionId}:${effect.generationEpoch}:${event.sentenceIndex}`;
                if (event.type !== "word" || lastDebugWordKey !== wordKey) {
                  if (event.type === "word") lastDebugWordKey = wordKey;
                  emitDebug(
                    "tts",
                    event.type === "word" ? "event.first-word" : "event",
                    {
                      eventType: event.type,
                      sentenceIndex: event.sentenceIndex,
                      charIndex:
                        event.type === "word" ? event.charIndex : undefined,
                      length: event.type === "word" ? event.length : undefined,
                      errorCode:
                        event.type === "error" ? event.errorCode : undefined,
                      error:
                        event.type === "error" ? event.errorMessage : undefined,
                      generationEpoch: effect.generationEpoch,
                      session: effect.sessionId.slice(-8),
                    },
                    target,
                  );
                }
                void executeTransition(
                  controller.dispatch({
                    type: "browser.event",
                    sessionId: effect.sessionId,
                    generationEpoch: effect.generationEpoch,
                    event,
                  }),
                );
              },
              (diagnostic) => {
                emitDebug(
                  "tts",
                  `voice.${diagnostic.type}`,
                  {
                    voice: diagnostic.voiceName ?? "chrome-selected",
                    wordBoundariesRequired: diagnostic.wordBoundariesRequired,
                    error: diagnostic.errorMessage,
                    sentenceIndex: effect.sentenceIndex,
                    generationEpoch: effect.generationEpoch,
                    session: effect.sessionId.slice(-8),
                  },
                  target,
                );
              },
            );
            emitDebug(
              "tts",
              "speak.accepted",
              {
                sentenceIndex: effect.sentenceIndex,
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            break;
          case "browser.pause":
            emitDebug(
              "tts",
              "pause.request",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            browserVoice.pause();
            break;
          case "browser.resume":
            emitDebug(
              "tts",
              "resume.request",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            browserVoice.resume();
            break;
          case "browser.stop":
            emitDebug(
              "tts",
              "stop.request",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            browserVoice.stop();
            break;
          case "provider.generate": {
            const credential = await credentials.load();
            if (!credential) {
              emitDebug(
                "background",
                "provider.generate.credential-missing",
                {
                  requestId: effect.requestId.slice(-24),
                  session: effect.sessionId.slice(-8),
                  generationEpoch: effect.generationEpoch,
                },
                target,
              );
              await performTransition(
                controller.dispatch({
                  type: "provider.event",
                  sessionId: effect.sessionId,
                  generationEpoch: effect.generationEpoch,
                  event: {
                    type: "failure",
                    errorCode: "CREDENTIAL_MISSING",
                    acknowledged: true,
                    receivedAudio: false,
                  },
                }),
              );
              break;
            }
            emitDebug(
              "background",
              "provider.generate.start",
              {
                requestId: effect.requestId.slice(-24),
                session: effect.sessionId.slice(-8),
                generationEpoch: effect.generationEpoch,
                region: effect.region,
                modelId: effect.modelId,
                voiceId: effect.voiceId,
                sentenceCount: effect.sentences.length,
                firstSentenceIndex: effect.sentences[0]?.index ?? null,
                lastSentenceIndex: effect.sentences.at(-1)?.index ?? null,
              },
              target,
            );
            providerTransport.generateBurst(
              effect,
              credential,
              (providerEvent) => {
                emitDebug(
                  "background",
                  "provider.generate.event",
                  {
                    requestId: providerEvent.requestId.slice(-24),
                    type: providerEvent.type,
                    ...(providerEvent.type === "audio"
                      ? {
                          sentenceIndex: providerEvent.sentenceIndex,
                          audioLength: providerEvent.audioBase64.length,
                          alignmentCharCount:
                            providerEvent.alignment?.chars.length ?? 0,
                          isFinal: providerEvent.isFinal,
                        }
                      : {
                          errorCode: providerEvent.errorCode,
                          acknowledged: providerEvent.acknowledged,
                          receivedAudio: providerEvent.receivedAudio,
                        }),
                  },
                  target,
                );
                const event: ProviderEvent =
                  providerEvent.type === "audio"
                    ? {
                        type: "audio",
                        sentenceIndex: providerEvent.sentenceIndex,
                        audioBase64: providerEvent.audioBase64,
                        alignment: providerEvent.alignment,
                        acknowledged: true,
                        isFinal: providerEvent.isFinal,
                      }
                    : {
                        type: "failure",
                        errorCode: providerEvent.errorCode,
                        acknowledged: providerEvent.acknowledged,
                        receivedAudio: providerEvent.receivedAudio,
                      };
                void executeTransition(
                  controller.dispatch({
                    type: "provider.event",
                    sessionId: effect.sessionId,
                    generationEpoch: effect.generationEpoch,
                    event,
                  }),
                );
              },
            );
            break;
          }
          case "provider.abort":
            emitDebug(
              "background",
              "provider.abort",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            providerTransport.abortAll();
            break;
          case "provider.pause-prefetch":
            emitDebug(
              "background",
              "provider.prefetch.pause",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            providerTransport.pausePrefetch();
            break;
          case "provider.resume-prefetch":
            emitDebug(
              "background",
              "provider.prefetch.resume",
              {
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            providerTransport.resumePrefetch();
            break;
          case "buffer.store": {
            const snapshot = controller.currentSnapshot();
            const decision = sessionBuffer.store(
              effect.entry,
              snapshot?.currentSentenceIndex ?? effect.entry.sentenceIndex,
            );
            if (decision.accepted) {
              await chrome.storage.session.set({
                [SESSION_BUFFER_KEY]: sessionBuffer.values(),
              });
            }
            if (decision.stopPrefetch) providerTransport.abortAll();
            break;
          }
          case "offscreen.ensure":
            await ensureOffscreen();
            break;
          case "offscreen.close":
            await closeOffscreen();
            break;
          case "audio.play":
            sentenceStartedAt = Date.now();
            lastCloudProgress = null;
            emitDebug(
              "offscreen",
              "audio.play.request",
              {
                sentenceIndex: effect.sentenceIndex,
                startAtMs: effect.startAtMs,
                playbackSpeed: effect.playbackSpeed,
                alignmentCharCount: effect.alignment?.chars.length ?? 0,
                alignmentStartMs: effect.alignment?.charStartTimesMs[0] ?? null,
                alignmentEndMs: effect.alignment
                  ? (effect.alignment.charStartTimesMs.at(-1) ?? 0) +
                    (effect.alignment.charDurationsMs.at(-1) ?? 0)
                  : null,
                generationEpoch: effect.generationEpoch,
                session: effect.sessionId.slice(-8),
              },
              target,
            );
            await ensureOffscreen();
            await sendOffscreen(effect);
            break;
          case "audio.pause":
          case "audio.stop": {
            const delivered = await sendOptionalOffscreen(effect);
            if (!delivered) {
              emitDebug(
                "background",
                "offscreen.cleanup.skipped",
                { effectType: effect.type },
                target,
              );
            }
            break;
          }
          case "audio.resume":
          case "audio.set-rate":
            await sendOffscreen(effect);
            break;
          case "content.render":
            if (target) {
              emitDebug(
                "background",
                "session.render.request",
                {
                  mode: effect.snapshot.mode,
                  status: effect.snapshot.status,
                  sentenceIndex: effect.snapshot.currentSentenceIndex,
                  generationEpoch: effect.snapshot.generationEpoch,
                  session: effect.snapshot.id.slice(-8),
                },
                target,
              );
              await sendToContent(target, {
                type: "content.render",
                snapshot: effect.snapshot,
              });
            }
            break;
          case "content.highlight":
            if (target) {
              const highlightStartedAt = Date.now();
              await sendToContent(target, {
                type: "content.highlight",
                sentenceIndex: effect.sentenceIndex,
                word: effect.word,
              });
              const deliveryMs = Math.max(0, Date.now() - highlightStartedAt);
              if (deliveryMs >= 500) {
                emitDebug(
                  "background",
                  "highlight.delivery-slow",
                  {
                    sentenceIndex: effect.sentenceIndex,
                    deliveryMs,
                    generationEpoch: effect.generationEpoch,
                    session: effect.sessionId.slice(-8),
                  },
                  target,
                );
              }
            }
            break;
          case "content.clear-highlights":
            if (target) {
              await sendToContent(target, { type: "content.clear-highlights" });
            }
            break;
          case "content.clear":
            if (target) await sendToContent(target, { type: "content.clear" });
            break;
          case "storage.save-descriptor":
            await chrome.storage.session.set({
              [SESSION_DESCRIPTOR_KEY]: effect.descriptor,
            });
            break;
          case "storage.clear-session":
            sessionBuffer.clear();
            await chrome.storage.session.remove([
              SESSION_DESCRIPTOR_KEY,
              SESSION_BUFFER_KEY,
            ]);
            break;
        }
      } catch (error) {
        emitDebug(
          effect.type.startsWith("browser.") ? "tts" : "background",
          "transition.effect.error",
          {
            effectType: effect.type,
            generationEpoch: effect.generationEpoch,
            session: effect.sessionId.slice(-8),
            error: summarizeDebugError(error),
          },
          target,
        );
        return;
      }
    }
    if (!transition.snapshot) {
      for (const effect of transition.effects) {
        sessionTargets.delete(effect.sessionId);
        if (activeArticle?.sessionId === effect.sessionId) activeArticle = null;
      }
    }
  }

  const startSession = async (
    article: ArticleSnapshot,
    target: ContentTarget,
    mode: VoiceMode,
  ) => {
    recoveryDescriptor = null;
    const replacedSessionId = controller.currentSnapshot()?.id ?? null;
    emitDebug(
      "background",
      "session.activate.start",
      {
        mode,
        replacing: replacedSessionId !== null,
        sentenceCount: article.sentences.length,
      },
      target,
    );
    const currentPreferences = await preferences.load();
    const transition = controller.dispatch({
      type: "activate",
      article,
      sourceTabId: target.tabId,
      sourceFrameId: target.frameId,
      mode,
      preferences: currentPreferences,
    });
    if (transition.snapshot) {
      sessionTargets.set(transition.snapshot.id, target);
      activeArticle = { sessionId: transition.snapshot.id, article };
    }
    emitDebug(
      "background",
      "session.activate.dispatched",
      {
        effectCount: transition.effects.length,
        generationEpoch: transition.snapshot?.generationEpoch,
        session: transition.snapshot?.id.slice(-8),
        status: transition.snapshot?.status,
      },
      target,
    );
    const activationEffects = executeTransition(transition);
    await chrome.storage.local.set({ [FIRST_USE_KEY]: true });
    await activationEffects;
    if (replacedSessionId) sessionTargets.delete(replacedSessionId);
    if (transition.snapshot) {
      emitDebug(
        "background",
        "session.play.dispatch",
        {
          generationEpoch: transition.snapshot.generationEpoch,
          session: transition.snapshot.id.slice(-8),
          status: transition.snapshot.status,
        },
        target,
      );
      await executeTransition(
        controller.dispatch({
          type: "play",
          sessionId: transition.snapshot.id,
          generationEpoch: transition.snapshot.generationEpoch,
        }),
      );
      const current = controller.currentSnapshot();
      emitDebug(
        "background",
        "session.play.effects-complete",
        {
          status: current?.status,
          sentenceIndex: current?.currentSentenceIndex,
          generationEpoch: current?.generationEpoch,
          session: current?.id.slice(-8),
        },
        target,
      );
    }
  };

  const injectAndExtract = async (target: ContentTarget) => {
    emitDebug("background", "action.request", {
      tabId: target.tabId,
      frameId: target.frameId,
    });
    try {
      await startupBarrier.afterRecovery(() =>
        stopBarrier.afterStop(async () => {
          await chrome.scripting.executeScript({
            target: { tabId: target.tabId, frameIds: [target.frameId] },
            files: ["reader.js"],
          });
          emitDebug("background", "reader.injected", {}, target);
          await sendDebugSnapshot(target);
          const delivered = await sendToContent(target, {
            type: "extract.request",
          });
          emitDebug(
            "background",
            "extract.request.delivery",
            { delivered },
            delivered ? target : undefined,
          );
        }),
      );
    } catch (error) {
      emitDebug(
        "background",
        "action.error",
        { error: summarizeDebugError(error) },
        target,
      );
      await chrome.action.setBadgeBackgroundColor({
        tabId: target.tabId,
        color: "#9c3d2e",
      });
      await chrome.action.setBadgeText({ tabId: target.tabId, text: "!" });
      await chrome.action.setTitle({
        tabId: target.tabId,
        title: localizedMessage("backgroundUnsupportedPageTitle"),
      });
    }
  };

  const handleExtraction = async (
    article: ArticleSnapshot,
    target: ContentTarget,
  ) => {
    emitDebug(
      "background",
      "extraction.received",
      {
        extractor: article.extractor,
        blockCount: article.blocks.length,
        sentenceCount: article.sentences.length,
      },
      target,
    );
    const [{ [FIRST_USE_KEY]: firstUse }, connection, currentPreferences] =
      await Promise.all([
        chrome.storage.local.get(FIRST_USE_KEY),
        credentials.describe(),
        preferences.load(),
      ]);
    if (
      !firstUse ||
      (currentPreferences.defaultVoiceMode === "cloud" && !connection.connected)
    ) {
      emitDebug(
        "background",
        "extraction.onboarding",
        {
          firstUse: Boolean(firstUse),
          defaultMode: currentPreferences.defaultVoiceMode,
          providerConnected: connection.connected,
        },
        target,
      );
      await sendToContent(target, {
        type: "onboarding.show",
        providerConnected: connection.connected,
      });
      return;
    }
    await startSession(article, target, currentPreferences.defaultVoiceMode);
  };

  const observeTask = (
    taskName: string,
    target: ContentTarget | null,
    task: Promise<unknown>,
  ) => {
    void task.catch((error) => {
      emitDebug(
        "background",
        "task.error",
        { taskName, error: summarizeDebugError(error) },
        target ?? undefined,
      );
    });
  };

  const commandForUi = (
    message: Record<string, unknown>,
  ): ReadingSessionCommand | null => {
    const snapshot = controller.currentSnapshot();
    if (
      !snapshot ||
      message.sessionId !== snapshot.id ||
      message.generationEpoch !== snapshot.generationEpoch ||
      typeof message.command !== "string"
    ) {
      return null;
    }
    const context = {
      sessionId: snapshot.id,
      generationEpoch: snapshot.generationEpoch,
    };
    switch (message.command) {
      case "toggle":
        return {
          type: snapshot.status === "playing" ? "pause" : "play",
          ...context,
        };
      case "play":
      case "pause":
      case "next":
        return { type: message.command, ...context };
      case "previous":
        return {
          type: "previous",
          elapsedInSentenceMs: Math.max(0, Date.now() - sentenceStartedAt),
          ...context,
        };
      case "seek":
        return Number.isSafeInteger(message.value)
          ? {
              type: "seek",
              sentenceIndex: message.value as number,
              ...context,
            }
          : null;
      case "set-playback-speed":
        return isPlaybackSpeed(message.value)
          ? {
              type: "set-playback-speed",
              playbackSpeed: message.value,
              ...context,
            }
          : null;
      case "set-highlights":
        return message.value === 0 || message.value === 1
          ? {
              type: "set-highlights",
              enabled: message.value === 1,
              ...context,
            }
          : null;
      case "retry":
        return { type: "retry-provider", ...context };
      case "continue-usage":
        return { type: "continue-after-usage-limit", ...context };
      case "switch-to-browser":
        return { type: "switch-to-browser", ...context };
      case "continue-without-highlights":
        return { type: "continue-without-highlights", ...context };
      case "close":
        return { type: "stop", ...context };
      default:
        return null;
    }
  };

  const handleSessionCommand = (
    message: Record<string, unknown>,
    senderTarget: ContentTarget | null,
    sendResponse?: (response?: unknown) => void,
  ): boolean | undefined => {
    const snapshot = controller.currentSnapshot();
    if (senderTarget) {
      emitDebug(
        "background",
        "ui.command.received",
        {
          command: String(message.command ?? "unknown"),
          requestedSession: String(message.sessionId ?? "").slice(-8),
          requestedEpoch:
            typeof message.generationEpoch === "number"
              ? message.generationEpoch
              : undefined,
          currentSession: snapshot?.id.slice(-8),
          currentEpoch: snapshot?.generationEpoch,
          currentStatus: snapshot?.status,
        },
        senderTarget,
      );
    }
    if (
      message.command === "restart" &&
      snapshot &&
      message.sessionId === snapshot.id &&
      message.generationEpoch === snapshot.generationEpoch
    ) {
      const target = sessionTargets.get(snapshot.id);
      if (target) {
        observeTask(
          "session-command:restart",
          target,
          (async () => {
            await stopBarrier.track(() =>
              executeTransition(
                controller.dispatch({
                  type: "stop",
                  sessionId: snapshot.id,
                  generationEpoch: snapshot.generationEpoch,
                }),
              ),
            );
            await injectAndExtract(target);
          })(),
        );
      }
      return;
    }

    const command = commandForUi(message);
    if (!command && senderTarget) {
      emitDebug(
        "background",
        "ui.command.rejected",
        { command: String(message.command ?? "unknown") },
        senderTarget,
      );
    }
    if (command?.type === "stop") {
      const cleanup = stopBarrier.track(() =>
        executeTransition(controller.dispatch(command)),
      );
      if (sendResponse) {
        void cleanup.then(
          () => sendResponse({ ok: true }),
          () => sendResponse({ ok: false }),
        );
        return true;
      }
      observeTask("session-command:stop", senderTarget, cleanup);
      return;
    }
    if (command) {
      if (
        command.type === "set-playback-speed" ||
        command.type === "set-highlights"
      ) {
        observeTask(
          `session-command:${command.type}`,
          senderTarget,
          preferenceUpdates.run(async () => {
            const current = controller.currentSnapshot();
            const persisted = await persistSessionPreferenceIfCurrent(
              preferences,
              command,
              current,
            );
            if (!persisted) return;
            await executeTransition(controller.dispatch(command));
          }),
        );
        return;
      }
      observeTask(
        `session-command:${command.type}`,
        senderTarget,
        executeTransition(controller.dispatch(command)),
      );
    }
  };

  const matchesCurrentSession = (context: CommandContext): boolean => {
    const snapshot = controller.currentSnapshot();
    return (
      snapshot !== null &&
      context.sessionId === snapshot.id &&
      context.generationEpoch === snapshot.generationEpoch
    );
  };

  const settingsOpened = ({ sessionId, generationEpoch }: CommandContext) => {
    const context = { sessionId, generationEpoch };
    if (!matchesCurrentSession(context)) return;
    void executeTransition(
      controller.dispatch({
        type: "settings.opened",
        ...context,
      }),
    );
  };

  const settingsClosed = ({ sessionId, generationEpoch }: CommandContext) => {
    const context = { sessionId, generationEpoch };
    void preferenceUpdates.run(async () => {
      const currentPreferences = await preferences.load();
      if (!matchesCurrentSession(context)) return;
      await executeTransition(
        controller.dispatch({
          type: "settings.closed",
          ...context,
          preferences: currentPreferences,
        }),
      );
    });
  };

  const applyChangedSettings = async (
    { sessionId, generationEpoch }: CommandContext,
    currentPreferences: Preferences,
  ) => {
    const context = { sessionId, generationEpoch };
    if (!matchesCurrentSession(context)) return;
    await executeTransition(
      controller.dispatch({
        type: "settings.closed",
        ...context,
        preferences: currentPreferences,
      }),
    );
    if (matchesCurrentSession(context)) {
      await executeTransition(
        controller.dispatch({
          type: "settings.opened",
          ...context,
        }),
      );
    }
  };

  const settingsChanged = ({ sessionId, generationEpoch }: CommandContext) => {
    const context = { sessionId, generationEpoch };
    if (!matchesCurrentSession(context)) return;
    void preferenceUpdates.run(async () => {
      const currentPreferences = await preferences.load();
      await applyChangedSettings(context, currentPreferences);
    });
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== "speech-settings" ||
      port.sender?.id !== chrome.runtime.id
    ) {
      return;
    }
    let boundContext: CommandContext | null = null;
    port.onMessage.addListener((message: unknown) => {
      if (
        !isExtensionMessage(message) ||
        message.target !== "background" ||
        message.type !== "settings.open" ||
        !isCommandContext(message) ||
        !matchesCurrentSession(message)
      ) {
        return;
      }
      boundContext = {
        sessionId: message.sessionId,
        generationEpoch: message.generationEpoch,
      };
      settingsOpened(boundContext);
    });
    port.onDisconnect.addListener(() => {
      if (boundContext) settingsClosed(boundContext);
    });
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (
        sender.id !== chrome.runtime.id ||
        !isExtensionMessage(message) ||
        message.target !== "background"
      ) {
        return;
      }
      const senderTarget: ContentTarget | null =
        sender.tab?.id === undefined
          ? null
          : { tabId: sender.tab.id, frameId: sender.frameId ?? 0 };

      if (
        message.type === "extraction.result" &&
        senderTarget &&
        isArticleSnapshot(message.article)
      ) {
        observeTask(
          "handle-extraction",
          senderTarget,
          handleExtraction(message.article, senderTarget),
        );
      } else if (message.type === "extraction.refused" && senderTarget) {
        emitDebug(
          "background",
          "extraction.refused",
          { reason: String(message.reason ?? "unknown") },
          senderTarget,
        );
      } else if (
        message.type === "session.reconcile" &&
        senderTarget &&
        recoveryDescriptor &&
        message.sessionId === recoveryDescriptor.sessionId &&
        message.generationEpoch === recoveryDescriptor.generationEpoch &&
        senderTarget.tabId === recoveryDescriptor.sourceTabId &&
        senderTarget.frameId === recoveryDescriptor.sourceFrameId &&
        isArticleSnapshot(message.article) &&
        !recoveryInFlight
      ) {
        const descriptor = recoveryDescriptor;
        const article = message.article;
        recoveryInFlight = true;
        void (async () => {
          try {
            emitDebug(
              "background",
              "recovery.restore.start",
              {
                status: descriptor.status,
                sentenceIndex: descriptor.currentSentenceIndex,
                generationEpoch: descriptor.generationEpoch,
                session: descriptor.sessionId.slice(-8),
              },
              senderTarget,
            );
            const [currentPreferences, stored] = await Promise.all([
              preferences.load(),
              chrome.storage.session.get(SESSION_BUFFER_KEY),
            ]);
            const entries = isSessionBufferEntries(stored[SESSION_BUFFER_KEY])
              ? stored[SESSION_BUFFER_KEY]
              : [];
            sessionBuffer.restore(entries, descriptor.currentSentenceIndex);
            const transition = controller.dispatch({
              type: "restore",
              article,
              descriptor,
              preferences: currentPreferences,
              bufferedAudio: entries,
            });
            if (transition.snapshot) {
              sessionTargets.set(transition.snapshot.id, senderTarget);
              activeArticle = { sessionId: transition.snapshot.id, article };
            }
            recoveryDescriptor = null;
            await executeTransition(transition);
            emitDebug(
              "background",
              "recovery.restore.complete",
              {
                restoredEntries: entries.length,
                status: transition.snapshot?.status,
              },
              senderTarget,
            );
          } catch (error) {
            emitDebug(
              "background",
              "recovery.restore.error",
              { error: summarizeDebugError(error) },
              senderTarget,
            );
          } finally {
            recoveryInFlight = false;
            settleRecoveryReconciliation();
          }
        })();
      } else if (
        message.type === "session.reconcile.failed" &&
        senderTarget &&
        recoveryDescriptor &&
        message.sessionId === recoveryDescriptor.sessionId &&
        senderTarget.tabId === recoveryDescriptor.sourceTabId &&
        senderTarget.frameId === recoveryDescriptor.sourceFrameId
      ) {
        void (async () => {
          try {
            await clearStoredSession();
          } finally {
            settleRecoveryReconciliation();
          }
        })();
      } else if (
        message.type === "activation.start" &&
        senderTarget &&
        isArticleSnapshot(message.article) &&
        isVoiceMode(message.mode)
      ) {
        const article = message.article;
        const mode = message.mode;
        observeTask(
          "activation-start",
          senderTarget,
          (async () => {
            if (mode === "cloud" && !(await credentials.describe()).connected) {
              await chrome.storage.session.set({
                [PENDING_CLOUD_KEY]: senderTarget,
              });
              await chrome.runtime.openOptionsPage();
              return;
            }
            await startSession(article, senderTarget, mode);
          })(),
        );
      } else if (message.type === "session.command") {
        const arrivedDuringRecovery =
          controller.currentSnapshot() === null ||
          recoveryDescriptor !== null ||
          recoveryInFlight;
        if (arrivedDuringRecovery) {
          if (senderTarget) {
            emitDebug(
              "background",
              "ui.command.deferred",
              {
                command: String(message.command ?? "unknown"),
                requestedSession: String(message.sessionId ?? "").slice(-8),
                requestedEpoch:
                  typeof message.generationEpoch === "number"
                    ? message.generationEpoch
                    : undefined,
              },
              senderTarget,
            );
          }
          let commandOwnsResponse = false;
          const replay = startupBarrier.afterRecovery(async () => {
            const replayedMessage = rebaseSessionCommandAfterRecovery(
              message,
              controller.currentSnapshot(),
              true,
            );
            if (senderTarget) {
              emitDebug(
                "background",
                "ui.command.replayed",
                {
                  command: String(replayedMessage.command ?? "unknown"),
                  requestedEpoch:
                    typeof message.generationEpoch === "number"
                      ? message.generationEpoch
                      : undefined,
                  replayedEpoch:
                    typeof replayedMessage.generationEpoch === "number"
                      ? replayedMessage.generationEpoch
                      : undefined,
                },
                senderTarget,
              );
            }
            commandOwnsResponse =
              handleSessionCommand(
                replayedMessage,
                senderTarget,
                sendResponse,
              ) === true;
          });
          observeTask("session-command-after-recovery", senderTarget, replay);
          void replay.then(
            () => {
              if (!commandOwnsResponse) sendResponse({ ok: true });
            },
            () => sendResponse({ ok: false }),
          );
          return true;
        }
        return handleSessionCommand(message, senderTarget, sendResponse);
      } else if (message.type === "settings.open") {
        if (isCommandContext(message)) settingsOpened(message);
        void chrome.runtime.openOptionsPage();
      } else if (message.type === "settings.changed") {
        if (isCommandContext(message)) settingsChanged(message);
      } else if (message.type === "source.changed") {
        const snapshot = controller.currentSnapshot();
        if (
          snapshot &&
          message.sessionId === snapshot.id &&
          message.generationEpoch === snapshot.generationEpoch
        ) {
          void executeTransition(
            controller.dispatch({
              type: "source.changed",
              sessionId: snapshot.id,
              generationEpoch: snapshot.generationEpoch,
            }),
          );
        }
      } else if (message.type === "source.navigated") {
        const snapshot = controller.currentSnapshot();
        if (
          snapshot &&
          message.sessionId === snapshot.id &&
          message.generationEpoch === snapshot.generationEpoch
        ) {
          void executeTransition(
            controller.dispatch({
              type: "stop",
              sessionId: snapshot.id,
              generationEpoch: snapshot.generationEpoch,
            }),
          );
        }
      } else if (message.type === "audio.event" && isRecord(message.event)) {
        const snapshot = controller.currentSnapshot();
        if (
          !snapshot ||
          message.sessionId !== snapshot.id ||
          message.generationEpoch !== snapshot.generationEpoch
        ) {
          return;
        }
        const raw = message.event;
        let event: AudioEvent | null = null;
        if (
          raw.type === "progress" &&
          Number.isSafeInteger(raw.sentenceIndex) &&
          typeof raw.mediaTimeMs === "number" &&
          Number.isFinite(raw.mediaTimeMs) &&
          raw.mediaTimeMs >= 0
        ) {
          const receivedAt = Date.now();
          const sentenceIndex = raw.sentenceIndex as number;
          const mediaTimeMs = raw.mediaTimeMs;
          const samePlayback =
            lastCloudProgress?.sessionId === snapshot.id &&
            lastCloudProgress.generationEpoch === snapshot.generationEpoch &&
            lastCloudProgress.sentenceIndex === sentenceIndex;
          if (!samePlayback || !lastCloudProgress) {
            emitDebug(
              "offscreen",
              "audio.progress.first",
              {
                sentenceIndex,
                mediaTimeMs,
                generationEpoch: snapshot.generationEpoch,
                session: snapshot.id.slice(-8),
              },
              sessionTargets.get(snapshot.id),
            );
          } else {
            const wallGapMs = Math.max(
              0,
              receivedAt - lastCloudProgress.receivedAt,
            );
            const mediaGapMs = mediaTimeMs - lastCloudProgress.mediaTimeMs;
            if (wallGapMs >= 1_000 || Math.abs(mediaGapMs) >= 1_000) {
              emitDebug(
                "offscreen",
                "audio.progress.gap",
                {
                  sentenceIndex,
                  previousMediaTimeMs: lastCloudProgress.mediaTimeMs,
                  mediaTimeMs,
                  mediaGapMs,
                  wallGapMs,
                  generationEpoch: snapshot.generationEpoch,
                  session: snapshot.id.slice(-8),
                },
                sessionTargets.get(snapshot.id),
              );
            }
          }
          lastCloudProgress = {
            sessionId: snapshot.id,
            generationEpoch: snapshot.generationEpoch,
            sentenceIndex,
            receivedAt,
            mediaTimeMs,
          };
          event = {
            type: "progress",
            sentenceIndex,
            mediaTimeMs,
          };
        } else if (
          raw.type === "ended" &&
          Number.isSafeInteger(raw.sentenceIndex)
        ) {
          const sentenceIndex = raw.sentenceIndex as number;
          const matchingProgress =
            lastCloudProgress?.sessionId === snapshot.id &&
            lastCloudProgress.generationEpoch === snapshot.generationEpoch &&
            lastCloudProgress.sentenceIndex === sentenceIndex
              ? lastCloudProgress
              : null;
          emitDebug(
            "offscreen",
            "audio.progress.ended",
            {
              sentenceIndex,
              lastMediaTimeMs: matchingProgress?.mediaTimeMs ?? null,
              wallSinceProgressMs: matchingProgress
                ? Math.max(0, Date.now() - matchingProgress.receivedAt)
                : null,
              generationEpoch: snapshot.generationEpoch,
              session: snapshot.id.slice(-8),
            },
            sessionTargets.get(snapshot.id),
          );
          event = {
            type: "ended",
            sentenceIndex,
          };
        } else if (
          raw.type === "error" &&
          Number.isSafeInteger(raw.sentenceIndex) &&
          typeof raw.errorCode === "string"
        ) {
          event = {
            type: "error",
            sentenceIndex: raw.sentenceIndex as number,
            errorCode: raw.errorCode.slice(0, 64),
          };
        }
        if (event) {
          void executeTransition(
            controller.dispatch({
              type: "audio.event",
              sessionId: snapshot.id,
              generationEpoch: snapshot.generationEpoch,
              event,
            }),
          );
        }
      } else if (message.type === "options.get-state") {
        void (async () => {
          const [connection, storedMetadata, currentPreferences] =
            await Promise.all([
              credentials.describe(),
              chrome.storage.local.get(PROVIDER_METADATA_KEY),
              preferences.load(),
            ]);
          sendResponse({
            connection,
            preferences: currentPreferences,
            metadata: storedMetadata[PROVIDER_METADATA_KEY] ?? {
              voices: [],
              models: [],
            },
            sessionContext: (() => {
              const snapshot = controller.currentSnapshot();
              return snapshot
                ? {
                    sessionId: snapshot.id,
                    generationEpoch: snapshot.generationEpoch,
                  }
                : null;
            })(),
            diagnosticsEvidence: (() => {
              const snapshot = controller.currentSnapshot();
              return snapshot && activeArticle?.sessionId === snapshot.id
                ? buildRuntimeDiagnosticEvidence(
                    activeArticle.article,
                    snapshot,
                  )
                : null;
            })(),
            ...(DEBUG_MODE ? { debugLog: debug.format() } : {}),
          });
        })();
        return true;
      } else if (
        message.type === "preferences.patch" &&
        isPreferencePatch(message.patch)
      ) {
        const preferencePatch = message.patch;
        const context = isCommandContext(message)
          ? {
              sessionId: message.sessionId,
              generationEpoch: message.generationEpoch,
            }
          : null;
        void preferenceUpdates.run(async () => {
          try {
            const currentPreferences = await preferences.patch(preferencePatch);
            if (context) {
              await applyChangedSettings(context, currentPreferences);
            }
            sendResponse({ ok: true, preferences: currentPreferences });
          } catch (error) {
            emitDebug("background", "preferences.patch.error", {
              error: summarizeDebugError(error),
            });
            sendResponse({ ok: false });
          }
        });
        return true;
      } else if (
        message.type === "provider.connect" &&
        typeof message.credential === "string" &&
        typeof message.rememberOnDevice === "boolean" &&
        isRegion(message.region)
      ) {
        void (async () => {
          const region = message.region as ElevenLabsRegion;
          const credential = message.credential as string;
          const rememberOnDevice = message.rememberOnDevice as boolean;
          recordDebug("background", "provider.connection.start", {
            region,
            credentialProvided: credential.trim().length > 0,
            rememberOnDevice,
          });
          try {
            const origin = elevenLabsOriginPattern(region);
            const permitted = await chrome.permissions.contains({
              origins: [origin],
            });
            recordDebug("background", "provider.permission.check", {
              region,
              granted: permitted,
            });
            if (!permitted) {
              sendResponse({
                ok: false,
                message: localizedMessage("optionsAllowSelectedRegion"),
                ...(DEBUG_MODE ? { debugLog: debug.format() } : {}),
              });
              return;
            }
            const providerMetadata = await metadataClient.validateAndLoad(
              credential,
              region,
            );
            await credentials.save(credential, rememberOnDevice);
            await chrome.storage.local.set({
              [PROVIDER_METADATA_KEY]: { ...providerMetadata, region },
            });
            const connection = await credentials.describe();
            recordDebug("background", "provider.connection.succeeded", {
              region,
              voiceCount: providerMetadata.voices.length,
              modelCount: providerMetadata.models.length,
            });
            sendResponse({
              ok: true,
              connection,
              metadata: providerMetadata,
              ...(DEBUG_MODE ? { debugLog: debug.format() } : {}),
            });
            const pending = (
              await chrome.storage.session.get(PENDING_CLOUD_KEY)
            )[PENDING_CLOUD_KEY] as ContentTarget | undefined;
            if (
              pending &&
              Number.isSafeInteger(pending.tabId) &&
              Number.isSafeInteger(pending.frameId)
            ) {
              await sendToContent(pending, { type: "pending.resume" });
              await chrome.storage.session.remove(PENDING_CLOUD_KEY);
            }
          } catch (error) {
            const errorCode =
              isRecord(error) && typeof error.code === "string"
                ? error.code
                : null;
            recordDebug("background", "provider.connection.failed", {
              region,
              errorCode,
              error: summarizeDebugError(error),
            });
            const messageKey =
              errorCode === "AUTH_FAILED"
                ? "optionsProviderAuthFailed"
                : errorCode === "RATE_LIMITED"
                  ? "optionsProviderRateLimited"
                  : errorCode === "PROVIDER_UNAVAILABLE"
                    ? "optionsProviderUnavailable"
                    : "optionsConnectionFailed";
            sendResponse({
              ok: false,
              message: localizedMessage(messageKey),
              ...(DEBUG_MODE ? { debugLog: debug.format() } : {}),
            });
          }
        })();
        return true;
      } else if (
        message.type === "provider.disconnect" &&
        isRegion(message.region)
      ) {
        void (async () => {
          providerTransport.abortAll();
          await credentials.disconnect();
          const stored = await chrome.storage.local.get(PROVIDER_METADATA_KEY);
          const storedMetadata = stored[PROVIDER_METADATA_KEY];
          const connectedRegion =
            isRecord(storedMetadata) && isRegion(storedMetadata.region)
              ? storedMetadata.region
              : (message.region as ElevenLabsRegion);
          await chrome.storage.local.remove(PROVIDER_METADATA_KEY);
          await chrome.permissions.remove({
            origins: [elevenLabsOriginPattern(connectedRegion)],
          });
          sendResponse({ ok: true });
        })();
        return true;
      }
    },
  );

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) {
      void injectAndExtract({ tabId: tab.id, frameId: 0 });
    }
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "read-article" && tab?.id !== undefined) {
      void injectAndExtract({ tabId: tab.id, frameId: 0 });
      return;
    }
    if (command === "toggle-playback") {
      observeTask(
        "command-toggle-playback",
        null,
        togglePlaybackAfterRecovery(
          startupBarrier,
          () => controller.currentSnapshot(),
          (toggle) => executeTransition(controller.dispatch(toggle)),
        ),
      );
    }
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID && tab?.id !== undefined) {
      void injectAndExtract({
        tabId: tab.id,
        frameId: info.frameId ?? 0,
      });
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const snapshot = controller.currentSnapshot();
    if (!snapshot || snapshot.sourceTabId !== tabId) return;
    void executeTransition(
      controller.dispatch({
        type: "stop",
        sessionId: snapshot.id,
        generationEpoch: snapshot.generationEpoch,
      }),
    );
  });

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.contextMenus.removeAll().then(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: localizedMessage("contextMenuReadSelection"),
        contexts: ["selection"],
      });
    });
    void chrome.storage.session.remove([
      SESSION_DESCRIPTOR_KEY,
      SESSION_BUFFER_KEY,
      PENDING_CLOUD_KEY,
    ]);
  });
});

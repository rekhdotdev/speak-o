import {
  BrowserVoiceAdapter,
  type BrowserTtsPort,
} from "../src/adapters/browser-voice";
import {
  isArticleSnapshot,
  isExtensionMessage,
  isPlaybackSpeed,
  isReadingSessionDescriptor,
  isRecord,
  isSessionBufferEntries,
} from "../src/contracts/runtime-guards";
import type { ArticleSnapshot } from "../src/extraction/types";
import {
  ElevenLabsMetadataClient,
  ElevenLabsTransport,
  elevenLabsOriginPattern,
} from "../src/provider/elevenlabs";
import { ReadingSessionController } from "../src/session/reading-session";
import { SessionBuffer } from "../src/session/session-buffer";
import { StopBarrier } from "../src/session/stop-barrier";
import type {
  AudioEvent,
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
  PreferenceStore,
  type ElevenLabsRegion,
  type ExtensionStorageArea,
  type VoiceMode,
} from "../src/storage/preferences";

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
  const metadataClient = new ElevenLabsMetadataClient();
  const providerTransport = new ElevenLabsTransport();
  const sessionBuffer = new SessionBuffer();
  const stopBarrier = new StopBarrier();
  const sessionTargets = new Map<string, ContentTarget>();
  let recoveryDescriptor: ReadingSessionDescriptor | null = null;
  let recoveryInFlight = false;
  let sentenceStartedAt = 0;

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
        onEvent: (event) =>
          options.onEvent({
            type: event.type as Parameters<typeof options.onEvent>[0]["type"],
            ...(event.charIndex === undefined
              ? {}
              : { charIndex: event.charIndex }),
            ...(event.length === undefined ? {} : { length: event.length }),
            ...(event.errorMessage === undefined
              ? {}
              : { errorMessage: event.errorMessage }),
          }),
      };
      if (options.voiceName) ttsOptions.voiceName = options.voiceName;
      await chrome.tts.speak(text, ttsOptions);
    },
    pause: () => chrome.tts.pause(),
    resume: () => chrome.tts.resume(),
    stop: () => chrome.tts.stop(),
  };
  const browserVoice = new BrowserVoiceAdapter(browserTtsPort);

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
    } catch {
      // The Source Page may have navigated or closed; lifecycle events own cleanup.
      return false;
    }
  };

  const clearStoredSession = async () => {
    recoveryDescriptor = null;
    sessionBuffer.clear();
    await chrome.storage.session.remove([
      SESSION_DESCRIPTOR_KEY,
      SESSION_BUFFER_KEY,
    ]);
  };

  const requestSessionRecovery = async () => {
    const stored = await chrome.storage.session.get(SESSION_DESCRIPTOR_KEY);
    const descriptor = stored[SESSION_DESCRIPTOR_KEY];
    if (
      !isReadingSessionDescriptor(descriptor) ||
      descriptor.status === "completed"
    ) {
      if (descriptor !== undefined) await clearStoredSession();
      return;
    }
    recoveryDescriptor = descriptor;
    const target = {
      tabId: descriptor.sourceTabId,
      frameId: descriptor.sourceFrameId,
    };
    const delivered = await sendToContent(target, {
      type: "session.reconcile.request",
      sessionId: descriptor.sessionId,
      generationEpoch: descriptor.generationEpoch,
      currentSentenceIndex: descriptor.currentSentenceIndex,
    });
    if (!delivered) await clearStoredSession();
  };

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

  const executeTransition = async (transition: ReadingSessionTransition) => {
    for (const effect of transition.effects) {
      const target = sessionTargets.get(effect.sessionId);
      switch (effect.type) {
        case "browser.speak":
          sentenceStartedAt = Date.now();
          await browserVoice.speak(effect, (event) => {
            void executeTransition(
              controller.dispatch({
                type: "browser.event",
                sessionId: effect.sessionId,
                generationEpoch: effect.generationEpoch,
                event,
              }),
            );
          });
          break;
        case "browser.pause":
          browserVoice.pause();
          break;
        case "browser.resume":
          browserVoice.resume();
          break;
        case "browser.stop":
          browserVoice.stop();
          break;
        case "provider.generate": {
          const credential = await credentials.load();
          if (!credential) {
            await executeTransition(
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
          providerTransport.generateBurst(
            effect,
            credential,
            (providerEvent) => {
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
          providerTransport.abortAll();
          break;
        case "provider.pause-prefetch":
          providerTransport.pausePrefetch();
          break;
        case "provider.resume-prefetch":
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
          await ensureOffscreen();
          await sendOffscreen(effect);
          break;
        case "audio.pause":
        case "audio.resume":
        case "audio.stop":
        case "audio.set-rate":
          await sendOffscreen(effect);
          break;
        case "content.render":
          if (target) {
            await sendToContent(target, {
              type: "content.render",
              snapshot: effect.snapshot,
            });
          }
          break;
        case "content.highlight":
          if (target) {
            await sendToContent(target, {
              type: "content.highlight",
              sentenceIndex: effect.sentenceIndex,
              word: effect.word,
            });
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
    }
    if (!transition.snapshot) {
      for (const effect of transition.effects)
        sessionTargets.delete(effect.sessionId);
    }
  };

  const startSession = async (
    article: ArticleSnapshot,
    target: ContentTarget,
    mode: VoiceMode,
  ) => {
    recoveryDescriptor = null;
    const replacedSessionId = controller.currentSnapshot()?.id ?? null;
    const currentPreferences = await preferences.load();
    const transition = controller.dispatch({
      type: "activate",
      article,
      sourceTabId: target.tabId,
      sourceFrameId: target.frameId,
      mode,
      preferences: currentPreferences,
    });
    if (transition.snapshot) sessionTargets.set(transition.snapshot.id, target);
    await chrome.storage.local.set({ [FIRST_USE_KEY]: true });
    await executeTransition(transition);
    if (replacedSessionId) sessionTargets.delete(replacedSessionId);
    if (transition.snapshot) {
      await executeTransition(
        controller.dispatch({
          type: "play",
          sessionId: transition.snapshot.id,
          generationEpoch: transition.snapshot.generationEpoch,
        }),
      );
    }
  };

  const injectAndExtract = (target: ContentTarget) =>
    stopBarrier.afterStop(async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: target.tabId, frameIds: [target.frameId] },
          files: ["reader.js"],
        });
        await sendToContent(target, { type: "extract.request" });
      } catch {
        await chrome.action.setBadgeBackgroundColor({
          tabId: target.tabId,
          color: "#9c3d2e",
        });
        await chrome.action.setBadgeText({ tabId: target.tabId, text: "!" });
        await chrome.action.setTitle({
          tabId: target.tabId,
          title:
            "Speak-O cannot run on this protected Chrome page or unsupported document.",
        });
      }
    });

  const handleExtraction = async (
    article: ArticleSnapshot,
    target: ContentTarget,
  ) => {
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
      await sendToContent(target, {
        type: "onboarding.show",
        providerConnected: connection.connected,
      });
      return;
    }
    await startSession(article, target, currentPreferences.defaultVoiceMode);
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

  const settingsOpened = () => {
    const snapshot = controller.currentSnapshot();
    if (!snapshot) return;
    void executeTransition(
      controller.dispatch({
        type: "settings.opened",
        sessionId: snapshot.id,
        generationEpoch: snapshot.generationEpoch,
      }),
    );
  };

  const settingsClosed = () => {
    const snapshot = controller.currentSnapshot();
    if (!snapshot) return;
    void preferences.load().then((currentPreferences) =>
      executeTransition(
        controller.dispatch({
          type: "settings.closed",
          sessionId: snapshot.id,
          generationEpoch: snapshot.generationEpoch,
          preferences: currentPreferences,
        }),
      ),
    );
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "speech-settings") return;
    settingsOpened();
    port.onDisconnect.addListener(settingsClosed);
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
        void handleExtraction(message.article, senderTarget);
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
            }
            recoveryDescriptor = null;
            await executeTransition(transition);
          } finally {
            recoveryInFlight = false;
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
        void clearStoredSession();
      } else if (
        message.type === "activation.start" &&
        senderTarget &&
        isArticleSnapshot(message.article) &&
        isVoiceMode(message.mode)
      ) {
        const article = message.article;
        const mode = message.mode;
        void (async () => {
          if (mode === "cloud" && !(await credentials.describe()).connected) {
            await chrome.storage.session.set({
              [PENDING_CLOUD_KEY]: senderTarget,
            });
            await chrome.runtime.openOptionsPage();
            return;
          }
          await startSession(article, senderTarget, mode);
        })();
      } else if (message.type === "session.command") {
        const snapshot = controller.currentSnapshot();
        if (
          message.command === "restart" &&
          snapshot &&
          message.sessionId === snapshot.id &&
          message.generationEpoch === snapshot.generationEpoch
        ) {
          const target = sessionTargets.get(snapshot.id);
          if (target) {
            void (async () => {
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
            })();
          }
        } else {
          const command = commandForUi(message);
          if (command?.type === "stop") {
            const cleanup = stopBarrier.track(() =>
              executeTransition(controller.dispatch(command)),
            );
            void cleanup.then(
              () => sendResponse({ ok: true }),
              () => sendResponse({ ok: false }),
            );
            return true;
          }
          if (command) void executeTransition(controller.dispatch(command));
        }
      } else if (message.type === "settings.open") {
        settingsOpened();
        void chrome.runtime.openOptionsPage();
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
          typeof raw.mediaTimeMs === "number"
        ) {
          event = {
            type: "progress",
            sentenceIndex: raw.sentenceIndex as number,
            mediaTimeMs: raw.mediaTimeMs,
          };
        } else if (
          raw.type === "ended" &&
          Number.isSafeInteger(raw.sentenceIndex)
        ) {
          event = {
            type: "ended",
            sentenceIndex: raw.sentenceIndex as number,
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
          const [connection, storedMetadata] = await Promise.all([
            credentials.describe(),
            chrome.storage.local.get(PROVIDER_METADATA_KEY),
          ]);
          sendResponse({
            connection,
            metadata: storedMetadata[PROVIDER_METADATA_KEY] ?? {
              voices: [],
              models: [],
            },
          });
        })();
        return true;
      } else if (
        message.type === "provider.connect" &&
        typeof message.credential === "string" &&
        typeof message.rememberOnDevice === "boolean" &&
        isRegion(message.region)
      ) {
        void (async () => {
          try {
            const region = message.region as ElevenLabsRegion;
            const origin = elevenLabsOriginPattern(region);
            const permitted = await chrome.permissions.contains({
              origins: [origin],
            });
            if (!permitted) {
              throw new Error(
                "Allow the selected ElevenLabs API Region first.",
              );
            }
            const providerMetadata = await metadataClient.validateAndLoad(
              message.credential as string,
              region,
            );
            await credentials.save(
              message.credential as string,
              message.rememberOnDevice as boolean,
            );
            await chrome.storage.local.set({
              [PROVIDER_METADATA_KEY]: { ...providerMetadata, region },
            });
            const connection = await credentials.describe();
            sendResponse({
              ok: true,
              connection,
              metadata: providerMetadata,
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
            sendResponse({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : "ElevenLabs could not be connected.",
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
      const snapshot = controller.currentSnapshot();
      if (!snapshot) return;
      void executeTransition(
        controller.dispatch({
          type: snapshot.status === "playing" ? "pause" : "play",
          sessionId: snapshot.id,
          generationEpoch: snapshot.generationEpoch,
        }),
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
        title: "Read Selection with Speak-O",
        contexts: ["selection"],
      });
    });
    void chrome.storage.session.remove([
      SESSION_DESCRIPTOR_KEY,
      SESSION_BUFFER_KEY,
      PENDING_CLOUD_KEY,
    ]);
  });

  void credentials.initialize().then(requestSessionRecovery);
});

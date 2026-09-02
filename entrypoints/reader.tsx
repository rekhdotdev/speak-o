import { createRoot, type Root } from "react-dom/client";
import readerCss from "../src/ui/reader.css?inline";
import { ReaderApp, type ReaderViewState } from "../src/ui/ReaderApp";
import { extractSourcePage } from "../src/extraction/extract-source-page";
import type {
  ArticleSnapshot,
  ExtractionResult,
  SourceMapping,
} from "../src/extraction/types";
import {
  SourceHighlighter,
  type HighlightRegistry,
} from "../src/highlighting/source-highlighter";
import { isExtensionMessage, isRecord } from "../src/contracts/runtime-guards";
import type { ReadingSessionSnapshot } from "../src/session/types";
import { isSpeechProviderId } from "../src/provider/types";
import { sendRuntimeMessageSafely } from "../src/runtime/safe-runtime-message";
import {
  RuntimeDebugBuffer,
  isRuntimeDebugEntry,
  summarizeDebugError,
  type RuntimeDebugScope,
} from "../src/diagnostics/runtime-debug";
import { applyInterfaceDirection, message } from "../src/i18n";
import { SourcePageUrlTracker } from "../src/runtime/source-page-url";

const HOST_ID = `speak-o-reader-root-${chrome.runtime.id}`;
const PAGE_HIGHLIGHT_STYLE_ID = `speak-o-highlight-styles-${chrome.runtime.id}`;
const isolatedWindow = window as Window & { __speakOReaderMounted?: boolean };

class CssHighlightRegistry implements HighlightRegistry {
  set(name: string, ranges: Range[]): void {
    const highlight = new Highlight(...ranges);
    highlight.priority = name === "speak-o-word" ? 2 : 1;
    CSS.highlights.set(name, highlight);
  }

  delete(name: string): void {
    CSS.highlights.delete(name);
  }
}

interface ReaderRuntime {
  root: Root;
  host: HTMLElement;
  state: ReaderViewState;
  article: ArticleSnapshot | null;
  mappings: SourceMapping[];
  highlighter: SourceHighlighter | null;
  sourcePageUrl: SourcePageUrlTracker;
  followSuspended: boolean;
  snapshot: ReadingSessionSnapshot | null;
  debug: RuntimeDebugBuffer;
  lastDebugWordSentence: number;
  sourceMappingInvalid: boolean;
  sourceChangeNotification: string | null;
}

function installPageHighlightStyles(): void {
  if (document.getElementById(PAGE_HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PAGE_HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(speak-o-sentence) {
      background-color: oklch(0.84 0.08 94 / 0.46);
    }
    ::highlight(speak-o-word) {
      background-color: oklch(0.64 0.17 83 / 0.88);
      text-decoration: underline 2px;
      text-underline-offset: 0.16em;
    }
    @media (prefers-color-scheme: dark) {
      ::highlight(speak-o-sentence) { background-color: oklch(0.52 0.08 88 / 0.46); }
      ::highlight(speak-o-word) { background-color: oklch(0.7 0.15 84 / 0.82); }
    }
    @media (forced-colors: active) {
      ::highlight(speak-o-sentence) { background-color: Highlight; }
      ::highlight(speak-o-word) { text-decoration: underline 3px; }
    }
  `;
  document.documentElement.append(style);
}

function mountRuntime(): ReaderRuntime | null {
  if (isolatedWindow.__speakOReaderMounted) return null;
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  applyInterfaceDirection(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = readerCss;
  const container = document.createElement("div");
  shadow.append(style, container);
  document.documentElement.append(host);
  isolatedWindow.__speakOReaderMounted = true;
  installPageHighlightStyles();
  const runtime: ReaderRuntime = {
    root: createRoot(container),
    host,
    state: { kind: "finding" },
    article: null,
    mappings: [],
    highlighter: null,
    sourcePageUrl: new SourcePageUrlTracker(location.href),
    followSuspended: false,
    snapshot: null,
    debug: new RuntimeDebugBuffer(),
    lastDebugWordSentence: -1,
    sourceMappingInvalid: false,
    sourceChangeNotification: null,
  };
  return runtime;
}

export default defineUnlistedScript(() => {
  const runtime = mountRuntime();

  if (runtime) {
    const send = async (message: Record<string, unknown>) => {
      const messageType = String(message.type ?? "unknown");
      let invalidated = false;
      appendDebug("content", "message.send", { messageType });
      try {
        const result = await sendRuntimeMessageSafely(
          (runtimeMessage) => chrome.runtime.sendMessage(runtimeMessage),
          {
            version: 1,
            target: "background",
            ...message,
          },
          (error) => {
            invalidated = true;
            appendDebug("content", "message.context-invalidated", {
              messageType,
              error: summarizeDebugError(error),
            });
          },
        );
        if (!invalidated) {
          appendDebug("content", "message.send.settled", { messageType });
        }
        return result;
      } catch (error) {
        appendDebug("content", "message.send.error", {
          messageType,
          error: summarizeDebugError(error),
        });
        return undefined;
      }
    };

    const remove = () => {
      runtime.highlighter?.clear();
      runtime.sourcePageUrl.synchronize(location.href);
      runtime.snapshot = null;
      runtime.article = null;
      runtime.mappings = [];
      runtime.highlighter = null;
      runtime.sourceMappingInvalid = false;
      runtime.sourceChangeNotification = null;
      runtime.host.style.display = "none";
    };

    const render = () => {
      runtime.root.render(
        <ReaderApp
          state={runtime.state}
          debugLog={runtime.debug.format()}
          onStartSetup={() => {
            if (!runtime.article) return;
            appendDebug("content", "ui.onboarding.start", {});
            void send({
              type: "onboarding.start",
              narrationLanguage: runtime.article.narrationLanguage,
            });
          }}
          onCommand={(command, value) => {
            const snapshot = runtime.snapshot;
            appendDebug("content", "ui.command", {
              command,
              value: typeof value === "number" ? value : undefined,
              status: snapshot?.status,
              sentenceIndex: snapshot?.currentSentenceIndex,
            });
            if (command === "close" && !snapshot) {
              remove();
              return;
            }
            if (!snapshot) return;
            if (
              command === "previous" ||
              command === "next" ||
              command === "seek"
            ) {
              runtime.followSuspended = false;
            }
            const payload: Record<string, unknown> = {
              type: "session.command",
              sessionId: snapshot.id,
              generationEpoch: snapshot.generationEpoch,
              command,
            };
            if (typeof value === "number") payload.value = value;
            if (command === "close") {
              void send(payload).finally(remove);
              return;
            }
            void send(payload);
          }}
          onOpenSettings={() => {
            appendDebug("content", "ui.settings.open", {});
            const snapshot = runtime.snapshot;
            if (!snapshot) return;
            void send({
              type: "settings.open",
              sessionId: snapshot.id,
              generationEpoch: snapshot.generationEpoch,
            });
          }}
        />,
      );
    };

    const appendDebug = (
      scope: RuntimeDebugScope,
      event: string,
      data: Record<string, string | number | boolean | null | undefined>,
    ) => {
      runtime.debug.record(scope, event, data);
      render();
    };

    const showExtractionRefusal = (
      result: Extract<ExtractionResult, { ok: false }>,
    ) => {
      const copy: Record<
        typeof result.reason,
        { title: string; message: string }
      > = {
        NO_SELECTION_OR_ARTICLE: {
          title: message("extractionNoArticleTitle"),
          message: message("extractionNoArticleMessage"),
        },
        UNSUPPORTED_X_PAGE: {
          title: message("extractionXSelectionTitle"),
          message: message("extractionXSelectionMessage"),
        },
        MAPPING_INCOMPLETE: {
          title: message("extractionMappingTitle"),
          message: message("extractionMappingMessage"),
        },
        ARTICLE_TOO_LARGE: {
          title: message("extractionLargeTitle"),
          message: message("extractionLargeMessage"),
        },
      };
      runtime.state = { kind: "error", ...copy[result.reason] };
      render();
    };

    const extract = () => {
      runtime.sourcePageUrl.synchronize(location.href);
      if (!runtime.host.isConnected)
        document.documentElement.append(runtime.host);
      installPageHighlightStyles();
      runtime.host.style.display = "block";
      runtime.state = { kind: "finding" };
      appendDebug("content", "extract.start", {
        hasSelection: !window.getSelection()?.isCollapsed,
      });
      let result: ExtractionResult;
      try {
        result = extractSourcePage({
          document,
          selection: window.getSelection(),
          sourceUrl: location.href,
          chromeLanguage: chrome.i18n.getUILanguage(),
        });
      } catch (error) {
        runtime.state = {
          kind: "error",
          title: message("extractionErrorTitle"),
          message: message("extractionErrorMessage"),
        };
        appendDebug("content", "extract.error", {
          error: summarizeDebugError(error),
        });
        return;
      }
      if (!result.ok) {
        appendDebug("content", "extract.refused", { reason: result.reason });
        showExtractionRefusal(result);
        void send({ type: "extraction.refused", reason: result.reason });
        return;
      }
      runtime.article = result.snapshot;
      runtime.mappings = result.mappings;
      runtime.highlighter = new SourceHighlighter(
        new CssHighlightRegistry(),
        result.mappings,
      );
      runtime.sourceMappingInvalid = false;
      runtime.sourceChangeNotification = null;
      appendDebug("content", "extract.complete", {
        extractor: result.snapshot.extractor,
        blockCount: result.snapshot.blocks.length,
        sentenceCount: result.snapshot.sentences.length,
        mappingCount: result.mappings.length,
      });
      void send({ type: "extraction.result", article: result.snapshot });
    };

    const maybeFollow = (mappingIds: string[]) => {
      if (runtime.followSuspended || !runtime.snapshot?.followEnabled) return;
      const mapping = runtime.mappings.find((candidate) =>
        mappingIds.includes(candidate.id),
      );
      if (!mapping) return;
      const rect = mapping.range.getBoundingClientRect();
      const comfortableTop = window.innerHeight * 0.2;
      const comfortableBottom = window.innerHeight * 0.74;
      if (rect.top >= comfortableTop && rect.bottom <= comfortableBottom)
        return;
      const target = mapping.range.commonAncestorContainer.parentElement;
      target?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    };

    const signalSourceChange = () => {
      const snapshot = runtime.snapshot;
      if (!snapshot || !runtime.sourceMappingInvalid) return;
      const notification = `${snapshot.id}:${snapshot.generationEpoch}`;
      if (runtime.sourceChangeNotification === notification) return;
      runtime.sourceChangeNotification = notification;
      void send({
        type: "source.changed",
        sessionId: snapshot.id,
        generationEpoch: snapshot.generationEpoch,
      });
    };

    const invalidateSourceMappings = () => {
      if (!runtime.sourceMappingInvalid) {
        runtime.sourceMappingInvalid = true;
        runtime.highlighter?.clear();
        appendDebug("content", "source.mapping-invalidated", {
          mappingCount: runtime.mappings.length,
        });
      }
      signalSourceChange();
    };

    chrome.runtime.onMessage.addListener((message, sender) => {
      if (
        sender.id !== chrome.runtime.id ||
        !isExtensionMessage(message) ||
        message.target !== "content"
      ) {
        return;
      }
      if (
        message.type === "content.debug.snapshot" &&
        Array.isArray(message.entries)
      ) {
        runtime.debug.ingest(message.entries);
        render();
        return;
      }
      if (
        message.type === "content.debug" &&
        isRuntimeDebugEntry(message.entry)
      ) {
        runtime.debug.ingest([message.entry]);
        render();
        return;
      }
      if (message.type === "extract.request") {
        appendDebug("content", "extract.request.received", {});
        extract();
      } else if (message.type === "session.reconcile.request") {
        appendDebug("content", "session.reconcile.requested", {
          sentenceIndex: Number(message.currentSentenceIndex),
        });
        const snapshot = runtime.snapshot;
        const article = runtime.article;
        const sentenceIndex = message.currentSentenceIndex;
        const matchesActiveView =
          snapshot !== null &&
          article !== null &&
          snapshot.id === message.sessionId &&
          snapshot.generationEpoch === message.generationEpoch &&
          Number.isSafeInteger(sentenceIndex) &&
          sentenceIndex === snapshot.currentSentenceIndex;
        const sentence = matchesActiveView
          ? article.sentences[sentenceIndex as number]
          : undefined;
        if (
          !matchesActiveView ||
          !sentence ||
          !runtime.highlighter?.validate(sentence.mappingIds)
        ) {
          appendDebug("content", "session.reconcile.rejected", {});
          void send({
            type: "session.reconcile.failed",
            sessionId: message.sessionId,
          });
          return;
        }
        appendDebug("content", "session.reconcile.accepted", {
          sentenceIndex: snapshot.currentSentenceIndex,
        });
        void send({
          type: "session.reconcile",
          sessionId: snapshot.id,
          generationEpoch: snapshot.generationEpoch,
          article,
        });
      } else if (message.type === "onboarding.show") {
        const firstRun = message.firstRun !== false;
        appendDebug("content", "onboarding.show", { firstRun });
        runtime.state = { kind: "onboarding", firstRun };
        render();
      } else if (
        message.type === "onboarding.resume" &&
        runtime.article &&
        isSpeechProviderId(message.provider)
      ) {
        void send({
          type: "activation.start",
          article: runtime.article,
          provider: message.provider,
        });
      } else if (
        message.type === "content.render" &&
        isRecord(message.snapshot)
      ) {
        const snapshot = message.snapshot as unknown as ReadingSessionSnapshot;
        appendDebug("content", "session.render", {
          mode: snapshot.mode,
          status: snapshot.status,
          sentenceIndex: snapshot.currentSentenceIndex,
          generationEpoch: snapshot.generationEpoch,
          session: snapshot.id.slice(-8),
        });
        runtime.snapshot = snapshot;
        if (!snapshot.highlightsEnabled) runtime.highlighter?.clear();
        runtime.state = { kind: "session", snapshot };
        render();
        signalSourceChange();
      } else if (message.type === "content.highlight") {
        const sentenceIndex = message.sentenceIndex;
        if (!Number.isSafeInteger(sentenceIndex) || !runtime.article) return;
        if (!runtime.snapshot?.highlightsEnabled) {
          runtime.highlighter?.clear();
          return;
        }
        const sentence = runtime.article.sentences[sentenceIndex as number];
        if (!sentence) return;
        if (sentence.mappingIds.length === 0) {
          runtime.highlighter?.clear();
          return;
        }
        const word =
          isRecord(message.word) &&
          Number.isSafeInteger(message.word.startOffset) &&
          Number.isSafeInteger(message.word.endOffset)
            ? {
                startOffset:
                  sentence.startOffset + (message.word.startOffset as number),
                endOffset:
                  sentence.startOffset + (message.word.endOffset as number),
              }
            : undefined;
        if (word && runtime.lastDebugWordSentence !== sentenceIndex) {
          runtime.lastDebugWordSentence = sentenceIndex as number;
          appendDebug("content", "highlight.first-word", {
            sentenceIndex: sentenceIndex as number,
            startOffset: word.startOffset - sentence.startOffset,
            endOffset: word.endOffset - sentence.startOffset,
          });
        }
        const precision = runtime.highlighter?.show(sentence.mappingIds, word, {
          startOffset: sentence.startOffset,
          endOffset: sentence.endOffset,
        });
        if (precision === "none") {
          invalidateSourceMappings();
          return;
        }
        maybeFollow(sentence.mappingIds);
      } else if (message.type === "content.clear-highlights") {
        runtime.highlighter?.clear();
      } else if (message.type === "content.clear") {
        remove();
      }
    });

    const signalNavigation = () => {
      runtime.sourcePageUrl.synchronize(location.href);
      if (!runtime.snapshot) return;
      void send({
        type: "source.navigated",
        sessionId: runtime.snapshot.id,
        generationEpoch: runtime.snapshot.generationEpoch,
      });
    };
    addEventListener("pagehide", signalNavigation, { once: true });
    addEventListener("popstate", signalNavigation);
    addEventListener("hashchange", signalNavigation);
    addEventListener(
      "wheel",
      () => {
        runtime.followSuspended = true;
      },
      { passive: true },
    );
    addEventListener(
      "touchmove",
      () => {
        runtime.followSuspended = true;
      },
      { passive: true },
    );

    const observer = new MutationObserver((records) => {
      const hasSourceMutation = records.some(
        (record) =>
          record.target !== runtime.host &&
          !runtime.host.contains(record.target),
      );
      if (
        hasSourceMutation &&
        !runtime.sourceMappingInvalid &&
        runtime.article &&
        runtime.highlighter &&
        !runtime.highlighter.validateAll()
      ) {
        invalidateSourceMappings();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.setInterval(() => {
      if (
        runtime.sourcePageUrl.observe(location.href, runtime.snapshot !== null)
      ) {
        signalNavigation();
      }
    }, 1_000);

    runtime.debug.record("content", "reader.mounted", {
      extensionVersion: chrome.runtime.getManifest().version,
    });
    render();
  }
});

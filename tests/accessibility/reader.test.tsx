import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type {
  ReadingSessionSnapshot,
  ReadingSessionStatus,
} from "../../src/session/types";
import { ReaderApp, type ReaderViewState } from "../../src/ui/ReaderApp";

function snapshot(status: ReadingSessionStatus): ReadingSessionSnapshot {
  return {
    version: 1,
    id: "accessibility-session",
    generationEpoch: 1,
    sourceTabId: 1,
    sourceFrameId: 0,
    title: "An accessible Article",
    status,
    mode:
      status === "provider-issue" || status === "usage-limit"
        ? "cloud"
        : "browser",
    provider:
      status === "provider-issue" || status === "usage-limit"
        ? "elevenlabs"
        : "browser",
    currentSentenceIndex: 1,
    currentMediaTimeMs: 0,
    sentenceCount: 4,
    progressPercent: 25,
    estimatedRemainingSeconds: 180,
    playbackSpeed: 1,
    theme: "system",
    narrationLanguage: "en-US",
    voiceId: null,
    modelId: "eleven_multilingual_v2",
    highlightsEnabled: true,
    followEnabled: true,
    dock: "bottom",
    minimized: false,
    expanded: false,
    submittedCharacters: 120,
    usageGuardCharacters: 25_000,
    notice:
      status === "page-changed"
        ? "sessionNoticeSourceChanged"
        : status === "provider-issue"
          ? "sessionNoticeRetryMayDuplicate"
          : status === "usage-limit"
            ? "sessionNoticeUsageGuard"
            : null,
    errorCode: status === "provider-issue" ? "PROVIDER_UNAVAILABLE" : null,
    retryRequiresConfirmation: status === "provider-issue",
  };
}

async function expectNoViolations(state: ReaderViewState): Promise<void> {
  const view = render(
    <ReaderApp
      state={state}
      onChooseProvider={vi.fn()}
      onCommand={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect((await axe.run(view.container)).violations).toEqual([]);
  cleanup();
}

describe("floating Reader accessibility", () => {
  it("uses localized accessibility names and bidi direction", () => {
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: vi.fn((key: string) => {
          if (key === "@@bidi_dir") return "rtl";
          if (key === "readerLabel") return "Localized Article Reader";
          return "";
        }),
      },
    });
    render(
      <ReaderApp
        state={{ kind: "finding" }}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Localized Article Reader")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  it("has no automated violations in its important visible states", async () => {
    await expectNoViolations({ kind: "finding" });
    await expectNoViolations({
      kind: "onboarding",
      connections: { elevenlabs: false, speechify: false },
    });
    await expectNoViolations({
      kind: "error",
      title: "No readable Article found",
      message: "Select prose and try again.",
    });
    for (const status of [
      "ready",
      "preparing",
      "playing",
      "paused",
      "buffering",
      "usage-limit",
      "provider-issue",
      "page-changed",
      "completed",
    ] as const) {
      await expectNoViolations({
        kind: "session",
        snapshot: snapshot(status),
      });
    }
  }, 20_000);

  it("keeps essential controls named when minimized and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("playing") }}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Minimize controls" }));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    expect(screen.getByLabelText("25 percent read")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Maximize controls" }));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
  });

  it("localizes typed runtime notices at the presentation boundary", () => {
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: vi.fn((key: string) =>
          key === "sessionNoticePaused" ? "Localized pause notice" : "",
        ),
      },
    });
    render(
      <ReaderApp
        state={{
          kind: "session",
          snapshot: {
            ...snapshot("paused"),
            notice: "sessionNoticePaused",
          },
        }}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("Localized pause notice")).toBeVisible();
  });

  it("does not double-handle native button keys or intercept editable controls", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("paused") }}
        onChooseProvider={vi.fn()}
        onCommand={onCommand}
        onOpenSettings={vi.fn()}
      />,
    );

    const play = screen.getByRole("button", { name: "Play" });
    play.focus();
    await user.keyboard(" ");
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenLastCalledWith("toggle", undefined);

    onCommand.mockClear();
    const speed = screen.getByRole("combobox", { name: "Playback Speed" });
    speed.focus();
    await user.keyboard(" ");
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("offers sentence, speed, and transport shortcuts from the focused Reader surface", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("paused") }}
        onChooseProvider={vi.fn()}
        onCommand={onCommand}
        onOpenSettings={vi.fn()}
      />,
    );

    const reader = screen.getByLabelText("Speak-O Article Reader");
    reader.focus();
    expect(reader).toHaveFocus();

    await user.keyboard("[ArrowLeft][ArrowRight][ArrowUp][ArrowDown] ");
    expect(onCommand.mock.calls).toEqual([
      ["previous", undefined],
      ["next", undefined],
      ["set-playback-speed", 1.25],
      ["set-playback-speed", 0.75],
      ["toggle", undefined],
    ]);

    await user.click(screen.getByRole("button", { name: "More details" }));
    expect(screen.getByText("Now reading")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Now reading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More details" })).toHaveFocus();

    onCommand.mockClear();
    await user.keyboard("[ArrowLeft]");
    expect(onCommand).toHaveBeenCalledWith("previous", undefined);
  });

  it("opens the details row above the main controls", async () => {
    const user = userEvent.setup();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("paused") }}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More details" }));
    const detail = screen.getByText("Now reading");
    const controls = screen.getByLabelText("Reading controls");
    expect(
      detail.compareDocumentPosition(controls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("presents Reading Position as a noninteractive progress indicator", () => {
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("playing") }}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("progressbar", { name: "Reading progress" }),
    ).toHaveAttribute("aria-valuetext", "25 percent");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("shows and copies the debug trace while Article discovery is stuck", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <ReaderApp
        state={{ kind: "finding" }}
        debugLog={"Speak-O DEBUG_MODE=true\n[content] extract.start"}
        onChooseProvider={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(
      (screen.getByLabelText("Speak-O debug log") as HTMLTextAreaElement).value,
    ).toContain("extract.start");
    await user.click(screen.getByRole("button", { name: "Copy debug log" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("extract.start"),
    );
  });
});

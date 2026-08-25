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
        ? "The Source Page changed."
        : status === "provider-issue"
          ? "The Speech Provider needs attention."
          : status === "usage-limit"
            ? "Provider Usage guard reached."
            : null,
    errorCode: status === "provider-issue" ? "PROVIDER_UNAVAILABLE" : null,
    retryRequiresConfirmation: status === "provider-issue",
  };
}

async function expectNoViolations(state: ReaderViewState): Promise<void> {
  const view = render(
    <ReaderApp
      state={state}
      onChooseMode={vi.fn()}
      onCommand={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect((await axe.run(view.container)).violations).toEqual([]);
  cleanup();
}

describe("floating Reader accessibility", () => {
  it("has no automated violations in its important visible states", async () => {
    await expectNoViolations({ kind: "finding" });
    await expectNoViolations({
      kind: "onboarding",
      providerConnected: false,
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
        onChooseMode={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Minimize controls" }));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    expect(screen.getByLabelText("25 percent read")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Maximize controls" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("does not double-handle native button keys or intercept editable controls", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("paused") }}
        onChooseMode={vi.fn()}
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

  it("opens the details row above the main controls", async () => {
    const user = userEvent.setup();
    render(
      <ReaderApp
        state={{ kind: "session", snapshot: snapshot("paused") }}
        onChooseMode={vi.fn()}
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
        onChooseMode={vi.fn()}
        onCommand={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("progressbar", { name: "Reading progress" }),
    ).toHaveAttribute("aria-valuetext", "25 percent");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

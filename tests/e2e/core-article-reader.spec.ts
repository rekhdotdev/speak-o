import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from "@playwright/test";

const extensionPath = resolve(".output/chrome-mv3");
const articleUrl = "http://127.0.0.1:41739/article.html";

const sessionSnapshot = {
  version: 1,
  id: "e2e-reading-session",
  generationEpoch: 1,
  sourceTabId: 1,
  sourceFrameId: 0,
  title: "A calm synthetic Article",
  status: "playing",
  mode: "browser",
  provider: "browser",
  currentSentenceIndex: 0,
  currentMediaTimeMs: 0,
  sentenceCount: 8,
  progressPercent: 24,
  estimatedRemainingSeconds: 152,
  playbackSpeed: 1,
  theme: "light",
  narrationLanguage: "en",
  voiceId: null,
  modelId: "eleven_multilingual_v2",
  highlightsEnabled: true,
  followEnabled: true,
  dock: "bottom",
  minimized: false,
  expanded: false,
  submittedCharacters: 0,
  usageGuardCharacters: 25_000,
  notice: null,
  errorCode: null,
  retryRequiresConfirmation: false,
} as const;

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  return existing ?? context.waitForEvent("serviceworker");
}

async function sendToContent(
  worker: Worker,
  message: Record<string, unknown>,
): Promise<void> {
  await worker.evaluate(async (runtimeMessage) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) throw new Error("No active Article tab");
    await chrome.tabs.sendMessage(tab.id, runtimeMessage, { frameId: 0 });
  }, message);
}

async function injectAndRequestExtraction(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) throw new Error("No active Article tab");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ["reader.js"],
    });
    await chrome.tabs.sendMessage(
      tab.id,
      { version: 1, target: "content", type: "extract.request" },
      { frameId: 0 },
    );
  });
}

async function installDeterministicBrowserVoice(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const tts = chrome.tts as unknown as Record<string, unknown>;
    tts.getVoices = async () => [];
    tts.speak = async (...args: unknown[]) => {
      const options = args[1] as
        { onEvent?: (event: Record<string, unknown>) => void } | undefined;
      options?.onEvent?.({ type: "start" });
    };
    tts.pause = () => undefined;
    tts.resume = () => undefined;
    tts.stop = () => undefined;
  });
}

function prepareTestExtension(testInfo: TestInfo): string {
  const testExtensionPath = testInfo.outputPath("extension");
  cpSync(extensionPath, testExtensionPath, { recursive: true });
  const manifestPath = resolve(testExtensionPath, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    host_permissions?: string[];
  };
  manifest.host_permissions = [
    ...(manifest.host_permissions ?? []),
    "http://127.0.0.1:41739/*",
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  return testExtensionPath;
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    animations: "disabled",
  });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("unpacked extension activates and renders deterministic core states", async ({}, testInfo) => {
  expect(
    existsSync(resolve(extensionPath, "manifest.json")),
    "Run npm run build before the unpacked-extension test.",
  ).toBe(true);

  const testExtensionPath = prepareTestExtension(testInfo);

  const context = await chromium.launchPersistentContext(
    testInfo.outputPath("chromium-profile"),
    {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
      args: [
        `--disable-extensions-except=${testExtensionPath}`,
        `--load-extension=${testExtensionPath}`,
        "--mute-audio",
      ],
    },
  );

  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    expect(extensionId).not.toHaveLength(0);

    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    await page.goto(articleUrl);
    await page.locator("article").click();

    await test.step("the extension extraction command extracts the Article and opens onboarding", async () => {
      // Headless Chromium does not route Playwright's synthetic keyboard
      // events through chrome.commands. Exercise the same injection and
      // extraction path used by the command handler instead.
      await injectAndRequestExtraction(worker);
      const onboarding = page.getByRole("region", {
        name: "Set up Speak-O",
      });
      await expect(onboarding).toBeVisible();
      await expect(
        onboarding.getByRole("button", {
          name: "Continue with Chrome Voice",
        }),
      ).toBeVisible();
      await expect(page.getByText("DEBUG_MODE is on")).toHaveCount(0);
      await capture(page, testInfo, "01-onboarding");
    });

    await test.step("choosing Chrome Voice creates the real Browser Voice Reading Session", async () => {
      await installDeterministicBrowserVoice(worker);
      await page
        .getByRole("button", { name: "Continue with Chrome Voice" })
        .click();
      const reader = page.getByRole("region", {
        name: "Speak-O Article Reader",
      });
      await expect(reader.getByText("Chrome Voice")).toBeVisible();
      await expect
        .poll(() =>
          worker.evaluate(async () => {
            const stored = await chrome.storage.session.get(
              "activeSessionDescriptor",
            );
            const descriptor = stored.activeSessionDescriptor;
            return typeof descriptor === "object" && descriptor !== null
              ? (descriptor as { mode?: unknown }).mode
              : null;
          }),
        )
        .toBe("browser");
    });

    await test.step("production session messages render the read-only progress UI", async () => {
      await sendToContent(worker, {
        version: 1,
        target: "content",
        type: "content.render",
        snapshot: sessionSnapshot,
      });

      const reader = page.getByRole("region", {
        name: "Speak-O Article Reader",
      });
      await expect(reader).toBeVisible();
      await expect(reader.getByRole("button", { name: "Pause" })).toBeVisible();
      const progress = reader.getByRole("progressbar", {
        name: "Reading progress",
      });
      await expect(progress).toHaveAttribute("value", "24");
      await expect(progress).toHaveAttribute("max", "100");
      await expect(progress).toHaveJSProperty("tagName", "PROGRESS");
      await capture(page, testInfo, "02-session-bottom-light");
    });

    await test.step("details, minimize, and restore use the real UI controls", async () => {
      const reader = page.getByRole("region", {
        name: "Speak-O Article Reader",
      });
      await reader.getByRole("button", { name: "More details" }).click();
      await expect(reader.getByText("Now reading")).toBeVisible();
      await capture(page, testInfo, "03-session-expanded");

      await reader.getByRole("button", { name: "Minimize controls" }).click();
      const compact = page.getByRole("region", {
        name: "Speak-O minimized Article Reader",
      });
      await expect(compact).toBeVisible();
      await expect(
        compact.getByRole("button", { name: "Pause" }),
      ).toBeFocused();
      await expect(compact.getByRole("button", { name: "Pause" })).toHaveCSS(
        "outline-style",
        "solid",
      );
      await capture(page, testInfo, "04-session-minimized");

      await page.keyboard.press("Tab");
      const maximize = compact.getByRole("button", {
        name: "Maximize controls",
      });
      await expect(maximize).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(reader).toBeVisible();
      const restoredPause = reader.getByRole("button", { name: "Pause" });
      await expect(restoredPause).toBeFocused();
      await expect(restoredPause).toHaveCSS("outline-style", "solid");
    });

    await test.step("top-docked dark controls and nested word highlighting are captured", async () => {
      await sendToContent(worker, {
        version: 1,
        target: "content",
        type: "content.render",
        snapshot: {
          ...sessionSnapshot,
          status: "paused",
          currentSentenceIndex: 0,
          progressPercent: 55,
          theme: "dark",
          dock: "top",
        },
      });
      await sendToContent(worker, {
        version: 1,
        target: "content",
        type: "content.highlight",
        sentenceIndex: 0,
        word: { startOffset: 2, endOffset: 6 },
      });

      const reader = page.getByRole("region", {
        name: "Speak-O Article Reader",
      });
      await expect(reader.getByRole("button", { name: "Play" })).toBeVisible();
      await expect(reader).toHaveAttribute("data-theme", "dark");
      const highlights = await page.evaluate(() => {
        const textFor = (name: string) => {
          const highlight = CSS.highlights.get(name);
          return highlight
            ? Array.from(highlight).map((range) => range.toString())
            : [];
        };
        return {
          sentence: textFor("speak-o-sentence"),
          word: textFor("speak-o-word"),
        };
      });
      expect(highlights.sentence).toContain("A calm synthetic Article");
      expect(highlights.word).toEqual(["calm"]);
      await capture(page, testInfo, "05-top-dark-word-highlight");
    });
  } finally {
    await context.close();
  }
});

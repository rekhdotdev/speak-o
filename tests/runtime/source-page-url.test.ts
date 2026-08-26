import { SourcePageUrlTracker } from "../../src/runtime/source-page-url";

describe("Source Page URL lifecycle", () => {
  it("does not attribute an idle SPA navigation to a later Reading Session", () => {
    const tracker = new SourcePageUrlTracker("https://example.test/article-a");

    expect(tracker.observe("https://example.test/article-b", false)).toBe(
      false,
    );
    expect(tracker.observe("https://example.test/article-b", true)).toBe(false);
  });

  it("rebases a later extraction before the idle navigation poll runs", () => {
    const tracker = new SourcePageUrlTracker("https://example.test/article-a");

    tracker.synchronize("https://example.test/article-b");

    expect(tracker.observe("https://example.test/article-b", true)).toBe(false);
  });

  it("detects navigation while a Reading Session is active", () => {
    const tracker = new SourcePageUrlTracker("https://example.test/article-a");

    expect(tracker.observe("https://example.test/article-b", true)).toBe(true);
    expect(tracker.observe("https://example.test/article-b", true)).toBe(false);
  });
});

import { extractSourcePage } from "../../src/extraction/extract-source-page";
import {
  SourceHighlighter,
  type HighlightRegistry,
} from "../../src/highlighting/source-highlighter";

class MemoryHighlightRegistry implements HighlightRegistry {
  readonly highlights = new Map<string, Range[]>();

  set(name: string, ranges: Range[]): void {
    this.highlights.set(name, ranges);
  }

  delete(name: string): void {
    this.highlights.delete(name);
  }
}

describe("SourceHighlighter", () => {
  it("uses exact CSS Highlight ranges and degrades invalid word alignment to sentence highlighting", () => {
    document.body.innerHTML = `<article><p id="source">Read emoji 👩🏽‍💻 safely.</p></article>`;
    const text = document.querySelector("#source")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Fixture text is missing");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const extraction = extractSourcePage({ document, selection });
    if (!extraction.ok) throw new Error("Selection extraction failed");

    const registry = new MemoryHighlightRegistry();
    const highlighter = new SourceHighlighter(registry, extraction.mappings);
    const mappingIds = extraction.snapshot.sentences[0]?.mappingIds ?? [];

    expect(
      highlighter.show(mappingIds, { startOffset: 5, endOffset: 18 }),
    ).toBe("word");
    expect(registry.highlights.get("speak-o-sentence")?.[0]?.toString()).toBe(
      "Read emoji 👩🏽‍💻 safely.",
    );
    expect(registry.highlights.get("speak-o-word")?.[0]?.toString()).toBe(
      "emoji 👩🏽‍💻",
    );
    expect(document.querySelectorAll("speak-o-highlight")).toHaveLength(0);

    expect(
      highlighter.show(mappingIds, { startOffset: 6, endOffset: 999 }),
    ).toBe("sentence");
    expect(registry.highlights.has("speak-o-word")).toBe(false);

    text.data = "The Source Page changed.";
    expect(highlighter.validate(mappingIds)).toBe(false);
  });

  it("clips sentence highlighting to its exact block offsets", () => {
    document.body.innerHTML = `<article><p id="source">First. Second sentence.</p></article>`;
    const text = document.querySelector("#source")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Fixture text is missing");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const extraction = extractSourcePage({ document, selection });
    if (!extraction.ok) throw new Error("Selection extraction failed");

    const sentence = extraction.snapshot.sentences[1];
    if (!sentence) throw new Error("Second sentence is missing");
    const registry = new MemoryHighlightRegistry();
    const highlighter = new SourceHighlighter(registry, extraction.mappings);

    expect(
      highlighter.show(sentence.mappingIds, undefined, {
        startOffset: sentence.startOffset,
        endOffset: sentence.endOffset,
      }),
    ).toBe("sentence");
    expect(registry.highlights.get("speak-o-sentence")?.[0]?.toString()).toBe(
      "Second sentence.",
    );
  });

  it("invalidates the Article Snapshot when a future mapped sentence changes", () => {
    document.body.innerHTML = `<article>
      <p id="current">Current sentence.</p>
      <p id="future">Future sentence.</p>
    </article>`;
    const currentText = document.querySelector("#current")?.firstChild;
    const futureText = document.querySelector("#future")?.firstChild;
    if (!(currentText instanceof Text) || !(futureText instanceof Text)) {
      throw new Error("Fixture text is missing");
    }
    const currentRange = document.createRange();
    currentRange.selectNodeContents(currentText);
    const futureRange = document.createRange();
    futureRange.selectNodeContents(futureText);
    const registry = new MemoryHighlightRegistry();
    const highlighter = new SourceHighlighter(registry, [
      {
        id: "current",
        blockIndex: 0,
        range: currentRange,
        sourceText: "Current sentence.",
        utteranceStart: 0,
        utteranceEnd: 17,
      },
      {
        id: "future",
        blockIndex: 1,
        range: futureRange,
        sourceText: "Future sentence.",
        utteranceStart: 18,
        utteranceEnd: 34,
      },
    ]);

    expect(highlighter.validateAll()).toBe(true);
    futureText.data = "Changed future sentence.";
    expect(highlighter.validate(["current"])).toBe(true);
    expect(highlighter.validateAll()).toBe(false);
  });
});

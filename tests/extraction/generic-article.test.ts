import genericArticleFixture from "../fixtures/generic-article.html?raw";
import { extractSourcePage } from "../../src/extraction/extract-source-page";

describe("generic Extractor contract", () => {
  it("uses Readability on a clone and returns only strictly mapped semantic Article blocks", () => {
    document.open();
    document.write(genericArticleFixture);
    document.close();

    const result = extractSourcePage({
      document,
      sourceUrl: "https://publication.example/articles/calm",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.extractor).toBe("generic");
    expect(result.snapshot.title).toBe("A calm synthetic publication");
    expect(result.snapshot.author).toBe("By Rowan Example");
    expect(result.snapshot.narrationLanguage).toBe("en-GB");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "title",
      "author",
      "paragraph",
      "heading",
      "paragraph",
      "list-item",
      "list-item",
      "blockquote",
      "cue",
      "cue",
    ]);
    expect(result.snapshot.blocks.at(-2)?.text).toBe("Code block omitted.");
    expect(result.snapshot.blocks.at(-1)?.text).toBe("Table omitted.");
    const narration = result.snapshot.blocks
      .map((block) => block.text)
      .join(" ");
    expect(narration).toContain("visible link text");
    expect(narration).toContain("const meaning = true");
    expect(narration).not.toContain("Sign in");
    expect(narration).not.toContain("hidden sentence");
    expect(narration).not.toContain("reader comment");
    expect(
      result.mappings.every(
        (mapping) => mapping.range.toString() === mapping.sourceText,
      ),
    ).toBe(true);
  });

  it("rejects a page without a coherent long-form Article", () => {
    document.body.innerHTML = `<main><button>Like</button><p>Short status.</p></main>`;

    expect(
      extractSourcePage({
        document,
        sourceUrl: "https://example.test/status",
      }),
    ).toEqual({
      ok: false,
      reason: "NO_SELECTION_OR_ARTICLE",
      extractor: "generic",
    });
  });
});

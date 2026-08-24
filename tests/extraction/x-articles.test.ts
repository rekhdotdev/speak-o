import xArticleFixture from "../fixtures/x-article.html?raw";
import xArticleDraftFixture from "../fixtures/x-article-draft.html?raw";
import xArticlePublicFixture from "../fixtures/x-article-public.html?raw";
import { extractSourcePage } from "../../src/extraction/extract-source-page";

describe("X Articles Site Adapter contract", () => {
  it("extracts synthetic X Article structure and excludes engagement content", () => {
    document.open();
    document.write(xArticleFixture);
    document.close();

    const result = extractSourcePage({
      document,
      sourceUrl: "https://x.com/example/status/123/articles/456",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.extractor).toBe("x-articles");
    expect(result.snapshot.title).toBe("A synthetic long-form title");
    expect(result.snapshot.author).toBe("Ada Example");
    expect(
      result.snapshot.blocks.map(({ kind, text }) => ({ kind, text })),
    ).toEqual([
      { kind: "title", text: "A synthetic long-form title" },
      { kind: "author", text: "Ada Example" },
      {
        kind: "paragraph",
        text: "The opening paragraph explains the useful idea clearly.",
      },
      { kind: "heading", text: "A mapped section" },
      {
        kind: "paragraph",
        text: "Visible link text stays in the narration.",
      },
      {
        kind: "blockquote",
        text: "A concise quotation remains part of the Article.",
      },
    ]);
    expect(
      result.snapshot.blocks.some((block) => block.text.includes("replies")),
    ).toBe(false);
    expect(
      result.mappings.every(
        (mapping) => mapping.range.toString() === mapping.sourceText,
      ),
    ).toBe(true);
  });

  it("refuses ordinary X posts without an explicit Selection", () => {
    document.body.innerHTML = `<main><article data-testid="tweet"><p>A regular post.</p></article></main>`;

    expect(
      extractSourcePage({
        document,
        sourceUrl: "https://x.com/example/status/123",
      }),
    ).toEqual({
      ok: false,
      reason: "UNSUPPORTED_X_PAGE",
      extractor: "x-articles",
    });
  });

  it("extracts current X Draft-style prose blocks instead of only semantic lists", () => {
    document.open();
    document.write(xArticleDraftFixture);
    document.close();

    const result = extractSourcePage({
      document,
      sourceUrl: "https://x.com/example/status/123/articles/456",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.title).toBe("A synthetic skills map");
    expect(
      result.snapshot.blocks.map(({ kind, text }) => ({ kind, text })),
    ).toEqual([
      { kind: "title", text: "A synthetic skills map" },
      { kind: "author", text: "Example Author" },
      {
        kind: "paragraph",
        text: "Modern systems combine several complementary techniques.",
      },
      {
        kind: "heading",
        text: "Building and deploying reliable applications",
      },
      { kind: "list-item", text: "Model foundations" },
      { kind: "list-item", text: "Grounding with source data" },
      {
        kind: "paragraph",
        text: "Reliable systems require evaluation and careful operations.",
      },
    ]);
    expect(
      result.mappings.every(
        (mapping) => mapping.range.toString() === mapping.sourceText,
      ),
    ).toBe(true);
  });

  it("extracts the public semantic X Article layout without test IDs", () => {
    document.open();
    document.write(xArticlePublicFixture);
    document.close();

    const result = extractSourcePage({
      document,
      sourceUrl: "https://x.com/example/status/123/articles/456",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.title).toBe("A synthetic public article");
    expect(
      result.snapshot.blocks.map(({ kind, text }) => ({ kind, text })),
    ).toEqual([
      { kind: "title", text: "A synthetic public article" },
      {
        kind: "paragraph",
        text: "Modern systems combine several complementary techniques.",
      },
      {
        kind: "paragraph",
        text: "Reliable applications require several practical skills.",
      },
      { kind: "list-item", text: "Model foundations" },
      { kind: "list-item", text: "Grounding with source data" },
      {
        kind: "paragraph",
        text: "Evaluation remains essential for uncertain output.",
      },
    ]);
  });
});

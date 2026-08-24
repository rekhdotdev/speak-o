import { extractSourcePage } from "../../src/extraction/extract-source-page";

describe("Extractor Selection contract", () => {
  it("gives an explicit Selection authority and preserves its exact Source Page range", () => {
    document.documentElement.lang = "en-IN";
    document.body.innerHTML = `
      <article>
        <h1>Ignored Article</h1>
        <p id="prose">Alpha beta gamma.</p>
      </article>
    `;
    const text = document.querySelector("#prose")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Fixture text is missing");

    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 10);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = extractSourcePage({ document, selection });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot).toMatchObject({
      extractor: "selection",
      title: null,
      author: null,
      narrationLanguage: "en-IN",
      characterCount: 4,
      blocks: [{ kind: "paragraph", text: "beta" }],
      sentences: [{ text: "beta", blockIndex: 0 }],
    });
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.sourceText).toBe("beta");
    expect(result.mappings[0]?.range.toString()).toBe("beta");
  });

  it("splits a cross-element Selection into exact text-node mappings", () => {
    document.body.innerHTML = `<p id="prose">Alpha <em>beta</em> gamma. Next.</p>`;
    const prose = document.querySelector("#prose");
    if (!prose) throw new Error("Fixture prose is missing");
    const range = document.createRange();
    range.selectNodeContents(prose);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = extractSourcePage({ document, selection });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.blocks[0]?.text).toBe("Alpha beta gamma. Next.");
    expect(result.mappings.map((mapping) => mapping.sourceText).join("")).toBe(
      "Alpha beta gamma. Next.",
    );
    expect(
      result.mappings.every(
        (mapping) =>
          mapping.range.startContainer instanceof Text &&
          mapping.range.startContainer === mapping.range.endContainer,
      ),
    ).toBe(true);
  });

  it("refuses a pathologically large Selection before segmentation", () => {
    const text = document.createTextNode("a".repeat(500_001));
    document.body.replaceChildren(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(extractSourcePage({ document, selection })).toEqual({
      ok: false,
      reason: "ARTICLE_TOO_LARGE",
      extractor: "selection",
    });
  });
});

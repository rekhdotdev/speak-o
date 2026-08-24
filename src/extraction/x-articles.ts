import { mappedBlockFromElement } from "./dom-mapping";
import { segmentBlocks } from "./segmentation";
import type {
  ArticleSnapshot,
  ExtractionInput,
  ExtractionResult,
  NarratableBlock,
  NarratableBlockKind,
  SourceMapping,
} from "./types";

function isXPage(input: ExtractionInput): boolean {
  try {
    const hostname = new URL(input.sourceUrl ?? input.document.URL).hostname;
    return (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com"
    );
  } catch {
    return false;
  }
}

function kindFor(element: Element): NarratableBlockKind {
  const tag = element.tagName.toLowerCase();
  const testId = element.getAttribute("data-testid") ?? "";
  const className = element.getAttribute("class") ?? "";
  if (
    /^h[1-6]$/.test(tag) ||
    testId === "longform-header" ||
    /(?:^|\s)longform-header(?:-|\s|$)/.test(className)
  ) {
    return "heading";
  }
  if (
    tag === "li" ||
    /(?:^|\s)longform-(?:un)?ordered-list-item(?:\s|$)/.test(className)
  ) {
    return "list-item";
  }
  if (tag === "blockquote") return "blockquote";
  if (tag === "figcaption") return "caption";
  return "paragraph";
}

function addMappedElement(
  element: Element | null,
  kind: NarratableBlockKind,
  blocks: NarratableBlock[],
  mappings: SourceMapping[],
  mappingNumber: { value: number },
): void {
  if (!element) return;
  const mapped = mappedBlockFromElement(
    element,
    kind,
    blocks.length,
    mappingNumber,
  );
  if (!mapped) return;
  blocks.push(mapped.block);
  mappings.push(...mapped.mappings);
}

export function extractXArticle(
  input: ExtractionInput,
): ExtractionResult | null {
  if (!isXPage(input)) return null;

  const publicArticleBody = input.document.querySelector(
    "article .x-article-body > .contents, article .x-article-body .contents",
  );
  const richText =
    input.document.querySelector(
      "[data-testid='twitterArticleRichTextView'], [data-testid='longformRichTextComponent']",
    ) ?? publicArticleBody;
  const article =
    input.document.querySelector("[data-testid='twitterArticleReadView']") ??
    richText?.closest("article") ??
    null;
  if (!article || !richText) {
    return {
      ok: false,
      reason: "UNSUPPORTED_X_PAGE",
      extractor: "x-articles",
    };
  }
  if (article.querySelectorAll("*").length > 20_000) {
    return { ok: false, reason: "ARTICLE_TOO_LARGE", extractor: "x-articles" };
  }

  const titleElement = article.querySelector(
    "[data-testid='twitterArticleTitle'], [data-testid='twitter-article-title'], h1",
  );
  const authorElement = article.querySelector("[data-testid='User-Name']");
  const blocks: NarratableBlock[] = [];
  const mappings: SourceMapping[] = [];
  const mappingNumber = { value: 1 };

  addMappedElement(titleElement, "title", blocks, mappings, mappingNumber);
  addMappedElement(authorElement, "author", blocks, mappings, mappingNumber);
  const blockSelector = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "[data-testid='longform-header']",
    "[class~='longform-unstyled']",
    "[class~='public-DraftStyleDefault-block']",
    "[class~='longform-unordered-list-item']",
    "[class~='longform-ordered-list-item']",
    "[class*='longform-header-']",
  ].join(", ");
  const candidates = Array.from(richText.querySelectorAll(blockSelector));
  const duplicateContainers = new Set<Element>();
  for (const element of candidates) {
    const ancestor = element.parentElement?.closest(blockSelector);
    if (
      ancestor &&
      richText.contains(ancestor) &&
      ancestor.textContent?.trim() === element.textContent?.trim()
    ) {
      duplicateContainers.add(ancestor);
    }
  }
  candidates
    .filter(
      (element) =>
        element !== titleElement &&
        element !== authorElement &&
        !duplicateContainers.has(element),
    )
    .forEach((element) => {
      addMappedElement(
        element,
        kindFor(element),
        blocks,
        mappings,
        mappingNumber,
      );
    });

  const characterCount = blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  if (characterCount > 500_000 || blocks.length > 20_000) {
    return { ok: false, reason: "ARTICLE_TOO_LARGE", extractor: "x-articles" };
  }
  if (blocks.length < 3 || mappings.length === 0) {
    return { ok: false, reason: "MAPPING_INCOMPLETE", extractor: "x-articles" };
  }

  const narrationLanguage =
    article.closest("[lang]")?.getAttribute("lang")?.trim() ||
    input.document.documentElement.lang.trim() ||
    input.chromeLanguage?.trim() ||
    "en";
  const title = titleElement?.textContent?.trim() || null;
  const author = authorElement?.textContent?.trim() || null;
  const snapshot: ArticleSnapshot = {
    id: crypto.randomUUID(),
    extractor: "x-articles",
    title,
    author,
    narrationLanguage,
    characterCount,
    blocks,
    sentences: segmentBlocks(blocks, narrationLanguage),
  };

  return { ok: true, snapshot, mappings };
}

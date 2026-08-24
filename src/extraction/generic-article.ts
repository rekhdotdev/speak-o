import { Readability } from "@mozilla/readability";
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

const EXCLUDED_ANCESTORS = [
  "nav",
  "aside",
  "footer",
  "[hidden]",
  "[aria-hidden='true']",
  "[role='navigation']",
  "[role='complementary']",
  ".comments",
  ".comment",
  "[aria-label*='comment' i]",
  "[aria-label*='recommend' i]",
  "[aria-label*='advert' i]",
].join(", ");

function semanticRoot(document: Document): Element | null {
  return (
    document.querySelector("article") ??
    document.querySelector("[role='article']") ??
    document.querySelector("main")
  );
}

function kindFor(element: Element): NarratableBlockKind {
  const tag = element.tagName.toLowerCase();
  if (/^h[2-6]$/.test(tag)) return "heading";
  if (tag === "li") return "list-item";
  if (tag === "blockquote") return "blockquote";
  if (tag === "figcaption") return "caption";
  return "paragraph";
}

function addElement(
  element: Element | null,
  kind: NarratableBlockKind,
  blocks: NarratableBlock[],
  mappings: SourceMapping[],
  mappingNumber: { value: number },
): NarratableBlock | null {
  if (!element) return null;
  const mapped = mappedBlockFromElement(
    element,
    kind,
    blocks.length,
    mappingNumber,
  );
  if (!mapped) return null;
  blocks.push(mapped.block);
  mappings.push(...mapped.mappings);
  return mapped.block;
}

function addCue(text: string, blocks: NarratableBlock[]): void {
  blocks.push({
    id: `block-${blocks.length + 1}`,
    kind: "cue",
    text,
    mappingIds: [],
  });
}

function isLargeCodeBlock(element: Element): boolean {
  const text = element.textContent ?? "";
  return text.length >= 120 || text.split("\n").length >= 4;
}

export function extractGenericArticle(
  input: ExtractionInput,
): ExtractionResult {
  if (input.document.getElementsByTagName("*").length > 20_000) {
    return { ok: false, reason: "ARTICLE_TOO_LARGE", extractor: "generic" };
  }
  const clone = input.document.cloneNode(true) as Document;
  let readable: ReturnType<Readability["parse"]>;
  try {
    readable = new Readability(clone, {
      charThreshold: 200,
      maxElemsToParse: 20_000,
    }).parse();
  } catch {
    return { ok: false, reason: "ARTICLE_TOO_LARGE", extractor: "generic" };
  }
  const root = semanticRoot(input.document);
  if (!readable || !root || (readable.textContent ?? "").trim().length < 200) {
    return {
      ok: false,
      reason: "NO_SELECTION_OR_ARTICLE",
      extractor: "generic",
    };
  }

  const titleElement = root.querySelector("h1");
  const authorElement = root.querySelector(
    "[rel='author'], [itemprop='author'], .byline, [data-testid='author']",
  );
  const blocks: NarratableBlock[] = [];
  const mappings: SourceMapping[] = [];
  const mappingNumber = { value: 1 };
  const titleBlock = addElement(
    titleElement,
    "title",
    blocks,
    mappings,
    mappingNumber,
  );
  const authorBlock = addElement(
    authorElement,
    "author",
    blocks,
    mappings,
    mappingNumber,
  );

  root
    .querySelectorAll(
      "h2, h3, h4, h5, h6, p, li, blockquote, figcaption, pre, table",
    )
    .forEach((element) => {
      if (
        element === authorElement ||
        element === titleElement ||
        element.closest(EXCLUDED_ANCESTORS) ||
        (element.tagName.toLowerCase() === "p" && element.closest("li"))
      ) {
        return;
      }

      const tag = element.tagName.toLowerCase();
      if (tag === "table") {
        addCue("Table omitted.", blocks);
        return;
      }
      if (tag === "pre" && isLargeCodeBlock(element)) {
        addCue("Code block omitted.", blocks);
        return;
      }
      addElement(element, kindFor(element), blocks, mappings, mappingNumber);
    });

  const mappedCharacterCount = mappings.reduce(
    (total, mapping) => total + mapping.sourceText.length,
    0,
  );
  const characterCount = blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  const substantiveBodyCharacters = blocks
    .filter(
      (block) =>
        block.kind !== "title" &&
        block.kind !== "author" &&
        block.kind !== "cue",
    )
    .reduce((total, block) => total + block.text.length, 0);
  if (characterCount > 500_000 || blocks.length > 20_000) {
    return { ok: false, reason: "ARTICLE_TOO_LARGE", extractor: "generic" };
  }
  if (
    blocks.length < 3 ||
    substantiveBodyCharacters < 200 ||
    mappedCharacterCount < substantiveBodyCharacters
  ) {
    return { ok: false, reason: "MAPPING_INCOMPLETE", extractor: "generic" };
  }

  const narrationLanguage =
    root.closest("[lang]")?.getAttribute("lang")?.trim() ||
    input.document.documentElement.lang.trim() ||
    input.chromeLanguage?.trim() ||
    "en";
  const snapshot: ArticleSnapshot = {
    id: crypto.randomUUID(),
    extractor: "generic",
    title: titleBlock?.text ?? (readable.title?.trim() || null),
    author: authorBlock?.text ?? readable.byline?.trim() ?? null,
    narrationLanguage,
    characterCount,
    blocks,
    sentences: segmentBlocks(blocks, narrationLanguage),
  };

  return { ok: true, snapshot, mappings };
}

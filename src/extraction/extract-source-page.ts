import { segmentBlocks } from "./segmentation";
import type {
  ArticleSnapshot,
  ExtractionInput,
  ExtractionResult,
  NarratableBlock,
  SourceMapping,
} from "./types";
import { extractXArticle } from "./x-articles";
import { extractGenericArticle } from "./generic-article";

function narrationLanguageFor(input: ExtractionInput, node: Node): string {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return (
    element?.closest("[lang]")?.getAttribute("lang")?.trim() ||
    input.document.documentElement.lang.trim() ||
    input.chromeLanguage?.trim() ||
    "en"
  );
}

function extractSelection(
  input: ExtractionInput,
  selection: Selection,
): ExtractionResult | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0).cloneRange();
  const text = range.toString();
  if (text.trim().length === 0) return null;
  if (text.length > 500_000) {
    return {
      ok: false,
      reason: "ARTICLE_TOO_LARGE",
      extractor: "selection",
    };
  }

  const root = range.commonAncestorContainer;
  const textNodes: Text[] = [];
  if (root instanceof Text) {
    textNodes.push(root);
  } else {
    const walker = input.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) textNodes.push(node);
      node = walker.nextNode();
    }
  }
  const mappings: SourceMapping[] = [];
  let utteranceOffset = 0;
  for (const node of textNodes) {
    if (!range.intersectsNode(node)) continue;
    const localStart = range.startContainer === node ? range.startOffset : 0;
    const localEnd =
      range.endContainer === node ? range.endOffset : node.data.length;
    if (localEnd <= localStart) continue;
    const sourceText = node.data.slice(localStart, localEnd);
    const nodeRange = input.document.createRange();
    nodeRange.setStart(node, localStart);
    nodeRange.setEnd(node, localEnd);
    mappings.push({
      id: `mapping-${mappings.length + 1}`,
      blockIndex: 0,
      utteranceStart: utteranceOffset,
      utteranceEnd: utteranceOffset + sourceText.length,
      sourceText,
      range: nodeRange,
    });
    utteranceOffset += sourceText.length;
  }
  if (mappings.map((mapping) => mapping.sourceText).join("") !== text) {
    return {
      ok: false,
      reason: "MAPPING_INCOMPLETE",
      extractor: "selection",
    };
  }
  const blocks: NarratableBlock[] = [
    {
      id: "block-1",
      kind: "paragraph",
      text,
      mappingIds: mappings.map((mapping) => mapping.id),
    },
  ];
  const narrationLanguage = narrationLanguageFor(
    input,
    range.commonAncestorContainer,
  );
  const snapshot: ArticleSnapshot = {
    id: crypto.randomUUID(),
    extractor: "selection",
    title: null,
    author: null,
    narrationLanguage,
    characterCount: text.length,
    blocks,
    sentences: segmentBlocks(blocks, narrationLanguage),
  };
  return { ok: true, snapshot, mappings };
}

export function extractSourcePage(input: ExtractionInput): ExtractionResult {
  const selectionResult = input.selection
    ? extractSelection(input, input.selection)
    : null;
  if (selectionResult) return selectionResult;

  const xArticleResult = extractXArticle(input);
  if (xArticleResult) return xArticleResult;

  return extractGenericArticle(input);
}

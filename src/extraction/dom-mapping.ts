import type {
  NarratableBlock,
  NarratableBlockKind,
  SourceMapping,
} from "./types";

function isHidden(node: Text): boolean {
  const element = node.parentElement;
  if (!element) return true;
  const hiddenAncestor = element.closest(
    "[hidden], [aria-hidden='true'], script, style, noscript, template",
  );
  if (hiddenAncestor) return true;

  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display === "none" || style?.visibility === "hidden";
}

function visibleTextNodes(element: Element): Text[] {
  const nodes: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return node instanceof Text && !isHidden(node) && node.data.length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );

  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

export function mappedBlockFromElement(
  element: Element,
  kind: NarratableBlockKind,
  blockIndex: number,
  mappingNumber: { value: number },
): { block: NarratableBlock; mappings: SourceMapping[] } | null {
  const textNodes = visibleTextNodes(element);
  if (textNodes.length === 0) return null;

  const firstContent = textNodes.findIndex(
    (node) => node.data.trim().length > 0,
  );
  const lastContent = textNodes.findLastIndex(
    (node) => node.data.trim().length > 0,
  );
  if (firstContent < 0 || lastContent < 0) return null;

  const mappings: SourceMapping[] = [];
  let text = "";
  for (let index = firstContent; index <= lastContent; index += 1) {
    const node = textNodes[index];
    if (!node) continue;
    const start = index === firstContent ? node.data.search(/\S/) : 0;
    const trailing =
      index === lastContent ? (node.data.match(/\s*$/)?.[0].length ?? 0) : 0;
    const end = node.data.length - trailing;
    if (end <= start) continue;

    const sourceText = node.data.slice(start, end);
    const range = element.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const id = `mapping-${mappingNumber.value}`;
    mappingNumber.value += 1;
    mappings.push({
      id,
      blockIndex,
      utteranceStart: text.length,
      utteranceEnd: text.length + sourceText.length,
      sourceText,
      range,
    });
    text += sourceText;
  }

  if (text.length === 0) return null;
  return {
    block: {
      id: `block-${blockIndex + 1}`,
      kind,
      text,
      mappingIds: mappings.map((mapping) => mapping.id),
    },
    mappings,
  };
}

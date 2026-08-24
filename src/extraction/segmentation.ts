import type { NarratableBlock, NarratableSentence } from "./types";

export function segmentBlocks(
  blocks: NarratableBlock[],
  narrationLanguage: string,
): NarratableSentence[] {
  const segmenter = new Intl.Segmenter(narrationLanguage, {
    granularity: "sentence",
  });
  const sentences: NarratableSentence[] = [];

  blocks.forEach((block, blockIndex) => {
    for (const part of segmenter.segment(block.text)) {
      if (part.segment.trim().length === 0) continue;
      sentences.push({
        id: `sentence-${sentences.length + 1}`,
        text: part.segment,
        blockIndex,
        startOffset: part.index,
        endOffset: part.index + part.segment.length,
        mappingIds: [...block.mappingIds],
      });
    }
  });

  return sentences;
}

import type { SourceMapping } from "../extraction/types";

export interface HighlightRegistry {
  set(name: string, ranges: Range[]): void;
  delete(name: string): void;
}

export interface WordOffsets {
  startOffset: number;
  endOffset: number;
}

export type HighlightPrecision = "none" | "sentence" | "word";

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  const previousIsHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  const nextIsLowSurrogate = next >= 0xdc00 && next <= 0xdfff;
  return !(previousIsHighSurrogate && nextIsLowSurrogate);
}

export class SourceHighlighter {
  private readonly mappingsById: ReadonlyMap<string, SourceMapping>;

  constructor(
    private readonly registry: HighlightRegistry,
    mappings: SourceMapping[],
  ) {
    this.mappingsById = new Map(
      mappings.map((mapping) => [mapping.id, mapping]),
    );
  }

  validate(mappingIds: string[]): boolean {
    if (mappingIds.length === 0) return false;
    return mappingIds.every((id) => {
      const mapping = this.mappingsById.get(id);
      return (
        mapping !== undefined &&
        mapping.range.commonAncestorContainer.isConnected &&
        mapping.range.toString() === mapping.sourceText
      );
    });
  }

  validateAll(): boolean {
    return this.validate([...this.mappingsById.keys()]);
  }

  show(
    mappingIds: string[],
    word?: WordOffsets,
    sentence?: WordOffsets,
  ): HighlightPrecision {
    if (!this.validate(mappingIds)) {
      this.clear();
      return "none";
    }

    const sentenceRanges = sentence
      ? this.rangesForOffsets(mappingIds, sentence)
      : mappingIds
          .map((id) => this.mappingsById.get(id)?.range.cloneRange())
          .filter((range): range is Range => range !== undefined);
    if (sentenceRanges.length === 0) {
      this.clear();
      return "none";
    }
    this.registry.set("speak-o-sentence", sentenceRanges);

    const wordRange = word ? this.rangeForWord(mappingIds, word) : null;
    if (!wordRange) {
      this.registry.delete("speak-o-word");
      return "sentence";
    }

    this.registry.set("speak-o-word", [wordRange]);
    return "word";
  }

  clear(): void {
    this.registry.delete("speak-o-sentence");
    this.registry.delete("speak-o-word");
  }

  private rangeForWord(mappingIds: string[], word: WordOffsets): Range | null {
    const mapping = mappingIds
      .map((id) => this.mappingsById.get(id))
      .find(
        (candidate) =>
          candidate !== undefined &&
          word.startOffset >= candidate.utteranceStart &&
          word.endOffset <= candidate.utteranceEnd,
      );
    return mapping
      ? (this.rangesForOffsets([mapping.id], word)[0] ?? null)
      : null;
  }

  private rangesForOffsets(
    mappingIds: string[],
    offsets: WordOffsets,
  ): Range[] {
    if (
      !Number.isSafeInteger(offsets.startOffset) ||
      !Number.isSafeInteger(offsets.endOffset) ||
      offsets.startOffset < 0 ||
      offsets.endOffset <= offsets.startOffset
    ) {
      return [];
    }

    return mappingIds
      .map((id) => this.mappingsById.get(id))
      .filter(
        (candidate): candidate is SourceMapping =>
          candidate !== undefined &&
          offsets.startOffset < candidate.utteranceEnd &&
          offsets.endOffset > candidate.utteranceStart,
      )
      .flatMap((mapping) => {
        if (
          !(mapping.range.startContainer instanceof Text) ||
          mapping.range.startContainer !== mapping.range.endContainer
        ) {
          return [];
        }
        const localStart =
          Math.max(offsets.startOffset, mapping.utteranceStart) -
          mapping.utteranceStart;
        const localEnd =
          Math.min(offsets.endOffset, mapping.utteranceEnd) -
          mapping.utteranceStart;
        if (
          localEnd <= localStart ||
          !isUtf16Boundary(mapping.sourceText, localStart) ||
          !isUtf16Boundary(mapping.sourceText, localEnd)
        ) {
          return [];
        }
        const range = mapping.range.cloneRange();
        range.setStart(
          mapping.range.startContainer,
          mapping.range.startOffset + localStart,
        );
        range.setEnd(
          mapping.range.endContainer,
          mapping.range.startOffset + localEnd,
        );
        return [range];
      });
  }
}

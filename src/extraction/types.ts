export type ExtractorIdentity = "selection" | "x-articles" | "generic";
export type NarratableBlockKind =
  | "title"
  | "author"
  | "heading"
  | "paragraph"
  | "list-item"
  | "blockquote"
  | "caption"
  | "cue";

export interface NarratableBlock {
  id: string;
  kind: NarratableBlockKind;
  text: string;
  mappingIds: string[];
}

export interface NarratableSentence {
  id: string;
  text: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  mappingIds: string[];
}

export interface ArticleSnapshot {
  id: string;
  extractor: ExtractorIdentity;
  title: string | null;
  author: string | null;
  narrationLanguage: string;
  characterCount: number;
  blocks: NarratableBlock[];
  sentences: NarratableSentence[];
}

export interface SourceMapping {
  id: string;
  blockIndex: number;
  utteranceStart: number;
  utteranceEnd: number;
  sourceText: string;
  range: Range;
}

export type ExtractionRefusalReason =
  | "NO_SELECTION_OR_ARTICLE"
  | "UNSUPPORTED_X_PAGE"
  | "MAPPING_INCOMPLETE"
  | "ARTICLE_TOO_LARGE";

export type ExtractionResult =
  | {
      ok: true;
      snapshot: ArticleSnapshot;
      mappings: SourceMapping[];
    }
  | {
      ok: false;
      reason: ExtractionRefusalReason;
      extractor: ExtractorIdentity | null;
    };

export interface ExtractionInput {
  document: Document;
  selection?: Selection | null;
  chromeLanguage?: string | null;
  sourceUrl?: string;
}

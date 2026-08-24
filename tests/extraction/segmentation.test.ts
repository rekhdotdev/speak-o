import { segmentBlocks } from "../../src/extraction/segmentation";
import type { NarratableBlock } from "../../src/extraction/types";

function block(text: string): NarratableBlock {
  return {
    id: "block-1",
    kind: "paragraph",
    text,
    mappingIds: ["mapping-1"],
  };
}

describe("locale-sensitive sentence segmentation", () => {
  it.each([
    ["zh-CN", "第一句。第二句。", ["第一句。", "第二句。"]],
    ["ar", "هذه جملة. وهذه جملة أخرى.", ["هذه جملة. ", "وهذه جملة أخرى."]],
    [
      "en",
      "Emoji 👩🏽‍💻 stays intact. Cafe\u0301 stays mapped.",
      ["Emoji 👩🏽‍💻 stays intact. ", "Cafe\u0301 stays mapped."],
    ],
    [
      "en",
      "Curly “punctuation” stays. Non-breaking\u00a0space stays.",
      ["Curly “punctuation” stays. ", "Non-breaking\u00a0space stays."],
    ],
  ])(
    "segments %s while preserving exact UTF-16 block offsets",
    (language, text, expected) => {
      const sentences = segmentBlocks([block(text)], language);
      expect(sentences.map((sentence) => sentence.text)).toEqual(expected);
      expect(
        sentences.every(
          (sentence) =>
            text.slice(sentence.startOffset, sentence.endOffset) ===
            sentence.text,
        ),
      ).toBe(true);
    },
  );
});

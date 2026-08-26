import {
  buildRedactedDiagnostics,
  buildRuntimeDiagnosticEvidence,
} from "../../src/diagnostics/diagnostics";
import type { ArticleSnapshot } from "../../src/extraction/types";
import type { ReadingSessionSnapshot } from "../../src/session/types";

describe("redacted diagnostics", () => {
  it("derives runtime evidence from the active extraction and session", () => {
    const article = {
      extractor: "x-articles",
      characterCount: 20,
      blocks: [
        {
          id: "mapped",
          kind: "paragraph",
          text: "Mapped",
          mappingIds: ["mapping-1"],
        },
        {
          id: "unmapped-cue",
          kind: "cue",
          text: "Table omitted.",
          mappingIds: [],
        },
      ],
    } as ArticleSnapshot;
    const session = {
      mode: "browser",
      narrationLanguage: "en-IN",
      modelId: "not-used-by-browser-voice",
      errorCode: "VOICE_WORD_EVENTS_UNAVAILABLE",
    } as ReadingSessionSnapshot;

    expect(buildRuntimeDiagnosticEvidence(article, session)).toEqual({
      extractor: "x-articles",
      extractionStage: "ready",
      mappedBlockCount: 1,
      mappedCharacterCount: 6,
      mappingCoverage: 0.3,
      narrationLanguage: "en-IN",
      provider: "browser",
      modelId: null,
      errorCodes: ["VOICE_WORD_EVENTS_UNAVAILABLE"],
    });
  });

  it("reports extraction and provider metadata without prose, credentials, audio, or URLs", () => {
    const diagnostics = buildRedactedDiagnostics({
      extensionVersion: "0.1.0",
      extractor: "x-articles",
      extractionStage: "mapping",
      mappedBlockCount: 12,
      mappedCharacterCount: 4_280,
      mappingCoverage: 0.98,
      narrationLanguage: "en-IN",
      provider: "elevenlabs",
      modelId: "eleven_multilingual_v2",
      errorCodes: ["SOURCE_RANGE_DETACHED"],
      generatedAt: new Date("2026-08-24T08:00:00.000Z"),
    });

    expect(diagnostics).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-08-24T08:00:00.000Z",
      extensionVersion: "0.1.0",
      extractor: "x-articles",
      extractionStage: "mapping",
      mappedBlockCount: 12,
      mappedCharacterCount: 4_280,
      mappingCoverage: 0.98,
      narrationLanguage: "en-IN",
      provider: "elevenlabs",
      modelId: "eleven_multilingual_v2",
      errorCodes: ["SOURCE_RANGE_DETACHED"],
    });

    const copied = JSON.stringify(diagnostics);
    expect(copied).not.toContain("https://");
    expect(copied).not.toContain("articleText");
    expect(copied).not.toContain("credential");
    expect(copied).not.toContain("audio");
  });
});

import { buildRedactedDiagnostics } from "../../src/diagnostics/diagnostics";

describe("redacted diagnostics", () => {
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

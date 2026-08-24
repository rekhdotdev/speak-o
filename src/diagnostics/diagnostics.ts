export type ExtractorIdentity = "selection" | "x-articles" | "generic";
export type ExtractionStage =
  "selection" | "readability" | "mapping" | "validation" | "ready";
export type ProviderIdentity = "browser" | "elevenlabs" | "none";

export interface DiagnosticInput {
  extensionVersion: string;
  extractor: ExtractorIdentity;
  extractionStage: ExtractionStage;
  mappedBlockCount: number;
  mappedCharacterCount: number;
  mappingCoverage: number;
  narrationLanguage: string;
  provider: ProviderIdentity;
  modelId: string | null;
  errorCodes: string[];
  generatedAt: Date;
}

export interface RedactedDiagnostics {
  schemaVersion: 1;
  generatedAt: string;
  extensionVersion: string;
  extractor: ExtractorIdentity;
  extractionStage: ExtractionStage;
  mappedBlockCount: number;
  mappedCharacterCount: number;
  mappingCoverage: number;
  narrationLanguage: string;
  provider: ProviderIdentity;
  modelId: string | null;
  errorCodes: string[];
}

function finiteNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function buildRedactedDiagnostics(
  input: DiagnosticInput,
): RedactedDiagnostics {
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt.toISOString(),
    extensionVersion: input.extensionVersion.slice(0, 32),
    extractor: input.extractor,
    extractionStage: input.extractionStage,
    mappedBlockCount: finiteNonNegativeInteger(input.mappedBlockCount),
    mappedCharacterCount: finiteNonNegativeInteger(input.mappedCharacterCount),
    mappingCoverage: Math.min(1, Math.max(0, input.mappingCoverage)),
    narrationLanguage: input.narrationLanguage.slice(0, 35),
    provider: input.provider,
    modelId: input.modelId?.slice(0, 160) ?? null,
    errorCodes: input.errorCodes
      .filter((code) => /^[A-Z][A-Z0-9_]{0,63}$/.test(code))
      .slice(0, 20),
  };
}

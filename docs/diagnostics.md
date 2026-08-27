# Redacted diagnostics format

Speak-O generates diagnostics locally only after the user chooses **Copy redacted diagnostics**. The JSON object has a versioned, fixed shape:

```json
{
  "version": 1,
  "extensionVersion": "0.1.0",
  "extractor": "generic",
  "extractionStage": "ready",
  "mappedBlockCount": 12,
  "mappedCharacterCount": 5840,
  "mappingCoverage": 1,
  "narrationLanguage": "en-US",
  "provider": "elevenlabs",
  "modelId": "eleven_multilingual_v2",
  "errorCodes": [],
  "generatedAt": "2026-08-24T00:00:00.000Z"
}
```

Allowed fields describe the Extractor or Site Adapter, extraction stage, mapped counts, mapping coverage, resolved Narration Language, provider and Model identifiers, extension version, redacted error codes, and generation time.

The format excludes Article or Selection prose, Provider Credentials or suffixes, generated audio, Speech Alignment, Source Page URL, Reading Position history, provider response bodies, and request headers. Diagnostics are not uploaded automatically; copying only places the JSON on the local clipboard.

## Debug build log

`WXT_DEBUG_MODE=true npm run build` enables the local debug trace in the reader and settings page. Provider connection attempts add redacted events for permission checks, metadata requests and responses, network failures, JSON failures, provider error presence, and connection outcome. Cloud Voice generation adds the selected Model and Voice identifiers, generation windows, socket open/send/message/audio/error/close events, alignment counters, numeric close codes, and booleans indicating whether provider error fields were present. Raw provider messages and close reasons are deliberately omitted because they can echo submitted prose. When reporting a generation failure, include `provider.socket.provider-error`, `provider.socket.close`, and `provider.socket.failed` if present. The trace is copied locally only when the user chooses **Copy debug log**; it excludes Provider Credentials, request headers, Article or Selection prose, generated audio, and full URLs.

# Architecture

Speak-O is a Chrome 124+ Manifest V3 extension built with WXT, React, and strict TypeScript. Its authority is split by trust boundary.

## Runtime components

### Service worker

`entrypoints/background.ts` owns the one browser-wide Reading Session, provider-specific Credential access, optional provider authority, Cloud Voice generation, Browser Voice commands, Session Buffer persistence, offscreen lifecycle, and session descriptor recovery. Every asynchronous event carries a Reading Session ID and generation epoch; stale events are ignored.

### Injected reader

`entrypoints/reader.tsx` is injected only after toolbar, command, or Selection-context-menu activation. It extracts a fixed Article Snapshot, retains live `Range` mappings, renders the floating interface inside Shadow DOM, and applies CSS Custom Highlights to the Source Page. It receives no Provider Credential and has no provider host authority.

### Offscreen audio document

`entrypoints/offscreen/` decodes and plays only Cloud Voice audio supplied by the service worker. It receives the active audio plus the alignment data needed to report media-clock progress; alignment may contain the provider's character sequence for that generated segment. It receives no Article Snapshot or Provider Credential and makes no provider request.

### Options page

`entrypoints/options/` stores local preferences, obtains a user-gesture optional origin grant, and asks the service worker to validate or disconnect the Provider Connection. Credential fields are masked and cleared after a connection attempt.

## Deep module seams

- `src/extraction/`: Selection-first extraction, X Articles Site Adapter, a generic Readability confidence gate followed by conservative live semantic-root selection, semantic blocks, locale-sensitive sentence segmentation, and exact DOM mappings.
- `src/session/`: the Reading Session state machine and bounded Session Buffer. UI, provider, audio, storage, and speech work leave the controller as typed effects.
- `src/provider/`: the common provider contract plus independent ElevenLabs and Speechify adapters. ElevenLabs uses reconnectable timestamped WebSocket bursts; Speechify uses bounded MP3 sentence streams without Speech Alignment.
- `src/adapters/`: Chrome `tts` translation into stable Browser Voice events.
- `src/highlighting/`: mapping validation and exact sentence or word ranges without DOM wrappers.
- `src/storage/`: sanitized local preferences and trusted-context credential policy.
- `src/contracts/`: versioned runtime validation.
- `src/diagnostics/`: explicitly requested, redacted support data.

## Data flow

1. An explicit user action injects the reader into one frame.
2. The reader captures a fixed Article Snapshot and retains non-serializable Source Page ranges locally.
3. The service worker activates or replaces the browser-wide Reading Session.
4. Browser Voice text goes to `chrome.tts`; Cloud Voice text goes directly to the explicitly selected ElevenLabs or Speechify origin from the service worker. That provider identity is fixed for the Reading Session.
5. Cloud audio and any available original-text alignment enter the bounded Session Buffer; the offscreen document plays active audio.
6. Word or sentence events return through the Reading Session and become exact CSS Highlight ranges in the reader.

The Source Page URL and Article text are excluded from the persisted descriptor. Navigation or contradictory recovery state stops or visibly pauses the Reading Session rather than inferring continuation.

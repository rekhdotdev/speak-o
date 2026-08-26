# Threat model

## Assets

- The user's ElevenLabs Provider Credential
- Article and Selection text
- Generated audio and Speech Alignment
- Provider Usage under the user's account
- Source Page integrity and user intent

## Trust boundaries

The service worker is the only component with credential and provider authority. The injected reader is exposed to hostile Source Pages but holds only the fixed Article Snapshot, live ranges, and rendered session state. The offscreen document receives generated audio and the active segment's alignment payload needed to report media timing; it receives neither the full Article Snapshot nor a Provider Credential. Rekh operates no runtime backend.

## Principal threats and controls

### Hostile Source Page reads a credential

Provider Credentials are never sent to content scripts, page main worlds, UI snapshots, diagnostics, audio messages, or the offscreen document. Credential storage is restricted to trusted extension contexts. Provider requests originate in the service worker.

### Overbroad network authority

The manifest has no persistent host permissions. Provider origins are optional; setup requests only the selected ElevenLabs API Region after a user gesture. Disconnect removes that grant. Executable code is bundled and extension CSP permits only self-hosted scripts.

### Unexpected or excessive Provider Usage

Speech starts only after explicit activation. Generation bursts contain the current and no more than two upcoming sentences. A configurable source-character guard defaults to 25,000. Potentially acknowledged retries need confirmation, and failures never silently switch providers.

### Source Page deception or mutation

Selection takes priority. Automatic extraction rejects uncertain or incompletely mapped content. Highlights use retained ranges without wrappers. Mutation, detachment, URL change, and page lifecycle signals visibly stop mapped continuation. Cross-origin frames and arbitrary shadow roots are not traversed.

### Stale Manifest V3 state

All commands and asynchronous events carry a Reading Session ID and generation epoch. Stop or replacement invalidates late work. A minimal session-only descriptor is reconciled with the existing content script after service-worker wake; missing or contradictory state is cleared instead of reconstructed from guesses.

### Local profile compromise

Session-only credential storage is the default. Remembering a credential is explicit and uses Chrome profile storage without application-level encryption. Speak-O does not claim protection against a compromised browser profile, device account, malicious extension with sufficient privileges, or local malware.

### Data leakage through support artifacts

Diagnostics are generated only on explicit copy and contain identifiers, counts, language, version, and redacted error codes. They exclude prose, credentials, audio, and full URLs. Fixtures and release archives are audited for credentials, original captures, development files, and unexpected origins.

## Out of scope

Protection from a compromised Chrome binary, operating system, ElevenLabs account, or Voice provider is outside the extension boundary. Provider policy and retention remain controlled by ElevenLabs.

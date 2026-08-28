# Speak-O privacy notice

Canonical source for the intended public page at `https://rekh.dev/speak-o/`.

Last updated: 29 August 2026.

Speak-O is an accountless, open-source Chrome Article Reader published by Rekh. Rekh does not operate a Speak-O speech backend, account service, analytics service, telemetry pipeline, crash reporter, or remote diagnostics service.

## Data Rekh receives

Rekh receives no Article text, Selection text, Provider Credential, Provider Usage, generated audio, Reading Position, copied diagnostics, or behavioral data from the extension.

## Chrome Voice Mode

Speak-O sends text to Chrome's `tts` API and makes no Speech Provider request of its own. A Voice exposed by Chrome or the operating system may itself use a remote service; Speak-O does not claim that Browser Voice Mode is offline.

## ElevenLabs Cloud Voice Mode

Only source text inside the bounded Generation Window is sent by the extension directly to the ElevenLabs API Region selected by the user, using the user's own Provider Credential. Rekh is not an intermediary. ElevenLabs controls its own processing, retention, billing, and policy. See [ElevenLabs privacy material](https://elevenlabs.io/privacy).

## Speechify Cloud Voice Mode

Only source text inside the bounded Generation Window is sent by the extension directly to Speechify using the user's own Provider Credential. Rekh is not an intermediary. Speechify controls its own processing, retention, billing, and policy. See [Speechify privacy material](https://speechify.com/privacy/).

## Local data

- Preferences and optional remembered credentials use `chrome.storage.local`; Speak-O does not use Chrome Sync.
- Provider Credentials use `chrome.storage.session` by default. Choosing **Remember on this device** stores the credential in local Chrome profile storage. Speak-O does not add application-level encryption.
- Compressed Cloud Voice audio and Speech Alignment for the active Session Buffer use `chrome.storage.session`, are bounded to 8 MiB, and are cleared when the Reading Session or extension session ends.
- The minimal active-session descriptor contains identifiers, provider, mode, cursor, and status. It excludes Article text and Source Page URL.
- Speak-O does not persist Article text, generated-audio downloads, reading history, or completed Reading Sessions.

## Permissions

Speak-O runs on a Source Page only after an explicit user action. ElevenLabs and Speechify origins are optional, and the extension requests only the selected provider origin during Provider Connection setup. Each connection is independent. Disconnecting removes that provider's credential, cached metadata, provider work, and optional origin permission.

## Diagnostics

Diagnostics are generated locally only when the user chooses **Copy redacted diagnostics**. They exclude Article prose, credentials, audio, and full URLs by default. The user decides whether and where to share the copied text.

## Changes and contact

Material changes are recorded in this repository and reflected on the intended canonical page. Privacy or security concerns should follow [SECURITY.md](SECURITY.md).

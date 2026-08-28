# Speak-O

Speak-O is an open-source, accountless Article Reader for Chrome 124+. It reads a fixed Article Snapshot or explicit Selection, keeps the current sentence highlighted on the original Source Page, and gives one browser-wide Reading Session calm playback controls.

ElevenLabs and Speechify Cloud Voice Modes connect directly to the user's account with a Bring Your Own Key Provider Credential. Browser Voice Mode uses a Voice exposed by Chrome or the operating system and needs no Provider Connection. A Browser Voice may use a remote service and is not guaranteed to be offline.

## What 0.1.0 includes

- Explicit toolbar, keyboard, and Selection-context-menu activation
- Selection-first extraction, a dedicated X Articles Site Adapter, and conservative generic Article extraction
- Exact CSS Custom Highlight ranges without rewriting Source Page DOM
- Sentence navigation, sentence-based progress, 0.5x–3x Playback Speed, top or bottom docking, and a minimized state
- Optional, independent ElevenLabs and Speechify BYOK Cloud Voice connections
- ElevenLabs word highlighting when Speech Alignment is valid; Speechify sentence highlighting
- `chrome.tts` Browser Voice fallback
- Session-only Provider Credentials by default, with explicit local persistence opt-in
- No Speak-O account, backend, subscription, analytics, telemetry, or remote code

Speak-O does not promise universal Article support. When extraction or mapping is uncertain, select the prose you want to hear.

## Build and load locally

Requirements: Node.js 22+, npm, Chrome 124+.

```sh
npm ci
npm run verify
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

For development:

```sh
npm run dev
```

The normal test suite uses fakes and never needs an ElevenLabs or Speechify key or consumes Provider Usage.

## Use Speak-O

1. Open an Article and choose the Speak-O toolbar action, press `Alt+Shift+R`, or select prose and use **Read Selection with Speak-O**.
2. On first use, continue with a Chrome Voice or open settings to connect ElevenLabs or Speechify.
3. Use the floating bar to play or pause, move by sentence, view progress, change Playback Speed, minimize, or stop.
4. Open settings to choose Voices, configure the Provider Usage guard, change the dock or theme, and copy redacted diagnostics.

See [Provider setup](docs/provider-setup.md) and [troubleshooting](docs/troubleshooting.md).

## Privacy and security

Rekh receives no Article text, Provider Credential, Provider Usage, diagnostics, or behavioral data. Cloud Voice text is sent by the extension directly to the selected ElevenLabs API Region or Speechify API using that provider's credential. Preferences use local extension storage; remembered credentials are protected by Chrome profile storage rather than application-level encryption; active audio and alignment use session storage.

Read [PRIVACY.md](PRIVACY.md), [the threat model](docs/threat-model.md), and [SECURITY.md](SECURITY.md).

## Project documentation

- [Architecture](docs/architecture.md)
- [Store permissions and data use](docs/store-permissions.md)
- [Diagnostics format](docs/diagnostics.md)
- [Contribution guide](CONTRIBUTING.md)
- [Apache-2.0 license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md)

Speak-O 0.1.0 is a public beta published by Rekh.

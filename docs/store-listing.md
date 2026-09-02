# Chrome Web Store listing draft

## Name

speak-o

## Short description

Listen to Articles on the original page with calm controls, exact highlights, and Chrome Voices.

## Detailed description

Speak-O is an open-source, accountless Article Reader for Chrome. Start it explicitly from the toolbar, a keyboard command, or selected prose. It captures a fixed Article Snapshot, skips surrounding page chrome, and keeps the active sentence highlighted on the original Source Page without rewriting the page.

Use a Chrome Voice with no setup, or connect an optional ElevenLabs or Speechify BYOK Cloud Voice provider. Each provider connection is independent and uses the user's own account.

The compact floating bar provides previous, play or pause, next, sentence-based progress, Playback Speed, Voice settings, details, minimize, and stop. Choose top or bottom docking, light or dark presentation, highlighting, and follow behavior.

Speak-O supports many conventional Article pages, dedicated X Articles handling, and Selection fallback. It does not claim universal extraction support, automatically read ordinary X posts or timelines, support PDFs, or operate a Rekh speech backend.

Privacy: Rekh receives no Article text, Provider Credential, Provider Usage, diagnostics, or behavioral data. Cloud Voice text goes directly from the extension to the selected ElevenLabs or Speechify API using the user's credential. Browser Voices may use remote platform services and are not guaranteed offline.

## Support

- Chrome Web Store: `https://chromewebstore.google.com/detail/speak-o/kjamjfihhlhhnnkbknkfjinenbfmlkgl`
- Source and Issues: `https://github.com/rekhdotdev/speak-o`
- Homepage: `https://rekh.dev/speak-o/`
- Privacy policy: `https://rekh.dev/speak-o/privacy/`
- Support: `https://rekh.dev/speak-o/support/`
- Extraction failures: use the repository's extraction-failure Issue form with redacted diagnostics.

## Store media

Upload the files in [`store-assets/`](../store-assets/):

- `icon-128.png`
- `screenshots/01-onboarding.png` through `screenshots/05-settings.png`
- `promo-tile-440x280.png`
- `marquee-1400x560.png` if the dashboard requests the optional marquee asset

The screenshots are current deterministic Chromium captures against the repository's synthetic Article fixture. They contain no private browsing data or Provider Credential.

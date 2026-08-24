# Chrome Web Store permissions and data use

## Required permissions

- `activeTab`: grants temporary access to the explicitly activated Source Page; Speak-O has no persistent site access.
- `scripting`: injects the reader only after a toolbar, command, or Selection context-menu action.
- `contextMenus`: provides **Read Selection with Speak-O** for explicit Selection reading.
- `tts`: speaks one sentence at a time with a Voice exposed by Chrome or the operating system.
- `storage`: stores local preferences, optional remembered credential state, and the session-only descriptor and audio buffer. Chrome Sync is not used.
- `offscreen`: creates an audio-only document while Cloud Voice audio is being played.

Speak-O does not request `tabs`, `webNavigation`, incognito access, a blanket content script, or persistent host permissions.

## Optional provider origins

The manifest lists the supported ElevenLabs API Regions as optional host permissions. The settings page requests only the selected origin during a user-initiated Provider Connection. Global is the default. Disconnect removes the selected grant.

## Data-use answers

Speak-O handles website content only to extract and read the Article Snapshot or Selection requested by the user. Cloud Voice source text is sent directly to ElevenLabs under the user's own account; Rekh does not receive it. Authentication information is used only for that direct Provider Connection. Data is not sold, used for advertising, transferred to Rekh, or used for unrelated purposes.

No analytics, tracking, remote configuration, remotely hosted code, or automatic diagnostic upload is present. The canonical privacy source is `PRIVACY.md` and is intended for `https://rekh.dev/speak-o/`.

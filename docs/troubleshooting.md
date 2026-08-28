# Troubleshooting

## Speak-O cannot run on this page

Chrome blocks extensions on protected pages such as `chrome://` pages and the Chrome Web Store. PDF extraction and local file ingestion are outside 0.1.0. Open a normal `http` or `https` Article. If the page is not confidently an Article, select prose and use the Speak-O context menu.

## No readable Article found

Speak-O rejects uncertain extraction rather than narrating navigation, comments, or recommendations. Select the exact prose and activate Selection reading. Ordinary X posts, threads, timelines, and conversations require a Selection; automatic X support is for X Articles.

## The Source Page changed

The Reading Session pauses when mapped text, URL, or page lifecycle state changes. Choose **Restart Article** to capture a new Article Snapshot, **Continue without highlights** to keep the fixed Snapshot without claiming a live mapping, or **Stop**.

## Chrome Voice does not speak

Open settings and choose a Voice exposed by Chrome or the operating system. A Voice may be unavailable, remote, or removed by the platform. Playback Speed changes restart the current Browser Voice sentence immediately because Chrome cannot reliably retime an utterance already in progress.

## ElevenLabs will not connect

Confirm the API Region, key validity, and network connection. Denying Chrome's optional origin prompt leaves the credential unsaved. A key is validated with metadata requests before connection. Disconnect and reconnect to replace an invalid or expired key.

## Speechify will not connect

Confirm the API key, account balance, and network connection. Denying Chrome's optional `api.speechify.ai` origin prompt leaves the credential unsaved. Speak-O follows the provider's paginated Voice catalog during validation; an incomplete or malformed catalog response fails closed. Disconnect and reconnect to replace an invalid or expired key.

## Capture a provider debug log

For a deliberate diagnostic build, run `WXT_DEBUG_MODE=true npm run build`, then reload `.output/chrome-mv3` from `chrome://extensions`. Reproduce the problem and open **Settings → Privacy & diagnostics**. The debug log records the provider identity, selected region when applicable, Model and Voice identifiers, generation window, transport lifecycle, outbound message shape, audio/alignment counters, numeric close codes, provider error-field presence, or sanitized network exception. Raw provider messages and close reasons are omitted because they can echo submitted prose. It does not include the Provider Credential, request headers, Article text, generated audio, or full URLs. Use **Copy debug log** to send the result with the failure message.

## Cloud Voice pauses or reports a provider issue

Speak-O never silently falls back. Use the attached action to confirm a retry when Provider Usage may have occurred, reconnect or choose a compatible Voice or Model, switch explicitly to Chrome Voice, or stop. A Usage guard pause is deliberate; continuing disables that guard for the current Reading Session only.

## A long pause lost visible playback

Open the Source Page and press Play. Speak-O recreates its offscreen audio document as needed and reconciles the session-only descriptor and buffer. If the Source Page or runtime state is contradictory, the extension clears or visibly pauses the session instead of regenerating speech automatically.

## Reporting an extraction failure

Use the GitHub extraction-failure issue form. Copy redacted diagnostics from settings and attach only synthetic or sanitized HTML. Never attach an original private page capture, Article prose you cannot redistribute, a Provider Credential, or generated audio.

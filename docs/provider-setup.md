# ElevenLabs Provider setup

Speak-O uses the user's own ElevenLabs account and sends Cloud Voice text directly to ElevenLabs. Rekh never receives the Provider Credential or Article text.

1. Open Speak-O settings from the floating bar or extension details.
2. Under **Speech**, choose the Advanced API Region that matches the ElevenLabs account. Global is the default.
3. Paste an ElevenLabs API key in **Provider Credential**.
4. Leave **Remember on this device** off for session-only storage, or enable it to use local Chrome profile storage. Remembered keys do not receive additional application-level encryption.
5. Choose **Connect ElevenLabs**. Chrome asks for access to exactly the selected API origin. Speak-O validates the key with provider metadata requests before treating it as connected.
6. Search and choose a Voice and, if needed, a supported Model.

Provider previews open provider-supplied preview media when available and do not generate new speech. When provider preview media is absent, Speak-O does not make a potentially billable preview request.

Disconnecting aborts provider work and removes the credential, cached provider metadata, and selected optional host permission. It does not change or delete the ElevenLabs account.

Normal development and CI never require a live key. Do not paste a credential into an Issue, diagnostic report, test, fixture, screenshot, log, or source file.

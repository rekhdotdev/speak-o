# Speech Provider setup

Speak-O uses the user's own ElevenLabs or Speechify account and sends Cloud Voice text directly to the provider selected for the Reading Session. Rekh never receives a Provider Credential or Article text.

## Connect ElevenLabs

1. Open Speak-O settings from the floating bar or extension details.
2. Under **Speech**, choose the Advanced API Region that matches the ElevenLabs account. Global is the default.
3. Paste an ElevenLabs API key in **Provider Credential**.
4. Leave **Remember on this device** off for session-only storage, or enable it to use local Chrome profile storage. Remembered keys do not receive additional application-level encryption.
5. Choose **Connect ElevenLabs**. Chrome asks for access to exactly the selected API origin. Speak-O validates the key with provider metadata requests before treating it as connected.
6. Search and choose an ElevenLabs Voice and, if needed, a supported Model.

## Connect Speechify

1. Open Speak-O settings and paste a Speechify API key in the Speechify **Provider Credential** field.
2. Choose whether to remember the key on this device.
3. Choose **Connect Speechify**. Chrome asks for access to `https://api.speechify.ai/*`, and Speak-O loads every page of the provider's Voice catalog before treating it as connected.
4. Choose a compatible Speechify Model and Voice. Speechify narration uses sentence highlighting because the integrated MP3 stream does not supply the Speech Alignment used by Speak-O's word highlighting.

Provider previews open provider-supplied preview media when available and do not generate new speech. When preview media is absent, Speak-O does not make a potentially billable preview request.

Each Provider Connection is independent. Disconnecting one provider aborts its work and removes only its credential, cached metadata, and optional host permission. It does not change the provider account or disconnect the other provider.

Normal development and CI never require a live key. Do not paste a credential into an Issue, diagnostic report, test, fixture, screenshot, log, or source file.

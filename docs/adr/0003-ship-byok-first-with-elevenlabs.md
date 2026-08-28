# Ship BYOK-first with ElevenLabs

_Superseded by [ADR-0014](0014-add-speechify-as-an-explicit-provider.md)._

Speak-O v1 ships ElevenLabs Cloud Voice Mode as its primary differentiated experience and retains `chrome.tts` as the sole built-in fallback. ElevenLabs is the first Cloud Speech Provider because timestamped streaming supplies original-text character alignment for synchronized word highlighting, with sentence highlighting retained when alignment is missing or invalid. The extension sends source text directly to ElevenLabs using a user-owned, preferably TTS-scoped, credit-capped, expiring Provider Credential; it accepts and clearly discloses that storing a credential in client software conflicts with ElevenLabs' preferred server-side guidance, while session-only storage by default, explicit device-persistence opt-in, open source, and no Rekh intermediary keep the trust boundary visible and limited.

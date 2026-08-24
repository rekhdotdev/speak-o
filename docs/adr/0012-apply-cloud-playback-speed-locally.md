# Apply Cloud Voice Playback Speed locally

Speak-O synthesizes ElevenLabs audio at normal speed and applies the user's 0.5x–3x Playback Speed locally with pitch-preserving media playback, allowing immediate changes to buffered audio while retaining the provider's media-time Speech Alignment and avoiding regeneration or additional Provider Usage; Browser Voice Mode instead applies rate changes at the next sentence because `chrome.tts` cannot reliably alter an active utterance.

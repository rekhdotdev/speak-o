# Use chrome.tts for browser voices

Speak-O uses Chrome's extension-level `chrome.tts` API for Browser Voice Mode instead of the page-level `window.speechSynthesis` API demonstrated by the initial prototype. The Chrome-specific API better supports a single browser-wide Reading Session, background-tab continuity, voice capability-aware progress events, and a provider-neutral playback controller without coupling speech ownership to the source page; Speak-O accepts the resulting Chrome lock-in in exchange for that stronger user experience.

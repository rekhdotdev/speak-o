# Speak-O

Speak-O is an open-source, Chrome-first, BYOK article reader that turns the primary reading content of a source page into a controlled spoken experience. Cloud Voice Mode is its primary differentiated experience, with Browser Voice Mode as an accountless fallback.

## Language

**Article**:
The primary long-form reading content on a source page, including platform-native long-form publications such as X Articles. Ordinary social posts, threads, conversations, and timelines are not Articles.
_Avoid_: Page text, all text

**Article Snapshot**:
The fixed representation of an Article captured when a Reading Session begins. Later source-page changes do not alter the active Article Snapshot.
_Avoid_: Live article, feed

**Extractor**:
A reader that identifies an Article and maps its narratable content back to the original Source Page.
_Avoid_: Scraper, parser

**Site Adapter**:
An Extractor for a recognized platform whose publication structure cannot be handled reliably by the generic Extractor.
_Avoid_: Site hack, hostname rule

**Source Page**:
The browser document from which an Article Snapshot or Selection originates and on which its active text is highlighted.
_Avoid_: Website, active tab

**Reading Session**:
The single active spoken reading of one Article Snapshot or Selection across the browser. Its Speech Provider is chosen explicitly and remains fixed unless the user switches to Browser Voice Mode. It continues across tab switches and ends when another Reading Session starts, the user stops it, or the source page navigates or closes.
_Avoid_: Playback, audio session

**First-run Setup**:
The guided configuration shown before the first Reading Session, where a user chooses a Speech Provider, establishes any required Provider Connection, and selects a Voice. Completing it returns to the pending Source Page and starts reading; later configuration uses Settings.
_Avoid_: Welcome tour, marketing onboarding

**Reading Position**:
The current sentence within an Article Snapshot or Selection. It is a content position rather than an audio timestamp.
_Avoid_: Playback time, audio position

**Playback Speed**:
The user-selected rate at which speech is heard. In Cloud Voice Mode it is applied immediately to already-generated audio without additional Provider Usage. In Browser Voice Mode, where Chrome cannot reliably retime an active utterance, an immediate change restarts the current sentence at the new rate.
_Avoid_: Voice speed, generation speed

**Narration Language**:
The single primary language resolved for a Reading Session and used for locale-sensitive segmentation and Voice compatibility. It may be inferred from the Source Page or overridden by the user, but it does not change automatically within a Reading Session.
_Avoid_: Browser language, interface language

**Speech Alignment**:
Timing data that maps source-text characters to generated audio and drives synchronized highlighting. Missing, unavailable, or invalid Speech Alignment degrades to sentence highlighting rather than an estimated word highlight.
_Avoid_: Playback progress, transcript

**Selection**:
Text explicitly chosen by the user as the source of a Reading Session when automatic Article identification is unsuitable.
_Avoid_: Manual article

**Browser Voice Mode**:
A Reading Session spoken through a voice exposed by the browser or operating system, without Speak-O sending the source text to its own servers. A Browser Voice may still rely on a remote service and is not necessarily offline.
_Avoid_: Offline mode, local mode

**Speech Provider**:
The system that turns source text into spoken output for a Reading Session.
_Avoid_: Speech engine, TTS service

**Provider Credential**:
A user-owned secret that grants Speak-O direct access to a Speech Provider. It remains on the user's device and is never received by Rekh.
_Avoid_: Speak-O key, account token

**Provider Connection**:
The local authorization state created when a user grants a provider-specific host permission and supplies a valid Provider Credential. Each Speech Provider has an independent Provider Connection. It is not a Speak-O account and can be disconnected without affecting the user's provider account or another Provider Connection.
_Avoid_: Login, linked account

**Provider Usage**:
Metered Cloud Voice consumption charged by a Speech Provider under the user's own account. Its units are provider-specific and should not be generically described as tokens or currency.
_Avoid_: Token usage, Speak-O credits

**Generation Window**:
The bounded set of Cloud Voice sentences submitted or prepared ahead of the Reading Position: the current sentence and no more than two complete upcoming sentences.
_Avoid_: Whole-article generation, sentence queue

**Session Buffer**:
The bounded, ephemeral Cloud Voice audio and Speech Alignment retained only for the active Reading Session so playback and a recent Previous action do not require unnecessary regeneration.
_Avoid_: Audio download, persistent cache

**Voice**:
A selectable speaking identity made available by a Speech Provider.
_Avoid_: Provider, Model

**Model**:
A Speech Provider's selectable synthesis model or model version.
_Avoid_: Provider, Voice

**Cloud Voice Mode**:
A Reading Session that sends source text directly to a user-selected external Speech Provider using the user's own credential. Speak-O does not operate an intermediary service or receive that credential.
_Avoid_: Pro mode, premium voice

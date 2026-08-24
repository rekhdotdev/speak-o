# Recover Cloud Voice audio from session storage

Speak-O keeps the bounded Session Buffer as compressed audio plus Speech Alignment in `chrome.storage.session`, decodes only the active playback window in the offscreen document, and recreates that document from the Session Buffer after a long pause; this avoids duplicate Provider Usage when Chrome closes an idle audio document while ensuring audio never persists across browser restart, extension reload, update, or disable.

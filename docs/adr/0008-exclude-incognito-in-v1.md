# Exclude incognito in v1

Speak-O declares `incognito: "not_allowed"` in v1 because Chrome shares `storage.local` and `storage.sync` between regular and incognito extension processes; supporting private windows later requires an intentionally ephemeral credential and session design rather than implying that split mode isolates remembered BYOK data.

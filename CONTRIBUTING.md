# Contributing to Speak-O

Thank you for helping improve Speak-O. Keep changes aligned with the domain language in `CONTEXT.md` and the architectural decisions in `docs/adr/`.

## Development

Use Node.js 22+ and npm:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Before opening a pull request, run `npm run verify`. The command formats-checks the repository, type-checks, runs unit, fixture, and accessibility tests, builds the Chrome extension, creates the Store ZIP, and audits the actual archive.

Tests should cross a documented seam and observe behavior. Prefer the Reading Session, Extractor, Provider adapter, Browser Voice adapter, storage, and message contracts over private implementation details. Never add a live Provider Credential or live generation request to CI.

## Extraction fixtures

Commit only synthetic or sanitized HTML. Remove names, identifiers, URLs, tokens, comments, and unrelated captured content. Never commit an original X capture. An extraction change should include a fixture and assert semantic blocks, exact mappings, exclusions, or a typed refusal.

## Issues and changes

GitHub Issues are the triage surface. Extraction failures should use the extraction-failure form and include redacted diagnostics where possible. Pull requests should link the originating Issue, explain user-visible behavior, and state the verification performed.

Security reports must follow [SECURITY.md](SECURITY.md), not a public Issue.

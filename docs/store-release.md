# Speak-O Chrome Web Store release

## Current release

- Product name: speak-o
- Version: 0.1.0
- Store package: `store-assets/speak-o-0.1.0-chrome.zip` or the freshly generated `.output/speak-o-0.1.0-chrome.zip`
- Chrome Web Store: `https://chromewebstore.google.com/detail/speak-o/kjamjfihhlhhnnkbknkfjinenbfmlkgl`
- Homepage: `https://rekh.dev/speak-o/`
- Privacy policy: `https://rekh.dev/speak-o/privacy/`
- Support: `https://rekh.dev/speak-o/support/`

## Before upload

1. Deploy the Speak-O pages in the Rekh site checkout and confirm the three URLs above load over HTTPS.
2. Review the Store description in [`docs/store-listing.md`](store-listing.md).
3. Run `npm run verify`.
4. Run `npm run test:e2e`.
5. Inspect the Store images in [`store-assets/`](../store-assets/).
6. Confirm the ZIP contains the production Manifest V3 build, not the source tree or a debug build.

The automated checks do not use live ElevenLabs or Speechify credentials. Manually test Chrome Voice and, if desired, each Cloud Voice Provider Connection with your own credentials. Never place a Provider Credential in a screenshot, issue, log, fixture, or test instruction.

## Dashboard fields

- Store Listing: use the name, summary, detailed description, category, language, screenshots, promo tile, and URLs from the listing draft.
- Privacy: describe the single purpose as reading user-requested Articles or Selection aloud with synchronized highlighting; justify every permission using [`docs/store-permissions.md`](store-permissions.md); declare the actual website-content and Provider Credential handling; select no remote code.
- Distribution: publish as a free public extension unless the publisher chooses a narrower rollout.
- Test instructions: reviewers can install and use Chrome Voice without an account or Provider Credential. Explain toolbar activation, Article extraction, and the floating Reading Session controls.

## After upload

The item ID is `kjamjfihhlhhnnkbknkfjinenbfmlkgl`. The Speak-O product page now points to the final Chrome Web Store URL. Deploy the site update, confirm the homepage/privacy/support links again, and then submit the item for review. Keep the submission deferred until the public page and final listing metadata have been checked if a coordinated launch is preferred.

# speak-o Chrome Web Store submission

This directory is the handoff for submitting the `speak-o` 1.0.0 production build to the Chrome Web Store. It includes the upload package, Store screenshots, the required small promotional tile, and an optional marquee tile.

The dashboard copy below is aligned with the current extension build and the public pages that must be deployed before submitting:

- Homepage: <https://rekh.dev/speak-o/>
- Privacy policy: <https://rekh.dev/speak-o/privacy/>
- Support: <https://rekh.dev/speak-o/support/>
- Terms: <https://rekh.dev/speak-o/terms/>
- Chrome Web Store: <https://chromewebstore.google.com/detail/speak-o/kjamjfihhlhhnnkbknkfjinenbfmlkgl>
- Source and issues: <https://github.com/rekhdotdev/speak-o>

## 0. Before opening the dashboard

Complete these checks first:

1. Deploy the current `rekh.dev` checkout so the homepage, privacy, support, and terms URLs above resolve over HTTPS.
2. Run `npm run verify` in the Speak-O repository.
3. Run `npm run test:e2e` in the Speak-O repository.
4. Inspect every image in this directory at full size.
5. Confirm that the ZIP is the production package and does not contain source files, test fixtures, credentials, or debug output.
6. Manually test Chrome Voice with a public Article. If testing ElevenLabs or Speechify, use your own key and remove it before capturing or sharing anything.

The automated checks do not use live ElevenLabs or Speechify credentials and do not consume Provider Usage.

## 1. Upload the package

Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), choose the existing Speak-O item, choose the ZIP file, and upload:

```text
store-assets/speak-o-1.0.0-chrome.zip
```

The ZIP is 223.83 kB and contains the production Manifest V3 build. The generated package passed the repository's permission, code-source, and sensitive-file audit.

## 2. Store Listing tab

Select the English locale. Fill the fields as follows.

### Product details

| Field                       | Value                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Name                        | `speak-o`                                                                                          |
| Short description / summary | `Listen to Articles on the original page with calm controls, exact highlights, and Chrome Voices.` |
| Category                    | `Productivity`                                                                                     |
| Language                    | `English`                                                                                          |
| Mature content              | Leave disabled; Speak-O is not a mature-content product.                                           |

Use this as the detailed description. Paste it as plain text; do not add HTML.

```text
Speak-O is an open-source, accountless Article Reader for Chrome. Start it explicitly from the toolbar, a keyboard command, or selected prose. It captures a fixed Article Snapshot, skips surrounding page chrome, and keeps the active sentence highlighted on the original Source Page without rewriting the page.

Use a Chrome Voice with no setup, or connect an optional ElevenLabs or Speechify BYOK Cloud Voice provider. Each provider connection is independent and uses the user's own account.

The compact floating bar provides previous, play or pause, next, sentence-based progress, Playback Speed, Voice settings, details, minimize, and stop. Choose top or bottom docking, light or dark presentation, highlighting, and follow behavior.

Speak-O supports many conventional Article pages, dedicated X Articles handling, and Selection fallback. It does not claim universal extraction support, automatically read ordinary X posts or timelines, support PDFs, or operate a Rekh speech backend.

Privacy: Rekh receives no Article text, Provider Credential, Provider Usage, diagnostics, or behavioral data. Cloud Voice text goes directly from the extension to the selected ElevenLabs or Speechify API using the user's credential. Browser Voices may use remote platform services and are not guaranteed offline.
```

Do not repeat the short description as the first sentence of the detailed description. Keep the copy accurate and avoid adding a keyword list, testimonials, unsupported sites, or claims such as “best,” “fastest,” or “official.”

### Website and support URLs

| Field              | Value                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage URL       | `https://rekh.dev/speak-o/`                                                                                                                                |
| Support URL        | `https://rekh.dev/speak-o/support/`                                                                                                                        |
| Privacy policy URL | Enter this on the Privacy tab: `https://rekh.dev/speak-o/privacy/`                                                                                         |
| Official URL       | Select `https://rekh.dev` only if it appears as a verified site in your dashboard. Otherwise leave this optional field blank until the domain is verified. |

### Graphic assets

Upload the following in this order:

| Dashboard asset          | File                                  | Notes                                     |
| ------------------------ | ------------------------------------- | ----------------------------------------- |
| Store icon               | `icon-128.png`                        | 128 × 128 PNG                             |
| Screenshot 1             | `screenshots/01-onboarding.png`       | First-run setup and provider choice       |
| Screenshot 2             | `screenshots/02-provider-setup.png`   | Speech Provider setup                     |
| Screenshot 3             | `screenshots/03-credential-field.png` | Empty BYOK credential field; no real key  |
| Screenshot 4             | `screenshots/04-reading-session.png`  | Bottom-docked Reading Session             |
| Screenshot 5             | `screenshots/05-settings.png`         | Speech settings and independent providers |
| Small promotional tile   | `promo-tile-440x280.png`              | Required 440 × 280 PNG                    |
| Marquee promotional tile | `marquee-1400x560.png`                | Optional 1400 × 560 PNG                   |

The screenshots are 1280 × 800 captures from the deterministic Chromium fixture. The Article is synthetic, and all credential fields are empty. Do not replace them with a capture containing a private page, real API key, account information, or provider response.

Promotional video: no video is prepared in this repository. Leave the field blank if the dashboard marks it optional. If the dashboard requires one, create a public or unlisted YouTube walkthrough and use that URL; never enter a placeholder URL.

## 3. Privacy tab

The privacy disclosures must match the extension, the public privacy policy, and the package being uploaded. Chrome requires data handling to be disclosed even when data is processed locally or sent directly to a third-party provider.

### Single purpose

Paste:

```text
Read user-requested web Articles or selected text aloud with synchronized highlighting on the original page.
```

### Permission justifications

Use the following text for each permission shown by the dashboard:

| Permission                          | Justification                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                         | Grants temporary access to the explicitly activated Source Page so Speak-O can extract the requested Article or Selection and keep the active sentence highlighted. Speak-O does not request persistent access to every site.            |
| `contextMenus`                      | Adds the user-invoked “Read Selection with Speak-O” context-menu action for reading text the user explicitly selects.                                                                                                                    |
| `offscreen`                         | Creates the extension's offscreen audio document so generated Cloud Voice audio can be decoded and played while the Reading Session remains attached to the Source Page.                                                                 |
| `scripting`                         | Injects the reader and source-page highlighter only after the user activates Speak-O from the toolbar, keyboard command, or Selection context menu.                                                                                      |
| `storage`                           | Stores user preferences and bounded Reading Session state. Optional Provider Credentials are stored in Chrome profile storage only when the user chooses “Remember on this device”; Chrome Sync is not used.                             |
| `tts`                               | Provides Browser Voice Mode through Chrome's text-to-speech API using a Voice exposed by Chrome or the operating system.                                                                                                                 |
| ElevenLabs optional host permission | Lets the user-selected ElevenLabs API Region receive bounded Cloud Voice requests directly from the extension. The permission is requested only during a user-initiated Provider Connection and uses the user's own Provider Credential. |
| Speechify optional host permission  | Lets the user-selected Speechify API receive bounded Cloud Voice requests directly from the extension. The permission is requested only during a user-initiated Provider Connection and uses the user's own Provider Credential.         |

If the dashboard lists the five ElevenLabs API origins separately, use the same ElevenLabs justification for each one. Do not claim that Speak-O needs access to all websites, `tabs`, browsing history, or a background content script; it does not request those permissions.

### Data-use disclosures

If the dashboard asks which types of user data the extension handles, select:

- **Website content** — the Article or Selection that the user explicitly asks Speak-O to read and highlight.
- **Authentication information** — an ElevenLabs or Speechify API credential when the user chooses to connect that provider.

Do not select personally identifiable information, financial or payment information, health information, personal communications, location, form data, or user activity based on the current build. Speak-O does not collect browsing history or track the user's activity across sites. The current page is accessed only as the user-facing Article-reading feature requires.

Use this explanation if the dashboard provides a general data-use text field:

```text
Speak-O handles Website Content only after the user explicitly starts reading an Article or Selection. It extracts a bounded Article Snapshot locally, maps it to the original Source Page, and uses it to provide speech and synchronized highlighting. If the user chooses ElevenLabs or Speechify, bounded source text is sent directly from the extension to the selected Provider using the user's own Provider Credential. Rekh does not receive the Article text, credential, generated audio, diagnostics, or behavioral data.

Provider Credentials are handled only for the user's Provider Connection and are session-only by default. If the user explicitly chooses “Remember on this device,” the credential is stored in local Chrome profile storage. Speak-O has no analytics, advertising, tracking, remote configuration, or unrelated data transfer.
```

### Limited Use certifications

Accept the dashboard certifications only after checking that they describe your actual practices. For the current build, the truthful answers are:

- Speak-O does not sell user data to third parties.
- Speak-O does not use or transfer user data for purposes unrelated to its single purpose.
- Speak-O does not use or transfer user data to determine creditworthiness or for lending purposes.
- Speak-O does not use or transfer user data for personalized or targeted advertising.
- The direct transfer of bounded text to the Provider selected by the user is necessary to provide the Cloud Voice feature and is disclosed in the listing and privacy policy.

### Remote code

Choose **No, I am not using remote code**.

All executable logic is bundled in the ZIP. ElevenLabs and Speechify connections are API calls for metadata and speech; Speak-O does not download or execute JavaScript, evaluate remote logic, use `eval`, or load remotely hosted extension scripts.

### Privacy policy URL

Paste:

```text
https://rekh.dev/speak-o/privacy/
```

This page must be deployed and publicly reachable before submission. It contains the required disclosures and the Limited Use statement.

## 4. Distribution tab

Recommended values for this release:

| Field            | Value                       |
| ---------------- | --------------------------- |
| Pricing          | Free                        |
| Visibility       | Public                      |
| Regions          | All regions                 |
| In-app purchases | No Speak-O in-app purchases |

ElevenLabs and Speechify may charge users under their own accounts, but Speak-O does not charge for the extension and has no Rekh subscription or billing flow.

If you want a private test before public launch, use a separate private or unlisted submission and complete the same policy disclosures. Private and unlisted items still go through review. For the intended launch, use **Public**.

## 5. Test instructions tab

Paste the following. It deliberately does not provide credentials because the core product works without an account or Provider Credential.

| Field                     | Value       |
| ------------------------- | ----------- |
| Reviewer account required | No          |
| Test username or email    | Leave blank |
| Test password             | Leave blank |

```text
No account or test credentials are required. Please do not enter a real ElevenLabs or Speechify API key to review the core extension.

1. Install the extension and pin speak-o from the Chrome toolbar.
2. Open any public Article over HTTP or HTTPS. Do not use chrome:// pages, the Chrome Web Store, a PDF, or a local file; Chrome does not allow this extension to run there in this release. A public Chrome documentation Article is suitable for testing.
3. Click the speak-o toolbar action. On first use, the reader shows the setup prompt.
4. Choose Chrome Voice, choose any available Voice (or the automatic Voice option), and choose Finish. This path uses Chrome's text-to-speech API and needs no account or credential.
5. Confirm that the floating Reading Session appears on the Source Page. Test Play/Pause, previous and next sentence, progress, Playback Speed, minimize, and Stop. The current sentence should remain highlighted on the original page.
6. Select a short passage on the page, open the context menu, and choose “Read Selection with Speak-O” to test Selection fallback.
7. Optional Cloud Voice testing is not required for review. If you choose to test it, use your own ElevenLabs or Speechify account and API key. Cloud Voice text is sent directly to the selected Provider; Rekh is not an intermediary. Do not expect us to provide reviewer credentials.
8. If automatic Article extraction is not confident on a particular page, select the exact prose and use the Selection context-menu action. This conservative fallback is expected behavior.
```

Do not put an API key, password, private URL, personal page, or real account details in this field. Do not use a test credential that could be exposed in a reviewer-visible field.

## 6. Save, review, and submit

1. Save the Store Listing tab and check the preview at desktop and narrow widths.
2. Save the Privacy tab and compare every answer against [`docs/store-permissions.md`](../docs/store-permissions.md) and the [hosted privacy policy](https://rekh.dev/speak-o/privacy/).
3. Save the Distribution tab.
4. Save the Test instructions tab.
5. Resolve any dashboard validation errors. Do not “fix” a warning by claiming that Speak-O collects no data; it handles Website Content and optional Authentication information as described above.
6. Submit for review.
7. The item ID is `kjamjfihhlhhnnkbknkfjinenbfmlkgl`; verify the public Store listing and Rekh links after the approved update is published.

The official dashboard references are [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/), [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/), [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [Prepare distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/).

## Files in this directory

| File                                  | Use                       | Dimensions |
| ------------------------------------- | ------------------------- | ---------- |
| `icon-128.png`                        | Store icon                | 128 × 128  |
| `screenshots/01-onboarding.png`       | First-run setup           | 1280 × 800 |
| `screenshots/02-provider-setup.png`   | Provider setup            | 1280 × 800 |
| `screenshots/03-credential-field.png` | Empty credential state    | 1280 × 800 |
| `screenshots/04-reading-session.png`  | Reading Session           | 1280 × 800 |
| `screenshots/05-settings.png`         | Speech settings           | 1280 × 800 |
| `promo-tile-440x280.png`              | Required small promo tile | 440 × 280  |
| `marquee-1400x560.png`                | Optional marquee tile     | 1400 × 560 |
| `speak-o-1.0.0-chrome.zip`            | Production package        | 223.60 kB  |

The promotional PNGs are rendered from [`promo-tile.svg`](promo-tile.svg) and [`marquee.svg`](marquee.svg), so the artwork remains editable. The ZIP is a local handoff artifact and should not be treated as a source release.

## Regenerating the handoff

Run the verification commands from the repository root:

```sh
npm run verify
npm run test:e2e
```

Refresh the screenshots from the current E2E output, render the SVG promotional sources to their declared PNG dimensions, and copy the newest `.output/speak-o-1.0.0-chrome.zip` here. Recheck that no credential, private page, live provider response, or test-only file entered the upload set.

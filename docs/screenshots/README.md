# Screenshot verification

`npm run test:e2e` builds the production extension and runs the unpacked-Chromium evidence seam against `tests/e2e/fixtures/article.html`. The fixture is synthetic, so screenshots never contain private or unsanitized pages. Production builds keep `DEBUG_MODE` off; use `WXT_DEBUG_MODE=true npm run build` only when deliberately producing a diagnostic build.

The automated run captures:

- first-use onboarding reached through the command-equivalent injection and extraction path (headless Chromium does not route synthetic keyboard events through `chrome.commands`);
- bottom-docked light controls with native read-only `<progress>`;
- the expanded detail row;
- minimized controls with the focused play/pause action and visible maximize action;
- top-docked dark controls with sentence and nested current-word highlights.

The Playwright HTML report, screenshots, and failure traces are retained by CI and tagged-release workflows. They are release evidence and are not bundled into the extension ZIP.

Review the images for Source Page interference, overlap, clipping, target size, focus visibility, contrast, hierarchy, and disclosure accuracy. Keep native toolbar clicks, context menus, installed OS voices, audible speech timing, long-idle service-worker recovery, narrow/zoomed layouts, forced colors, RTL strings, options-page sizing, Cloud Voice, and provider recovery states in the manual release checklist until each has its own deterministic seam.

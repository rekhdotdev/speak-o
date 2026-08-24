# Screenshot verification matrix

Release screenshots are captured from deterministic synthetic Article fixtures, never from private or unsanitized pages. Capture at device scale factor 1 unless the scenario specifies otherwise.

- Bottom and top dock: ready and playing
- Minimized and expanded controls
- Light, dark, and system themes
- Narrow 360 px viewport and 200 percent browser zoom
- Buffering, Provider Usage guard, provider issue, and Source Page changed recovery
- First-use onboarding and Voice picker
- Options sections at desktop and narrow widths
- Forced colors and RTL-derived interface strings

Review each image for Source Page interference, overlap, clipping, target size, focus visibility, contrast, hierarchy, and disclosure accuracy. Generated screenshots are release evidence and are not bundled into the extension ZIP.

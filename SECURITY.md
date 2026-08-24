# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository: open the repository's **Security** tab, choose **Advisories**, then **Report a vulnerability**. Do not include a Provider Credential, Article prose, generated audio, or an unredacted URL.

If private reporting is unavailable, contact Rekh through the security contact published on `rekh.dev` and reference Speak-O. Do not open a public Issue until maintainers have coordinated disclosure.

Include the affected Speak-O version, Chrome version, operating system, minimal reproduction, impact, and locally generated redacted diagnostics when relevant. We will acknowledge a complete report, investigate it privately, and coordinate a fix and disclosure.

## Supported versions

Speak-O is currently a public beta. Security fixes target the latest tagged release and `main`.

## Security boundary

Speak-O intentionally accepts a client-side BYOK owner-key model. Session-only storage is the default; remembered keys use Chrome profile storage without additional application-level encryption. Content scripts and the offscreen document never receive the Provider Credential or provider network authority. See [the threat model](docs/threat-model.md).

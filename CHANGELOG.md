# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-21

### Added

- First version: your Nightscout site in Gladys, read only. **Not a medical
  device.**
- One device per site: glucose (mg/dL or mmol/L), change over 5 minutes,
  trend number and arrow, age of the measurement, out of target range, and
  the uploader battery when the site reports it. No history by default.
- Scene triggers: glucose low, very low, high (thresholds of Nightscout or
  fixed ones), back in range, rising fast, falling fast, measurement too old.
  Once per crossing, kept across restarts.
- Scene action "Read the glucose": the value, its trend, its age and a ready
  sentence for a message.
- Dashboard widget: glucose colored by the range of the site, trend, age and
  the curve of the last three hours.
- Access token (recommended), API_SECRET or public site; a self-hosted or a
  hosted site (local or cloud badge).
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-nightscout/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-nightscout/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-nightscout/releases/tag/v1.0.0

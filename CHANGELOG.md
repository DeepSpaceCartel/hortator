# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-20

### Added

- Status bar items for the 5-hour session window, the weekly window, and per-model weekly windows such as Fable. Each has a mini bar with a divider at the steady-pace position.
- Activity Bar panel with full-width bars, a marker for steady pace, and shading for unused quota or usage ahead of pace.
- Notifications when a window moves between behind, on, and ahead of pace, with a cooldown and per-window and per-state filters. Shown once across all open windows, by the focused one, and merged when several windows change state together.
- Usage endpoint source (undocumented `api.anthropic.com/api/oauth/usage`), gated behind a one-time permission prompt. Polls every 5 minutes by default, shares one reading and one rate-limit backoff between all VS Code windows, and honours `Retry-After`.
- Claude Code status line source that saves the documented `rate_limits` data, with a command that copies the setup to the clipboard.

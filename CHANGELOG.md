# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-20

### Added

- Status bar items for the 5-hour session window, the weekly window, and per-model weekly windows such as Fable. Each has a mini bar with a divider at the steady-pace position.
- Status bar items colored by pace state: yellow when ahead, green on pace, unchanged when behind, with the theme's warning and error backgrounds at 95% and 100% used. The panel shows the delta to the pace marker as solid green (unused quota, behind pace) or red (usage beyond the marker, ahead of pace). All are theme colors (`hortator.ahead`, `hortator.onPace`, `hortator.deltaBehind`, `hortator.deltaAhead`) that can be overridden.
- Activity Bar panel with full-width bars, a marker for steady pace, and shading for unused quota or usage ahead of pace.
- Notifications when a window moves between behind, on, and ahead of pace, with a cooldown and per-window and per-state filters. Shown once across all open windows, by the focused one, and merged when several windows change state together.
- Default source: the usage Claude Code caches in its own `.claude.json` (`cachedUsageUtilization`). Makes no network requests, does not use your login, and includes per-model windows such as Fable.
- Optional usage endpoint source (undocumented `api.anthropic.com/api/oauth/usage`), off by default and gated behind a one-time permission prompt. Polls every 5 minutes, shares one reading and one rate-limit backoff between all VS Code windows, honours `Retry-After`, escalates repeated 429s, and shows the server's message and the next attempt time.
- Claude Code status line source that saves the documented `rate_limits` data. A command sets the hook up (never replacing an existing status line, with a backup), another copies the setting to the clipboard, and the hook is offered once when the endpoint is failing.

# Hortator

Track your Claude subscription usage against a **steady pace**, right in VS Code.

Claude plans give you a 5-hour session limit and weekly limits. Hortator shows how much of each you have used, and puts a marker where your usage would be if you spread it evenly over the window. Behind the marker means you are leaving quota you pay for on the table. Past it means you are burning faster than steady and may run out early.

> Not affiliated with or endorsed by Anthropic.

## Features

- **Status bar**: one item per window, for example `W ██│░░░░░░ 6%`. The `│` divider is the steady-pace position; empty cells to its left are unused quota. Hover for details, click to open the panel. Colors: **yellow** when ahead of pace (you may run out early), **green** on pace, and the normal text color when behind. At 95% used the item takes the theme's warning background, and at 100% its error background.
- **Activity Bar panel**: full-width bars with the pace marker. When behind, the stretch between the fill and the marker is **green**: quota you could still use to be on pace. When ahead, the stretch of fill beyond the marker is **red**.
- **Windows**: session (5h), weekly, and per-model weekly limits such as Fable when your plan has them.
- **Notifications** when a window moves between *behind*, *on*, and *ahead* of pace. Ahead notifications say when you would hit the limit at your current rate.

## Getting started

Hortator needs a Claude Pro or Max subscription and Claude Code used on the machine where the extension runs (for remote workspaces, that is the remote machine).

1. Install the extension.
2. Use Claude Code as usual. Hortator shows the usage Claude Code keeps up to date on disk, so there is nothing to configure.
3. Look at the bottom-left status bar and open the Hortator icon in the Activity Bar.

## Privacy and network use

- By default Hortator makes **no network requests** and never touches your login. It reads one entry, `cachedUsageUtilization`, from Claude Code's `.claude.json` (in `$CLAUDE_CONFIG_DIR` if set, else your home directory), and ignores the rest of that file.
- The optional status line hook only writes the rate limits Claude Code hands it to a local file.
- The optional usage endpoint (off by default) reads Claude Code's saved login (`~/.claude/.credentials.json`, or the macOS keychain) and sends its access token to `https://api.anthropic.com/api/oauth/usage`, the same host and login Claude Code itself uses. It asks for your permission once before doing so. The token is never written anywhere by Hortator or sent to any other host.
- Hortator has no telemetry.

## Data sources

| Source | Provides | Notes |
| --- | --- | --- |
| Claude Code's usage cache | session, weekly, per-model | **Default.** Read from `.claude.json`, where Claude Code stores what it last fetched. The format is undocumented and could change. It is only as fresh as Claude Code's last refresh (the panel says how old the reading is) and does not update while no Claude Code session is running. |
| Status line hook | session, weekly | Uses Claude Code's documented status line data, so it only updates while a session is active. Run **Hortator: Set up Claude Code status line hook**. It adds the hook to `~/.claude/settings.json` (keeping a backup) unless you already have a different `statusLine`, which it never replaces. **Hortator: Copy Claude Code status line setup** copies the setting instead, to merge by hand. |
| Usage endpoint | session, weekly, per-model | Opt-in with `hortator.endpoint.enabled`. Works without a Claude Code session, but the endpoint is undocumented and heavily rate limited (see below). |

Every source that is available runs, and the newest reading per window wins.

**Rate limiting of the usage endpoint.** If you enable it, note that it is rate limited per account and can refuse requests for hours, even at one request per five minutes. Hortator polls every 5 minutes, shares one reading between all windows on the machine (in `<claude config dir>/hortator/usage-cache.json`, which holds usage percentages but no token), honours `Retry-After` when it is usable, escalates repeated `HTTP 429` responses up to 30 minutes, and shows the server's message and when it will try again. That is why it is not the default.

## Notifications

A notification appears when a window **enters** a new state, not on every poll:

| State | Meaning | Message |
| --- | --- | --- |
| behind | more than `hortator.tolerance` (5%) under the steady pace | there is unused quota, you can speed up |
| on | within the tolerance | back on pace |
| ahead | more than the tolerance over the pace | slow down, with the time until you would hit the limit |

To keep it from nagging:

- Only weekly windows notify by default. The 5h session window swings between ahead and behind with normal work; add `"session"` to `hortator.notifications.windows` to include it.
- The same window notifies for the same state at most once per `hortator.notifications.cooldownHours` (12).
- Readings older than 15 minutes never notify, and a window first seen already on pace stays quiet.
- With several VS Code windows open, each notification is shown once, by the window you are looking at. What was already shown is recorded in `<claude config dir>/hortator/notify-state.json`, shared by all windows. A notification that comes up while no window is focused appears when you come back.
- Windows that change state at the same moment (for example weekly and a per-model limit) are merged into a single notification.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `hortator.tolerance` | `5` | Percent of the window around the pace marker that counts as on pace. |
| `hortator.claudeCache.enabled` | `true` | Read the usage Claude Code caches in `.claude.json`. No network. |
| `hortator.statusBar.colors` | `true` | Color status bar items (yellow ahead, green on pace). |
| `hortator.endpoint.enabled` | `false` | Also poll the usage endpoint (still needs your permission). |
| `hortator.endpoint.intervalSeconds` | `300` | How often to poll it (minimum 60). |
| `hortator.file.path` | empty | Status line hook output file. Empty means `<claude config dir>/hortator/rate_limits.json`. |
| `hortator.notifications.enabled` | `true` | Show notifications. |
| `hortator.notifications.windows` | `["weekly"]` | Which windows notify: `session`, `weekly`. |
| `hortator.notifications.states` | all three | Which transitions notify: `behind`, `on`, `ahead`. |
| `hortator.notifications.cooldownHours` | `12` | Minimum hours between repeats for the same window and state. |

## Colors

All colors are theme colors, so they follow light and dark themes and you can change them in `workbench.colorCustomizations`:

| Color | Default | Used for |
| --- | --- | --- |
| `hortator.ahead` | `charts.yellow` | Status bar text when a window is ahead of pace. |
| `hortator.onPace` | `charts.green` | Status bar text when a window is on pace. |
| `hortator.deltaBehind` | `charts.green` | Panel: the part of the pace not yet used. |
| `hortator.deltaAhead` | `charts.red` | Panel: usage beyond the pace marker. |

```json
"workbench.colorCustomizations": {
  "hortator.ahead": "#e5c07b",
  "hortator.deltaAhead": "#e06c75"
}
```

A window that is behind pace keeps the status bar's normal text color. Some themes give the defaults little contrast on the status bar; override them there, or turn status bar coloring off with `hortator.statusBar.colors`.

## Commands

- **Hortator: Show usage**
- **Hortator: Refresh now**, also the refresh button in the panel's title bar. Re-reads the local sources and shows when it last checked; the endpoint, if enabled, at most once every 30 seconds. It cannot make Claude Code refresh its own cache.
- **Hortator: Allow usage endpoint (uses Claude Code login)**
- **Hortator: Stop using Claude Code login**
- **Hortator: Set up Claude Code status line hook**
- **Hortator: Copy Claude Code status line setup**

## Notes

- A window whose reset time has passed is hidden until new data arrives, so the session bar disappears between 5h sessions.
- Pace for a window is `(now - (resets_at - length)) / length`, with lengths of 5h (session) and 7d (weekly).

## Development

```
npm test            # unit tests, no dependencies
```

Open the folder in VS Code and press **F5** to run the extension in a development host. To install a build, see [RELEASING.md](RELEASING.md).

# Hortator

Track your Claude subscription usage against a **steady pace**, right in VS Code.

Claude plans give you a 5-hour session limit and weekly limits. Hortator shows how much of each you have used, and puts a marker where your usage would be if you spread it evenly over the window. Behind the marker means you are leaving quota you pay for on the table. Past it means you are burning faster than steady and may run out early.

> Not affiliated with or endorsed by Anthropic.

## Features

- **Status bar**: one item per window, for example `W ██│░░░░░░ 6%`. The `│` divider is the steady-pace position; empty cells to its left are unused quota. Hover for details, click to open the panel.
- **Activity Bar panel**: full-width bars. The striped area between the fill and the marker is quota not yet used; amber past the marker is usage ahead of pace.
- **Windows**: session (5h), weekly, and per-model weekly limits such as Fable when your plan has them.
- **Notifications** when a window moves between *behind*, *on*, and *ahead* of pace. Ahead notifications say when you would hit the limit at your current rate.

## Getting started

Hortator needs a Claude Pro or Max subscription and a Claude Code login on the machine where the extension runs (for remote workspaces, that is the remote machine).

1. Install the extension.
2. On first run it asks once whether it may use Claude Code's saved login to fetch your usage limits. Choose **Allow**. You can change your mind at any time with **Hortator: Allow usage endpoint** or **Hortator: Stop using Claude Code login**.
3. Look at the bottom-left status bar and open the Hortator icon in the Activity Bar.

## Privacy and network use

- With your permission, Hortator reads Claude Code's saved login (`~/.claude/.credentials.json`, or the macOS keychain) and sends its access token to `https://api.anthropic.com/api/oauth/usage`. That is the same host and login Claude Code itself uses.
- That endpoint is **undocumented**. It can change or disappear without notice; if it does, Hortator shows an error note in the panel and backs off.
- The token is never written anywhere by Hortator or sent to any other host. Hortator has no telemetry.
- Without permission, or with `hortator.endpoint.enabled` off, nothing is sent. Only the status line source below works.

## Data sources

| Source | Provides | Notes |
| --- | --- | --- |
| Usage endpoint | session, weekly, per-model | Needs the permission above. Works without a running Claude Code session. |
| Status line hook | session, weekly | Uses Claude Code's documented status line data, so it only updates while a session is active. Run **Hortator: Copy Claude Code status line setup** and paste the result into `~/.claude/settings.json` (it replaces any existing `statusLine`). |

Both run when available and the newest reading per window wins.

The usage endpoint is rate limited per account, and every VS Code window you have open would otherwise poll it separately. So Hortator polls every 5 minutes, shares one reading between all windows on the machine (in `<claude config dir>/hortator/usage-cache.json`, which holds usage percentages but no token), and honours `Retry-After` when it gets `HTTP 429`, for all windows at once. While rate limited, the panel and the status bar show when it will try again.

## Notifications

A notification appears when a window **enters** a new state, not on every poll:

| State | Meaning | Message |
| --- | --- | --- |
| behind | more than `hortator.tolerance` (5) points under the steady pace | there is unused quota, you can speed up |
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
| `hortator.tolerance` | `5` | Percentage points around the pace marker that count as on pace. |
| `hortator.endpoint.enabled` | `true` | Use the usage endpoint (still needs your permission). |
| `hortator.endpoint.intervalSeconds` | `300` | How often to poll it (minimum 60). |
| `hortator.file.path` | empty | Status line hook output file. Empty means `<claude config dir>/hortator/rate_limits.json`. |
| `hortator.notifications.enabled` | `true` | Show notifications. |
| `hortator.notifications.windows` | `["weekly"]` | Which windows notify: `session`, `weekly`. |
| `hortator.notifications.states` | all three | Which transitions notify: `behind`, `on`, `ahead`. |
| `hortator.notifications.cooldownHours` | `12` | Minimum hours between repeats for the same window and state. |

## Commands

- **Hortator: Show usage**
- **Hortator: Refresh now** (at most once every 30 seconds)
- **Hortator: Allow usage endpoint (uses Claude Code login)**
- **Hortator: Stop using Claude Code login**
- **Hortator: Copy Claude Code status line setup**

## Notes

- A window whose reset time has passed is hidden until new data arrives, so the session bar disappears between 5h sessions.
- Pace for a window is `(now - (resets_at - length)) / length`, with lengths of 5h (session) and 7d (weekly).

## Development

```
npm test            # unit tests, no dependencies
```

Open the folder in VS Code and press **F5** to run the extension in a development host. To install a build, see [RELEASING.md](RELEASING.md).

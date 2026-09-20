# Claude Pace

VS Code extension that shows Claude subscription usage (session, weekly, and per-model windows such as Fable) and a marker for where usage would be if spent at a steady pace. A fill behind the marker means unused quota.

- **Status bar** (bottom left): one item per window, e.g. `W ██░│░░░░░ 6%`. The `│` divider is the steady-pace position. Hover for details, click to open the view.
- **Explorer view "Claude Pace"**: full-width bars. Striped area between fill and marker is quota not yet used; amber past the marker is usage ahead of pace.

## Data sources

Both run by default and the newest reading per window wins.

| Source | Provides | Notes |
| --- | --- | --- |
| `endpoint` | session, weekly, per-model (Fable) | Polls the **undocumented** `api.anthropic.com/api/oauth/usage` with Claude Code's login from `~/.claude/.credentials.json` (macOS keychain on darwin). Works without a session. No stability guarantee; failures show as a note and back off. Disable with `claudePace.endpoint.enabled`. |
| `statusline` | session, weekly | Documented Claude Code status line data, only updated while a session is active. |

To enable the status line source, add to `~/.claude/settings.json` (this replaces any existing `statusLine`):

```json
{ "statusLine": { "type": "command", "command": "node /home/hortator/scripts/statusline.js" } }
```

## Develop

```
npm test     # unit tests, no dependencies
```

Open this folder in VS Code and press F5 (Run Extension). The extension runs in the workspace (remote) extension host, where `~/.claude` lives.

## Notes

- A window whose reset time has passed is hidden until new data arrives, so the session bar disappears between 5h sessions.
- Pace for a window is `(now - (resets_at - length)) / length`, with lengths 5h (session) and 7d (weekly).

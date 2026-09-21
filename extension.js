'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { withPace, formatDuration } = require('./src/pace');
const { merge } = require('./src/windows');
const { statusLabel, describe, tooltip, formatClock, formatError } = require('./src/text');
const { fileSource } = require('./src/sources/file');
const { endpointSource } = require('./src/sources/endpoint');
const { PaceView } = require('./src/view');
const { combine } = require('./src/notify');
const { claimNotifications } = require('./src/claim');

const TICK_MS = 15 * 1000;
const NOTIFY_MAX_READING_AGE_MS = 15 * 60 * 1000;
// undefined = never asked, true = allowed, false = declined.
const CONSENT_KEY = 'endpointConsent';

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function activate(context) {
  const view = new PaceView();
  const log = vscode.window.createOutputChannel('Hortator', { log: true });
  context.subscriptions.push(log);
  const snapshots = new Map();
  const errors = new Map();
  let running = [];
  let items = [];
  let itemKey = null;

  const focus = 'hortator.focus';

  const endpointEnabled = () => vscode.workspace.getConfiguration('hortator').get('endpoint.enabled', true);
  const consent = () => context.globalState.get(CONSENT_KEY);
  const endpointAllowed = () => endpointEnabled() && consent() === true;

  /** One status bar item per window so each gets its own tooltip; rebuilt when the set of windows changes. */
  const syncItems = (windows) => {
    const key = windows.map((w) => w.id).join('|');
    if (key === itemKey) return;
    itemKey = key;
    items.forEach((i) => i.dispose());
    const count = Math.max(windows.length, 1);
    items = Array.from({ length: count }, (_, i) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100 - i);
      item.command = focus;
      item.show();
      return item;
    });
  };

  const render = () => {
    const now = Date.now();
    const tolerance = vscode.workspace.getConfiguration('hortator').get('tolerance', 5);
    const windows = merge(snapshots.values(), now).map((w) => withPace(w, now, tolerance));

    const errorNotes = [...errors].map(([id, e]) => `${id}: ${formatError(e, now)}`);
    syncItems(windows);
    if (windows.length === 0) {
      const retryAt = Math.min(...[...errors.values()].map((e) => e.retryAt ?? Infinity));
      items[0].text = Number.isFinite(retryAt) && retryAt > now ? `$(warning) Hortator · retry ${formatClock(retryAt, now)}` : '$(pulse) Hortator';
      items[0].tooltip = ['No usage data yet', ...errorNotes].join('\n\n');
    }
    windows.forEach((w, i) => {
      items[i].text = i === 0 ? `$(pulse) ${statusLabel(w)}` : statusLabel(w);
      const md = new vscode.MarkdownString(tooltip(w, now));
      items[i].tooltip = md;
    });

    const notes = [
      ...[...snapshots].map(([id, s]) => ({ text: `${id}: read ${formatDuration(now - s.updatedAt)} ago` })),
      ...errorNotes.map((text) => ({ text, error: true })),
    ];
    if (endpointEnabled() && consent() !== true) {
      notes.push({ text: 'endpoint: off until allowed (Command Palette: "Hortator: Allow usage endpoint")' });
    }
    view.update({
      windows: windows.map((w) => ({ ...w, summary: describe(w), resetsIn: formatDuration(w.resetsAt - now) })),
      notes,
      empty: endpointAllowed()
        ? 'No usage data yet. See the notes below, and the "Hortator" output channel for details.'
        : 'No usage data yet. Run "Hortator: Allow usage endpoint" from the Command Palette, or set up the Claude Code status line hook (see the README).',
    });
    notify(windows, now);
  };

  const notify = (windows, now) => {
    const cfg = vscode.workspace.getConfiguration('hortator.notifications');
    if (!cfg.get('enabled', true)) return;
    // Only the window you are looking at speaks, so a popup is never lost in a background window.
    if (!vscode.window.state.focused) return;
    // Every open window sees the same readings; the claim makes sure exactly one of them shows each notification.
    const toShow = claimNotifications(path.join(configDir(), 'hortator'), windows, now, {
      groups: cfg.get('windows', ['weekly']),
      states: cfg.get('states', ['behind', 'on', 'ahead']),
      cooldownMs: cfg.get('cooldownHours', 12) * 3600 * 1000,
      maxAgeMs: NOTIFY_MAX_READING_AGE_MS,
    });
    for (const n of combine(toShow)) {
      const show = n.level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      show(n.text, 'Show usage').then((pick) => pick && vscode.commands.executeCommand(focus));
    }
  };

  const startSources = () => {
    running.forEach((r) => r.dispose());
    running = [];
    snapshots.clear();
    errors.clear();

    const cfg = vscode.workspace.getConfiguration('hortator');
    const specs = [fileSource({ file: cfg.get('file.path') || path.join(configDir(), 'hortator', 'rate_limits.json') })];
    if (endpointAllowed()) {
      specs.push(endpointSource({ intervalMs: cfg.get('endpoint.intervalSeconds', 300) * 1000, configDir: configDir(), log }));
    }
    for (const spec of specs) {
      running.push(
        spec.start(
          (snap) => {
            snapshots.set(spec.id, snap);
            errors.delete(spec.id);
            render();
          },
          (msg, meta) => {
            errors.set(spec.id, { msg, retryAt: meta?.retryAt });
            render();
          },
        ),
      );
    }
  };

  let asking = false;
  /** One-time permission to read Claude Code's login. Dismissing the prompt asks again next start. */
  const askConsent = async () => {
    if (asking || !endpointEnabled() || consent() !== undefined) return;
    asking = true;
    const pick = await vscode.window.showInformationMessage(
      "Hortator can fetch your full usage limits (including per-model ones like Fable) by sending Claude Code's saved login token to api.anthropic.com. It uses an undocumented endpoint. Allow it?",
      'Allow',
      "Don't allow",
    );
    asking = false;
    if (!pick) return;
    await setConsent(pick === 'Allow');
  };

  const setConsent = async (allowed) => {
    await context.globalState.update(CONSENT_KEY, allowed);
    if (allowed && !endpointEnabled()) {
      // The settings listener restarts the sources.
      await vscode.workspace.getConfiguration('hortator').update('endpoint.enabled', true, vscode.ConfigurationTarget.Global);
      return;
    }
    startSources();
    render();
  };

  /** Copies the status line script to a path that survives extension updates and puts the setting on the clipboard. */
  const copyStatusLineSetup = async () => {
    try {
      const dest = path.join(configDir(), 'hortator', 'statusline.js');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(context.extensionPath, 'scripts', 'statusline.js'), dest);
      const setting = { statusLine: { type: 'command', command: `node "${dest}"` } };
      await vscode.env.clipboard.writeText(JSON.stringify(setting, null, 2));
      vscode.window.showInformationMessage(
        `Copied the statusLine setting to the clipboard. Paste it into ${path.join(configDir(), 'settings.json')} (it replaces any existing statusLine).`,
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Hortator: could not set up the status line script: ${e.message}`);
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hortator.view', view),
    vscode.commands.registerCommand('hortator.allowEndpoint', () => setConsent(true)),
    vscode.commands.registerCommand('hortator.revokeEndpoint', () => setConsent(false)),
    vscode.commands.registerCommand('hortator.copyStatusLineSetup', copyStatusLineSetup),
    vscode.commands.registerCommand(focus, () => vscode.commands.executeCommand('hortator.view.focus')),
    vscode.commands.registerCommand('hortator.refresh', () => running.forEach((r) => r.refresh?.(true))),
    vscode.window.onDidChangeWindowState((s) => s.focused && render()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('hortator')) return;
      // Only the data sources need a restart; everything else is read on each render.
      if (e.affectsConfiguration('hortator.endpoint') || e.affectsConfiguration('hortator.file')) startSources();
      render();
    }),
    { dispose: () => running.forEach((r) => r.dispose()) },
    { dispose: () => items.forEach((i) => i.dispose()) },
  );

  // The pace marker moves with the clock even when no new reading arrives.
  const tick = setInterval(() => {
    running.forEach((r) => r.refresh?.(false));
    render();
  }, TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

  startSources();
  render();
  askConsent();
}

function deactivate() {}

module.exports = { activate, deactivate };

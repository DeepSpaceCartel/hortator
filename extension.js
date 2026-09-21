'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { withPace, formatDuration } = require('./src/pace');
const { merge } = require('./src/windows');
const { statusLabel, describe, tooltip, statusStyle, formatClock, formatError } = require('./src/text');
const { fileSource } = require('./src/sources/file');
const { endpointSource } = require('./src/sources/endpoint');
const { claudeCacheSource } = require('./src/sources/claude-cache');
const { PaceView } = require('./src/view');
const { combine } = require('./src/notify');
const { claimNotifications, claimOnce } = require('./src/claim');
const { addStatusLine } = require('./src/statusline-setup');

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
  let offered = false;
  let lastRefresh = 0;

  const focus = 'hortator.focus';

  const endpointEnabled = () => vscode.workspace.getConfiguration('hortator').get('endpoint.enabled', false);
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
    const colored = vscode.workspace.getConfiguration('hortator').get('statusBar.colors', true);
    windows.forEach((w, i) => {
      items[i].text = i === 0 ? `$(pulse) ${statusLabel(w)}` : statusLabel(w);
      const md = new vscode.MarkdownString(tooltip(w, now));
      items[i].tooltip = md;
      const style = colored ? statusStyle(w) : {};
      items[i].color = style.color && new vscode.ThemeColor(style.color);
      items[i].backgroundColor = style.background && new vscode.ThemeColor(style.background);
    });

    const notes = [
      ...[...snapshots].map(([id, s]) => ({ text: `${id}: read ${formatDuration(now - s.updatedAt)} ago` })),
      ...errorNotes.map((text) => ({ text, error: true })),
    ];
    // Claude Code writes the cache, so a refresh may find nothing new; this shows that the check did happen.
    if (lastRefresh) notes.push({ text: `last checked ${formatClock(lastRefresh, now)}` });
    if (errors.has('endpoint') && !snapshots.has('statusline')) {
      notes.push({ text: 'Tip: the status line hook needs no endpoint. Run "Hortator: Copy Claude Code status line setup" for session and weekly bars.' });
    }
    if (endpointEnabled() && consent() !== true) {
      notes.push({ text: 'endpoint: off until allowed (Command Palette: "Hortator: Allow usage endpoint")' });
    }
    view.update({
      windows: windows.map((w) => ({ ...w, summary: describe(w), resetsIn: formatDuration(w.resetsAt - now) })),
      notes,
      empty:
        'No usage data yet. Hortator shows the usage Claude Code caches in .claude.json, which appears once Claude Code has fetched it. See the notes below, and the README for the status line hook and the usage endpoint.',
    });
    notify(windows, now);
    offerStatusLine();
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
    if (cfg.get('claudeCache.enabled', true)) specs.push(claudeCacheSource());
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

  const hortatorDir = () => path.join(configDir(), 'hortator');

  /** Copies the status line script to a path that survives extension updates and returns the command that runs it. */
  const installStatusLineScript = () => {
    const dest = path.join(hortatorDir(), 'statusline.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(context.extensionPath, 'scripts', 'statusline.js'), dest);
    return `node "${dest}"`;
  };

  const copyStatusLineSetup = async () => {
    try {
      const setting = { statusLine: { type: 'command', command: installStatusLineScript() } };
      await vscode.env.clipboard.writeText(JSON.stringify(setting, null, 2));
      vscode.window.showInformationMessage(
        `Copied the statusLine setting to the clipboard. Paste it into ${path.join(configDir(), 'settings.json')} (it replaces any existing statusLine).`,
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Hortator: could not set up the status line script: ${e.message}`);
    }
  };

  /** Adds the status line to Claude Code's settings.json, unless one is already there that is not ours. */
  const setupStatusLine = async () => {
    try {
      const command = installStatusLineScript();
      const file = path.join(configDir(), 'settings.json');
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const result = addStatusLine(before, command);
      if (result.status === 'exists') {
        vscode.window.showInformationMessage('Hortator: the status line hook is already set up.');
      } else if (result.status === 'added') {
        if (before) fs.copyFileSync(file, `${file}.hortator-backup`);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, result.text);
        fs.renameSync(tmp, file);
        vscode.window.showInformationMessage(
          `Hortator: added the status line hook to ${file}${before ? ' (backup: settings.json.hortator-backup)' : ''}. Bars appear after Claude Code's next response; restart a session if they do not.`,
        );
      } else {
        // Never overwrite someone else's status line or a file we cannot parse.
        await vscode.env.clipboard.writeText(JSON.stringify({ statusLine: { type: 'command', command } }, null, 2));
        const why = result.status === 'conflict' ? `it already has a statusLine (${result.existing})` : 'it could not be parsed as JSON';
        vscode.window.showWarningMessage(`Hortator left ${file} alone because ${why}. The Hortator setting is on your clipboard to merge in by hand.`);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Hortator: could not set up the status line hook: ${e.message}`);
    }
  };

  /** Offers the hook once per machine when the endpoint is failing and no hook data has arrived. */
  const offerStatusLine = () => {
    if (offered || !errors.has('endpoint') || snapshots.has('statusline') || !vscode.window.state.focused) return;
    offered = true;
    if (!claimOnce(hortatorDir(), 'statusline-offer')) return;
    vscode.window
      .showInformationMessage(
        'Hortator cannot get usage from the endpoint right now. The Claude Code status line hook gives session and weekly usage without it. Set it up?',
        'Set up',
        'Not now',
      )
      .then((pick) => pick === 'Set up' && setupStatusLine());
  };

  /** Re-reads every source now (the endpoint, if on, at most every 30 seconds) and shows progress in the panel. */
  const refresh = () =>
    vscode.window.withProgress({ location: { viewId: 'hortator.view' } }, async () => {
      running.forEach((r) => r.refresh?.(true));
      lastRefresh = Date.now();
      render();
      // Long enough for the progress bar to be seen.
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hortator.view', view),
    vscode.commands.registerCommand('hortator.allowEndpoint', () => setConsent(true)),
    vscode.commands.registerCommand('hortator.revokeEndpoint', () => setConsent(false)),
    vscode.commands.registerCommand('hortator.copyStatusLineSetup', copyStatusLineSetup),
    vscode.commands.registerCommand('hortator.setupStatusLine', setupStatusLine),
    vscode.commands.registerCommand(focus, () => vscode.commands.executeCommand('hortator.view.focus')),
    vscode.commands.registerCommand('hortator.refresh', refresh),
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

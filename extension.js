'use strict';

const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { withPace, formatDuration } = require('./src/pace');
const { merge } = require('./src/windows');
const { statusLabel, describe, tooltip } = require('./src/text');
const { fileSource } = require('./src/sources/file');
const { endpointSource } = require('./src/sources/endpoint');
const { PaceView } = require('./src/view');

const TICK_MS = 15 * 1000;

function activate(context) {
  const view = new PaceView();
  const snapshots = new Map();
  const errors = new Map();
  let running = [];
  let items = [];
  let itemKey = null;

  const focus = 'claudePace.focus';

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
    const tolerance = vscode.workspace.getConfiguration('claudePace').get('tolerance', 5);
    const windows = merge(snapshots.values(), now).map((w) => withPace(w, now, tolerance));

    syncItems(windows);
    if (windows.length === 0) {
      items[0].text = '$(pulse) Claude Pace';
      items[0].tooltip = 'No usage data yet';
    }
    windows.forEach((w, i) => {
      items[i].text = i === 0 ? `$(pulse) ${statusLabel(w)}` : statusLabel(w);
      const md = new vscode.MarkdownString(tooltip(w, now));
      items[i].tooltip = md;
    });

    const notes = [
      ...[...snapshots].map(([id, s]) => ({ text: `${id}: read ${formatDuration(now - s.updatedAt)} ago` })),
      ...[...errors].map(([id, msg]) => ({ text: `${id}: ${msg}`, error: true })),
    ];
    view.update({
      windows: windows.map((w) => ({ ...w, summary: describe(w), resetsIn: formatDuration(w.resetsAt - now) })),
      notes,
    });
  };

  const startSources = () => {
    running.forEach((r) => r.dispose());
    running = [];
    snapshots.clear();
    errors.clear();

    const cfg = vscode.workspace.getConfiguration('claudePace');
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const specs = [fileSource({ file: cfg.get('file.path') || path.join(configDir, 'pace', 'rate_limits.json') })];
    if (cfg.get('endpoint.enabled', true)) {
      specs.push(endpointSource({ intervalMs: cfg.get('endpoint.intervalSeconds', 120) * 1000, configDir }));
    }
    for (const spec of specs) {
      running.push(
        spec.start(
          (snap) => {
            snapshots.set(spec.id, snap);
            errors.delete(spec.id);
            render();
          },
          (msg) => {
            errors.set(spec.id, msg);
            render();
          },
        ),
      );
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudePace.view', view),
    vscode.commands.registerCommand(focus, () => vscode.commands.executeCommand('claudePace.view.focus')),
    vscode.commands.registerCommand('claudePace.refresh', () => running.forEach((r) => r.refresh?.(true))),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudePace')) return;
      startSources();
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
}

function deactivate() {}

module.exports = { activate, deactivate };

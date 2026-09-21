'use strict';

const crypto = require('crypto');

const STYLE = `
  body { padding: 0 12px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .row { margin: 12px 0; }
  .head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .bar { position: relative; height: 10px; background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 2px; }
  .bar > div { position: absolute; top: 0; bottom: 0; }
  .fill { left: 0; background: var(--vscode-progressBar-background); }
  .gap { background: var(--vscode-hortator-deltaBehind, var(--vscode-charts-green)); }
  .over { background: var(--vscode-hortator-deltaAhead, var(--vscode-charts-red)); }
  .marker { width: 2px; top: -3px !important; bottom: -3px !important; margin-left: -1px; background: var(--vscode-foreground); }
  .sub, .muted { color: var(--vscode-descriptionForeground); font-size: .9em; margin-top: 4px; }
  .err { color: var(--vscode-errorForeground); }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const place = (n, left, width) => {
    n.style.left = left + '%';
    if (width !== undefined) n.style.width = width + '%';
    return n;
  };
  const clamp = (n) => Math.min(100, Math.max(0, n));

  function render({ windows, notes, empty }) {
    root.replaceChildren();
    if (!windows.length) root.append(el('p', 'muted', empty));
    for (const w of windows) {
      const used = clamp(w.usedPct), pace = clamp(w.pacePct);
      const head = el('div', 'head');
      head.append(el('span', 'label', w.label), el('span', 'pct', Math.round(w.usedPct) + '%'));

      const bar = el('div', 'bar');
      bar.append(place(el('div', 'fill'), 0, used));
      if (pace > used) bar.append(place(el('div', 'gap'), used, pace - used));
      else bar.append(place(el('div', 'over'), pace, used - pace));
      bar.append(place(el('div', 'marker'), pace));
      bar.title = 'Marker: steady pace (' + Math.round(w.pacePct) + '%). Green: quota not yet used to reach it. Red: usage beyond it.';

      const row = el('div', 'row');
      row.append(head, bar, el('div', 'sub', w.summary + ' · resets in ' + w.resetsIn));
      root.append(row);
    }
    for (const n of notes) root.append(el('div', n.error ? 'muted err' : 'muted', n.text));
  }

  window.addEventListener('message', (e) => render(e.data));
  vscode.postMessage({ type: 'ready' });
`;

class PaceView {
  constructor() {
    this.view = undefined;
    this.state = { windows: [], notes: [] };
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = crypto.randomBytes(16).toString('hex');
    view.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${STYLE}</style></head><body><div id="root"></div><script nonce="${nonce}">${SCRIPT}</script></body></html>`;
    // The page announces itself once its listener exists; posting earlier would be lost.
    view.webview.onDidReceiveMessage((m) => m.type === 'ready' && this.push());
    view.onDidChangeVisibility(() => view.visible && this.push());
    view.onDidDispose(() => (this.view = undefined));
  }

  update(state) {
    this.state = state;
    this.push();
  }

  push() {
    this.view?.webview.postMessage(this.state);
  }
}

module.exports = { PaceView };

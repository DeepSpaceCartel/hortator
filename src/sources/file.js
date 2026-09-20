'use strict';

const fs = require('fs');
const path = require('path');
const { fromStatusline } = require('../windows');

/**
 * Reads the snapshot written by scripts/statusline.js: `{ updatedAt, rate_limits }`.
 * Only updates while a Claude Code session is running and has produced a response.
 */
function fileSource({ file }) {
  return {
    id: 'statusline',
    start(onUpdate, onError) {
      const read = () => {
        try {
          const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
          onUpdate({ updatedAt: raw.updatedAt, windows: fromStatusline(raw.rate_limits, raw.updatedAt) });
        } catch (e) {
          if (e.code !== 'ENOENT') onError(e.message);
        }
      };
      read();

      let watcher;
      let debounce;
      const dir = path.dirname(file);
      const base = path.basename(file);
      try {
        fs.mkdirSync(dir, { recursive: true });
        // The writer renames a temp file over the target, so watch the directory.
        watcher = fs.watch(dir, (_event, name) => {
          if (name !== base) return;
          clearTimeout(debounce);
          debounce = setTimeout(read, 100);
        });
      } catch {
        // No watcher: refresh() on the periodic tick still picks up changes.
      }
      return {
        refresh: read,
        dispose() {
          clearTimeout(debounce);
          watcher?.close();
        },
      };
    },
  };
}

module.exports = { fileSource };

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fromEndpoint } = require('../windows');

/** Claude Code keeps its state in `.claude.json`: in the config dir if CLAUDE_CONFIG_DIR is set, else in the home dir. */
const defaultFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');

/**
 * Reads the usage Claude Code caches for itself (`cachedUsageUtilization`), which has the same shape as the
 * usage endpoint's response, including per-model windows such as Fable. Nothing is sent anywhere and no login
 * is touched. Only that one entry is used; the rest of the file (account details and so on) is ignored.
 *
 * It is undocumented and only as fresh as Claude Code's last refresh, so a stale or missing entry is normal.
 */
function claudeCacheSource({ file = defaultFile() } = {}) {
  return {
    id: 'claude-cache',
    start(onUpdate, onError) {
      let stamp = '';
      let emitted;

      const read = (force) => {
        try {
          // The file is rewritten often by Claude Code; only parse it when it actually changed.
          const st = fs.statSync(file);
          const next = `${st.mtimeMs}:${st.size}`;
          if (!force && next === stamp) return;
          stamp = next;

          const entry = JSON.parse(fs.readFileSync(file, 'utf8')).cachedUsageUtilization;
          if (!entry?.utilization || !Number.isFinite(entry.fetchedAtMs) || entry.fetchedAtMs === emitted) return;
          const windows = fromEndpoint(entry.utilization, entry.fetchedAtMs);
          if (windows.length === 0) return;
          emitted = entry.fetchedAtMs;
          onUpdate({ updatedAt: entry.fetchedAtMs, windows });
        } catch (e) {
          // Not there yet, or caught mid-write (a JSON error would quote file content, so it is not reported).
          if (e.code === 'ENOENT' || e instanceof SyntaxError) {
            stamp = '';
            return;
          }
          onError(`could not read ${path.basename(file)} (${e.code ?? 'error'})`);
        }
      };

      read(true);
      return { refresh: read, dispose() {} };
    },
  };
}

module.exports = { claudeCacheSource, defaultFile };

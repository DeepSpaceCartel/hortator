'use strict';

const fs = require('fs');
const path = require('path');
const { planNotifications } = require('./notify');

const LOCK_STALE_MS = 10 * 1000;

const readState = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const writeState = (file, data) => {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
};

/**
 * Runs fn while holding a cross-process lock (mkdir is atomic). Returns undefined if the lock is
 * held by someone else or cannot be taken; callers simply try again on the next tick.
 */
function withLock(lockDir, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockDir);
    } catch (e) {
      if (e.code !== 'EEXIST') return undefined;
      try {
        // A crashed window can leave its lock behind.
        if (Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        // Released in the meantime; fall through and let the next tick retry.
      }
      return undefined;
    }
    try {
      return fn();
    } finally {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // Already gone.
      }
    }
  }
  return undefined;
}

/**
 * Decides which notifications this window should show and records them as shown, atomically across
 * every VS Code window on the machine (they share the account, the readings, and this directory).
 * Whoever claims a notification is the only one that returns it.
 *
 * @param {string} dir directory shared by all windows
 * @param {Parameters<typeof planNotifications>[0]} windows
 * @param {number} now
 * @param {Parameters<typeof planNotifications>[3]} opts
 */
function claimNotifications(dir, windows, now, opts) {
  const stateFile = path.join(dir, 'notify-state.json');
  const stored = readState(stateFile);
  // Lock-free peek first: most ticks have nothing to say and nothing to record.
  const peek = planNotifications(windows, stored, now, opts);
  if (peek.toShow.length === 0 && JSON.stringify(peek.next) === JSON.stringify(stored)) return [];

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return [];
  }
  return (
    withLock(path.join(dir, 'notify.lock'), () => {
      // Re-read under the lock: another window may have claimed it since the peek.
      const current = readState(stateFile);
      const { toShow, next } = planNotifications(windows, current, now, opts);
      if (JSON.stringify(next) !== JSON.stringify(current) && !writeState(stateFile, next)) {
        // Without a record the same notification would repeat on every tick, so stay quiet.
        return [];
      }
      return toShow;
    }) ?? []
  );
}

module.exports = { claimNotifications };

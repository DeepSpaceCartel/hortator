'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fromEndpoint } = require('../windows');

const URL = 'https://api.anthropic.com/api/oauth/usage';
const MIN_GAP_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

const keychain = () =>
  new Promise((resolve, reject) =>
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (err, out) => (err ? reject(err) : resolve(out))),
  );

/** Reads Claude Code's OAuth login. The token stays inside this module and is never logged. */
async function readCredentials(configDir) {
  let raw;
  if (process.platform === 'darwin') {
    raw = await keychain().catch(() => undefined);
  }
  raw ??= fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8');
  const oauth = JSON.parse(raw).claudeAiOauth;
  if (!oauth?.accessToken) throw new Error('no Claude Code login found (run `claude` and /login)');
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) throw new Error('login token expired; use Claude Code once to refresh it');
  return oauth.accessToken;
}

/**
 * Polls Anthropic's undocumented OAuth usage endpoint. It has no stability
 * guarantee, so failures are surfaced as a note and retried with backoff.
 */
function endpointSource({ intervalMs, configDir }) {
  return {
    id: 'endpoint',
    start(onUpdate, onError) {
      let timer;
      let failures = 0;
      let disposed = false;
      let lastPoll = 0;
      let inFlight = false;

      const schedule = () => {
        if (disposed) return;
        const delay = failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
        timer = setTimeout(poll, delay);
      };

      const poll = async () => {
        if (inFlight || disposed) return;
        inFlight = true;
        clearTimeout(timer);
        lastPoll = Date.now();
        try {
          const token = await readCredentials(configDir);
          const res = await fetch(URL, {
            headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-pace' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const now = Date.now();
          onUpdate({ updatedAt: now, windows: fromEndpoint(await res.json(), now) });
          failures = 0;
        } catch (e) {
          failures++;
          onError(e.message);
        } finally {
          inFlight = false;
          schedule();
        }
      };

      poll();
      return {
        refresh(force) {
          if (force && Date.now() - lastPoll >= MIN_GAP_MS) poll();
        },
        dispose() {
          disposed = true;
          clearTimeout(timer);
        },
      };
    },
  };
}

module.exports = { endpointSource };

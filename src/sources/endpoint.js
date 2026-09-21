'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fromEndpoint } = require('../windows');
const { formatDuration } = require('../pace');

const URL = 'https://api.anthropic.com/api/oauth/usage';
const MIN_GAP_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
// Instances that did not make the last request wake a little later, so the one that did can refresh the shared cache first.
const describeRetryAfter = (header) => (header ? `Retry-After: ${header}s` : 'no Retry-After header, backing off');
const clock = (ms) => new Date(ms).toLocaleTimeString();
const followerDelay = (intervalMs) => 2000 + Math.random() * intervalMs * 0.1;

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

// Every Hortator instance (one per VS Code window) on the machine shares one reading and one
// backoff through this file, because they all spend the same account's rate limit.
const readCache = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const writeCache = (file, data) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch {
    // The cache only saves requests; losing it is harmless.
  }
};

/**
 * Polls Anthropic's undocumented OAuth usage endpoint. It has no stability
 * guarantee and is rate limited per account, so it reuses readings other windows
 * already fetched, honours Retry-After, and surfaces failures as a note.
 */
function endpointSource({ intervalMs, configDir, log = { info() {}, warn() {} } }) {
  return {
    id: 'endpoint',
    start(onUpdate, onError) {
      const cachePath = path.join(configDir, 'hortator', 'usage-cache.json');
      let timer;
      let failures = 0;
      let disposed = false;
      let lastPoll = 0;
      let inFlight = false;

      const publish = (snap) => snap.windows && onUpdate({ updatedAt: snap.updatedAt, windows: snap.windows });
      const backoff = () => (failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS));

      const schedule = (delay) => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(() => poll(false), delay);
      };

      const poll = async (force) => {
        if (inFlight || disposed) return;
        inFlight = true;
        let delay = backoff();
        try {
          const cache = readCache(cachePath);
          const now = Date.now();
          if (cache.blockedUntil > now) {
            const wait = cache.blockedUntil - now;
            log.info(`rate limited; next request at ${clock(cache.blockedUntil)}, in ${formatDuration(wait)} (shared with other windows)`);
            publish(cache);
            // After publish, because an update clears the source's error note.
            onError(`rate limited by Anthropic (${describeRetryAfter(cache.retryAfter)})`, { retryAt: cache.blockedUntil });
            delay = wait + followerDelay(intervalMs);
          } else if (!force && cache.updatedAt && now - cache.updatedAt < intervalMs) {
            log.info(`using the reading another window took ${formatDuration(now - cache.updatedAt)} ago`);
            publish(cache);
            delay = cache.updatedAt + intervalMs - now + followerDelay(intervalMs);
          } else {
            lastPoll = now;
            log.info(force ? 'fetching usage (manual refresh)' : 'fetching usage');
            const token = await readCredentials(configDir);
            const res = await fetch(URL, {
              headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'hortator' },
              signal: AbortSignal.timeout(15000),
            });
            if (res.status === 429) {
              const header = res.headers.get('retry-after');
              // Repeated 429s escalate; the streak lives in the cache so it survives reloads and is shared.
              const streak = (cache.streak ?? 0) + 1;
              const wait = Number(header) > 0 ? Math.min(Number(header) * 1000, MAX_BACKOFF_MS) : Math.min(intervalMs * 2 ** streak, MAX_BACKOFF_MS);
              const blockedUntil = Date.now() + wait;
              log.warn(`HTTP 429 (${describeRetryAfter(header)}); next request at ${clock(blockedUntil)}, in ${formatDuration(wait)}; consecutive rate limits: ${streak}`);
              writeCache(cachePath, { ...cache, blockedUntil, streak, retryAfter: header || null });
              throw Object.assign(new Error(`HTTP 429 (${describeRetryAfter(header)})`), { waitMs: wait, retryAt: blockedUntil });
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const at = Date.now();
            const snap = { updatedAt: at, windows: fromEndpoint(await res.json(), at) };
            writeCache(cachePath, snap);
            log.info(`ok: ${snap.windows.length} windows`);
            publish(snap);
            failures = 0;
            delay = intervalMs;
          }
        } catch (e) {
          failures++;
          delay = e.waitMs ?? backoff();
          if (e.waitMs === undefined) log.warn(`failed: ${e.message}`);
          onError(e.message, e.retryAt ? { retryAt: e.retryAt } : undefined);
        } finally {
          inFlight = false;
          schedule(delay);
        }
      };

      poll(false);
      return {
        refresh(force) {
          if (force && Date.now() - lastPoll >= MIN_GAP_MS) poll(true);
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

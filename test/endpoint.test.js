'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { endpointSource } = require('../src/sources/endpoint');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/usage.json'), 'utf8'));
const INTERVAL = 300_000;
const TOKEN = 'test-token-abc';

/** Lets pending promise callbacks run; timers are mocked but setImmediate is not. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A fake Claude Code login dir, mocked clock, and a fetch that answers from `replies`. */
function setup(t, replies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hortator-ep-'));
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: 4_000_000_000_000 } }));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000_000_000 });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(init.headers.Authorization);
    return replies[Math.min(calls.length, replies.length) - 1]();
  });
  const ok = () => new Response(JSON.stringify(fixture), { status: 200 });
  const limited = (seconds) => () => new Response(null, { status: 429, headers: seconds ? { 'retry-after': String(seconds) } : {} });
  return { dir, calls, ok, limited };
}

const start = (dir) => {
  const updates = [];
  const errors = [];
  const metas = [];
  const handle = endpointSource({ intervalMs: INTERVAL, configDir: dir }).start(
    (u) => updates.push(u),
    (m, meta) => {
      errors.push(m);
      metas.push(meta);
    },
  );
  return { handle, updates, errors, metas };
};

test('429 honours Retry-After and reports the wait', async (t) => {
  const s = setup(t, [() => s.limited(900)(), () => s.ok()]);
  const a = start(s.dir);
  await flush();
  assert.deepEqual(a.errors, ['HTTP 429 (Retry-After: 900s)']);
  assert.equal(a.metas[0].retryAt, Date.now() + 900_000, 'reports when it will retry');

  t.mock.timers.tick(899_999);
  await flush();
  assert.equal(s.calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(s.calls.length, 2);
  assert.equal(a.updates.length, 1);
  a.handle.dispose();
});

test('429 without Retry-After escalates on each consecutive rate limit and resets on success', async (t) => {
  const s = setup(t, [() => s.limited()(), () => s.limited()(), () => s.ok()]);
  const a = start(s.dir);
  await flush();
  assert.match(a.errors.at(-1), /no Retry-After header/);
  assert.equal(a.metas.at(-1).retryAt - Date.now(), 600_000);
  t.mock.timers.tick(INTERVAL * 2 - 1);
  await flush();
  assert.equal(s.calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(s.calls.length, 2);
  assert.equal(a.metas.at(-1).retryAt - Date.now(), 1_200_000);

  t.mock.timers.tick(INTERVAL * 4);
  await flush();
  assert.equal(s.calls.length, 3);
  const cache = JSON.parse(fs.readFileSync(path.join(s.dir, 'hortator', 'usage-cache.json'), 'utf8'));
  assert.equal(cache.streak, undefined);
  assert.equal(cache.blockedUntil, undefined);
  a.handle.dispose();
});

test('instances sharing a config dir make one request and never cache the token', async (t) => {
  const s = setup(t, [() => s.ok()]);
  const a = start(s.dir);
  await flush();
  const b = start(s.dir);
  await flush();

  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0], `Bearer ${TOKEN}`);
  assert.deepEqual(b.updates[0].windows.map((w) => w.id), ['session', 'weekly_all', 'weekly_scoped:Fable']);
  assert.ok(!fs.readFileSync(path.join(s.dir, 'hortator', 'usage-cache.json'), 'utf8').includes(TOKEN));
  a.handle.dispose();
  b.handle.dispose();
});

test('a rate limit seen by one instance holds back the others', async (t) => {
  const s = setup(t, [() => s.limited(600)(), () => s.ok()]);
  const a = start(s.dir);
  await flush();
  const b = start(s.dir);
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal(b.errors.length, 1, 'the follower explains why it has no data');
  assert.equal(b.errors[0], 'rate limited by Anthropic (Retry-After: 600s)');
  assert.equal(b.metas[0].retryAt, 1_000_000_000_000 + 600_000, 'the follower reports the shared retry time');

  // The instance that got the 429 retries first; the other waits a bit longer and reuses its result.
  t.mock.timers.tick(600_000);
  await flush();
  assert.equal(s.calls.length, 2);
  const before = b.updates.length;
  t.mock.timers.tick(40_000); // past the follower delay (at most 32s), well before a's next poll
  await flush();
  assert.equal(s.calls.length, 2);
  assert.ok(b.updates.length > before, 'the follower published the shared reading');
  a.handle.dispose();
  b.handle.dispose();
});

test('a forced refresh skips a fresh cache but not a rate limit block', async (t) => {
  const s = setup(t, [() => s.ok(), () => s.limited(600)(), () => s.ok()]);
  const a = start(s.dir);
  await flush();

  t.mock.timers.tick(31_000);
  a.handle.refresh(true);
  await flush();
  assert.equal(s.calls.length, 2); // refetched although the cache was fresh; now rate limited

  t.mock.timers.tick(31_000);
  a.handle.refresh(true);
  await flush();
  assert.equal(s.calls.length, 2); // still blocked
  a.handle.dispose();
});

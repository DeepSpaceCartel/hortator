'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { withPace, formatDuration, LENGTH_MS, HOUR } = require('../src/pace');
const { fromEndpoint, fromStatusline, merge } = require('../src/windows');
const { bar, describe, formatClock, formatError } = require('../src/text');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/usage.json'), 'utf8'));
const win = (over = {}) => ({ id: 'w', label: 'W', short: 'W', group: 'weekly', usedPct: 10, resetsAt: 0, lengthMs: LENGTH_MS.weekly, updatedAt: 0, ...over });

test('pace is the elapsed fraction of the window', () => {
  const resetsAt = 1_000_000_000;
  const half = withPace(win({ resetsAt }), resetsAt - LENGTH_MS.weekly / 2);
  assert.equal(half.pacePct, 50);
  assert.equal(withPace(win({ resetsAt }), resetsAt - LENGTH_MS.weekly * 2).pacePct, 0);
  assert.equal(withPace(win({ resetsAt }), resetsAt + 1).pacePct, 100);
});

test('state reflects distance from the marker, with tolerance', () => {
  const resetsAt = 1_000_000_000;
  const now = resetsAt - LENGTH_MS.weekly / 2;
  assert.equal(withPace(win({ resetsAt, usedPct: 10 }), now).state, 'behind');
  assert.equal(withPace(win({ resetsAt, usedPct: 53 }), now).state, 'on');
  assert.equal(withPace(win({ resetsAt, usedPct: 80 }), now).state, 'ahead');
  assert.equal(withPace(win({ resetsAt, usedPct: 53 }), now, 1).state, 'ahead');
});

test('projection is withheld at the very start of a window', () => {
  const resetsAt = 1_000_000_000;
  assert.equal(withPace(win({ resetsAt, usedPct: 5 }), resetsAt - LENGTH_MS.weekly + 1000).projectedPct, null);
  assert.equal(withPace(win({ resetsAt, usedPct: 25 }), resetsAt - LENGTH_MS.weekly / 2).projectedPct, 50);
});

test('formatDuration', () => {
  assert.equal(formatDuration(59 * 60000), '59m');
  assert.equal(formatDuration(3 * HOUR + 5 * 60000), '3h 5m');
  assert.equal(formatDuration(41 * HOUR), '1d 17h');
  assert.equal(formatDuration(-5), '0m');
});

test('endpoint limits[] yields session, weekly and the Fable window', () => {
  const ws = fromEndpoint(fixture, 1);
  assert.deepEqual(ws.map((w) => [w.id, w.usedPct, w.lengthMs]), [
    ['session', 23, 5 * HOUR],
    ['weekly_all', 6, 7 * 24 * HOUR],
    ['weekly_scoped:Fable', 0, 7 * 24 * HOUR],
  ]);
  assert.equal(ws[2].label, 'Weekly · Fable');
  assert.equal(ws[2].short, 'F');
  assert.equal(ws[1].resetsAt, Date.parse('2026-09-22T16:00:00.403044Z'));
});

test('endpoint falls back to five_hour / seven_day without limits[]', () => {
  const { limits, ...legacy } = fixture;
  assert.deepEqual(fromEndpoint(legacy, 1).map((w) => [w.id, w.usedPct]), [['session', 23], ['weekly_all', 6]]);
});

test('unrecognised or malformed limits are skipped', () => {
  const json = { limits: [{ kind: 'spend', percent: 3, resets_at: '2026-09-22T16:00:00Z' }, { kind: 'session', percent: null, resets_at: 'x' }] };
  assert.deepEqual(fromEndpoint(json, 1), []);
});

test('statusline rate_limits use the same ids and epoch seconds', () => {
  const ws = fromStatusline({ five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 }, spend_limit: { used_percentage: 1, resets_at: 1 } }, 1);
  assert.deepEqual(ws.map((w) => [w.id, w.usedPct, w.resetsAt]), [['session', 23.5, 1738425600000], ['weekly_all', 41.2, 1738857600000]]);
});

test('merge takes the newest reading per window and drops reset windows', () => {
  const now = 1000;
  const stale = { updatedAt: 1, windows: [win({ id: 'weekly_all', usedPct: 10, resetsAt: 5000, updatedAt: 1 }), win({ id: 'session', usedPct: 9, resetsAt: 500, updatedAt: 1 })] };
  const fresh = { updatedAt: 9, windows: [win({ id: 'weekly_all', usedPct: 12, resetsAt: 5000, updatedAt: 9 }), win({ id: 'weekly_scoped:Fable', label: 'Weekly · Fable', resetsAt: 5000, updatedAt: 9 })] };
  const out = merge([stale, fresh], now);
  assert.deepEqual(out.map((w) => [w.id, w.usedPct]), [['weekly_all', 12], ['weekly_scoped:Fable', 10]]);
});

test('bar puts the divider at the pace position', () => {
  assert.equal(bar(20, 50, 10), '██░░░│░░░░░');
  assert.equal(bar(0, 0, 4), '│░░░░');
  assert.equal(bar(100, 100, 4), '████│');
  assert.equal(bar(150, -20, 4), '│████');
});

test('describe wording', () => {
  assert.match(describe({ state: 'behind', deltaPct: -34.4 }), /^34% behind pace/);
  assert.match(describe({ state: 'ahead', deltaPct: 12 }), /^12% ahead/);
  assert.equal(describe({ state: 'on', deltaPct: 1 }), 'on pace');
});

test('statusline.js persists rate_limits atomically and prints a short line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-'));
  const out = path.join(dir, 'sub', 'rate_limits.json');
  const rl = { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } };
  const r = spawnSync('node', [path.join(__dirname, '../scripts/statusline.js'), out], { input: JSON.stringify({ rate_limits: rl }), encoding: 'utf8' });
  assert.equal(r.stdout, '5h 24%');
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).rate_limits, rl);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['rate_limits.json']);

  const none = spawnSync('node', [path.join(__dirname, '../scripts/statusline.js'), path.join(dir, 'x.json')], { input: '{"model":{}}', encoding: 'utf8' });
  assert.equal(none.stdout, '');
  assert.equal(fs.existsSync(path.join(dir, 'x.json')), false);
});

test('formatError shows when a rate-limited source will retry, and stops counting down once due', () => {
  const now = new Date(2026, 8, 21, 12, 0).getTime();
  const soon = formatError({ msg: 'HTTP 429 (Retry-After: 420s)', retryAt: now + 7 * 60000 }, now);
  assert.match(soon, /^HTTP 429 \(Retry-After: 420s\)\. Retrying at .+ \(in 7m\)$/);
  assert.equal(formatError({ msg: 'HTTP 429', retryAt: now - 1 }, now), 'HTTP 429. Retrying now');
  assert.equal(formatError({ msg: 'HTTP 500' }, now), 'HTTP 500');
});

test('formatClock adds the date only when it is not today', () => {
  const now = new Date(2026, 8, 21, 12, 0).getTime();
  const sameDay = formatClock(now + 30 * 60000, now);
  const nextDay = formatClock(now + 13 * HOUR, now);
  assert.ok(nextDay.length > sameDay.length, `${nextDay} should carry a date, ${sameDay} should not`);
});

test('status bar style: yellow when ahead, green on pace, untouched when behind, theme backgrounds near the limit', () => {
  const { statusStyle } = require('../src/text');
  assert.deepEqual(statusStyle({ state: 'on', usedPct: 40 }), { color: 'hortator.onPace' });
  assert.deepEqual(statusStyle({ state: 'behind', usedPct: 10 }), {});
  assert.deepEqual(statusStyle({ state: 'ahead', usedPct: 85 }), { color: 'hortator.ahead' });
  assert.deepEqual(statusStyle({ state: 'ahead', usedPct: 95 }), { background: 'statusBarItem.warningBackground' });
  assert.deepEqual(statusStyle({ state: 'on', usedPct: 100 }), { background: 'statusBarItem.errorBackground' });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withPace, LENGTH_MS, HOUR } = require('../src/pace');
const { claimNotifications } = require('../src/claim');

const RESETS = 10 * 24 * HOUR;
const NOW = RESETS - LENGTH_MS.weekly / 2;
const OPTS = { groups: ['weekly'], states: ['behind', 'on', 'ahead'], cooldownMs: 12 * HOUR, maxAgeMs: 15 * 60000 };
const behind = () =>
  withPace({ id: 'weekly_all', label: 'Weekly', short: 'W', group: 'weekly', usedPct: 10, resetsAt: RESETS, lengthMs: LENGTH_MS.weekly, updatedAt: NOW }, NOW);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hortator-claim-'));

test('only the first window to claim a notification gets it', () => {
  const dir = tmp();
  assert.equal(claimNotifications(dir, [behind()], NOW, OPTS).length, 1); // window A
  assert.equal(claimNotifications(dir, [behind()], NOW, OPTS).length, 0); // window B, same moment
  assert.equal(claimNotifications(dir, [behind()], NOW + 60000, OPTS).length, 0); // and later
  assert.ok(!fs.existsSync(path.join(dir, 'notify.lock')), 'the lock is released');
});

test('a lock held by another window defers the claim without consuming it', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'notify.lock'));
  assert.deepEqual(claimNotifications(dir, [behind()], NOW, OPTS), []);
  assert.ok(!fs.existsSync(path.join(dir, 'notify-state.json')), 'nothing was recorded');

  fs.rmdirSync(path.join(dir, 'notify.lock'));
  assert.equal(claimNotifications(dir, [behind()], NOW, OPTS).length, 1);
});

test('a lock left behind by a crashed window is taken over', () => {
  const dir = tmp();
  const lock = path.join(dir, 'notify.lock');
  fs.mkdirSync(lock);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(claimNotifications(dir, [behind()], NOW, OPTS).length, 1);
});

test('nothing to say means no lock and no state file', () => {
  const dir = tmp();
  const onPace = withPace({ ...behind(), usedPct: 50 }, NOW);
  assert.deepEqual(claimNotifications(dir, [onPace], NOW, OPTS), []);
  assert.deepEqual(fs.readdirSync(dir), ['notify-state.json']); // the on-pace state is recorded once...
  const mtime = fs.statSync(path.join(dir, 'notify-state.json')).mtimeMs;
  assert.deepEqual(claimNotifications(dir, [onPace], NOW + 1000, OPTS), []);
  assert.equal(fs.statSync(path.join(dir, 'notify-state.json')).mtimeMs, mtime); // ...and not rewritten
});

test('if the state cannot be recorded, stay quiet rather than repeat every tick', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'notify-state.json')); // a directory where the file should be
  assert.deepEqual(claimNotifications(dir, [behind()], NOW, OPTS), []);
});

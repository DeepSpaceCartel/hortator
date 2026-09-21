'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeCacheSource, defaultFile } = require('../src/sources/claude-cache');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/usage.json'), 'utf8'));

/** A .claude.json like Claude Code's: the usage entry among account details that must stay untouched. */
const claudeJson = (fetchedAtMs, extra = {}) =>
  JSON.stringify({ oauthAccount: { emailAddress: 'private@example.com' }, cachedUsageUtilization: { accountUuid: 'u', fetchedAtMs, utilization: fixture }, ...extra });

let clock = 1_000;
/** Writes and bumps the mtime, since two quick writes can share a timestamp. */
const write = (file, text) => {
  fs.writeFileSync(file, text);
  clock += 10;
  fs.utimesSync(file, clock, clock);
};

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hortator-cc-'));
  const file = path.join(dir, '.claude.json');
  const updates = [];
  const errors = [];
  const start = () => claudeCacheSource({ file }).start((u) => updates.push(u), (m) => errors.push(m));
  return { file, updates, errors, start };
};

test('reads session, weekly and Fable windows stamped with when Claude Code fetched them', () => {
  const s = setup();
  write(s.file, claudeJson(1_700_000_000_000));
  s.start();

  assert.equal(s.updates.length, 1);
  assert.equal(s.updates[0].updatedAt, 1_700_000_000_000);
  assert.deepEqual(s.updates[0].windows.map((w) => [w.id, w.usedPct, w.updatedAt]), [
    ['session', 23, 1_700_000_000_000],
    ['weekly_all', 6, 1_700_000_000_000],
    ['weekly_scoped:Fable', 0, 1_700_000_000_000],
  ]);
  assert.ok(!JSON.stringify(s.updates).includes('private@example.com'), 'nothing else from the file is used');
  assert.deepEqual(s.errors, []);
});

test('a missing file, a file without the entry, and a half-written file are all quiet', () => {
  const s = setup();
  const handle = s.start(); // no file yet
  write(s.file, JSON.stringify({ theme: 'dark' }));
  handle.refresh(false);
  write(s.file, '{"cachedUsageUtilization": {"fetchedAt');
  handle.refresh(false);
  assert.deepEqual(s.updates, []);
  assert.deepEqual(s.errors, []);

  write(s.file, claudeJson(1_700_000_000_000)); // the write completes
  handle.refresh(false);
  assert.equal(s.updates.length, 1);
});

test('only re-parses when the file changed and only emits when Claude Code fetched again', () => {
  const s = setup();
  write(s.file, claudeJson(1_700_000_000_000));
  const handle = s.start();

  handle.refresh(false); // unchanged file
  assert.equal(s.updates.length, 1);

  write(s.file, claudeJson(1_700_000_000_000, { unrelated: 'Claude Code rewrote something else' }));
  handle.refresh(false); // file changed, same fetch
  assert.equal(s.updates.length, 1);

  write(s.file, claudeJson(1_700_000_300_000)); // a new fetch
  handle.refresh(false);
  assert.equal(s.updates.length, 2);
  assert.equal(s.updates[1].updatedAt, 1_700_000_300_000);
});

test('an unreadable file is reported without quoting its content', () => {
  const s = setup();
  fs.mkdirSync(s.file); // a directory where the file should be: EISDIR
  s.start();
  assert.deepEqual(s.errors, ['could not read .claude.json (EISDIR)']);
});

test('the default location follows CLAUDE_CONFIG_DIR, else the home directory', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = '/custom/dir';
    assert.equal(defaultFile(), path.join('/custom/dir', '.claude.json'));
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(defaultFile(), path.join(os.homedir(), '.claude.json'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addStatusLine } = require('../src/statusline-setup');
const { claimOnce } = require('../src/claim');
const { formatError } = require('../src/text');

const CMD = 'node "/home/u/.claude/hortator/statusline.js"';

test('addStatusLine adds the hook and keeps every other setting', () => {
  const before = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, model: 'opus' });
  const r = addStatusLine(before, CMD);
  assert.equal(r.status, 'added');
  assert.deepEqual(JSON.parse(r.text), { permissions: { allow: ['Bash(ls)'] }, model: 'opus', statusLine: { type: 'command', command: CMD } });
  assert.ok(r.text.endsWith('\n'));
});

test('addStatusLine works on an empty or missing file', () => {
  assert.deepEqual(JSON.parse(addStatusLine('', CMD).text), { statusLine: { type: 'command', command: CMD } });
  assert.equal(addStatusLine('  \n', CMD).status, 'added');
});

test('addStatusLine recognises its own hook, including a Windows path', () => {
  assert.equal(addStatusLine(JSON.stringify({ statusLine: { type: 'command', command: CMD } }), CMD).status, 'exists');
  assert.equal(addStatusLine(JSON.stringify({ statusLine: { type: 'command', command: 'node "C:\\Users\\u\\.claude\\hortator\\statusline.js"' } }), CMD).status, 'exists');
});

test('addStatusLine never replaces someone else’s status line or unparseable settings', () => {
  const theirs = addStatusLine(JSON.stringify({ statusLine: { type: 'command', command: '~/bin/my-line.sh' } }), CMD);
  assert.deepEqual(theirs, { status: 'conflict', existing: '~/bin/my-line.sh' });
  for (const bad of ['{ not json', '[]', 'null', '"text"']) assert.equal(addStatusLine(bad, CMD).status, 'invalid', bad);
});

test('claimOnce succeeds for exactly one caller per name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hortator-once-'));
  assert.equal(claimOnce(dir, 'offer'), true);
  assert.equal(claimOnce(dir, 'offer'), false);
  assert.equal(claimOnce(dir, 'other'), true);
});

test('formatError does not double the period of a server message', () => {
  const now = 1_000_000;
  const text = formatError({ msg: 'HTTP 429: Rate limited. Please try again later.', retryAt: now + 60_000 }, now);
  assert.match(text, /^HTTP 429: Rate limited\. Please try again later\. Retrying at /);
  assert.ok(!text.includes('..'));
});

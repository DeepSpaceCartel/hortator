'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the usage view lives in its own Activity Bar container with an existing icon', () => {
  const [container] = pkg.contributes.viewsContainers.activitybar;
  assert.ok(fs.existsSync(path.join(root, container.icon)), `missing ${container.icon}`);
  assert.deepEqual(pkg.contributes.views[container.id].map((v) => v.id), ['hortator.view']);
});

test('extension.js registers the view id declared in the manifest', () => {
  const src = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  assert.match(src, /registerWebviewViewProvider\('hortator\.view'/);
});

test('every contributed command is registered by the extension', () => {
  const src = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  for (const { command } of pkg.contributes.commands) {
    assert.ok(src.includes(`'${command}'`) || src.includes(`const focus = '${command}'`), `${command} is not registered`);
  }
});

test('marketplace metadata is complete', () => {
  for (const field of ['publisher', 'license', 'repository', 'icon', 'categories', 'description']) {
    assert.ok(pkg[field], `package.json is missing ${field}`);
  }
  assert.notEqual(pkg.private, true, '"private": true blocks publishing');
  assert.match(pkg.icon, /\.png$/, 'the Marketplace requires a PNG icon');
  const png = fs.readFileSync(path.join(root, pkg.icon));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  for (const file of ['LICENSE', 'CHANGELOG.md', 'README.md']) assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
});

test('the changelog has an entry for the current version', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\]`, 'm'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withPace, LENGTH_MS, HOUR } = require('../src/pace');
const { planNotifications, combine, windowKey } = require('../src/notify');

const DAY = 24 * HOUR;
const RESETS = 10 * DAY;
const OPTS = { groups: ['weekly'], states: ['behind', 'on', 'ahead'], cooldownMs: 12 * HOUR, maxAgeMs: 15 * 60000 };
// Half way through the week: steady pace is 50%.
const NOW = RESETS - LENGTH_MS.weekly / 2;

// A reading taken at `at`, so later steps in a test are fresh rather than stale.
const win = (over = {}, at = NOW) =>
  withPace({ id: 'weekly_all', label: 'Weekly', short: 'W', group: 'weekly', usedPct: 10, resetsAt: RESETS, lengthMs: LENGTH_MS.weekly, updatedAt: at, ...over }, at);

test('first sight behind pace notifies; first sight on pace stays quiet', () => {
  const behind = planNotifications([win({ usedPct: 10 })], {}, NOW, OPTS);
  assert.equal(behind.toShow.length, 1);
  assert.equal(behind.toShow[0].level, 'info');
  assert.match(behind.toShow[0].text, /^Weekly: 40% behind pace \(10% used, steady pace is 50%\)/);

  assert.deepEqual(planNotifications([win({ usedPct: 50 })], {}, NOW, OPTS).toShow, []);
});

test('ahead of pace warns and says when the limit would be hit', () => {
  const { toShow } = planNotifications([win({ usedPct: 75 })], {}, NOW, OPTS);
  assert.equal(toShow[0].level, 'warn');
  // 75% after 3.5 days: 25 more percent take 25 * 3.5 / 75 = 1d 4h; 3.5d - 1d 4h = 2d 8h remain until the reset.
  assert.match(toShow[0].text, /hit the limit in 1d 4h, 2d 8h before it resets/);
});

test('nothing repeats while the state is unchanged, and transitions notify', () => {
  const first = planNotifications([win({ usedPct: 10 })], {}, NOW, OPTS);
  const again = planNotifications([win({ usedPct: 12 })], first.next, NOW + 60000, OPTS);
  assert.deepEqual(again.toShow, []);

  const back = planNotifications([win({ usedPct: 50 })], again.next, NOW + 2 * 60000, OPTS);
  assert.equal(back.toShow.length, 1);
  assert.match(back.toShow[0].text, /on pace/);
});

test('cooldown suppresses the same state re-entered too soon, allows it later', () => {
  const at = (h) => NOW + h * HOUR;
  let r = planNotifications([win({ usedPct: 10 }, at(0))], {}, at(0), OPTS); // behind, notified
  assert.equal(r.toShow.length, 1);
  r = planNotifications([win({ usedPct: 50 }, at(1))], r.next, at(1), OPTS); // on, notified
  assert.equal(r.toShow.length, 1);

  const soon = planNotifications([win({ usedPct: 10 }, at(2))], r.next, at(2), OPTS); // behind again, too soon
  assert.deepEqual(soon.toShow, []);
  assert.equal(soon.next[windowKey(win())].state, 'behind');

  r = planNotifications([win({ usedPct: 50 }, at(3))], soon.next, at(3), OPTS);
  const later = planNotifications([win({ usedPct: 10 }, at(13))], r.next, at(13), OPTS);
  assert.equal(later.toShow.length, 1);
});

test('filters: window group, state list, stale readings', () => {
  const session = win({ id: 'session', group: 'session', usedPct: 10 });
  assert.deepEqual(planNotifications([session], {}, NOW, OPTS).toShow, []);
  assert.equal(planNotifications([session], {}, NOW, { ...OPTS, groups: ['session'] }).toShow.length, 1);

  assert.deepEqual(planNotifications([win({ usedPct: 10 })], {}, NOW, { ...OPTS, states: ['ahead'] }).toShow, []);
  assert.deepEqual(planNotifications([win({ usedPct: 10, updatedAt: NOW - HOUR })], {}, NOW, OPTS).toShow, []);
});

test('memory survives an empty window list but is dropped once the window has reset', () => {
  const first = planNotifications([win({ usedPct: 10 })], {}, NOW, OPTS);
  const startup = planNotifications([], first.next, NOW + 1000, OPTS);
  assert.deepEqual(Object.keys(startup.next), Object.keys(first.next));
  assert.deepEqual(planNotifications([], first.next, RESETS + 1, OPTS).next, {});
});

test('a new window instance notifies again even in the same state', () => {
  const first = planNotifications([win({ usedPct: 10 })], {}, NOW, OPTS);
  const nextWeek = { resetsAt: RESETS + LENGTH_MS.weekly };
  const now2 = NOW + LENGTH_MS.weekly;
  const w = withPace({ ...win({ usedPct: 10 }), ...nextWeek, updatedAt: now2 }, now2);
  assert.equal(planNotifications([w], first.next, now2, { ...OPTS, cooldownMs: 0 }).toShow.length, 1);
});

test('hitting the limit is reported plainly', () => {
  const { toShow } = planNotifications([win({ usedPct: 100 })], {}, NOW, OPTS);
  assert.match(toShow[0].text, /^Weekly: limit reached\. Resets in 3d 12h\./);
});

test('notifications that fire together in the same state become one popup', () => {
  const weekly = win({ usedPct: 6 });
  const fable = win({ id: 'weekly_scoped:Fable', label: 'Weekly · Fable', usedPct: 0 });
  const { toShow } = planNotifications([weekly, fable], {}, NOW, OPTS);
  assert.equal(toShow.length, 2);

  const merged = combine(toShow);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].level, 'info');
  assert.equal(merged[0].text, "Behind pace: Weekly (44%), Weekly · Fable (50%). There's unused quota, so you can speed up.");
});

test('combined ahead notifications warn and name the earliest limit; different states stay separate', () => {
  const a = win({ usedPct: 75 });
  const b = win({ id: 'weekly_scoped:Fable', label: 'Weekly · Fable', usedPct: 90 });
  const ahead = combine(planNotifications([a, b], {}, NOW, OPTS).toShow);
  assert.equal(ahead.length, 1);
  assert.equal(ahead[0].level, 'warn');
  assert.match(ahead[0].text, /^Ahead of pace: Weekly \(25%\), Weekly · Fable \(40%\)\. Slow down\. At this rate the earliest limit is hit in /);

  const mixed = combine(planNotifications([win({ usedPct: 10 }), win({ id: 'x', label: 'X', usedPct: 80 })], {}, NOW, OPTS).toShow);
  assert.deepEqual(mixed.map((m) => m.level).sort(), ['info', 'warn']);
});

test('a single notification passes through combine unchanged', () => {
  const { toShow } = planNotifications([win({ usedPct: 10 })], {}, NOW, OPTS);
  assert.deepEqual(combine(toShow), [{ level: toShow[0].level, text: toShow[0].text }]);
});

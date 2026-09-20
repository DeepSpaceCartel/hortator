'use strict';

const { LENGTH_MS } = require('./pace');

/** @typedef {import('./pace').Window} Window */

const ORDER = { session: 0, weekly_all: 1 };

/** Maps one entry of the endpoint's `limits[]` to a Window, or null if unrecognised. */
function fromLimit(l, updatedAt) {
  const resetsAt = Date.parse(l.resets_at);
  if (!Number.isFinite(l.percent) || !Number.isFinite(resetsAt)) return null;
  if (l.kind === 'session') {
    return { id: 'session', label: 'Session (5h)', short: 'S', group: 'session', usedPct: l.percent, resetsAt, lengthMs: LENGTH_MS.session, updatedAt };
  }
  if (typeof l.kind === 'string' && l.kind.startsWith('weekly')) {
    const model = l.scope?.model?.display_name;
    const surface = l.scope?.surface?.display_name;
    const scope = [model, surface].filter(Boolean).join(' / ');
    return {
      id: scope ? `${l.kind}:${scope}` : l.kind,
      label: scope ? `Weekly · ${scope}` : 'Weekly',
      short: scope ? scope[0].toUpperCase() : 'W',
      group: 'weekly',
      usedPct: l.percent,
      resetsAt,
      lengthMs: LENGTH_MS.weekly,
      updatedAt,
    };
  }
  return null;
}

/**
 * Normalises the OAuth usage endpoint response. Prefers `limits[]` (which carries
 * per-model windows such as Fable) and falls back to the five_hour / seven_day keys.
 * @returns {Window[]}
 */
function fromEndpoint(json, updatedAt) {
  if (Array.isArray(json?.limits)) {
    return json.limits.map((l) => fromLimit(l, updatedAt)).filter(Boolean);
  }
  const legacy = [
    ['session', json?.five_hour],
    ['weekly_all', json?.seven_day],
  ];
  return legacy
    .map(([kind, v]) => v && fromLimit({ kind, percent: v.utilization, resets_at: v.resets_at }, updatedAt))
    .filter(Boolean);
}

/**
 * Normalises the `rate_limits` object Claude Code hands to the status line
 * (percentages 0-100, reset times in epoch seconds).
 * @returns {Window[]}
 */
function fromStatusline(rateLimits, updatedAt) {
  const map = { five_hour: 'session', seven_day: 'weekly_all' };
  const out = [];
  for (const [key, kind] of Object.entries(map)) {
    const v = rateLimits?.[key];
    if (!v) continue;
    const w = fromLimit({ kind, percent: v.used_percentage, resets_at: new Date(v.resets_at * 1000).toISOString() }, updatedAt);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Combines snapshots from all sources. For each window the newest reading wins;
 * windows that already reset are dropped, as Claude Code does.
 * @param {Iterable<{updatedAt:number, windows:Window[]}>} snapshots
 * @param {number} now epoch ms
 * @returns {Window[]}
 */
function merge(snapshots, now) {
  const best = new Map();
  for (const snap of snapshots) {
    for (const w of snap.windows) {
      const cur = best.get(w.id);
      if (!cur || w.updatedAt > cur.updatedAt) best.set(w.id, w);
    }
  }
  const rank = (w) => ORDER[w.id] ?? 2;
  return [...best.values()].filter((w) => w.resetsAt > now).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

module.exports = { fromEndpoint, fromStatusline, merge };

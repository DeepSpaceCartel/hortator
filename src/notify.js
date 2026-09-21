'use strict';

const { formatDuration } = require('./pace');

/** @typedef {{state: string, notifiedAt: Record<string, number>}} Remembered */

// Keyed by the window instance (rounded to the minute, since sources disagree by sub-second
// amounts), so a new week or session starts with a clean slate.
const windowKey = (w) => `${w.id}@${Math.round(w.resetsAt / 60000)}`;
const keyResetMs = (key) => Number(key.slice(key.lastIndexOf('@') + 1)) * 60000;

/** Builds the message for a window that just entered its current state. */
function message(w, now) {
  const pts = Math.round(Math.abs(w.deltaPct));
  const used = Math.round(w.usedPct);
  const pace = Math.round(w.pacePct);
  const resets = formatDuration(w.resetsAt - now);
  const base = { state: w.state, label: w.label, pts, limitInMs: w.limitInMs };

  if (w.state === 'behind') {
    return { ...base, level: 'info', text: `${w.label}: ${pts} pts behind pace (${used}% used, steady pace is ${pace}%). There's unused quota, so you can speed up. Resets in ${resets}.` };
  }
  if (w.state === 'ahead') {
    if (w.usedPct >= 100) return { ...base, level: 'warn', text: `${w.label}: limit reached. Resets in ${resets}.` };
    const tail =
      w.limitInMs === null
        ? 'Slow down to make it last until the reset.'
        : `At this rate you'll hit the limit in ${formatDuration(w.limitInMs)}, ${formatDuration(w.resetsAt - now - w.limitInMs)} before it resets. Slow down.`;
    return { ...base, level: 'warn', text: `${w.label}: ${pts} pts ahead of pace (${used}% used, steady pace is ${pace}%). ${tail}` };
  }
  return { ...base, level: 'info', text: `${w.label}: on pace (${used}% used, steady pace is ${pace}%).` };
}

/**
 * Decides which notifications to show. Notifies when a window enters a state it
 * was not in before, at most once per window and state per cooldown, and only
 * for fresh readings. A window seen for the first time already on pace stays quiet.
 *
 * @param {Array<import('./pace').Window & {state:string}>} windows windows already run through withPace
 * @param {Record<string, Remembered>} stored what the previous call returned as `next`
 * @param {number} now epoch ms
 * @param {{groups: string[], states: string[], cooldownMs: number, maxAgeMs: number}} opts
 */
function planNotifications(windows, stored, now, opts) {
  const { groups, states, cooldownMs, maxAgeMs } = opts;
  /** @type {Record<string, Remembered>} */
  const next = {};
  // Keep memory of windows that have not reset yet, even if they are absent right now (e.g. at startup).
  for (const [key, value] of Object.entries(stored)) {
    if (keyResetMs(key) > now) next[key] = value;
  }

  const toShow = [];
  for (const w of windows) {
    if (!groups.includes(w.group) || now - w.updatedAt > maxAgeMs) continue;
    const key = windowKey(w);
    const prev = stored[key];
    if (prev?.state === w.state) continue;

    const notifiedAt = { ...prev?.notifiedAt };
    const quiet =
      (!prev && w.state === 'on') ||
      !states.includes(w.state) ||
      now - (notifiedAt[w.state] ?? -Infinity) < cooldownMs;
    if (!quiet) {
      toShow.push({ key, ...message(w, now) });
      notifiedAt[w.state] = now;
    }
    next[key] = { state: w.state, notifiedAt };
  }
  return { toShow, next };
}

/**
 * Merges notifications that fire together and share a state into one, so weekly and a
 * per-model window crossing at the same moment produce a single popup, not two near-duplicates.
 */
function combine(items) {
  const groups = new Map();
  for (const n of items) groups.set(n.state, [...(groups.get(n.state) ?? []), n]);
  return [...groups.values()].map((g) => {
    if (g.length === 1) return { level: g[0].level, text: g[0].text };
    const names = g.map((n) => `${n.label} (${n.pts} pts)`).join(', ');
    if (g[0].state === 'behind') return { level: 'info', text: `Behind pace: ${names}. There's unused quota, so you can speed up.` };
    if (g[0].state === 'ahead') {
      const soonest = Math.min(...g.map((n) => n.limitInMs ?? Infinity));
      const tail = Number.isFinite(soonest) ? ` At this rate the earliest limit is hit in ${formatDuration(soonest)}.` : '';
      return { level: 'warn', text: `Ahead of pace: ${names}. Slow down.${tail}` };
    }
    return { level: 'info', text: `Back on pace: ${g.map((n) => n.label).join(', ')}.` };
  });
}

module.exports = { planNotifications, combine, windowKey };

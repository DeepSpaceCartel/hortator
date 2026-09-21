'use strict';

const HOUR = 3600 * 1000;
const LENGTH_MS = { session: 5 * HOUR, weekly: 7 * 24 * HOUR };

/**
 * @typedef {object} Window
 * @property {string} id         stable key, e.g. "session", "weekly_all", "weekly_scoped:Fable"
 * @property {string} label
 * @property {string} short      one-letter status bar tag
 * @property {'session'|'weekly'} group
 * @property {number} usedPct    0-100
 * @property {number} resetsAt   epoch ms
 * @property {number} lengthMs
 * @property {number} updatedAt  epoch ms when this reading was taken
 */

/**
 * Adds where usage would be at a steady pace: the fraction of the window
 * already elapsed. Behind the marker means quota is going unused.
 * @param {Window} w
 * @param {number} now epoch ms
 * @param {number} tolerance percentage points still counted as "on pace"
 */
function withPace(w, now, tolerance = 5) {
  const start = w.resetsAt - w.lengthMs;
  const elapsed = Math.min(Math.max((now - start) / w.lengthMs, 0), 1);
  const pacePct = elapsed * 100;
  const deltaPct = w.usedPct - pacePct;
  const state = deltaPct > tolerance ? 'ahead' : deltaPct < -tolerance ? 'behind' : 'on';
  // Extrapolating from a sliver of the window is noise.
  const reliable = elapsed >= 0.02;
  const projectedPct = reliable ? w.usedPct / elapsed : null;
  // Time until the limit is hit if the average rate so far continues.
  const limitInMs = reliable && w.usedPct > 0 ? Math.max(0, ((100 - w.usedPct) * elapsed * w.lengthMs) / w.usedPct) : null;
  return { ...w, pacePct, deltaPct, state, projectedPct, limitInMs };
}

/** @param {number} ms */
function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { HOUR, LENGTH_MS, withPace, formatDuration };

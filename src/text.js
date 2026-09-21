'use strict';

const { formatDuration } = require('./pace');

const clamp = (n) => Math.min(100, Math.max(0, n));

/**
 * Text bar with a divider at the pace position: `██│░░░░░`.
 * Fill to the left of the divider means ahead of pace, empty cells left of it mean unused quota.
 */
function bar(usedPct, pacePct, cells) {
  const filled = Math.round((clamp(usedPct) / 100) * cells);
  const mark = Math.round((clamp(pacePct) / 100) * cells);
  let s = '';
  for (let i = 0; i < cells; i++) {
    if (i === mark) s += '│';
    s += i < filled ? '█' : '░';
  }
  return mark === cells ? `${s}│` : s;
}

/** Status bar label for one window, e.g. `W ██│░░░░░░ 6%`. */
function statusLabel(w) {
  return `${w.short} ${bar(w.usedPct, w.pacePct, 8)} ${Math.round(w.usedPct)}%`;
}

/** One-line verdict on where usage stands relative to a steady pace. */
function describe(w) {
  const pts = Math.round(Math.abs(w.deltaPct));
  if (w.state === 'behind') return `${pts} pts behind pace, so ${pts}% of the window's quota is unused so far`;
  if (w.state === 'ahead') return `${pts} pts ahead of pace`;
  return 'on pace';
}

/** Markdown tooltip for a status bar item. */
function tooltip(w, now) {
  const lines = [
    `**${w.label}**: ${Math.round(w.usedPct)}% used · steady pace ${Math.round(w.pacePct)}%`,
    `\`${bar(w.usedPct, w.pacePct, 24)}\``,
    `${describe(w)}`,
    `Resets in ${formatDuration(w.resetsAt - now)}`,
  ];
  if (w.projectedPct !== null) lines.push(`At this rate: ${Math.round(w.projectedPct)}% by reset`);
  lines.push(`_Reading from ${formatDuration(now - w.updatedAt)} ago_`);
  return lines.join('\n\n');
}

/** Local clock time, prefixed with the date when it is not today. */
function formatClock(ms, now) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** A source error, with when it will retry (if it will) rendered against the current time. */
function formatError({ msg, retryAt }, now) {
  if (!retryAt) return msg;
  const wait = retryAt - now;
  return wait > 0 ? `${msg}. Retrying at ${formatClock(retryAt, now)} (in ${formatDuration(wait)})` : `${msg}. Retrying now`;
}

module.exports = { bar, statusLabel, describe, tooltip, formatClock, formatError };

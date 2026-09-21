'use strict';

const OURS = /hortator[\\/]statusline\.js/;

/**
 * Adds Hortator's status line to the text of a Claude Code settings.json without touching
 * anything else. An existing status line of someone else's is never replaced.
 *
 * @param {string} settingsText current file contents, empty if the file does not exist
 * @param {string} command the status line command to install
 * @returns {{status: 'added', text: string} | {status: 'exists'} | {status: 'conflict', existing: string} | {status: 'invalid'}}
 */
function addStatusLine(settingsText, command) {
  let settings;
  try {
    settings = settingsText.trim() ? JSON.parse(settingsText) : {};
  } catch {
    return { status: 'invalid' };
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return { status: 'invalid' };

  const current = settings.statusLine;
  if (current) {
    const existing = String(current.command ?? JSON.stringify(current));
    return OURS.test(existing) ? { status: 'exists' } : { status: 'conflict', existing };
  }
  settings.statusLine = { type: 'command', command };
  return { status: 'added', text: `${JSON.stringify(settings, null, 2)}\n` };
}

module.exports = { addStatusLine };

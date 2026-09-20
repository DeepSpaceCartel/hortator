#!/usr/bin/env node
'use strict';

// Claude Code status line command. Saves the subscription rate limits it is
// given so the Claude Pace extension can read them, and prints a short line.
// Usage: node statusline.js [output-file]

const fs = require('fs');
const os = require('os');
const path = require('path');

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const out = process.argv[2] || path.join(configDir, 'pace', 'rate_limits.json');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }
  const rl = data.rate_limits;
  if (!rl) return;

  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), rate_limits: rl }));
    fs.renameSync(tmp, out);
  } catch {
    // Never break the status line over a failed write.
  }

  const parts = [];
  if (rl.five_hour) parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
  if (rl.seven_day) parts.push(`7d ${Math.round(rl.seven_day.used_percentage)}%`);
  process.stdout.write(parts.join(' · '));
});

#!/usr/bin/env node
// Kills any process holding dev ports 3000-3005 before `npm run dev` starts.
// Hooked into the root package.json dev scripts via `&&` so it runs every time.

import { execSync } from 'node:child_process';

const PORTS = [3000, 3001, 3002, 3003, 3004, 3005];
const killed = [];

for (const port of PORTS) {
  try {
    const out = execSync(`lsof -ti :${port}`, { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (!out) continue;
    const pids = out.split('\n').filter(Boolean);
    execSync(`kill -9 ${pids.join(' ')}`, { stdio: 'ignore' });
    killed.push(`${port} (pid ${pids.join(', ')})`);
  } catch {
    // lsof exits non-zero when nothing is listening — that's fine.
  }
}

if (killed.length === 0) {
  console.log('[ports 3000-3005] all free ✓');
} else {
  console.log(`[ports 3000-3005] freed: ${killed.join(', ')}`);
}

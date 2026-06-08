#!/usr/bin/env node
// STAGING branch: dev servers run on ports 4000-4005 (hard rule — keeps the
// staging worktree from clashing with the main worktree, which uses 3000-3005).
// Kills any process holding dev ports 4000-4005 before `npm run dev` starts.
// Hooked into the root package.json dev scripts via `&&` so it runs every time.

import { execSync } from 'node:child_process';

const PORTS = [4000, 4001, 4002, 4003, 4004, 4005];
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
  console.log('[ports 4000-4005] all free ✓');
} else {
  console.log(`[ports 4000-4005] freed: ${killed.join(', ')}`);
}

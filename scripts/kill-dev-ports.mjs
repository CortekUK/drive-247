#!/usr/bin/env node
// Kills any process holding the dev port range before `npm run dev` starts.
// Hooked into the root package.json dev scripts via `&&` so it runs every time.

import { execSync } from 'node:child_process';

// Port range is worktree-aware so the staging worktree never kills the main
// worktree's dev servers (hard rule: staging runs on 4000+, main on 3000+).
//   - explicit override:  DEV_PORTS=4000,4001,4002  or  DEV_PORT_BASE=4000
//   - otherwise: a checkout whose directory name contains "staging" uses 4000-4005
import { basename } from 'node:path';

const base = process.env.DEV_PORT_BASE
  ? Number(process.env.DEV_PORT_BASE)
  : basename(process.cwd()).includes('staging') ? 4000 : 3000;

const PORTS = process.env.DEV_PORTS
  ? process.env.DEV_PORTS.split(',').map((p) => Number(p.trim())).filter(Boolean)
  : [base, base + 1, base + 2, base + 3, base + 4, base + 5];

const RANGE = `${PORTS[0]}-${PORTS[PORTS.length - 1]}`;
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
  console.log(`[ports ${RANGE}] all free ✓`);
} else {
  console.log(`[ports ${RANGE}] freed: ${killed.join(', ')}`);
}

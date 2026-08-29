#!/usr/bin/env node
// Frees the dev port(s) an app is about to bind, before `next dev` tries to.
// Hooked into the root package.json dev scripts via `&&` so it runs every time.
//
//   node scripts/kill-dev-ports.mjs portal          → frees only portal's port
//   node scripts/kill-dev-ports.mjs booking portal  → frees those two
//   node scripts/kill-dev-ports.mjs                 → frees every app's port
//   node scripts/kill-dev-ports.mjs 3001            → a bare port also works
//
// WHY IT TAKES AN APP NAME
//
// It used to free 3000-3005 unconditionally, whichever single app you were
// starting. So `npm run dev:portal` killed the booking server on 3000, and
// `npm run dev:booking` killed the portal on 3001 — the two apps you need
// running TOGETHER to take a payment, since the portal opens booking's hosted
// checkout. Running one app must not evict another.
//
// The ports are not written down here. Each app's own package.json already says
// which port it binds (`next dev --port NNNN`), so that is where they are read
// from — change a port there and this follows it.
//
// WHY IT IS PLATFORM-SPLIT
//
// It used to be `lsof -ti :PORT` + `kill -9`, wrapped in a try/catch whose
// comment said "lsof exits non-zero when nothing is listening — that's fine".
// On Windows neither program exists, so EVERY port threw ENOENT, every throw
// was swallowed by that catch, and the script printed "all free ✓" having
// looked at nothing and killed nothing. `next dev` then died on
// `EADDRINUSE :::3000` one second later, pointing at a port the line above had
// just certified as free. The check has to work or fail loudly; quietly
// reporting success it never achieved is the one thing it must not do.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:process';

const isWindows = platform === 'win32';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Port range is worktree-aware so the staging worktree never kills the main
// worktree's dev servers (hard rule: staging runs on 4000+, main on 3000+).
//   - explicit override:  DEV_PORTS=4000,4001,4002  or  DEV_PORT_BASE=4000
//   - otherwise: a checkout whose directory name contains "staging" uses 4000-4005
const base = process.env.DEV_PORT_BASE
  ? Number(process.env.DEV_PORT_BASE)
  : basename(process.cwd()).includes('staging') ? 4000 : 3000;

const PORTS = process.env.DEV_PORTS
  ? process.env.DEV_PORTS.split(',').map((p) => Number(p.trim())).filter(Boolean)
  : [base, base + 1, base + 2, base + 3, base + 4, base + 5];

/**
 * The base the ports in apps/<app>/package.json are written against.
 *
 * A staging worktree runs the SAME package.json on a shifted range, so an app's
 * declared port is translated by the offset rather than read literally —
 * otherwise `dev:portal` in a staging checkout would free main's 3001 and evict
 * the very servers the worktree split exists to protect.
 */
const CANONICAL_BASE = 3000;

/** app name -> dev port for THIS worktree, from each workspace's own `dev` script. */
function readAppPorts() {
  const ports = new Map();
  let entries;
  try {
    entries = readdirSync(join(ROOT, 'apps'), { withFileTypes: true });
  } catch {
    return ports;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, 'apps', entry.name, 'package.json'), 'utf8'));
    } catch {
      continue; // not a workspace, or unreadable — nothing to learn from it
    }
    const match = /--port[= ](\d+)/.exec(pkg.scripts?.dev ?? '');
    if (match) ports.set(pkg.name ?? entry.name, Number(match[1]) - CANONICAL_BASE + base);
  }
  return ports;
}

const appPorts = readAppPorts();
const args = process.argv.slice(2);

/** Which ports this invocation is responsible for. */
const targets = new Set();
const unknown = [];
if (args.length === 0) {
  // No app named — `npm run dev` starts everything, so clear the worktree's
  // whole range rather than only the ports apps/ currently declares.
  for (const port of PORTS) targets.add(port);
} else {
  for (const arg of args) {
    if (/^\d+$/.test(arg)) targets.add(Number(arg));
    else if (appPorts.has(arg)) targets.add(appPorts.get(arg));
    else unknown.push(arg);
  }
}

if (unknown.length > 0) {
  console.error(`[dev ports] unknown app: ${unknown.join(', ')}`);
  console.error(`  known: ${[...appPorts.keys()].join(', ') || '(none found under apps/)'}`);
  process.exit(1);
}

if (targets.size === 0) {
  console.log('[dev ports] no port to free');
  process.exit(0);
}

const label = `[dev ports ${[...targets].sort((a, b) => a - b).join(', ')}]`;

/**
 * PIDs listening on the target ports, as a Map<port, Set<pid>>.
 *
 * Windows: one `netstat -ano` pass rather than a probe per port. Listening rows
 * are identified by a WILDCARD foreign address (`0.0.0.0:0` / `[::]:0`) instead
 * of the word LISTENING, because that word is localised — on a German or
 * Japanese Windows it reads ABHÖREN / LISTEN and a match on it finds nothing.
 * A socket bound to `[::]:3000` (which is what Next binds, and the address in
 * the EADDRINUSE this script exists to prevent) is found the same way as
 * `0.0.0.0:3000`.
 */
function findListeners() {
  const byPort = new Map();

  const output = isWindows
    ? execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
    : execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    let port;
    let pid;

    if (isWindows) {
      // Proto  LocalAddress  ForeignAddress  State  PID
      if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
      const [, local, foreign] = parts;
      if (!/:0$/.test(foreign)) continue; // not a listening socket
      port = Number(local.slice(local.lastIndexOf(':') + 1));
      pid = Number(parts[parts.length - 1]);
      if (pid <= 4) continue; // System / Idle
    } else {
      // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME(host:port)
      if (parts.length < 9) continue;
      pid = Number(parts[1]);
      const name = parts[parts.length - 1];
      port = Number(name.slice(name.lastIndexOf(':') + 1));
      if (pid <= 0) continue;
    }

    if (!targets.has(port) || !Number.isInteger(pid)) continue;
    if (!byPort.has(port)) byPort.set(port, new Set());
    byPort.get(port).add(pid);
  }

  return byPort;
}

/**
 * Kill the process AND its children. A Next dev server spawns compiler workers;
 * killing only the parent leaves those holding the socket, which is the same
 * EADDRINUSE by another route.
 */
function killTree(pid) {
  const args = isWindows ? ['/PID', String(pid), '/T', '/F'] : ['-9', String(pid)];
  execFileSync(isWindows ? 'taskkill' : 'kill', args, {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

let listeners;
try {
  listeners = findListeners();
} catch (err) {
  // The probe itself is broken — a missing netstat/lsof, a denied query. Say so
  // and let the dev server start anyway: a port that IS free must not be
  // blocked by our inability to check it.
  console.warn(`${label} could not check (${err.code ?? err.message}); starting anyway`);
  process.exit(0);
}

const killed = [];
for (const [port, pids] of listeners) {
  for (const pid of pids) {
    // The exit code is deliberately ignored. `taskkill /T` reports failure for a
    // child that had already exited, and for a parent killed moments earlier as
    // part of another tree — neither is a problem, and treating them as one
    // reported "COULD NOT FREE" for ports it had in fact just freed. Whether
    // this worked is decided below, by looking at the ports again.
    try {
      killTree(pid);
    } catch {
      /* verified below */
    }
    killed.push(`${port} (pid ${pid})`);
  }
}

// VERIFY, DON'T ASSUME. The socket is not always released the instant the
// process dies, and turbo starts `next dev` the moment this exits — so wait for
// the ports to actually come free rather than racing them, and let what the OS
// reports at the end be the answer.
let stillHeld = [];
if (killed.length > 0) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      stillHeld = [...findListeners().keys()];
    } catch {
      stillHeld = [];
      break;
    }
    if (stillHeld.length === 0 || Date.now() >= deadline) break;
    // Short synchronous slices; only reached when something was actually killed.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

if (stillHeld.length > 0) {
  console.error(`${label} STILL IN USE: ${stillHeld.join(', ')}`);
  console.error('  Close the owning process by hand, or run this terminal as Administrator.');
  process.exit(1);
}

console.log(killed.length === 0 ? `${label} free ✓` : `${label} freed: ${killed.join(', ')}`);

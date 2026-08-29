#!/usr/bin/env node
/**
 * Square guardrail — proof that the META gate bites. One level up from
 * check-meta.mjs, which proves the other gates bite.
 *
 * check-meta.mjs is itself a guardrail, so it inherits the failure mode it was
 * written to prevent: if it silently stops proving anything, verify.sh keeps
 * printing green. That is not hypothetical. An early draft of check-meta.mjs
 * imported check-predicates.mjs statically; the version of that file which
 * shipped before this workstream runs its scan at module scope and ends in
 * `process.exit(0)`, so the import ENDED THE META PROCESS with status 0 before
 * a single proof ran. `git checkout` on one file disarmed the whole thing and
 * nothing anywhere went red. W1 below is that exact scenario, kept forever.
 *
 * NOT wired into verify.sh: it runs check-meta.mjs a dozen times (~45s), which
 * is too slow for a pre-push hook. Run it when you change anything in this
 * directory, and in a nightly/CI job:
 *
 *   node scripts/square-guardrails/prove-meta-bites.mjs
 *
 * NON-DESTRUCTIVE. Every mutation happens inside a self-contained copy of the
 * guardrails in a temp directory. The working tree is never written to, so an
 * interrupted run cannot leave a weakened guardrail on disk.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const BASELINE_REL = 'docs/square-integration/BASELINE.sha256';
const GUARD_REL = 'scripts/square-guardrails';

const TMP = mkdtempSync(join(tmpdir(), 'square-prove-meta-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

function put(rel, body) {
  const full = join(TMP, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

// --- build a self-contained mini-repo the meta gate can run against ---------
mkdirSync(join(TMP, GUARD_REL), { recursive: true });
for (const f of readdirSync(HERE, { withFileTypes: true })) {
  if (!f.isFile()) continue;
  copyFileSync(join(HERE, f.name), join(TMP, GUARD_REL, f.name));
  if (f.name.endsWith('.sh')) chmodSync(join(TMP, GUARD_REL, f.name), 0o755);
}
const baseline = readFileSync(join(REPO, BASELINE_REL), 'utf8');
put(BASELINE_REL, baseline);
for (const line of baseline.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const rel = t.split(/\s+/).slice(1).join(' ');
  put(rel, readFileSync(join(REPO, rel)));       // real bytes, real relative path
}
put('apps/.keep.ts', 'export const keep = 1\n'); // second grep root must exist

const PRISTINE = new Map();
for (const rel of [`${GUARD_REL}/check-predicates.mjs`, `${GUARD_REL}/verify.sh`, BASELINE_REL]) {
  PRISTINE.set(rel, readFileSync(join(TMP, rel)));
}
const restore = () => { for (const [rel, body] of PRISTINE) writeFileSync(join(TMP, rel), body); };

function edit(rel, from, to) {
  const p = join(TMP, rel);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`weakening no longer applies to ${rel}: ${from.slice(0, 60)}…`);
  writeFileSync(p, s.replace(from, to));
}

function metaStatus() {
  const r = spawnSync(process.execPath, [join(TMP, GUARD_REL, 'check-meta.mjs')], {
    cwd: TMP, encoding: 'utf8',
    env: { ...process.env, SQUARE_GUARDRAILS_META: '' },
  });
  if (r.error) throw r.error;
  const said = (r.stdout + r.stderr).split('\n').find((l) => l.includes('GATE DOES NOT BITE')) || '';
  return { code: r.status, said: said.replace('[meta] GATE DOES NOT BITE: ', '').trim() };
}

// --- the weakenings --------------------------------------------------------
const WEAKENINGS = [
  ['W1  check-predicates.mjs exits at import time (the pre-rewrite shape)', () =>
    writeFileSync(join(TMP, GUARD_REL, 'check-predicates.mjs'),
      '// no exports; scans and exits at module scope, exactly like the old version\nprocess.exit(0);\n')],

  // Narrows every comparison rule to `===` only, which is the exact coverage the
  // pre-widening checker had. Spelled as an edit to CMP so this weakening carries
  // no backslashes of its own to mis-escape.
  ['W2  comparison rules narrowed back to the single `===` spelling', () =>
    edit(`${GUARD_REL}/check-predicates.mjs`,
      "const CMP = '(===|!==|==|!=)';",
      "const CMP = '(===)';")],

  ['W3  dynamic-eq refine() removed, so the rule over-fires', () => {
    const p = join(TMP, GUARD_REL, 'check-predicates.mjs');
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf('    refine: (body) => {');
    if (i === -1) throw new Error('refine() not found');
    writeFileSync(p, s.slice(0, i) + s.slice(s.indexOf('    },', i) + 6));
  }],

  ['W4  a new rule added with no mutation probe', () =>
    edit(`${GUARD_REL}/check-predicates.mjs`, 'export const RULES = [',
      "export const RULES = [\n  { id: 'unproven', name: 'x', pattern: 'zzz-never', allow: [], why: 'x' },")],

  ['W5  stripe-client.ts quietly dropped from the baseline', () =>
    writeFileSync(join(TMP, BASELINE_REL),
      baseline.split('\n').filter((l) => l.startsWith('#') || !l.includes('stripe-client.ts')).join('\n'))],

  // Second entry, not the first: the first is pinned by check-meta's REQUIRED
  // floor, so mutating it would prove the floor rather than the stale-hash path.
  ['W6  a recorded baseline checksum goes stale', () => {
    const entries = baseline.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    edit(BASELINE_REL, entries[1].split(/\s+/)[0], '0'.repeat(64));
  }],

  ['W7  baseline emptied of entries', () =>
    writeFileSync(join(TMP, BASELINE_REL), '# nothing frozen\n')],

  ['W8  verify.sh freeze step made to ignore its exit status', () =>
    edit(`${GUARD_REL}/verify.sh`,
      'if node scripts/square-guardrails/check-frozen.mjs; then echo "    ok"; else echo "    FAIL"; fail=1; fi',
      'node scripts/square-guardrails/check-frozen.mjs || true; echo "    ok"')],

  ['W9  verify.sh seam typecheck (step 3) always reports ok', () =>
    edit(`${GUARD_REL}/verify.sh`,
      'if out=$("$DENO" check --unstable supabase/functions/_shared/payments/*.ts 2>&1); then',
      'if out=$("$DENO" check --unstable supabase/functions/_shared/payments/*.ts 2>&1); true; then')],

  ['W10 verify.sh stops invoking a gate at all', () =>
    edit(`${GUARD_REL}/verify.sh`, 'if node scripts/square-guardrails/check-frozen.mjs; then', 'if true; then')],

  ['W11 verify.sh always exits 0', () =>
    edit(`${GUARD_REL}/verify.sh`, 'exit $fail', 'exit 0')],
];

// --- run -------------------------------------------------------------------
restore();
const control = metaStatus();
if (control.code !== 0) {
  console.error('[prove] the unmodified copy already fails; fix that before trusting anything below.');
  console.error(`        ${control.said}`);
  process.exit(1);
}
console.log('[prove] control: unmodified guardrails pass\n');

let missed = 0;
for (const [label, weaken] of WEAKENINGS) {
  restore();
  try { weaken(); } catch (err) {
    console.error(`${label.padEnd(60)} SETUP FAILED  ${err.message}`);
    missed += 1;
    continue;
  }
  const { code, said } = metaStatus();
  if (code === 0) {
    console.error(`${label.padEnd(60)} MISSED — check-meta.mjs still passes`);
    missed += 1;
  } else {
    console.log(`${label.padEnd(60)} caught: ${said || '(non-zero exit)'}`);
  }
}
restore();

console.log();
if (missed) {
  console.error(`[prove] ${missed} weakening(s) went unnoticed — the meta gate has a blind spot.`);
  process.exit(1);
}
console.log(`[prove] ok  all ${WEAKENINGS.length} weakenings were caught by check-meta.mjs`);
process.exit(0);

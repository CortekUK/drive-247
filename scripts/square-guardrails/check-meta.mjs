#!/usr/bin/env node
/**
 * Square guardrail — the meta gate. It guards the guards.
 *
 * A guardrail that cannot fail is worse than no guardrail: it manufactures
 * confidence. This repo has already been bitten by exactly that — verify.sh's
 * typecheck step used to infer failure by grepping a command's OUTPUT for the
 * word "error", so a non-zero exit with unmatched text read as success and the
 * script printed its green banner anyway.
 *
 * So every gate is mutation-tested on every run: deliberately violate the rule
 * in a throwaway tree, and assert the gate reports failure. Four layers:
 *
 *   1  predicate rules   — every rule in check-predicates.mjs RULES must fire on
 *                          a snippet that violates it, and no rule may fire on
 *                          the sanctioned spellings. A rule with no probe is a
 *                          failure here, so widening the rule set without
 *                          proving the new rule bites cannot pass.
 *   2  freeze gate       — every path in the real BASELINE.sha256 must be
 *                          individually enforced, and the gate must reject an
 *                          empty, malformed or missing baseline.
 *   3  verify.sh wiring  — a failing gate must reach verify.sh's exit status.
 *                          Run against a stub `deno` so this costs ~0.6s and so
 *                          the typecheck steps can be proven to key off exit
 *                          status rather than output text.
 *   4  coverage          — every check-*.mjs in this directory is actually
 *                          invoked by verify.sh.
 *
 * Everything here decides by EXIT STATUS or by a returned violation list. If you
 * add a gate, add its probe; never grep output to decide pass/fail.
 *
 * Note: this file contains deliberately-violating snippets. check-predicates.mjs
 * scans supabase/functions and apps only — never scripts/ — so they are inert.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES, violationsFor } from './check-predicates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const BASELINE_REL = 'docs/square-integration/BASELINE.sha256';

// Layer 3 spawns verify.sh, which invokes this file again. Without this the
// meta gate would recurse until the process table objected.
if (process.env.SQUARE_GUARDRAILS_META === 'child') {
  console.log('[meta] skipped (nested run inside a meta sandbox)');
  process.exit(0);
}

const TMP = mkdtempSync(join(tmpdir(), 'square-guardrail-meta-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

let failed = false;
let proofs = 0;
function assert(ok, label, detail) {
  if (ok) { proofs += 1; return; }
  failed = true;
  console.error(`[meta] GATE DOES NOT BITE: ${label}`);
  if (detail) console.error(`       ${detail}`);
}

function write(root, rel, body) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

/** Exit status only. Output is captured so a green run stays quiet. */
function status(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return r.status;
}

// ---------------------------------------------------------------------------
// 1  predicate rules — each spelling, and the sanctioned spellings that must
//    NOT trip. Run in-process against a sandbox tree via the same function
//    check-predicates.mjs itself decides with.
// ---------------------------------------------------------------------------

/** ruleId -> snippets that MUST be reported. Every rule needs at least one. */
const PROBES = {
  'neq-provider': [
    `q.neq('payment_provider', 'square')`,
    `q.neq("payment_provider", "square")`,
  ],
  'is-provider-null': [`q.is('payment_provider', null)`],
  'square-literal-compare': [
    `const a = p === 'square'`,
    `const b = p === "square"`,
    `const c = p == 'square'`,
    `const d = p != "square"`,
    `const e = p !== 'square'`,
    'const f = p === `square`',
    `const g = 'square' === p`,
  ],
  'stripe-negated-compare': [
    `const a = p !== 'stripe'`,
    `const b = p != "stripe"`,
    'const c = p !== `stripe`',
    `const d = 'stripe' !== p`,
  ],
  'provider-field-compare': [
    `if (row.payment_provider === 'stripe') return`,
    `if (tenant.paymentProvider == "square") return`,
  ],
  'provider-string-membership': [
    `if (mode.includes('square')) return`,
    `if (mode.startsWith("square")) return`,
    `if (mode.indexOf('square') > -1) return`,
  ],
  'provider-switch-case': [
    `  case 'square':`,
    `  case "stripe":`,
  ],
  'provider-literal-alias': [
    `const SQUARE_PROVIDER = 'square'`,
    `let s: string = "square"`,
    `const STRIPE_NAME = 'stripe'`,
  ],
  'dynamic-provider-eq': [
    `q.eq('payment_provider', provider)`,
    `q.eq(PROVIDER_COLUMN, chosen)`,
    `q.eq('payment_provider', mode === 'x' ? 'stripe' : 'square')`,
  ],
  'resolver-alias': [
    `export function getTenantProvider(t) { return t }`,
    `function providerFor(t) { return t }`,
    `function resolveProvider(t) { return t }`,
    `function getPaymentProvider(t) { return t }`,
    `function whichProvider(t) { return t }`,
  ],
};

/** Spellings that are lawful and must never be reported by ANY rule. Each one
 *  is a live site in this repo or the sanctioned form from the directive. */
const SANCTIONED = [
  `q.eq('payment_provider', 'stripe')`,          // the one sanctioned predicate
  `q.eq("payment_provider", "square")`,          // square-webhook's own scope
  `q.eq(PROVIDER_COLUMN, SQUARE)`,               // via predicates.ts constants
  `q.eq(PROVIDER_COLUMN, STRIPE)`,
  `const flag = provider === "xero" ? 1 : 2`,    // accounting provider
  `if (doc.provider === 'bonzah') return`,       // insurance provider
  `if (provider === 'ai') return`,               // verification provider
  `if (stateRow.provider !== "zoho") return`,
  `const t = pendingConfirm?.type === 'stripe'`, // add-payment-dialog.tsx
  `const u = task === "stripe" ? 'a' : 'b'`,     // migration-progress.ts
  `const icon = MessageSquare`,                  // identifier, not a literal
  `type P = "stripe" | "square"`,                // a union is not a fork
  `// const P = provider === 'square'`,          // commented-out code
  ` * banned: provider === 'square'`,            // prose describing the rule
];

{
  const box = join(TMP, 'predicates');
  mkdirSync(join(box, 'apps'), { recursive: true });
  const probeFile = 'supabase/functions/probe/index.ts';
  const cwdOpt = { cwd: box };

  const withoutProbe = RULES.filter((r) => !(PROBES[r.id] || []).length);
  assert(
    withoutProbe.length === 0,
    'a rule has no mutation probe',
    `add PROBES entries for: ${withoutProbe.map((r) => r.id).join(', ')}`,
  );

  const previous = process.cwd();
  try {
    process.chdir(box);
    // Sanctioned spellings: no rule may fire.
    write(box, probeFile, SANCTIONED.join('\n') + '\n');
    for (const rule of RULES) {
      const hits = violationsFor(rule);
      assert(hits.length === 0, `FALSE POSITIVE in rule ${rule.id}`, hits.join('\n       '));
    }

    // Each violating spelling: its own rule must fire on it.
    for (const rule of RULES) {
      for (const snippet of PROBES[rule.id] || []) {
        write(box, probeFile, `${snippet}\n`);
        assert(
          violationsFor(rule).length > 0,
          `rule ${rule.id} misses the spelling: ${snippet}`,
          'widen the pattern or drop the claim that this rule covers it',
        );
      }
    }
    // And the CLI must translate that into a non-zero exit, per rule.
    write(box, probeFile, `const a = p === 'square'\n`);
    assert(
      status(process.execPath, [join(HERE, 'check-predicates.mjs'), '--only', 'square-literal-compare'],
             { ...cwdOpt, stdio: 'pipe' }) !== 0,
      'check-predicates.mjs exits 0 despite a violation',
    );
    write(box, probeFile, `const ok = 1\n`);
    assert(
      status(process.execPath, [join(HERE, 'check-predicates.mjs')], { ...cwdOpt, stdio: 'pipe' }) === 0,
      'check-predicates.mjs exits non-zero on a clean tree',
    );
  } finally {
    process.chdir(previous);
  }
}

// ---------------------------------------------------------------------------
// 2  freeze gate — every real baseline path, individually.
// ---------------------------------------------------------------------------
{
  const box = join(TMP, 'freeze');
  const checker = join(HERE, 'check-frozen.mjs');
  const runFreeze = () => status(process.execPath, [checker], { cwd: box, stdio: 'pipe' });

  const realBaseline = readFileSync(join(REPO, BASELINE_REL), 'utf8');
  const entries = realBaseline.split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const [hash, ...rest] = l.trim().split(/\s+/); return { hash, path: rest.join(' ') }; });

  assert(entries.length > 0, 'BASELINE.sha256 lists no files');

  // Reproduce the real tree for exactly the frozen paths.
  const originals = new Map();
  for (const e of entries) {
    const body = readFileSync(join(REPO, e.path));
    originals.set(e.path, body);
    write(box, e.path, body);
    assert(
      createHash('sha256').update(body).digest('hex') === e.hash,
      `baseline hash is stale for ${e.path}`,
      'the recorded checksum does not match the file on disk',
    );
  }
  write(box, BASELINE_REL, realBaseline);

  assert(runFreeze() === 0, 'freeze gate fails on an unmodified tree');

  // Mutate each frozen file in turn. A path listed but not enforced (typo, dead
  // path, duplicate line shadowed by another) shows up here.
  for (const e of entries) {
    write(box, e.path, Buffer.concat([originals.get(e.path), Buffer.from('\n// mutation\n')]));
    assert(runFreeze() !== 0, `freeze gate ignores a change to ${e.path}`);
    write(box, e.path, originals.get(e.path));
  }

  // Deleting a frozen file must not read as "nothing changed".
  const victim = entries[0].path;
  rmSync(join(box, victim));
  assert(runFreeze() !== 0, `freeze gate ignores deletion of ${victim}`);
  write(box, victim, originals.get(victim));

  // Emptying or corrupting the baseline must not silence the gate.
  write(box, BASELINE_REL, '# every entry removed\n');
  assert(runFreeze() !== 0, 'freeze gate passes with an empty baseline');
  write(box, BASELINE_REL, 'deadbeef  supabase/functions/_shared/stripe-client.ts\n');
  assert(runFreeze() !== 0, 'freeze gate passes with a malformed baseline hash');
  rmSync(join(box, BASELINE_REL));
  assert(runFreeze() !== 0, 'freeze gate passes with no baseline at all');
  write(box, BASELINE_REL, realBaseline);
  assert(runFreeze() === 0, 'freeze gate does not recover after the baseline is restored');
}

// ---------------------------------------------------------------------------
// 3  verify.sh wiring — a failing gate must reach the script's exit status.
//    A stub `deno` keeps this at ~0.15s per run and lets the typecheck steps
//    be proven independently of any real source file.
// ---------------------------------------------------------------------------
{
  const box = join(TMP, 'verify');
  const gates = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
  mkdirSync(join(box, 'scripts/square-guardrails'), { recursive: true });
  for (const g of gates) copyFileSync(join(HERE, g), join(box, 'scripts/square-guardrails', g));
  const sh = join(box, 'scripts/square-guardrails/verify.sh');
  copyFileSync(join(HERE, 'verify.sh'), sh);
  chmodSync(sh, 0o755);

  const denoOk = write(box, 'stub/deno-ok', '#!/usr/bin/env bash\nexit 0\n');
  const denoFail = write(box, 'stub/deno-fail', '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(denoOk, 0o755);
  chmodSync(denoFail, 0o755);

  // A minimal tree the real script can walk: both grep roots, one square edge
  // function so step 4's loop body actually executes, one frozen file.
  const frozenRel = 'supabase/functions/_shared/stripe-client.ts';
  const frozenBody = '// stand-in for the frozen module\n';
  write(box, frozenRel, frozenBody);
  write(box, 'supabase/functions/square-fake/index.ts', 'export const noop = 1\n');
  write(box, 'supabase/functions/_shared/payments/seam.ts', 'export const seam = 1\n');
  write(box, 'apps/keep.ts', 'export const keep = 1\n');
  const goodBaseline =
    `${createHash('sha256').update(frozenBody).digest('hex')}  ${frozenRel}\n`;
  write(box, BASELINE_REL, goodBaseline);

  const childEnv = (deno) => ({ ...process.env, DENO: deno, SQUARE_GUARDRAILS_META: 'child' });
  const runVerify = (deno) => status('bash', [sh], { cwd: box, stdio: 'pipe', env: childEnv(deno) });

  assert(runVerify(denoOk) === 0, 'verify.sh cannot go green even on a clean sandbox',
         'the remaining proofs in this block would be meaningless');

  // freeze failure propagates
  write(box, frozenRel, frozenBody + '// tampered\n');
  assert(runVerify(denoOk) !== 0, 'verify.sh exits 0 while the freeze gate is failing');
  write(box, frozenRel, frozenBody);

  // predicate failure propagates
  const planted = write(box, 'supabase/functions/bad/index.ts', `const a = p === 'square'\n`);
  assert(runVerify(denoOk) !== 0, 'verify.sh exits 0 while the predicate gate is failing');
  rmSync(planted);

  // typecheck failure propagates — the defect this script was rewritten for.
  // The stub prints nothing at all, so a gate that looked for the word "error"
  // in the output would read this as success.
  assert(runVerify(denoFail) !== 0, 'verify.sh exits 0 while deno reports failure',
         'the typecheck/test steps are not keying off exit status');

  assert(runVerify(denoOk) === 0, 'verify.sh stays red after the sandbox is repaired');
}

// ---------------------------------------------------------------------------
// 4  coverage — a gate nobody runs is decoration. (Reading the script for its
//    wiring is a structural check on source, not an output-grep pass/fail.)
// ---------------------------------------------------------------------------
{
  const sh = readFileSync(join(HERE, 'verify.sh'), 'utf8');
  for (const gate of readdirSync(HERE).filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))) {
    assert(sh.includes(gate), `${gate} exists but verify.sh never runs it`);
  }
}

if (failed) {
  console.error('\n[meta] one or more guardrails did not bite — fix the gate, not this file.');
  process.exit(1);
}
console.log(`[meta] ok  ${proofs} proofs: every gate was violated on purpose and every one failed`);
process.exit(0);

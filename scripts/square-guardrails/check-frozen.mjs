#!/usr/bin/env node
/**
 * Square guardrail — the freeze gate.
 *
 * Enforces the prime directive mechanically: "a Square bug is acceptable, a
 * Stripe regression is not". _shared/stripe-client.ts is 632 lines of hard-won
 * logic (the DEPOSIT_HOLD_CARD_VARIANTS downgrade ladder, resolveHoldExpiryDetailed,
 * getWebhookSecretCandidates' empty-string footgun, validateStripeCustomerId, the
 * UK/UAE multi-account helpers) imported by 55 files. It is frozen for the
 * duration of this workstream.
 *
 * Exit 1 if a frozen file's checksum moved while Square artifacts are present.
 *
 *   node scripts/square-guardrails/check-frozen.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASELINE = 'docs/square-integration/BASELINE.sha256';
const SQUARE_ARTIFACT = /(^|\/)(square|payments)\b|square/i;

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

if (!existsSync(BASELINE)) {
  console.error(`[freeze] baseline missing: ${BASELINE}`);
  process.exit(1);
}

const entries = readFileSync(BASELINE, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => {
    const [hash, ...rest] = l.trim().split(/\s+/);
    return { hash, path: rest.join(' ') };
  });

// An empty baseline used to pass: zero entries, zero mismatches, exit 0, and
// verify.sh printed its green banner. Deleting every line was therefore a way
// to silence this gate without touching this file. It is now a failure.
if (entries.length === 0) {
  console.error(`[freeze] baseline has no entries: ${BASELINE}`);
  console.error('         a freeze gate with nothing frozen cannot fail; refusing to pass.');
  process.exit(1);
}
const malformed = entries.filter((e) => !/^[0-9a-f]{64}$/.test(e.hash) || !e.path);
if (malformed.length) {
  for (const m of malformed) console.error(`[freeze] malformed baseline line: ${m.hash} ${m.path}`);
  process.exit(1);
}

// Which files does this branch change relative to main?
let changed = [];
try {
  changed = execSync('git diff --name-only main...HEAD', { encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch {
  console.warn('[freeze] could not diff against main; checking checksums only');
}
const touchesSquare = changed.some((f) => SQUARE_ARTIFACT.test(f));

let failed = false;
let proven = 0;
for (const { hash, path } of entries) {
  if (!existsSync(path)) {
    console.error(`[freeze] FROZEN FILE MISSING: ${path}`);
    failed = true;
    continue;
  }
  const actual = sha256(path);
  if (actual !== hash) {
    if (touchesSquare) {
      console.error(`[freeze] VIOLATION: ${path} changed in a commit that also touches Square.`);
      console.error(`         expected ${hash}`);
      console.error(`         actual   ${actual}`);
      console.error(`         Move the change into supabase/functions/_shared/payments/ instead.`);
      failed = true;
    } else {
      console.error(`[freeze] ${path} changed. Stripe-maintenance PR: update ${BASELINE} in this commit.`);
      failed = true;
    }
  } else {
    console.log(`[freeze] ok  ${path}`);
    proven += 1;
  }
}
if (!failed) console.log(`[freeze] ${proven} frozen file(s) byte-identical to ${BASELINE}`);
process.exit(failed ? 1 : 0);

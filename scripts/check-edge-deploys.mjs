#!/usr/bin/env node
/**
 * Is what's DEPLOYED what's in git?
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * On 2026-09-17 the self-serve signup flow was changed so every new tenant is
 * created on the v2 portal (`portal_experience: 'v2'`) with the v2 brand colour.
 * The change was written, reviewed, tested and COMMITTED — and never deployed.
 * The live `signup-provision` stayed at version 19 from 2026-08-03, so the next
 * real signup (`nasir`, 2026-09-18 10:03) was created as a v1 tenant with the
 * old palette, and the bug was reported a second time as though the fix had not
 * been made. It had been made. It was not running.
 *
 * `git log` cannot tell you that. A commit is not a deploy, and nothing in the
 * repo changes when a function ships or fails to ship. This script closes that
 * gap: for each function below it downloads the DEPLOYED bundle and checks that
 * the markers which must be present are present.
 *
 * ── usage ───────────────────────────────────────────────────────────────────
 *
 *   SB_PAT=<supabase personal access token> node scripts/check-edge-deploys.mjs
 *
 * Exits 1 if any function is missing a marker, so it can gate a release. The
 * token is read from the environment only and never written anywhere.
 *
 * ── adding a check ──────────────────────────────────────────────────────────
 *
 * Add an entry when a behaviour change MUST be live to be correct — a money
 * path, a gating flag, a webhook contract.
 *
 * A marker must be a STRING LITERAL or an object KEY from the change itself: the
 * deploy pipeline bundles with esbuild, which strips comments, so a marker taken
 * from a comment would report every function as stale. Prefer something
 * distinctive — a log message, a column name, a hex colour — over a common word
 * like a status name that appears all over the file anyway.
 */

const PROJECT = 'hviqoaokxvlancmftwuo';

/**
 * `canary` is a string that is in EVERY version of the function, old and new.
 *
 * Without it this script cannot tell "the new code is not deployed" from "I
 * cannot read strings out of this bundle at all". Deployed bundles are eszips
 * and their sources may be compressed, so a substring search can come back
 * empty for a perfectly current function — which would report a healthy deploy
 * as stale and, worse, teach everyone to ignore this script. If the canary is
 * missing the result is INCONCLUSIVE, not a failure.
 *
 * @type {{slug: string, markers: string[], canary: string, why: string}[]}
 */
const CHECKS = [
  {
    slug: 'signup-provision',
    markers: ['portal_experience', '442DD7'],
    canary: 'SLUG_TAKEN',
    why: 'every self-serve signup must be created on v2 with the v2 brand colour',
  },
  {
    slug: 'subscription-webhook',
    markers: [
      // Both are string literals from the monotonic period guard, which is the
      // fix that stops invoice.paid walking current_period_end backwards.
      'period write SKIPPED',
      'start-only period write SKIPPED',
    ],
    canary: 'checkout.session.completed',
    why: 'the dunning fixes are money-visible: billing dates and plan names',
  },
  {
    slug: 'generate-review-summary',
    // NOT 'subscription_past_due_expired': that string predates the Sep 18 gate
    // work, so it passed against a six-week-old bundle and reported a stale
    // function as fine. A marker has to be unique to the change it guards.
    markers: ['global kill-switch read failed'],
    canary: 'subscription_past_due_expired',
    why: 'imports _shared/subscription-gate.ts, which must honour both kill switches and the configured grace window',
  },
];

const token = process.env.SB_PAT;
if (!token) {
  console.error('FATAL: export SB_PAT with a Supabase personal access token (read-only use)');
  process.exit(1);
}

const api = (path) =>
  fetch(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

let failed = 0;

let inconclusive = 0;

for (const { slug, markers, canary, why } of CHECKS) {
  const metaRes = await api(`/functions/${slug}`);
  if (!metaRes.ok) {
    console.log(`FAIL  ${slug}: could not read metadata (HTTP ${metaRes.status})`);
    failed += 1;
    continue;
  }
  const meta = await metaRes.json();
  const bodyRes = await api(`/functions/${slug}/body`);
  if (!bodyRes.ok) {
    console.log(`FAIL  ${slug}: could not read the deployed bundle (HTTP ${bodyRes.status})`);
    failed += 1;
    continue;
  }
  // The bundle is an eszip; the strings we look for survive in it verbatim.
  const bundle = Buffer.from(await bodyRes.arrayBuffer()).toString('latin1');

  // Can this bundle be read at all? See the note on `canary`.
  if (canary && !bundle.includes(canary)) {
    inconclusive += 1;
    console.log(`?     ${slug}  v${meta.version}  INCONCLUSIVE — the bundle is unreadable by substring search`);
    console.log(`      the canary ${JSON.stringify(canary)} is absent too, and it is in every version,`);
    console.log(`      so absence of the markers proves nothing here. Compare versions/dates by hand.`);
    continue;
  }

  const missing = markers.filter((m) => !bundle.includes(m));
  const when = meta.updated_at ? new Date(Number(meta.updated_at)).toISOString() : 'unknown';
  const age = meta.updated_at
    ? Math.floor((Date.now() - Number(meta.updated_at)) / 86_400_000)
    : null;

  if (missing.length === 0) {
    console.log(`ok    ${slug}  v${meta.version}  deployed ${when}${age != null ? ` (${age}d ago)` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${slug}  v${meta.version}  deployed ${when}${age != null ? ` (${age}d ago)` : ''}`);
    console.log(`      missing from the DEPLOYED bundle: ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
    console.log(`      why it matters: ${why}`);
    console.log(`      the code is in git but is NOT running — redeploy ${slug}`);
  }
}

const parts = [];
if (failed) parts.push(`${failed} STALE`);
if (inconclusive) parts.push(`${inconclusive} inconclusive`);
const clean = CHECKS.length - failed - inconclusive;
if (clean) parts.push(`${clean} up to date`);
console.log(`\n${parts.join(', ')} of ${CHECKS.length} checked functions.`);

// Inconclusive is NOT a pass: it means this check could not do its job, and
// treating it as green is how a stale deploy hides for 46 days.
process.exit(failed === 0 && inconclusive === 0 ? 0 : 1);

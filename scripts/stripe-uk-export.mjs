#!/usr/bin/env node
/**
 * stripe-uk-export.mjs — full read-only export of the legacy UK Stripe platform
 * account and every connected account hanging off it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The UK platform account closes at 08:00 UTC 2026-08-19. Once closed it cannot
 * be reopened and the dashboard goes with it. Our `payments` table stores Stripe
 * OBJECT IDS but none of the underlying facts — no card brand, no last4, no
 * receipt URL, no balance transaction, no fee, no ARN. So ~1,400 stored ids lose
 * their referent permanently at cut-off.
 *
 * That matters most for DISPUTES: ~$56k of captured UK card money is still
 * inside the chargeback window, and because car rental is a future-dated
 * service the clock runs from the RENTAL date, not the payment date — the tail
 * runs for months. Defending any of those requires evidence that exists only
 * inside this account right now.
 *
 * This script is READ-ONLY. It issues GET requests exclusively. It never
 * creates, updates, cancels or refunds anything.
 *
 * USAGE
 *   export STRIPE_UK_SECRET_KEY=sk_live_...          # the LEGACY UK key
 *   node scripts/stripe-uk-export.mjs                # writes ./stripe-uk-export-<ts>/
 *
 *   # optional
 *   STRIPE_UK_SECRET_KEY=... node scripts/stripe-uk-export.mjs --out /backup/uk
 *   ... --skip-connected      # platform only (faster smoke test)
 *   ... --only charges,disputes
 *
 * OUTPUT
 *   <out>/platform/<resource>.json          one file per resource, full array
 *   <out>/connected/<acct_id>/<resource>.json
 *   <out>/_manifest.json                    counts, errors, timings
 *
 * Resume: already-complete files are skipped, so re-running after a crash or a
 * rate-limit storm continues rather than starting over. Delete a file to force
 * that one resource to re-fetch.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.STRIPE_UK_SECRET_KEY || process.env.STRIPE_LIVE_SECRET_KEY;
if (!KEY) {
  console.error('\nERROR: set STRIPE_UK_SECRET_KEY to the LEGACY UK secret key (sk_live_...).\n');
  process.exit(1);
}
if (!KEY.startsWith('sk_')) {
  console.error('\nERROR: that does not look like a secret key (expected sk_live_... or sk_test_...).\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = argVal('--out', `stripe-uk-export-${STAMP}`);
const ONLY = argVal('--only', null)?.split(',').map((s) => s.trim());
const SKIP_CONNECTED = has('--skip-connected');

// Resources fetched on the PLATFORM account. `limit:100` is Stripe's max page.
// `expand` pulls the fields that exist nowhere in our DB and are the whole point
// of the export — balance_transaction carries the fee/net, and for a dispute the
// evidence block is what you would actually submit.
const PLATFORM = [
  ['balance',                'v1/balance',                    { single: true }],
  ['accounts',               'v1/accounts',                   {}],
  ['charges',                'v1/charges',                    { expand: ['data.balance_transaction', 'data.customer'] }],
  ['payment_intents',        'v1/payment_intents',            {}],
  ['checkout_sessions',      'v1/checkout/sessions',          {}],
  ['refunds',                'v1/refunds',                    {}],
  ['disputes',               'v1/disputes',                   {}],
  ['early_fraud_warnings',   'v1/radar/early_fraud_warnings', {}],
  ['customers',              'v1/customers',                  {}],
  ['invoices',               'v1/invoices',                   {}],
  ['payouts',                'v1/payouts',                    {}],
  ['balance_transactions',   'v1/balance_transactions',       {}],
  ['application_fees',       'v1/application_fees',           {}],
  ['subscriptions',          'v1/subscriptions',              {}],
  ['products',               'v1/products',                   {}],
  ['prices',                 'v1/prices',                     {}],
  // Money moved platform -> connected account. Without this you cannot answer
  // "who was actually paid what" from the export alone, and it is the other
  // half of the application_fees picture when settling with the ex-partner.
  ['transfers',              'v1/transfers',                  { expand: ['data.balance_transaction'] }],
  // Webhook/event history. Stripe retains only ~30 days, so this is the one
  // resource that is ALREADY partly lost and will be fully lost at closure.
  // It is how you reconstruct what happened to a payment when our own tables
  // disagree with Stripe.
  ['events',                 'v1/events',                     {}],
];

// Per CONNECTED account. Same shape, fetched with the Stripe-Account header.
const CONNECTED = [
  ['balance',                'v1/balance',                    { single: true }],
  ['account',                'v1/account',                    { single: true }],
  ['charges',                'v1/charges',                    { expand: ['data.balance_transaction', 'data.customer'] }],
  ['payment_intents',        'v1/payment_intents',            {}],
  ['checkout_sessions',      'v1/checkout/sessions',          {}],
  ['refunds',                'v1/refunds',                    {}],
  ['disputes',               'v1/disputes',                   {}],
  ['early_fraud_warnings',   'v1/radar/early_fraud_warnings', {}],
  ['customers',              'v1/customers',                  {}],
  ['invoices',               'v1/invoices',                   {}],
  ['payouts',                'v1/payouts',                    {}],
  ['balance_transactions',   'v1/balance_transactions',       {}],
  ['transfers',              'v1/transfers',                  {}],
  ['events',                 'v1/events',                     {}],
  // Saved cards. Our DB has zero card mandates so this should come back empty —
  // if it does NOT, that is a finding: cards exist on the closing account that
  // nothing in our system knows about, and their owners lose them silently.
  ['payment_methods',        'v1/payment_methods',            { params: { type: 'card' } }],
];

const manifest = { started: new Date().toISOString(), key_prefix: KEY.slice(0, 12), platform: {}, connected: {}, errors: [] };
let calls = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One GET, with retry on 429 and 5xx. Returns parsed JSON or throws. */
async function get(path, params = {}, stripeAccount = null, attempt = 0) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x, i) => qs.append(`${k}[${i}]`, x));
    else if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  const url = `https://api.stripe.com/${path}${qs.toString() ? `?${qs}` : ''}`;
  const headers = { Authorization: `Bearer ${KEY}`, 'Stripe-Version': '2023-10-16' };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;

  calls++;
  const res = await fetch(url, { headers });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${res.status} after ${attempt} retries on ${path}`);
    // Exponential backoff. Stripe's live rate limit is 100 read req/s; a long
    // export will brush it, and giving up there would silently truncate history.
    const wait = Math.min(2 ** attempt * 500, 15000);
    process.stdout.write(` [${res.status} backoff ${wait}ms]`);
    await sleep(wait);
    return get(path, params, stripeAccount, attempt + 1);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

/** Auto-paginate a Stripe list endpoint to completion. */
async function getAll(path, opts = {}, stripeAccount = null) {
  if (opts.single) return await get(path, { ...(opts.params || {}), ...(opts.expand ? { expand: opts.expand } : {}) }, stripeAccount);
  const out = [];
  let starting_after;
  for (;;) {
    const page = await get(path, {
      limit: 100,
      ...(opts.params || {}),
      ...(starting_after ? { starting_after } : {}),
      ...(opts.expand ? { expand: opts.expand } : {}),
    }, stripeAccount);
    const data = page.data || [];
    out.push(...data);
    process.stdout.write(`\r    ${path} … ${out.length}`);
    if (!page.has_more || data.length === 0) break;
    starting_after = data[data.length - 1].id;
  }
  return out;
}

function save(dir, name, payload) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(payload, null, 2));
}

/** Fetch a resource set into a directory, skipping anything already written. */
async function fetchSet(list, dir, stripeAccount, label) {
  const counts = {};
  for (const [name, path, opts] of list) {
    if (ONLY && !ONLY.includes(name)) continue;
    const file = join(dir, `${name}.json`);
    if (existsSync(file)) {
      try {
        const prev = JSON.parse(readFileSync(file, 'utf8'));
        counts[name] = Array.isArray(prev) ? prev.length : 1;
        console.log(`    ${name}: skipped (already exported, ${counts[name]})`);
        continue;
      } catch { /* corrupt — refetch */ }
    }
    try {
      const data = await getAll(path, opts, stripeAccount);
      save(dir, name, data);
      counts[name] = Array.isArray(data) ? data.length : 1;
      process.stdout.write(`\r    ${name}: ${counts[name]}${' '.repeat(30)}\n`);
    } catch (e) {
      // One dead resource must never abort the run — a permission gap on Radar
      // should not cost you the charges. Record it and continue.
      counts[name] = `ERROR: ${e.message}`;
      manifest.errors.push({ scope: label, resource: name, error: e.message, code: e.code });
      process.stdout.write(`\r    ${name}: FAILED — ${e.message}${' '.repeat(10)}\n`);
    }
  }
  return counts;
}

(async () => {
  const t0 = Date.now();
  console.log(`\nSTRIPE UK EXPORT — read-only`);
  console.log(`key    ${KEY.slice(0, 12)}…`);
  console.log(`out    ${OUT}\n`);

  mkdirSync(OUT, { recursive: true });

  console.log('PLATFORM ACCOUNT');
  manifest.platform = await fetchSet(PLATFORM, join(OUT, 'platform'), null, 'platform');

  if (!SKIP_CONNECTED) {
    let accounts = [];
    try {
      accounts = JSON.parse(readFileSync(join(OUT, 'platform', 'accounts.json'), 'utf8'));
    } catch {
      console.log('\n  (no accounts.json — fetching connected account list)');
      accounts = await getAll('v1/accounts', {}, null);
      save(join(OUT, 'platform'), 'accounts', accounts);
    }
    console.log(`\nCONNECTED ACCOUNTS — ${accounts.length}\n`);
    for (let i = 0; i < accounts.length; i++) {
      const id = accounts[i].id;
      console.log(`  [${i + 1}/${accounts.length}] ${id}  ${accounts[i].business_profile?.name || accounts[i].email || ''}`);
      manifest.connected[id] = await fetchSet(CONNECTED, join(OUT, 'connected', id), id, id);
    }
  }

  manifest.finished = new Date().toISOString();
  manifest.duration_seconds = Math.round((Date.now() - t0) / 1000);
  manifest.api_calls = calls;
  save(OUT, '_manifest', manifest);

  const totals = {};
  for (const src of [manifest.platform, ...Object.values(manifest.connected)]) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
  }

  console.log(`\n${'='.repeat(58)}`);
  console.log('EXPORT COMPLETE');
  console.log(`${'='.repeat(58)}`);
  console.log(`  duration    ${manifest.duration_seconds}s   api calls ${calls}`);
  console.log(`  output      ${OUT}`);
  console.log('\n  totals across platform + all connected accounts:');
  for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${v}`);
  }
  if (manifest.errors.length) {
    console.log(`\n  ${manifest.errors.length} RESOURCE(S) FAILED — re-run to retry just these:`);
    for (const e of manifest.errors.slice(0, 20)) console.log(`    ${e.scope}/${e.resource}: ${e.error}`);
    console.log('\n  Re-running is safe: completed files are skipped.');
  } else {
    console.log('\n  no errors.');
  }
  console.log('');
})().catch((e) => {
  console.error('\nFATAL:', e.message);
  console.error('Re-run the same command — completed resources are skipped.\n');
  process.exit(1);
});

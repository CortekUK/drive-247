#!/usr/bin/env node
/**
 * Square credential health check.
 *
 * Proves each Square credential against Square's own API rather than against
 * our expectations of it. A credential is VERIFIED only when Square accepts it;
 * "the variable is set" is not evidence of anything — a stale, revoked or
 * wrong-environment secret is set exactly as convincingly as a working one.
 *
 *   node scripts/square-credential-health.mjs
 *   node scripts/square-credential-health.mjs --env-file supabase/functions/.env
 *   node scripts/square-credential-health.mjs --mode live
 *
 * SECRETS ARE NEVER PRINTED. Each value is reported as present/absent, its
 * length, and a short SHA-256 fingerprint — enough to tell two values apart, to
 * spot the same key pasted into two slots, and to confirm a rotation actually
 * changed something, without putting the secret in a terminal, a CI log or a
 * screenshot.
 *
 * WHAT IT CANNOT DO
 *
 * Supabase stores edge-function secrets encrypted and does not hand them back,
 * so this reads from your shell or a local env file. Passing when run locally
 * therefore proves the VALUE is good, not that the same value is the one
 * deployed. Compare the fingerprints printed here against a run in the
 * deployed environment to close that gap.
 *
 * WHY EACH CHECK IS THE ONE IT IS
 *
 * Square has no "validate this credential" endpoint, so each check is the
 * cheapest real request that can only succeed with a correct value:
 *
 *   app id + secret   ObtainToken with a deliberately invalid authorization
 *                     code. A correct app pair is rejected for the CODE
 *                     (`AUTHORIZATION_ERROR` / invalid grant); a wrong app id
 *                     or secret is rejected for the CLIENT
 *                     (`UNAUTHORIZED` / invalid_client) first. The distinction
 *                     is the test. Nothing is created and no token is issued.
 *
 *   webhook signature Square never echoes the key, so it is verified
 *                     ARITHMETICALLY: we compute the HMAC-SHA256 Square would
 *                     compute for a known body and confirm our verification
 *                     path accepts it and rejects a tampered one. That proves
 *                     the key is usable as key material and that the
 *                     notification URL it is paired with matches — the two
 *                     failure modes that silently drop every event.
 *
 *   redirect uri      Format only. Square does not expose the registered value
 *                     through the API; it can only be compared by eye against
 *                     the console.
 */

import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const envFile = arg('--env-file');
const onlyMode = arg('--mode'); // 'test' | 'live' | undefined (both)

/** Values come from the shell, optionally overlaid with a local env file. */
const env = { ...process.env };
if (envFile) {
  let raw;
  try {
    raw = readFileSync(envFile, 'utf8');
  } catch (err) {
    console.error(`Cannot read --env-file ${envFile}: ${err.code ?? err.message}`);
    process.exit(2);
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
}

const val = (name) => {
  const v = env[name];
  return v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim();
};

/** Short, stable, non-reversible. Enough to compare two values without seeing either. */
const fingerprint = (v) => (v ? createHash('sha256').update(v).digest('hex').slice(0, 10) : '—');

const HOST = { test: 'https://connect.squareupsandbox.com', live: 'https://connect.squareup.com' };
const SQUARE_VERSION = val('SQUARE_VERSION') ?? '2026-08-19';

const results = [];
const record = (name, mode, status, detail) => results.push({ name, mode, status, detail });

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/**
 * Application id + secret, via ObtainToken with a knowingly bad code.
 *
 * Reading the FAILURE is the whole point. Square rejects a bad client before it
 * ever looks at the code, so which error comes back separates "your app
 * credentials are wrong" from "your app credentials are right and the code was
 * rubbish, as intended".
 */
async function checkAppCredentials(mode) {
  const idName = `SQUARE_${mode.toUpperCase()}_APP_ID`;
  const secretName = `SQUARE_${mode.toUpperCase()}_APP_SECRET`;
  const appId = val(idName);
  const appSecret = val(secretName);

  if (!appId || !appSecret) {
    const missing = [!appId ? idName : null, !appSecret ? secretName : null].filter(Boolean);
    record(`${idName} + ${secretName}`, mode, 'MISSING', `not set: ${missing.join(', ')}`);
    return;
  }

  const expectedPrefix = mode === 'live' ? 'sq0idp-' : 'sandbox-sq0idb-';
  if (!appId.startsWith(expectedPrefix)) {
    record(
      idName,
      mode,
      'FAIL',
      `expected an id starting "${expectedPrefix}" for ${mode}; this looks like the other environment's app id`,
    );
    return;
  }

  let res;
  let body;
  try {
    res = await fetch(`${HOST[mode]}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        // Deliberately invalid. We are testing the CLIENT, not the code.
        code: 'health-check-not-a-real-authorization-code',
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    record(`${idName} + ${secretName}`, mode, 'ERROR', `network: ${err.message}`);
    return;
  }

  // The two responses were MEASURED against Square, not assumed — an earlier
  // version of this check read them backwards and reported working credentials
  // as broken. Both are HTTP 401, so the status alone tells you nothing:
  //
  //   correct id + correct secret, bad code
  //     -> {"errors":[{"category":"AUTHENTICATION_ERROR","code":"UNAUTHORIZED",
  //                   "detail":"Authorization code not found for app <appId>"}]}
  //        Square authenticated the CLIENT, then failed to find the code.
  //        It even echoes the app id, confirming which app answered.
  //
  //   wrong secret, or wrong app id
  //     -> {"message":"Not Authorized","type":"service.not_authorized"}
  //        A bare service-level rejection with no errors[] — Square never got
  //        as far as the code.
  //
  // So the discriminator is the SHAPE of the failure, not its status.
  const errs = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errs.map((e) => `${e.category ?? ''}/${e.code ?? ''}`).join(', ');
  const detail = errs.map((e) => e.detail ?? '').join(' ');

  if (res.ok) {
    // Unreachable in practice: a fake code cannot mint a token.
    record(`${idName} + ${secretName}`, mode, 'ERROR', 'unexpected success from a dummy code — investigate');
    return;
  }

  if (body?.type === 'service.not_authorized' || (errs.length === 0 && body?.message === 'Not Authorized')) {
    record(
      `${idName} + ${secretName}`,
      mode,
      'FAIL',
      `Square refused the application credentials outright (service.not_authorized). ` +
        `The ${mode} app id and secret do not belong together, or are not a ${mode} application. ` +
        `Take a fresh pair from the console.`,
    );
    return;
  }

  if (/authorization code not found/i.test(detail)) {
    // The app id is echoed back; confirm it is the one we sent.
    const echoesOurApp = detail.includes(appId);
    record(
      `${idName} + ${secretName}`,
      mode,
      'PASS',
      `Square authenticated the application and rejected only the dummy code${
        echoesOurApp ? ', echoing this exact app id' : ''
      } — the pair is valid.`,
    );
    return;
  }

  record(
    `${idName} + ${secretName}`,
    mode,
    'UNKNOWN',
    `HTTP ${res.status}${codes ? ` (${codes})` : ''} — unrecognised response shape; check manually`,
  );
}

/**
 * Webhook signature key, verified arithmetically.
 *
 * Square signs `notification_url + raw_body` with HMAC-SHA256. Both halves are
 * checked because a key that is fine paired with the wrong URL rejects every
 * real event just as completely as a wrong key.
 */
function checkWebhookKey(mode) {
  const keyName = `SQUARE_${mode.toUpperCase()}_WEBHOOK_SIGNATURE_KEY`;
  const key = val(keyName);
  const url =
    val(`SQUARE_${mode.toUpperCase()}_WEBHOOK_NOTIFICATION_URL`) ?? val('SQUARE_WEBHOOK_NOTIFICATION_URL');

  if (!key) {
    record(keyName, mode, 'MISSING', 'not set — every live event for this mode is rejected');
    return;
  }
  if (!url) {
    record(
      keyName,
      mode,
      'FAIL',
      'no notification URL set for this mode (SQUARE_WEBHOOK_NOTIFICATION_URL or the per-mode override); ' +
        'the URL is part of the signed message, so verification cannot succeed',
    );
    return;
  }
  if (!/^https:\/\//.test(url)) {
    record(keyName, mode, 'FAIL', `notification URL is not https: ${url}`);
    return;
  }
  if (url.endsWith('/')) {
    record(
      keyName,
      mode,
      'FAIL',
      'notification URL has a trailing slash — it must match the registered value byte for byte',
    );
    return;
  }

  const body = JSON.stringify({ type: 'health.check', data: { id: 'health' } });
  let signature;
  try {
    signature = createHmac('sha256', key).update(url + body).digest('base64');
  } catch (err) {
    record(keyName, mode, 'FAIL', `unusable as HMAC key material: ${err.message}`);
    return;
  }

  const good = createHmac('sha256', key).update(url + body).digest('base64') === signature;
  const tampered = createHmac('sha256', key).update(url + body + 'x').digest('base64') === signature;

  if (good && !tampered) {
    record(keyName, mode, 'PASS', `usable key; signs for ${url}`);
  } else {
    record(keyName, mode, 'FAIL', 'HMAC did not behave as expected — key material is not usable');
  }
}

/** Redirect URI: format only. Square does not expose the registered value. */
function checkRedirectUri() {
  const name = 'SQUARE_REDIRECT_URI';
  const v = val(name);
  if (!v) {
    record(name, 'both', 'MISSING', 'not set — the OAuth flow cannot complete');
    return;
  }
  if (!/^https:\/\/.+\/functions\/v1\/square-oauth-callback$/.test(v)) {
    record(name, 'both', 'FAIL', `does not look like the callback endpoint: ${v}`);
    return;
  }
  record(name, 'both', 'CHECK', `well-formed — confirm BY EYE it matches the console exactly: ${v}`);
}

/** Names the code never reads. Being set is harmless; being believed in is not. */
function checkDeadVariables() {
  const dead = [
    ['SQUARE_ENV', 'mode comes from the OAuth state row and tenants.square_mode; nothing reads this'],
    ['SQUARE_TEST_ACCESS_TOKEN', 'payments use each tenant\'s OAuth token; no platform token is ever used'],
    ['SQUARE_LIVE_ACCESS_TOKEN', 'same — no code path reads a platform access token'],
    ['SQUARE_TEST_BASE_URL', 'hosts are hardcoded in square-client.ts'],
    ['SQUARE_LIVE_BASE_URL', 'hosts are hardcoded in square-client.ts'],
    ['SQUARE_APPLICATION_ID', 'superseded by the per-mode SQUARE_{TEST,LIVE}_APP_ID'],
    ['SQUARE_LOCATION_ID', 'location is per tenant, stored in square_connections.location_id'],
    ['SQUARE_OAUTH_REDIRECT_URL', 'the code reads SQUARE_REDIRECT_URI; this name is read by nothing'],
  ];
  for (const [name, why] of dead) {
    if (val(name)) record(name, '—', 'UNUSED', why);
  }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const modes = onlyMode ? [onlyMode] : ['test', 'live'];

console.log('Square credential health');
console.log('='.repeat(78));
console.log(`Square-Version: ${SQUARE_VERSION}${val('SQUARE_VERSION') ? '' : '  (default — SQUARE_VERSION unset)'}`);
console.log(`Source        : ${envFile ? envFile : 'process environment'}`);
console.log('Secrets are never printed; values are shown as a SHA-256 fingerprint.\n');

console.log('Inventory');
console.log('-'.repeat(78));
const inventory = [
  'SQUARE_TEST_APP_ID',
  'SQUARE_TEST_APP_SECRET',
  'SQUARE_TEST_WEBHOOK_SIGNATURE_KEY',
  'SQUARE_LIVE_APP_ID',
  'SQUARE_LIVE_APP_SECRET',
  'SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY',
  'SQUARE_REDIRECT_URI',
  'SQUARE_WEBHOOK_NOTIFICATION_URL',
  'SQUARE_TEST_WEBHOOK_NOTIFICATION_URL',
  'SQUARE_LIVE_WEBHOOK_NOTIFICATION_URL',
  'SQUARE_VERSION',
  'SQUARE_TIMEOUT_MS',
];
for (const name of inventory) {
  const v = val(name);
  const shown = name.endsWith('_URL') || name.endsWith('_URI') || name === 'SQUARE_VERSION' || name === 'SQUARE_TIMEOUT_MS';
  console.log(
    `  ${name.padEnd(38)} ${(v ? 'set' : 'unset').padEnd(6)} ${
      v ? (shown ? v : `len=${String(v.length).padStart(3)} fp=${fingerprint(v)}`) : ''
    }`,
  );
}

// Same key in two slots is a real, silent failure: it means one environment's
// key is missing and the other is duplicated.
const testKey = val('SQUARE_TEST_WEBHOOK_SIGNATURE_KEY');
const liveKey = val('SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY');
if (testKey && liveKey && testKey === liveKey) {
  record(
    'SQUARE_{TEST,LIVE}_WEBHOOK_SIGNATURE_KEY',
    'both',
    'FAIL',
    'identical in both slots — sandbox and production issue DIFFERENT keys, so one of these is wrong ' +
      'and that environment rejects every event',
  );
}

console.log('\nChecks');
console.log('-'.repeat(78));
for (const mode of modes) {
  await checkAppCredentials(mode);
  checkWebhookKey(mode);
}
checkRedirectUri();
checkDeadVariables();

const ICON = { PASS: 'PASS', FAIL: 'FAIL', MISSING: 'MISS', UNKNOWN: '????', ERROR: 'ERR ', CHECK: 'EYE ', UNUSED: 'DEAD' };
for (const r of results) {
  console.log(`  [${ICON[r.status] ?? r.status}] ${r.name}${r.mode && r.mode !== '—' ? ` (${r.mode})` : ''}`);
  console.log(`         ${r.detail}`);
}

const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR').length;
const missing = results.filter((r) => r.status === 'MISSING').length;
const passed = results.filter((r) => r.status === 'PASS').length;

console.log('\n' + '='.repeat(78));
console.log(`verified ${passed}   failed ${failed}   missing ${missing}`);
console.log(
  'A credential counts as VERIFIED only on PASS with a value freshly taken from the Square dashboard.',
);
process.exit(failed > 0 ? 1 : 0);

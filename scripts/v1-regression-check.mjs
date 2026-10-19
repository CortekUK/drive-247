#!/usr/bin/env node
/**
 * v1-regression-check.mjs — does a live v1 tenant's portal still work?
 *
 * The standing rule for the platform security work is that v1 behaves exactly
 * as before every commit. This script is that check, run before and after each
 * change: it creates a throwaway head_admin on a v1 tenant (with both policies
 * accepted so the policy gate does not block), signs in to the DEPLOYED portal
 * in headless Chromium, opens the screens v1 operators live in, and records for
 * each one:
 *   - whether it rendered (no error boundary, the page's own heading present),
 *   - every Supabase request that came back 4xx/5xx (a permission regression
 *     shows up here first),
 *   - console errors,
 *   - a full-page screenshot.
 * The throwaway user is deleted in `finally`.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/v1-regression-check.mjs --tenant test --out <dir> [--label before]
 *
 * Exits 1 when any screen fails to render or a Supabase call fails.
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const SLUG = arg('tenant', 'test');
const OUT = arg('out', path.resolve('v1-regression'));
const LABEL = arg('label', new Date().toISOString().replace(/[:.]/g, '-'));
const BASE = arg('base', `https://${SLUG}.portal.drive-247.com`);
const { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SVC } = process.env;
if (!URL || !SVC) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2); }

// The v1 screens the standing rule names, and the text that proves each rendered.
const SCREENS = [
  { name: 'dashboard', path: '/', expect: null },
  { name: 'customers', path: '/customers', expect: /customers/i },
  { name: 'rentals', path: '/rentals', expect: /rentals/i },
  { name: 'payments', path: '/payments', expect: /payments/i },
  { name: 'documents', path: '/documents', expect: /documents/i },
  { name: 'settings-messaging', path: '/settings?tab=messaging', expect: /Communication Channels/i },
];

const svc = createClient(URL, SVC, { auth: { persistSession: false } });
const fx = { authId: null, appUserId: null };

async function fixture(tenant) {
  const email = `v1-regression-${randomBytes(4).toString('hex')}@drive-247.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  fx.authId = data.user.id;
  const { data: au } = await svc.from('app_users')
    .insert({ auth_user_id: fx.authId, email, role: 'head_admin', tenant_id: tenant.id, name: 'v1 regression check', is_active: true })
    .select('id').single().throwOnError();
  fx.appUserId = au.id;
  await svc.from('policy_acceptances').insert([
    { app_user_id: au.id, tenant_id: tenant.id, policy_type: 'privacy_policy', version: tenant.privacy_policy_version ?? '1.0' },
    { app_user_id: au.id, tenant_id: tenant.id, policy_type: 'terms_and_conditions', version: tenant.terms_version ?? '1.0' },
  ]).throwOnError();
  return { email, password };
}

async function teardown() {
  if (fx.appUserId) {
    await svc.from('policy_acceptances').delete().eq('app_user_id', fx.appUserId);
    await svc.from('app_users').delete().eq('id', fx.appUserId);
  }
  if (fx.authId) await svc.auth.admin.deleteUser(fx.authId);
}

const results = [];
let browser;
try {
  const { data: tenant } = await svc.from('tenants')
    .select('id, slug, portal_experience, privacy_policy_version, terms_version').eq('slug', SLUG).single().throwOnError();
  if (tenant.portal_experience === 'v2') throw new Error(`${SLUG} is a v2 tenant — this check is for v1.`);
  const creds = await fixture(tenant);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let current = null;
  page.on('response', (r) => {
    if (current && r.url().startsWith(URL) && r.status() >= 400) current.failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(URL, '').slice(0, 140)}`);
  });
  page.on('console', (m) => { if (current && m.type() === 'error') current.console.push(m.text().slice(0, 200)); });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
  // Let the post-login landing finish its own requests, so they are not cut off
  // (and misreported as "Failed to fetch") by the first navigation below.
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  mkdirSync(OUT, { recursive: true });
  for (const s of SCREENS) {
    current = { screen: s.name, path: s.path, failed: [], console: [], rendered: false, note: '' };
    try {
      await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // First-login dialogs (welcome guide, tours) would hide the screen in the screenshot.
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      const text = await page.locator('body').innerText();
      const crashed = /Something went wrong|Application error|Unhandled Runtime Error/i.test(text);
      const onLogin = new globalThis.URL(page.url()).pathname.startsWith('/login');
      current.rendered = !crashed && !onLogin && (!s.expect || s.expect.test(text));
      current.note = crashed ? 'error boundary' : onLogin ? 'bounced to login' : !current.rendered ? 'expected heading missing' : '';
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${s.name}.png`), fullPage: true });
    } catch (e) {
      current.note = e.message.split('\n')[0];
    }
    results.push(current);
  }
} catch (e) {
  console.error('Check aborted:', e?.message ?? e);
  results.push({ screen: '(setup)', path: '', failed: [], console: [], rendered: false, note: e?.message ?? String(e) });
} finally {
  await browser?.close().catch(() => {});
  await teardown().catch((e) => console.error('TEARDOWN FAILED — clean up by hand:', e?.message ?? e));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 1));
console.log(`v1 regression check — tenant ${SLUG} (${BASE}), label ${LABEL}\n`);
console.log('| screen | rendered | failed Supabase calls | console errors | note |\n|---|---|---|---|---|');
for (const r of results) console.log(`| ${r.screen} | ${r.rendered ? 'yes' : 'NO'} | ${r.failed.length} | ${r.console.length} | ${r.note} |`);
for (const r of results) for (const f of r.failed) console.log(`  ${r.screen}: ${f}`);
process.exit(results.every((r) => r.rendered && r.failed.length === 0) ? 0 : 1);

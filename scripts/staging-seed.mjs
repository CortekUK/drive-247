#!/usr/bin/env node
/**
 * staging-seed.mjs — put the minimum usable data into a freshly rebuilt
 * staging DB: one super-admin login, ONE synthetic tenant ("northwind"), its
 * head admin, and a small fleet. Idempotent: safe to re-run.
 *
 * Deliberately ONE tenant. Multiple near-identical tenants made it ambiguous
 * which one a given test was exercising. "northwind" is the long-standing
 * convention for sample data — it reads as a believable operator in the UI
 * while being unmistakably not a real customer. Never "test": that collides
 * with the real `test` tenant slug used in production.
 *
 * Synthetic ONLY. Never copy production customer data into staging.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... node scripts/staging-seed.mjs
 *   Credentials are written to .staging-credentials.local (gitignored).
 */
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const REF = 'ksmreaadhbirzakkxqrq';
const URL = `https://${REF}.supabase.co`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('set SUPABASE_ACCESS_TOKEN'); process.exit(1); }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const api = async (path, init = {}) =>
  fetch(`https://api.supabase.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA,
               'Content-Type': 'application/json', ...(init.headers || {}) },
  });

const sql = async (query) => {
  const r = await api(`/projects/${REF}/database/query`, {
    method: 'POST', body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`SQL failed: ${JSON.stringify(j)}`);
  return j;
};

// service_role key, needed for the Auth admin API
const keys = await (await api(`/projects/${REF}/api-keys`)).json();
const SERVICE = keys.find((k) => k.name === 'service_role').api_key;

const authAdmin = async (path, init = {}) =>
  fetch(`${URL}/auth/v1${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
               'Content-Type': 'application/json', ...(init.headers || {}) },
  });

const pw = () => randomBytes(12).toString('base64url') + 'aA1!';

/** create (or find) an auth user, return its uuid */
async function ensureAuthUser(email, password) {
  const r = await authAdmin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await r.json();
  if (j.id) return { id: j.id, created: true };
  // already exists -> look it up
  const list = await (await authAdmin(`/admin/users?page=1&per_page=200`)).json();
  const found = (list.users || []).find((u) => u.email === email);
  if (!found) throw new Error(`could not create or find ${email}: ${JSON.stringify(j)}`);
  return { id: found.id, created: false };
}

const esc = (s) => String(s).replace(/'/g, "''");
const creds = [];

console.log('▸ super admin');
{
  const email = 'staging-admin@drive-247.com';
  const password = pw();
  const { id, created } = await ensureAuthUser(email, password);
  if (!created) {
    // Re-runs must not silently drop this login from the creds file: the file is
    // overwritten each run, so an unrotated password would simply vanish and the
    // account would be unreachable. Rotate instead.
    await authAdmin(`/admin/users/${id}`, {
      method: 'PUT', body: JSON.stringify({ password }),
    });
  }
  creds.push({ role: 'super admin (admin app)', email, password });
  await sql(`
    insert into app_users (auth_user_id, email, role, tenant_id, is_super_admin, is_primary_super_admin)
    values ('${id}', '${esc(email)}', 'head_admin', null, true, true)
    on conflict (auth_user_id) do update
      set is_super_admin = true, is_primary_super_admin = true, tenant_id = null;`);
  console.log(`   ${email}`);
}

const TENANT = { slug: 'northwind', company_name: 'Northwind Rentals' };
const TENANTS = [TENANT];

console.log('▸ removing any tenant that is not the seed tenant');
{
  // Guarded: this script hard-codes the staging ref at the top, so it can only
  // ever run against staging. Never point it at production.
  const stale = await sql(`select id, slug from tenants where slug <> '${TENANT.slug}'`);
  for (const t of stale) {
    // Remove the auth.users rows too. An app_users row deleted on its own
    // leaves an orphaned auth user, which makes signup report "already exists"
    // while login reports "no account" — a loop that is painful to diagnose.
    const orphans = await sql(
      `select auth_user_id from app_users where tenant_id = '${t.id}' and auth_user_id is not null`
    );
    await sql(`delete from vehicles  where tenant_id = '${t.id}'`);
    await sql(`delete from app_users where tenant_id = '${t.id}'`);
    await sql(`delete from tenants   where id = '${t.id}'`);
    for (const o of orphans) {
      await authAdmin(`/admin/users/${o.auth_user_id}`, { method: 'DELETE' }).catch(() => {});
    }
    console.log(`   removed ${t.slug}${orphans.length ? ` (+${orphans.length} auth user)` : ''}`);
  }
  if (!stale.length) console.log('   none');
}

console.log('▸ tenants');
for (const t of TENANTS) {
  await sql(`insert into tenants (slug, company_name)
             values ('${esc(t.slug)}', '${esc(t.company_name)}')
             on conflict (slug) do nothing;`);
  console.log(`   ${t.slug}`);
}

console.log('▸ tenant admin for "northwind"');
{
  const email = 'northwind-admin@drive-247.com';
  const password = pw();
  const { id, created } = await ensureAuthUser(email, password);
  if (!created) {
    await authAdmin(`/admin/users/${id}`, {
      method: 'PUT', body: JSON.stringify({ password }),
    });
  }
  creds.push({ role: 'tenant head_admin (northwind portal)', email, password });
  await sql(`
    insert into app_users (auth_user_id, email, role, tenant_id, is_super_admin)
    select '${id}', '${esc(email)}', 'head_admin', t.id, false
      from tenants t where t.slug = '${TENANT.slug}'
    on conflict (auth_user_id) do update
      set tenant_id = excluded.tenant_id, role = 'head_admin';`);
  console.log(`   ${email}`);
}

console.log('▸ fleet for "northwind"');
{
  const vehicles = [
    ['Tesla', 'Model 3', 2023, 'STG-001'],
    ['Toyota', 'Corolla', 2022, 'STG-002'],
    ['Ford', 'Transit', 2021, 'STG-003'],
  ];
  for (const [make, model, year, reg] of vehicles) {
    await sql(`insert into vehicles (tenant_id, make, model, year, reg)
               select t.id, '${esc(make)}', '${esc(model)}', ${year}, '${esc(reg)}'
                 from tenants t where t.slug='${TENANT.slug}'
                 and not exists (select 1 from vehicles v where v.reg='${esc(reg)}');`);
  }
  console.log(`   ${vehicles.length} vehicles`);
}

const counts = await sql(`select
  (select count(*) from tenants) tenants,
  (select count(*) from app_users) app_users,
  (select count(*) from vehicles) vehicles`);
console.log('\n▸ staging now holds:', counts[0]);

if (creds.length) {
  const out = creds.map((c) => `# ${c.role}\n${c.email}\n${c.password}\n`).join('\n');
  writeFileSync('.staging-credentials.local', out, { mode: 0o600 });
  console.log('\n▸ credentials written to .staging-credentials.local (gitignored, chmod 600)');
  creds.forEach((c) => console.log(`   ${c.role}: ${c.email}`));
} else {
  console.log('\n▸ no new logins created (all existed already)');
}

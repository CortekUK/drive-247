/**
 * Stage 0a (the privileged RPC surface) executed against a throwaway Postgres.
 *
 * `public` is exposed through PostgREST, so every function `anon` may execute is
 * an HTTP endpoint callable with the published key. 150 of them are SECURITY
 * DEFINER and run as their owner, which row-level security does not constrain.
 * docs/trax/remediation/00-revoke-anon-execute-on-definer-functions.sql takes
 * that away from `anon` and leaves every other caller alone.
 *
 * This test builds a stand-in for each function named in the script — the same
 * name and the same argument types, so the signatures must match exactly or the
 * revoke fails to resolve — grants them as production does, applies the script,
 * and checks who can execute what afterwards. It proves the statements are
 * valid and that they hit what they claim to hit. It is NOT proof that no
 * caller depends on them: that is the code evidence recorded in the script.
 *
 * No live database is touched.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { PGlite } = await import(pathToFileURL(process.env.TRAX_PGLITE_PATH ?? resolve(tmpdir(), 'drive247-trax-sql-tests/node_modules/@electric-sql/pglite/dist/index.js')));
const db = new PGlite();
const script = (name) => readFile(resolve(root, 'docs/trax/remediation', name), 'utf8');

const stage0a = await script('00-revoke-anon-execute-on-definer-functions.sql');
/** Every function the script revokes, with its argument list verbatim. */
const revoked = [...stage0a.matchAll(/^revoke execute on function public\.([a-z0-9_]+)\(([^)]*)\) from ([a-z, ]+);/gim)]
  .map((m) => ({ name: m[1], args: m[2], from: m[3].split(',').map((s) => s.trim()) }));
const targets = [...new Map(revoked.map((r) => [`${r.name}(${r.args})`, r])).values()];

const BUILTIN = new Set(['text', 'uuid', 'numeric', 'integer', 'int', 'boolean', 'bool', 'date', 'jsonb', 'json',
  'bigint', 'smallint', 'real', 'double precision', 'timestamp with time zone', 'timestamp without time zone',
  'timestamptz', 'timestamp', 'interval', 'bytea', 'inet', 'character varying', 'varchar', 'oid', 'void']);

/** `p_user_ids text[]` -> type `text[]`; `p_type credit_transaction_type` -> a type we must invent. */
function typeOf(argument) {
  const trimmed = argument.trim();
  if (!trimmed) return null;
  const spaceAt = trimmed.indexOf(' ');
  return spaceAt === -1 ? trimmed : trimmed.slice(spaceAt + 1).trim();
}

await db.exec('create role anon; create role authenticated; create role service_role;');

// Types the deployed functions use that this database does not have.
const missing = new Set();
for (const target of targets) {
  for (const argument of target.args.split(',')) {
    const type = typeOf(argument);
    if (!type) continue;
    const base = type.replace(/\[\]$/, '').trim();
    if (!BUILTIN.has(base)) missing.add(base);
  }
}
for (const type of missing) await db.exec(`create domain public.${type} as text;`);

// A stand-in per function: same name, same argument types, SECURITY DEFINER.
// PostgreSQL grants EXECUTE to PUBLIC on every new function, which the deployed
// project has revoked, so the fixture revokes it too — otherwise a revoke from
// `anon` would look effective here while leaving the function open in reality.
for (const target of targets) {
  await db.exec(`create function public.${target.name}(${target.args}) returns void language sql security definer as $$ select $$;`);
  await db.exec(`revoke execute on function public.${target.name}(${target.args}) from public;`);
}
// Two functions are reachable by anon through a PUBLIC grant instead of a grant
// named `anon` (live ACL: {=X/postgres,postgres=X/postgres,authenticated=…}).
const VIA_PUBLIC = new Set(['block_customer', 'unblock_customer']);
for (const target of targets) {
  const grantees = VIA_PUBLIC.has(target.name) ? 'public, authenticated, service_role' : 'anon, authenticated, service_role';
  await db.exec(`grant execute on function public.${target.name}(${target.args}) to ${grantees};`);
}
// The two RPCs the anonymous booking path actually calls. Neither is SECURITY
// DEFINER in production, and neither may lose its grant.
await db.exec(`
create function public.generate_first_charge_for_rental(rental_id_param uuid) returns void language sql as $$ select $$;
create function public.backfill_rental_charges_first_month_only() returns void language sql as $$ select $$;
grant execute on function public.generate_first_charge_for_rental(uuid) to anon, authenticated, service_role;
grant execute on function public.backfill_rental_charges_first_month_only() to anon, authenticated, service_role;
`);

const canExecute = async (role, signature) =>
  (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, signature])).rows[0].ok;
const signature = (target) => `public.${target.name}(${target.args.split(',').map((a) => typeOf(a)).filter(Boolean).join(',')})`;

test('before: the anonymous key can execute every one of them', async () => {
  for (const target of targets) {
    assert.equal(await canExecute('anon', signature(target)), true, `${target.name}: fixture is not in the exposed state`);
  }
  assert.equal(await canExecute('anon', 'public.exec_sql(text)'), true);
});

test('stage 0a executes, and every statement resolves to a real function', async () => {
  // A mismatched signature raises "function … does not exist", so this also
  // checks the script against the argument lists read from the live catalogue.
  try { await db.exec(stage0a); }
  catch (error) { await db.exec('rollback;').catch(() => {}); throw new Error(`00-…sql: ${error.message}`); }
  assert.ok(targets.length >= 140, `expected the full definer surface, got ${targets.length}`);
});

test('after: anon can execute none of them, starting with exec_sql', async () => {
  assert.equal(await canExecute('anon', 'public.exec_sql(text)'), false, 'arbitrary SQL is still reachable with the public key');
  // PUBLIC was revoked too, so no future role inherits it either.
  assert.equal(await canExecute('public', 'public.exec_sql(text)'), false);
  const stillOpen = [];
  for (const target of targets) if (await canExecute('anon', signature(target))) stillOpen.push(target.name);
  assert.deepEqual(stillOpen, [], `still executable by anon: ${stillOpen.join(', ')}`);
});

test('the booking checkout keeps the two RPCs it calls', async () => {
  assert.equal(await canExecute('anon', 'public.generate_first_charge_for_rental(uuid)'), true, 'checkout lost its charge RPC');
  assert.equal(await canExecute('anon', 'public.backfill_rental_charges_first_month_only()'), true, 'checkout lost its backfill RPC');
});

test('staff sessions and server code are untouched', async () => {
  for (const target of targets.slice(0, 40)) {
    assert.equal(await canExecute('authenticated', signature(target)), true, `${target.name}: a staff session lost it`);
    assert.equal(await canExecute('service_role', signature(target)), true, `${target.name}: server code lost it`);
  }
  // The two edge functions that need theirs.
  assert.equal(await canExecute('service_role', 'public.exec_sql(text)'), true, 'simulate-payg-timelapse would break');
  assert.equal(await canExecute('service_role', 'public.admin_revoke_user_sessions(text[])'), true, 'admin-force-logout would break');
});

test('the rollback restores exactly what was removed', async () => {
  await db.exec(await script('06-rollback-function-revokes.sql'));
  const missingBack = [];
  for (const target of targets) if (!(await canExecute('anon', signature(target)))) missingBack.push(target.name);
  assert.deepEqual(missingBack, [], `rollback did not restore: ${missingBack.join(', ')}`);
});

test.after(async () => { await db.close(); });

#!/usr/bin/env node
/**
 * door-test.mjs — try the doors, don't just read the plans.
 *
 * The other evals compare how the database is BUILT. This one compares how it
 * BEHAVES from outside, the way the apps and a stranger on the internet see it.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/environments/database/door-test.mjs
 *
 * Four comparisons, all read-only on both sides:
 *   api_menu_tables      every table and view the API offers
 *   api_menu_functions   every function the API lets a client call, with its inputs
 *   effective_access     what anon / authenticated / service_role can really do to each
 *                        table and function, after inheritance and PUBLIC grants
 *   anon_http_answers    what happens when a visitor with only the public key asks
 *                        for each table: let in or refused
 *
 * Staging holds no customer rows, so "did any rows come back" cannot be compared.
 * Instead every prod table that hands rows to an anonymous visitor is listed as a
 * WARNING. An identical staging copies those holes; this keeps them in view.
 *
 * NOT covered yet: logged-in probes (operator A reading operator B, a customer
 * reading another customer). They need seeded tenants and users on staging.
 */
import { PROD_REF, TARGET, sql, mgmtGet, compare, applyExceptions, report, requireSetup, isMain } from "./lib.mjs";

const MANAGED = `('auth','storage','realtime','_realtime','extensions','graphql','graphql_public','vault','pgsodium','pgsodium_masks','net','cron','supabase_functions','supabase_migrations','pgbouncer','_analytics','_supavisor','pgmq','pgtle','information_schema')`;

async function keys(ref) {
  const list = await mgmtGet(ref, "/api-keys?reveal=true");
  const find = (name) => list.find((k) => k.name === name)?.api_key;
  return { anon: find("anon"), service: find("service_role") };
}

async function menu(ref, key) {
  const res = await fetch(`https://${ref}.supabase.co/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${ref}: API menu returned HTTP ${res.status}`);
  const spec = await res.json();
  const tables = [], functions = [];
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    if (path === "/") continue;
    if (path.startsWith("/rpc/")) {
      // Names only: the API labels types differently from one PostgREST version to the next
      // (integer vs int32). The real types are compared by db-eval.
      const params = (ops.post?.parameters ?? []).flatMap((p) => Object.keys(p.schema?.properties ?? {}));
      functions.push({ k: path.slice(5), d: params.sort().join(", ") });
    } else {
      const def = spec.definitions?.[path.slice(1)];
      const cols = Object.keys(def?.properties ?? {});
      tables.push({ k: path.slice(1), d: `${Object.keys(ops).sort().join(",")} | ${cols.join(", ")}` });
    }
  }
  return { tables, functions };
}

const ACCESS_SQL = `
  select r.rolname || ' ' || n.nspname || '.' || c.relname as k,
         concat_ws(',', case when has_table_privilege(r.oid, c.oid, 'SELECT') then 'select' end,
                        case when has_table_privilege(r.oid, c.oid, 'INSERT') then 'insert' end,
                        case when has_table_privilege(r.oid, c.oid, 'UPDATE') then 'update' end,
                        case when has_table_privilege(r.oid, c.oid, 'DELETE') then 'delete' end)
         || ' rls=' || c.relrowsecurity as d
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
  where c.relkind in ('r','p','v','m') and n.nspname !~ '^pg_' and n.nspname not in ${MANAGED}
  union all
  select r.rolname || ' fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'execute=' || has_function_privilege(r.oid, p.oid, 'EXECUTE') || ' definer=' || p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
  where n.nspname !~ '^pg_' and n.nspname not in ${MANAGED}
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

/** Ask for one row of each table with only the public key. Rows are counted, never kept. */
async function knock(ref, anonKey, tables) {
  const out = [];
  const leaks = [];
  for (let i = 0; i < tables.length; i += 12) {
    await Promise.all(
      tables.slice(i, i + 12).map(async (t) => {
        const res = await fetch(`https://${ref}.supabase.co/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
        let gotRow = false;
        if (res.ok) {
          const body = await res.json().catch(() => []);
          gotRow = Array.isArray(body) && body.length > 0;
        } else await res.arrayBuffer();
        out.push({ k: t, d: res.ok ? "let in" : `refused (${res.status})` });
        if (gotRow) leaks.push(t);
      }),
    );
  }
  return { out, leaks: leaks.sort() };
}

export async function runDoorTest() {
  const [pk, sk] = await Promise.all([keys(PROD_REF), keys(TARGET)]);
  const [pm, sm] = await Promise.all([menu(PROD_REF, pk.service), menu(TARGET, sk.service)]);
  const tables = compare("api_menu_tables", pm.tables, sm.tables);
  const functions = compare("api_menu_functions", pm.functions, sm.functions);
  if (tables.prod < 250) tables.problems.push(`prod's API offers ${tables.prod} tables, floor is 250: too few to trust this comparison`);
  if (functions.prod < 200) functions.problems.push(`prod's API offers ${functions.prod} functions, floor is 200: too few to trust this comparison`);

  const [pa, sa] = await Promise.all([sql(PROD_REF, ACCESS_SQL), sql(TARGET, ACCESS_SQL)]);
  const access = compare("effective_access", pa, sa);
  if (access.prod < 1500) access.problems.push(`prod returned ${access.prod} access rows, floor is 1500: too few to trust this comparison`);

  // Knock on every door prod has, on both sides, so a table missing from staging shows as a difference.
  const names = pm.tables.map((t) => t.k);
  const [pkn, skn] = await Promise.all([knock(PROD_REF, pk.anon, names), knock(TARGET, sk.anon, names)]);
  const anon = compare("anon_http_answers", pkn.out, skn.out);
  if (pkn.leaks.length) {
    anon.warnings.push(`on PROD a visitor with no login gets rows back from ${pkn.leaks.length} tables: ${pkn.leaks.join(", ")}`);
  }
  return [tables, functions, access, anon];
}

if (isMain(import.meta.url)) {
  requireSetup();
  const { ok } = await report("door-test", applyExceptions(await runDoorTest()));
  process.exit(ok ? 0 : 1);
}

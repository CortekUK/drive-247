#!/usr/bin/env node
/**
 * blind-spots.mjs — is there anything in the database that db-eval never looks at?
 *
 * db-eval works from a list of checks someone wrote. This script goes the other
 * way: it asks the database "what kinds of thing do you hold, and how many of
 * each?" and then confirms every kind is claimed by a db-eval check.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/evals/environments/database/blind-spots.mjs
 *
 * It fails when:
 *   - a kind of object exists (on either side) that no db-eval check covers
 *   - the count of a kind differs between prod and staging (a second, cruder
 *     comparison that shares no query with db-eval)
 *   - a kind names a db-eval check that does not exist any more
 */
import { PROD_REF, TARGET, sql, blankResult, applyExceptions, report, requireSetup, isMain } from "./lib.mjs";
import { CHECK_NAMES } from "./db-eval.mjs";

const MANAGED = `('auth','storage','realtime','_realtime','extensions','graphql','graphql_public','vault','pgsodium','pgsodium_masks','net','cron','supabase_functions','supabase_migrations','pgbouncer','_analytics','_supavisor','pgmq','pgtle','information_schema','tiger','tiger_data','topology')`;
const NS = `(n.nspname !~ '^pg_' and n.nspname not in ${MANAGED})`;
const notExt = (oid, cls) => `not exists (select 1 from pg_depend d where d.objid = ${oid} and d.classid = '${cls}'::regclass and d.deptype = 'e')`;
// Anything a user (not the platform, not an extension) created has an oid above this.
const USER_OID = 16384;

// Row data that happens to live in a catalog-like place. Per-tenant tokens and
// passwords are rows, not structure, so they are counted for the record and never compared.
const DATA = "(data)";

/** kind -> { covered by which db-eval check (null = nothing looks at it), how to count it }. */
const KINDS = [
  ["ordinary tables", "tables", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["partitioned tables", "tables", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='p' and ${NS}`],
  ["foreign tables", "tables", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='f' and ${NS}`],
  ["views", "views", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='v' and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["materialized views", "views", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='m' and ${NS}`],
  ["sequences", "sequences", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and ${NS}`],
  ["indexes", "indexes", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('i','I') and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["columns", "columns", `select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','f') and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["constraints", "constraints", `select count(*) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["functions and procedures", "functions", `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind in ('f','p','w') and ${NS} and ${notExt("p.oid", "pg_proc")}`],
  ["aggregates", "functions", `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='a' and ${NS} and ${notExt("p.oid", "pg_proc")}`],
  ["triggers", "triggers", `select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["triggers on platform tables", "triggers", `select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace cn on cn.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where not t.tgisinternal and cn.nspname in ${MANAGED} and ${NS}`],
  ["event triggers", "event_triggers", `select count(*) from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace where ${NS}`],
  ["rewrite rules", "rules", `select count(*) from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where r.rulename<>'_RETURN' and ${NS}`],
  ["row-level policies", "policies", `select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where ${NS}`],
  ["policies on storage", "storage_policies", `select count(*) from pg_policies where schemaname='storage'`],
  ["policies on other platform tables", "platform_policies", `select count(*) from pg_policies where schemaname in ${MANAGED} and schemaname <> 'storage'`],
  ["enums", "enums", `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e' and ${NS} and ${notExt("t.oid", "pg_type")}`],
  ["domains", "domains_and_composites", `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='d' and ${NS} and ${notExt("t.oid", "pg_type")}`],
  ["composite types", "domains_and_composites", `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_class c on c.oid=t.typrelid where t.typtype='c' and c.relkind='c' and ${NS} and ${notExt("t.oid", "pg_type")}`],
  ["range types", null, `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='r' and ${NS} and ${notExt("t.oid", "pg_type")}`],
  ["base types", null, `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='b' and t.typelem=0 and t.typcategory<>'A' and ${NS} and ${notExt("t.oid", "pg_type")}`],
  ["operators", null, `select count(*) from pg_operator o join pg_namespace n on n.oid=o.oprnamespace where ${NS} and ${notExt("o.oid", "pg_operator")}`],
  ["operator classes", null, `select count(*) from pg_opclass o join pg_namespace n on n.oid=o.opcnamespace where ${NS} and ${notExt("o.oid", "pg_opclass")}`],
  ["casts", null, `select count(*) from pg_cast c where c.oid >= ${USER_OID} and ${notExt("c.oid", "pg_cast")}`],
  ["collations", null, `select count(*) from pg_collation c join pg_namespace n on n.oid=c.collnamespace where ${NS} and ${notExt("c.oid", "pg_collation")}`],
  ["text search configs", null, `select count(*) from pg_ts_config c join pg_namespace n on n.oid=c.cfgnamespace where ${NS} and ${notExt("c.oid", "pg_ts_config")}`],
  ["text search dictionaries", null, `select count(*) from pg_ts_dict c join pg_namespace n on n.oid=c.dictnamespace where ${NS} and ${notExt("c.oid", "pg_ts_dict")}`],
  ["extended statistics", null, `select count(*) from pg_statistic_ext s join pg_namespace n on n.oid=s.stxnamespace where ${NS}`],
  ["foreign servers", null, `select count(*) from pg_foreign_server where oid >= ${USER_OID}`],
  ["foreign data wrappers", null, `select count(*) from pg_foreign_data_wrapper f where f.oid >= ${USER_OID} and ${notExt("f.oid", "pg_foreign_data_wrapper")}`],
  ["subscriptions", null, `select count(*) from pg_subscription`],
  ["publications", "publications", `select count(*) from pg_publication`],
  ["our tables in publications", "realtime_publications", `select count(*) from pg_publication_tables p join pg_namespace n on n.nspname=p.schemaname where ${NS}`],
  ["tables with non-default replica identity", "replica_identity", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and c.relreplident<>'d' and ${NS}`],
  ["column-level grants", "column_grants", `select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attacl is not null and not a.attisdropped and ${NS}`],
  ["tables with explicit grants", "table_grants", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relacl is not null and c.relkind in ('r','p','v','m','f','S') and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["functions with explicit grants", "function_grants", `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proacl is not null and ${NS} and ${notExt("p.oid", "pg_proc")}`],
  ["types with explicit grants", null, `select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typacl is not null and t.typtype in ('e','d','c','r') and ${NS} and ${notExt("t.oid", "pg_type")} and not exists (select 1 from pg_class c where c.oid=t.typrelid and c.relkind<>'c')`],
  ["default privilege rules", "default_privileges", `select count(*) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where ${NS}`],
  ["schemas", "schemas", `select count(*) from pg_namespace n where ${NS}`],
  ["extensions", "extensions", `select count(*) from pg_extension`],
  ["roles", "roles", `select count(*) from pg_roles where rolname !~ '^pg_' and rolname !~ '^cli_login_'`],
  ["role memberships", "role_memberships", `select count(distinct (am.roleid, am.member)) from pg_auth_members am join pg_roles r on r.oid=am.roleid join pg_roles m on m.oid=am.member where r.rolname !~ '^pg_' and m.rolname !~ '^cli_login_' and r.rolname !~ '^cli_login_'`],
  ["comments on tables and columns", "comments", `select count(*) from pg_description d join pg_class c on c.oid=d.objoid and d.classoid='pg_class'::regclass join pg_namespace n on n.oid=c.relnamespace where ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["comments on functions", "function_comments", `select count(*) from pg_description d join pg_proc p on p.oid=d.objoid and d.classoid='pg_proc'::regclass join pg_namespace n on n.oid=p.pronamespace where ${NS} and ${notExt("p.oid", "pg_proc")}`],
  ["storage options on tables and indexes", "table_options", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.reloptions is not null and c.relkind in ('r','p','i','I') and ${NS} and ${notExt("c.oid", "pg_class")}`],
  ["per-column options", "column_options", `select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attnum>0 and not a.attisdropped and ${NS} and exists (select 1 from unnest(a.attoptions) o where o !~ '^pg_attver=')`],
  ["inheritance and partitions", "inheritance", `select count(*) from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace where ${NS}`],
  ["storage buckets", "storage_buckets", `select count(*) from storage.buckets`],
  ["cron jobs", "cron_jobs", `select count(*) from cron.job`],
  ["database and role settings", "database_settings", `select count(*) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) cfg where s.setdatabase in (0,(select oid from pg_database where datname=current_database())) and coalesce(r.rolname,'') !~ '^cli_login_'`],
  ["security labels", null, `select count(*) from pg_seclabel`],
  ["large objects", DATA, `select count(*) from pg_largeobject_metadata`],
  ["vault secrets", DATA, `select count(*) from vault.secrets`],
  ["database webhooks", null, `select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where n.nspname='supabase_functions' and not t.tgisinternal`],
];

async function inventory(ref) {
  const out = {};
  // One round trip per batch; a relation that does not exist counts as zero.
  for (let i = 0; i < KINDS.length; i += 12) {
    const batch = KINDS.slice(i, i + 12);
    try {
      const row = (await sql(ref, `select ${batch.map(([, , q], j) => `(${q}) as c${j}`).join(", ")}`))[0];
      batch.forEach(([kind], j) => (out[kind] = Number(row[`c${j}`])));
    } catch {
      for (const [kind, , q] of batch) {
        try {
          out[kind] = Number((await sql(ref, q))[0].count);
        } catch (e) {
          if (!/does not exist/.test(String(e.message))) throw e;
          out[kind] = 0;
        }
      }
    }
  }
  return out;
}

export async function runBlindSpots() {
  const [prod, stag] = await Promise.all([inventory(PROD_REF), inventory(TARGET)]);
  const coverage = blankResult("every_kind_is_covered", "safety");
  const counts = blankResult("kind_counts_match", "parity");
  let covered = 0;
  for (const [kind, check] of KINDS) {
    const p = prod[kind], s = stag[kind];
    if (check === DATA) { covered++; continue; }
    if (check && !CHECK_NAMES.includes(check)) coverage.problems.push(`"${kind}" points at db-eval check "${check}", which does not exist`);
    if (!check && (p > 0 || s > 0)) coverage.problems.push(`${kind}: prod has ${p}, staging has ${s}, and no db-eval check looks at them`);
    if (check || (p === 0 && s === 0)) covered++;
    if (p !== s) counts.changed.push({ key: kind, hint: `prod ${p}, staging ${s}` });
  }
  coverage.prod = KINDS.length;
  coverage.staging = covered;
  counts.prod = Object.values(prod).reduce((a, b) => a + b, 0);
  counts.staging = Object.values(stag).reduce((a, b) => a + b, 0);
  return [coverage, counts];
}

if (isMain(import.meta.url)) {
  requireSetup();
  const { ok } = await report("blind-spots", applyExceptions(await runBlindSpots()));
  process.exit(ok ? 0 : 1);
}

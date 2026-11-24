#!/usr/bin/env node
/**
 * db-eval.mjs — is the staging database built the same as prod?
 *
 * Compares DEFINITIONS, never row data. Reads both projects over the Supabase
 * Management API in read-only mode, so it cannot change either database.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/environments/database/db-eval.mjs
 *
 *   --target <ref>   staging project ref (default: STAGING_REF in .staging-credentials.local)
 *   --only a,b       run only these checks
 *   --show <n>       differences printed per check (default 8, 0 = all)
 *   --json <file>    also write the full result as JSON
 *   --no-pdf         skip the PDF report
 *
 * Exit code 0 only when every check is identical.
 *
 * Two kinds of check:
 *   parity  — the object exists on both sides with the same definition. The
 *             project ref and any embedded JWT are masked first, because those
 *             legitimately differ between two projects.
 *   safety  — staging must not carry anything that still points at production
 *             (a cron or function body with the prod ref fires at real customers).
 *
 * Every check also has a FLOOR: the fewest objects prod must return before the
 * comparison is believed. Two empty lists are "identical" too, and an empty
 * answer is far more likely to be a broken query than a real match.
 */
import { PROD_REF, TARGET, arg, sql, compare, blankResult, applyExceptions, report, requireSetup, isMain, die } from "./lib.mjs";

// Schemas Supabase owns. Their contents depend on the platform version a
// project was created on, not on anything we wrote, so they are not compared
// wholesale. Our own objects that live inside them (storage policies, triggers
// on auth.users, cron jobs) are picked up by dedicated checks below.
const MANAGED = [
  "auth", "storage", "realtime", "_realtime", "extensions", "graphql", "graphql_public",
  "vault", "pgsodium", "pgsodium_masks", "net", "cron", "supabase_functions",
  "supabase_migrations", "pgbouncer", "_analytics", "_supavisor", "pgmq", "pgtle",
  "information_schema", "tiger", "tiger_data", "topology",
];
const USER_NS = `(n.nspname !~ '^pg_' and n.nspname not in (${MANAGED.map((s) => `'${s}'`).join(",")}))`;
// Objects created by an extension belong to the extension, not to us.
const NOT_EXT = (oid, cls) =>
  `not exists (select 1 from pg_depend d where d.objid = ${oid} and d.classid = '${cls}'::regclass and d.deptype = 'e')`;

/** Every check returns rows of { k: unique key, d: definition text }. */
export const CHECKS = [
  {
    name: "extensions",
    sql: `select e.extname as k, n.nspname as d from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,
  },
  {
    name: "schemas",
    sql: `select n.nspname as k, '' as d from pg_namespace n where ${USER_NS}`,
  },
  {
    name: "enums",
    sql: `select n.nspname || '.' || t.typname as k,
                 (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as d
          from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where t.typtype = 'e' and ${USER_NS} and ${NOT_EXT("t.oid", "pg_type")}`,
  },
  {
    name: "domains_and_composites",
    sql: `select n.nspname || '.' || t.typname as k,
                 case when t.typtype = 'd' then 'domain ' || format_type(t.typbasetype, t.typtypmod) || coalesce(' ' || (select string_agg(pg_get_constraintdef(c.oid), ' ' order by c.conname) from pg_constraint c where c.contypid = t.oid), '')
                      else 'composite ' || (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) end as d
          from pg_type t join pg_namespace n on n.oid = t.typnamespace
          left join pg_class c on c.oid = t.typrelid
          where (t.typtype = 'd' or (t.typtype = 'c' and c.relkind = 'c')) and ${USER_NS} and ${NOT_EXT("t.oid", "pg_type")}`,
  },
  {
    name: "tables",
    sql: `select n.nspname || '.' || c.relname as k,
                 'kind=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' force_rls=' || c.relforcerowsecurity || ' persistence=' || c.relpersistence::text as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p','f') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "columns",
    sql: `select n.nspname || '.' || c.relname || '.' || a.attname as k,
                 'pos=' || (select count(*) from pg_attribute b where b.attrelid = a.attrelid and b.attnum > 0 and b.attnum <= a.attnum and not b.attisdropped)
                 || ' type=' || format_type(a.atttypid, a.atttypmod)
                 || ' notnull=' || a.attnotnull
                 || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
                 || ' default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as d
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
          where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p','f') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "constraints",
    sql: `select n.nspname || '.' || c.relname || '.' || con.conname as k, pg_get_constraintdef(con.oid) as d
          from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
          where ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "indexes",
    sql: `select n.nspname || '.' || ic.relname as k, pg_get_indexdef(i.indexrelid) as d
          from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          where ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "sequences",
    sql: `select s.schemaname || '.' || s.sequencename as k,
                 s.data_type || ' start=' || s.start_value || ' inc=' || s.increment_by || ' min=' || s.min_value || ' max=' || s.max_value || ' cycle=' || s.cycle as d
          from pg_sequences s join pg_namespace n on n.nspname = s.schemaname where ${USER_NS}`,
  },
  {
    name: "functions",
    sql: `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
                 case when p.prokind in ('f','p','w') then pg_get_functiondef(p.oid) else 'aggregate ' || pg_get_function_result(p.oid) end
                 || ' /*config=' || coalesce(array_to_string(p.proconfig, ','), '') || '*/' as d
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where ${USER_NS} and ${NOT_EXT("p.oid", "pg_proc")}`,
  },
  {
    name: "triggers",
    // Our triggers anywhere: on our tables, or calling our functions from a
    // managed table (the auth.users hooks are the important case).
    sql: `select n.nspname || '.' || c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) || ' /*enabled=' || t.tgenabled::text || '*/' as d
          from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
          join pg_proc p on p.oid = t.tgfoid join pg_namespace fn on fn.oid = p.pronamespace
          where not t.tgisinternal and ${NOT_EXT("c.oid", "pg_class")}
            and (${USER_NS} or (fn.nspname !~ '^pg_' and fn.nspname not in (${MANAGED.map((s) => `'${s}'`).join(",")})))`,
  },
  {
    name: "event_triggers",
    sql: `select e.evtname as k, e.evtevent || ' ' || e.evtfoid::regproc::text || ' enabled=' || e.evtenabled::text as d
          from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid join pg_namespace n on n.oid = p.pronamespace
          where ${USER_NS}`,
  },
  {
    name: "policies",
    sql: `select pol.schemaname || '.' || pol.tablename || '.' || pol.policyname as k,
                 pol.permissive || ' ' || pol.cmd || ' to=' || array_to_string(pol.roles, ',') || ' using=' || coalesce(pol.qual, '') || ' check=' || coalesce(pol.with_check, '') as d
          from pg_policies pol join pg_namespace n on n.nspname = pol.schemaname where ${USER_NS}`,
  },
  {
    name: "views",
    sql: `select n.nspname || '.' || c.relname as k,
                 'kind=' || c.relkind::text || ' options=' || coalesce(array_to_string(c.reloptions, ','), '') || ' ' || pg_get_viewdef(c.oid, true) as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('v','m') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "table_grants",
    // Who may touch each table/view/sequence. anon and authenticated matter most.
    sql: `select n.nspname || '.' || c.relname || ' -> ' || coalesce(r.rolname, 'PUBLIC') as k,
                 string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ',' order by a.privilege_type) as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
          left join pg_roles r on r.oid = a.grantee
          where c.relkind in ('r','p','v','m','f','S') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}
          group by 1`,
  },
  {
    name: "function_grants",
    sql: `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || coalesce(r.rolname, 'PUBLIC') as k,
                 string_agg(a.privilege_type, ',' order by a.privilege_type) as d
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          left join pg_roles r on r.oid = a.grantee
          where ${USER_NS} and ${NOT_EXT("p.oid", "pg_proc")}
          group by 1`,
  },
  {
    name: "schema_grants",
    sql: `select n.nspname || ' -> ' || coalesce(r.rolname, 'PUBLIC') as k, string_agg(a.privilege_type, ',' order by a.privilege_type) as d
          from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          left join pg_roles r on r.oid = a.grantee
          where ${USER_NS} group by 1`,
  },
  {
    name: "default_privileges",
    sql: `select n.nspname || ' ' || d.defaclobjtype::text || ' by ' || o.rolname || ' -> ' || coalesce(r.rolname, 'PUBLIC') as k,
                 string_agg(a.privilege_type, ',' order by a.privilege_type) as d
          from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace join pg_roles o on o.oid = d.defaclrole
          cross join lateral aclexplode(d.defaclacl) a left join pg_roles r on r.oid = a.grantee
          where ${USER_NS} group by 1`,
  },
  {
    name: "owners",
    sql: `select 'table ' || n.nspname || '.' || c.relname as k, pg_get_userbyid(c.relowner) as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p','v','m','S') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}
          union all
          select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_userbyid(p.proowner)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where ${USER_NS} and ${NOT_EXT("p.oid", "pg_proc")}`,
  },
  {
    name: "comments",
    // PostgREST reads table/column comments, so they are part of the API surface.
    sql: `select n.nspname || '.' || c.relname || coalesce('.' || a.attname, '') as k, d.description as d
          from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
          join pg_namespace n on n.oid = c.relnamespace
          left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
          where ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "realtime_publications",
    // Our tables only. Realtime also keeps its own daily partitions in a
    // publication; those are created and dropped by the service, not by us.
    sql: `select p.pubname || ' ' || p.schemaname || '.' || p.tablename as k, coalesce(array_to_string(p.attnames, ','), '') || ' where=' || coalesce(p.rowfilter, '') as d
          from pg_publication_tables p join pg_namespace n on n.nspname = p.schemaname where ${USER_NS}`,
  },
  {
    name: "replica_identity",
    sql: `select n.nspname || '.' || c.relname as k, c.relreplident::text as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p') and c.relreplident <> 'd' and ${USER_NS}`,
  },
  {
    name: "storage_buckets",
    sql: `select id as k, 'public=' || public || ' limit=' || coalesce(file_size_limit::text, '') || ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), '') as d
          from storage.buckets`,
  },
  {
    name: "storage_policies",
    sql: `select tablename || '.' || policyname as k,
                 permissive || ' ' || cmd || ' to=' || array_to_string(roles, ',') || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '') as d
          from pg_policies where schemaname = 'storage'`,
  },
  {
    name: "cron_jobs",
    // Schedule and command must match. Whether a job is switched on is
    // deliberately NOT compared: staging keeps its crons off.
    sql: `select jobname as k, schedule || ' :: ' || command as d from cron.job`,
    optionalRelation: "cron.job",
  },
  {
    name: "database_settings",
    sql: `select coalesce(r.rolname, '(all roles)') || ' ' || split_part(cfg, '=', 1) as k, split_part(cfg, '=', 2) as d
          from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole
          cross join lateral unnest(s.setconfig) cfg
          where s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
            and coalesce(r.rolname, '') !~ '^cli_login_'`,
  },
  {
    name: "extension_versions",
    sql: `select e.extname as k, e.extversion as d from pg_extension e`,
  },
  {
    name: "rules",
    sql: `select n.nspname || '.' || c.relname || '.' || r.rulename as k, pg_get_ruledef(r.oid) as d
          from pg_rewrite r join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
          where r.rulename <> '_RETURN' and ${USER_NS}`,
  },
  {
    name: "column_grants",
    // Permissions set on one column instead of a whole table.
    sql: `select n.nspname || '.' || c.relname || '.' || a.attname || ' -> ' || coalesce(r.rolname, 'PUBLIC') as k,
                 string_agg(x.privilege_type, ',' order by x.privilege_type) as d
          from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          cross join lateral aclexplode(a.attacl) x left join pg_roles r on r.oid = x.grantee
          where a.attacl is not null and not a.attisdropped and ${USER_NS}
          group by 1`,
  },
  {
    name: "roles",
    // cli_login_* are short-lived logins the Supabase CLI makes for a dump.
    // Per-role settings are compared one by one in database_settings, not here.
    sql: `select rolname as k,
                 'super=' || rolsuper || ' inherit=' || rolinherit || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb
                 || ' login=' || rolcanlogin || ' replication=' || rolreplication || ' bypassrls=' || rolbypassrls as d
          from pg_roles where rolname !~ '^pg_' and rolname !~ '^cli_login_'`,
  },
  {
    name: "role_memberships",
    // One role can be granted to the same member twice by different grantors, so every grant is listed.
    sql: `select r.rolname || ' <- ' || m.rolname as k,
                 string_agg('by=' || g.rolname || ' admin=' || am.admin_option || ' inherit=' || am.inherit_option || ' set=' || am.set_option, '; ' order by g.rolname) as d
          from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.grantor
          where r.rolname !~ '^pg_' and m.rolname !~ '^cli_login_' and r.rolname !~ '^cli_login_'
          group by 1`,
  },
  {
    name: "table_options",
    sql: `select n.nspname || '.' || c.relname as k, array_to_string(c.reloptions, ',') as d
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.reloptions is not null and c.relkind in ('r','p','i','I') and ${USER_NS} and ${NOT_EXT("c.oid", "pg_class")}`,
  },
  {
    name: "inheritance",
    sql: `select pn.nspname || '.' || p.relname || ' <- ' || n.nspname || '.' || c.relname as k,
                 coalesce(pg_get_expr(c.relpartbound, c.oid), 'inherits') as d
          from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_namespace n on n.oid = c.relnamespace
          join pg_class p on p.oid = i.inhparent join pg_namespace pn on pn.oid = p.relnamespace
          where ${USER_NS}`,
  },
  {
    name: "function_comments",
    sql: `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k, d.description as d
          from pg_description d join pg_proc p on p.oid = d.objoid and d.classoid = 'pg_proc'::regclass
          join pg_namespace n on n.oid = p.pronamespace
          where ${USER_NS} and ${NOT_EXT("p.oid", "pg_proc")}`,
  },
  {
    name: "platform_policies",
    // Policies we (or the platform) put on Supabase-owned tables other than storage, e.g. realtime.messages.
    sql: `select schemaname || '.' || tablename || '.' || policyname as k,
                 permissive || ' ' || cmd || ' to=' || array_to_string(roles, ',') || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '') as d
          from pg_policies where schemaname in (${MANAGED.map((x) => `'${x}'`).join(",")}) and schemaname <> 'storage'`,
  },
  {
    name: "column_options",
    // Per-column settings such as n_distinct. `pg_attver` is left out: newer Supabase
    // images stamp it on every column of every schema, including Postgres' own.
    sql: `select n.nspname || '.' || c.relname || '.' || a.attname as k,
                 (select string_agg(o, ',' order by o) from unnest(a.attoptions) o where o !~ '^pg_attver=') as d
          from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          where a.attnum > 0 and not a.attisdropped and ${USER_NS}
            and exists (select 1 from unnest(a.attoptions) o where o !~ '^pg_attver=')`,
  },
  {
    name: "publications",
    sql: `select pubname as k, 'all=' || puballtables || ' insert=' || pubinsert || ' update=' || pubupdate || ' delete=' || pubdelete || ' truncate=' || pubtruncate || ' via_root=' || pubviaroot as d
          from pg_publication`,
  },
];


/**
 * Fewest objects prod must return for a check to be believed (about 80% of
 * what prod holds today). `0` means "prod is expected to have none of these";
 * it is written down so that empty is a stated fact and not an accident.
 */
const FLOOR = {
  extensions: 7, extension_versions: 7, schemas: 2, enums: 28, domains_and_composites: 0,
  tables: 275, columns: 3800, constraints: 1500, indexes: 980, sequences: 6,
  functions: 330, triggers: 190, event_triggers: 0, rules: 0, policies: 600, views: 19,
  table_grants: 1000, column_grants: 4000, function_grants: 1300, schema_grants: 7,
  default_privileges: 19, owners: 630, roles: 10, role_memberships: 5, comments: 430,
  table_options: 1, column_options: 0, inheritance: 0, publications: 1, realtime_publications: 32,
  function_comments: 30, platform_policies: 1,
  replica_identity: 4, storage_buckets: 22, storage_policies: 87, cron_jobs: 28, database_settings: 5,
};

export const CHECK_NAMES = [...CHECKS.map((c) => c.name), "no_prod_references"];

async function runCheck(check) {
  const side = async (ref) => {
    try {
      return await sql(ref, check.sql);
    } catch (e) {
      if (check.optionalRelation && /does not exist/.test(String(e.message))) return [];
      throw e;
    }
  };
  const [prodRows, stagRows] = await Promise.all([side(PROD_REF), side(TARGET)]);
  const r = compare(check.name, prodRows, stagRows);
  const floor = FLOOR[check.name];
  if (r.prod < floor) r.problems.push(`prod returned ${r.prod}, floor is ${floor}: too few to trust this comparison`);
  if (floor === 0 && r.prod > 0) r.warnings.push(`prod now has ${r.prod}; this was expected to be empty, give the check a real floor`);
  return r;
}

/** Safety: nothing on staging may still name the production project. */
async function prodReferenceLeaks() {
  const q = `
    select 'function ' || n.nspname || '.' || p.proname as k from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f','p','w') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prosrc like '%${PROD_REF}%'
    union all
    select 'view ' || schemaname || '.' || viewname from pg_views where definition like '%${PROD_REF}%'
    union all
    select 'column default ' || c.relname || '.' || a.attname from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
      join pg_class c on c.oid = ad.adrelid where pg_get_expr(ad.adbin, ad.adrelid) like '%${PROD_REF}%'
    union all
    select 'setting ' || cfg from pg_db_role_setting s cross join lateral unnest(s.setconfig) cfg where cfg like '%${PROD_REF}%'`;
  const rows = await sql(TARGET, q);
  let cron = [];
  try {
    cron = await sql(TARGET, `select 'cron ' || jobname as k from cron.job where command like '%${PROD_REF}%'`);
  } catch (e) {
    if (!/does not exist/.test(String(e.message))) throw e;
  }
  const r = blankResult("no_prod_references", "safety");
  r.extra = [...rows, ...cron].map((x) => x.k).sort();
  r.staging = r.extra.length;
  return r;
}

async function activeCrons() {
  const r = blankResult("active_crons (info)", "info");
  try {
    const rows = await sql(TARGET, `select jobname from cron.job where active`);
    r.staging = rows.length;
    if (rows.length) r.warnings.push(`${rows.length} cron job(s) switched ON on staging: ${rows.map((x) => x.jobname).slice(0, 6).join(", ")}`);
  } catch (e) {
    if (!/does not exist/.test(String(e.message))) throw e;
  }
  return r;
}

/** Run the checks and return raw results (no exceptions applied, nothing printed). */
export async function runChecks(only) {
  for (const c of CHECKS) if (FLOOR[c.name] === undefined) die(`db-eval: check "${c.name}" has no floor. Every check needs one.`);
  const unknown = (only ?? []).filter((n) => !CHECK_NAMES.includes(n));
  if (unknown.length) die(`db-eval: unknown check(s): ${unknown.join(", ")}`);
  const selected = CHECKS.filter((c) => !only || only.includes(c.name));
  const results = [];
  // Small batches: the Management API rate-limits bursts.
  for (let i = 0; i < selected.length; i += 4) results.push(...(await Promise.all(selected.slice(i, i + 4).map(runCheck))));
  if (!only || only.includes("no_prod_references")) results.push(await prodReferenceLeaks());
  if (!only) results.push(await activeCrons());
  return results;
}

if (isMain(import.meta.url)) {
  requireSetup();
  const only = arg("only")?.split(",").map((s) => s.trim());
  const results = applyExceptions(await runChecks(only));
  const { ok } = await report("db-eval", results);
  process.exit(ok ? 0 : 1);
}

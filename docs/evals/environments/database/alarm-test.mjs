#!/usr/bin/env node
/**
 * alarm-test.mjs — does every db-eval check actually notice a break?
 *
 * A check that has only ever said PASS is unproven: it may simply be looking in
 * the wrong place. So for each check this script breaks one small thing on
 * STAGING on purpose, confirms the check goes red, then puts it back and
 * confirms the check returns to exactly where it was.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/evals/environments/database/alarm-test.mjs
 *   --only a,b    test only these checks
 *
 * It WRITES to staging, and only to staging: lib.mjs refuses any write aimed at
 * production. Every break is undone in a `finally`, and the run ends by
 * confirming staging is left exactly as it was found.
 */
import { PROD_REF, TARGET, arg, sql, blankResult, diffCount, report, requireSetup, isMain, die } from "./lib.mjs";
import { runChecks, CHECK_NAMES } from "./db-eval.mjs";

const write = (q) => sql(TARGET, q, { write: true });
const read = async (q) => (await sql(TARGET, q))[0];
const lit = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);

/** Real objects to break. Chosen from what is there, so nothing is hardcoded to today's schema. */
async function pickTargets() {
  const t = await read(`
    select format('%I.%I', n.nspname, c.relname) as tbl,
           (select format('%I', a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped order by a.attnum limit 1) as col,
           obj_description(c.oid, 'pg_class') as comment
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.reloptions is null and c.relreplident = 'd'
      and pg_get_userbyid(c.relowner) = 'postgres'
      and not exists (select 1 from pg_publication_tables p where p.schemaname = 'public' and p.tablename = c.relname)
      and not exists (select 1 from pg_inherits i where i.inhparent = c.oid or i.inhrelid = c.oid)
    order by c.relname limit 1`);
  const f = await read(`
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as fn,
           pg_get_functiondef(p.oid) as def, obj_description(p.oid, 'pg_proc') as comment
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f' and l.lanname = 'plpgsql' and pg_get_userbyid(p.proowner) = 'postgres'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), '$function$', ''))) = 20
    order by length(p.prosrc), p.proname limit 1`);
  const g = await read(`
    select format('%I', t.tgname) as trg, format('%I.%I', n.nspname, c.relname) as tbl
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'O' order by c.relname, t.tgname limit 1`);
  const b = await read(`select id, file_size_limit from storage.buckets order by id limit 1`);
  if (!t || !f || !g || !b) die("alarm-test: staging has no schema to break yet. Rebuild staging first.");
  return { t, f, g, b };
}

/** One deliberate break per check: [check, what it does in plain words, apply SQL, undo SQL]. */
function breaks({ t, f, g, b }) {
  const brokenFn = f.def.slice(0, f.def.lastIndexOf("$function$")) + "\n-- alarm-test\n$function$";
  return [
    ["extensions", "install an extra extension", `create extension tablefunc with schema extensions`, `drop extension if exists tablefunc`],
    ["extension_versions", "install an extra extension", `create extension tablefunc with schema extensions`, `drop extension if exists tablefunc`],
    ["schemas", "add a schema", `create schema _alarm_schema`, `drop schema if exists _alarm_schema`],
    ["enums", "add an enum", `create type public._alarm_enum as enum ('a')`, `drop type if exists public._alarm_enum`],
    ["domains_and_composites", "add a domain", `create domain public._alarm_domain as integer`, `drop domain if exists public._alarm_domain`],
    ["tables", `switch RLS off on ${t.tbl}`, `alter table ${t.tbl} disable row level security`, `alter table ${t.tbl} enable row level security`],
    ["columns", `add a column to ${t.tbl}`, `alter table ${t.tbl} add column _alarm_col integer`, `alter table ${t.tbl} drop column if exists _alarm_col`],
    ["constraints", `add a constraint to ${t.tbl}`, `alter table ${t.tbl} add constraint _alarm_chk check (true)`, `alter table ${t.tbl} drop constraint if exists _alarm_chk`],
    ["indexes", `add an index to ${t.tbl}`, `create index _alarm_idx on ${t.tbl} (${t.col})`, `drop index if exists public._alarm_idx`],
    ["sequences", "add a sequence", `create sequence public._alarm_seq`, `drop sequence if exists public._alarm_seq`],
    ["functions", `change one line inside ${f.fn}`, brokenFn, f.def],
    ["triggers", `disable trigger ${g.trg} on ${g.tbl}`, `alter table ${g.tbl} disable trigger ${g.trg}`, `alter table ${g.tbl} enable trigger ${g.trg}`],
    ["rules", `add a rule to ${t.tbl}`, `create rule _alarm_rule as on delete to ${t.tbl} do also nothing`, `drop rule if exists _alarm_rule on ${t.tbl}`],
    ["policies", `add a policy to ${t.tbl}`, `create policy _alarm_policy on ${t.tbl} for select using (false)`, `drop policy if exists _alarm_policy on ${t.tbl}`],
    ["views", "add a view", `create view public._alarm_view as select 1 as x`, `drop view if exists public._alarm_view`],
    ["table_grants", `grant a role access to ${t.tbl}`, `grant select on ${t.tbl} to pg_monitor`, `revoke select on ${t.tbl} from pg_monitor`],
    ["column_grants", `grant a role access to one column of ${t.tbl}`, `grant select (${t.col}) on ${t.tbl} to pg_monitor`, `revoke select (${t.col}) on ${t.tbl} from pg_monitor`],
    ["function_grants", `grant a role permission to run ${f.fn}`, `grant execute on function ${f.fn} to pg_monitor`, `revoke execute on function ${f.fn} from pg_monitor`],
    ["schema_grants", "grant a role access to schema public", `grant usage on schema public to pg_monitor`, `revoke usage on schema public from pg_monitor`],
    ["default_privileges", "add a default grant for future tables", `alter default privileges for role postgres in schema public grant select on tables to pg_monitor`, `alter default privileges for role postgres in schema public revoke select on tables from pg_monitor`],
    // A fresh role with no grants of its own, so handing the table back restores the permissions exactly.
    ["owners", `hand ${t.tbl} to another owner`,
      `create role _alarm_owner nologin; grant _alarm_owner to postgres; grant create on schema public to _alarm_owner; alter table ${t.tbl} owner to _alarm_owner`,
      `do $$ begin if exists (select 1 from pg_roles where rolname = '_alarm_owner') then execute 'alter table ${t.tbl} owner to postgres'; execute 'revoke create on schema public from _alarm_owner'; execute 'drop role _alarm_owner'; end if; end $$`],
    ["roles", "add a role", `create role _alarm_role nologin`, `drop role if exists _alarm_role`],
    ["role_memberships", "add a role and make it a member of anon", `create role _alarm_member nologin; grant anon to _alarm_member`, `drop role if exists _alarm_member`],
    ["comments", `change the comment on ${t.tbl}`, `comment on table ${t.tbl} is '_alarm'`, `comment on table ${t.tbl} is ${lit(t.comment)}`],
    ["function_comments", `change the comment on ${f.fn}`, `comment on function ${f.fn} is '_alarm'`, `comment on function ${f.fn} is ${lit(f.comment)}`],
    ["table_options", `set a storage option on ${t.tbl}`, `alter table ${t.tbl} set (fillfactor = 90)`, `alter table ${t.tbl} reset (fillfactor)`],
    ["column_options", `set an option on one column of ${t.tbl}`, `alter table ${t.tbl} alter column ${t.col} set (n_distinct = 5)`, `alter table ${t.tbl} alter column ${t.col} reset (n_distinct)`],
    ["inheritance", `add a child table under ${t.tbl}`, `create table public._alarm_child () inherits (${t.tbl})`, `drop table if exists public._alarm_child`],
    ["platform_policies", "add a policy to realtime.messages", `create policy _alarm_policy on realtime.messages for select using (false)`, `drop policy if exists _alarm_policy on realtime.messages`],
    ["publications", "add a publication", `create publication _alarm_pub`, `drop publication if exists _alarm_pub`],
    ["realtime_publications", `publish ${t.tbl} to realtime`, `alter publication supabase_realtime add table ${t.tbl}`, `alter publication supabase_realtime drop table ${t.tbl}`],
    ["replica_identity", `change replica identity on ${t.tbl}`, `alter table ${t.tbl} replica identity full`, `alter table ${t.tbl} replica identity default`],
    ["storage_buckets", `change the size limit on bucket ${b.id}`, `update storage.buckets set file_size_limit = coalesce(file_size_limit, 0) + 1 where id = ${lit(b.id)}`, `update storage.buckets set file_size_limit = ${b.file_size_limit ?? "null"} where id = ${lit(b.id)}`],
    ["storage_policies", "add a policy to storage.objects", `create policy _alarm_policy on storage.objects for select using (false)`, `drop policy if exists _alarm_policy on storage.objects`],
    // Scheduled for 1 January and removed seconds later, so it never fires.
    ["cron_jobs", "add a cron job", `select cron.schedule('_alarm_job', '0 0 1 1 *', 'select 1')`, `select cron.unschedule('_alarm_job') where exists (select 1 from cron.job where jobname = '_alarm_job')`],
    ["database_settings", "add a role setting", `alter role postgres set default_statistics_target = 101`, `alter role postgres reset default_statistics_target`],
    ["no_prod_references", "add a function that names the production project",
      `create function public._alarm_prod_ref() returns text language sql as $f$ select 'https://${PROD_REF}.supabase.co' $f$`,
      `drop function if exists public._alarm_prod_ref()`],
  ];
}

// Needs superuser to create one, and none exist on either side. blind-spots.mjs
// still counts them, so one appearing in prod is caught there.
const UNTESTABLE = { event_triggers: "an event trigger needs superuser to create; none exist on either side and blind-spots.mjs counts them" };

const countFor = async (check) => diffCount((await runChecks([check]))[0]);

export async function runAlarmTest(only) {
  const all = breaks(await pickTargets());
  const missingBreak = CHECK_NAMES.filter((n) => !all.some(([c]) => c === n) && !UNTESTABLE[n]);
  if (missingBreak.length) die(`alarm-test: no break defined for check(s): ${missingBreak.join(", ")}. Every check needs one.`);
  const selected = all.filter(([c]) => !only || only.includes(c));
  const results = [];

  for (const [check, what, apply, undo] of selected) {
    const r = blankResult(check, "safety");
    r.prod = "-";
    let before;
    try {
      before = await countFor(check);
      let during;
      try {
        await write(apply);
        during = await countFor(check);
      } finally {
        await write(undo);
      }
      const after = await countFor(check);
      r.staging = during > before ? "caught" : "MISSED";
      if (during <= before) r.problems.push(`did not notice: ${what} (differences stayed at ${before})`);
      if (after !== before) r.problems.push(`staging not restored after: ${what} (differences ${before} -> ${after})`);
    } catch (e) {
      r.staging = "error";
      r.problems.push(`could not run: ${what} -- ${String(e.message).slice(0, 220)}`);
      try { await write(undo); } catch { /* the undo is safe to repeat; a failure here is reported by the next check */ }
    }
    console.log(`  ${r.problems.length ? "FAIL" : "ok  "}  ${check.padEnd(26)} ${what}`);
    results.push(r);
  }

  for (const [check, why] of Object.entries(UNTESTABLE)) {
    if (only && !only.includes(check)) continue;
    const r = blankResult(`${check} (not testable)`, "info");
    r.warnings.push(why);
    results.push(r);
  }
  return results;
}

if (isMain(import.meta.url)) {
  requireSetup();
  const only = arg("only")?.split(",").map((s) => s.trim());
  console.log(`\nalarm-test: breaking staging ${TARGET} on purpose, one check at a time\n`);
  const results = await runAlarmTest(only);
  const { ok } = await report("alarm-test", results);
  process.exit(ok ? 0 : 1);
}

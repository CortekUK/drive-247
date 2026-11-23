#!/usr/bin/env node
/**
 * rebuild.mjs — make the staging database a fresh copy of prod's structure.
 *
 * Run it whenever db-eval says staging has drifted. It reads prod, empties our
 * schemas on staging, builds them again from prod's blueprint, then runs
 * db-eval to prove the result.
 *
 *   SUPABASE_ACCESS_TOKEN=… node evals/environments/database/rebuild.mjs --yes
 *   --dry-run   show what would happen, change nothing
 *   --keep      leave the prod blueprint in reports/blueprints/ for reading
 *
 * WHAT IT WIPES: every row in staging's public, private and turo_syntax_check
 * schemas. Staging rows are seed data, so re-seed afterwards. Auth users, files
 * in storage and vault secrets on staging are left alone.
 *
 * WHAT IT NEVER DOES: write to production (lib.mjs refuses), copy a row of
 * data, or leave a cron switched on. Crons are installed with the prod address
 * and prod keys swapped for staging's, and all of them are switched off.
 *
 * Needs pg_dump 17 (see blueprint-diff.mjs).
 */
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HERE, PROD_REF, TARGET, flag, sql, mgmtGet, applyExceptions, report, requireSetup, die } from "./lib.mjs";
import { SCHEMAS, findPgDump, dump } from "./blueprint-diff.mjs";
import { runChecks } from "./db-eval.mjs";

requireSetup();
const DRY = flag("dry-run");
if (!DRY && !flag("yes")) die("rebuild wipes every row in staging's own schemas. Re-run with --yes (or --dry-run to look first).");

const IN = SCHEMAS.map((s) => `'${s}'`).join(",");
const write = (q) => sql(TARGET, q, { write: true });
const lit = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const step = (n, text) => console.log(`\n[${n}] ${text}`);
const t0 = Date.now();

/** Send statements in groups. Each group is one request, so one transaction. */
async function sendAll(statements, label, size = 400) {
  for (let i = 0; i < statements.length; i += size) {
    const group = statements.slice(i, i + size);
    try {
      await write(group.join("\n"));
    } catch (e) {
      // Find the one statement that was refused, so the error names it.
      for (const s of group) {
        try { await write(s); } catch (one) { die(`${label} failed on:\n  ${s.slice(0, 300)}\n  ${one.message.slice(0, 400)}`); }
      }
      // Every statement went through alone, so the group was only too big for one transaction.
    }
  }
}

// ── 1. read prod ────────────────────────────────────────────────────────────

step(1, "Reading prod's blueprint (schema only, read-only session)");
const pgDump = await findPgDump();
const dir = flag("keep") ? join(HERE, "reports", "blueprints") : join(tmpdir(), `d247-rebuild-${process.pid}`);
mkdirSync(dir, { recursive: true });
let text;
try {
  text = await dump(pgDump, PROD_REF, join(dir, "prod.sql"));
} finally {
  if (!flag("keep") && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
if (/^(COPY |INSERT INTO )/m.test(text)) die("The prod dump contains row data. Refusing to continue.");

// pg_dump writes one block per object, each under a "-- Name: …; Type: …" header.
const pieces = text.split(/^--\n-- (?=Name: )/m);
const strip = (s) => s.split("\n").filter((l) => !l.startsWith("\\restrict") && !l.startsWith("\\unrestrict")).join("\n");
// The settings pg_dump opens with (empty search_path, no function body checks).
// Every request is its own session, so every request starts with them.
const preamble = strip(pieces[0]).split("\n").filter((l) => /^(SET |SELECT pg_catalog\.set_config)/.test(l)).join("\n");
const blocks = pieces.slice(1).map((b) => {
  const head = b.match(/^Name: (.*?); Type: (.*?); Schema: (.*?); Owner: ?(.*)$/m);
  if (!head) die(`Could not read a blueprint block header: ${b.slice(0, 120)}`);
  return { name: head[1], type: head[2], schema: head[3], body: strip(b.split("\n").slice(1).join("\n")) };
});
const structure = blocks.filter((b) => !["ACL", "DEFAULT ACL", "SCHEMA"].includes(b.type));
const schemaBlocks = blocks.filter((b) => b.type === "SCHEMA");
const acl = blocks.filter((b) => b.type === "ACL");
const aclLines = acl.flatMap((b) => b.body.split("\n").filter((l) => /^(GRANT|REVOKE) /.test(l)));
const columnGrants = aclLines.filter((l) => /^GRANT [^;]*\([^)]*\) ON TABLE /.test(l));
console.log(`    ${blocks.length} objects: ${structure.length} to build, ${aclLines.length} permission lines (${columnGrants.length} per-column)`);
if (structure.length < 3000) die(`Only ${structure.length} objects in prod's blueprint: too few to be the real thing. Refusing.`);

const [prodExt, prodRoles, prodBuckets, prodPolicies, prodTriggers, prodEventTriggers, prodPubTables, prodCron] = await Promise.all([
  sql(PROD_REF, `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`),
  sql(PROD_REF, `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls from pg_roles where rolname !~ '^(pg_|supabase|cli_login_|pgbouncer|pgsodium|dashboard_user|postgres$|anon$|authenticated$|authenticator$|service_role$)'`),
  sql(PROD_REF, `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id`),
  sql(PROD_REF, `select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('storage','realtime') order by 1,2,3`),
  sql(PROD_REF, `select pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace cn on cn.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace where not t.tgisinternal and cn.nspname not in (${IN}) and n.nspname in (${IN})`),
  sql(PROD_REF, `select e.evtname, e.evtevent, e.evttags, format('%I.%I', n.nspname, p.proname) fn from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid join pg_namespace n on n.oid = p.pronamespace where n.nspname in (${IN})`),
  sql(PROD_REF, `select pubname, schemaname, tablename from pg_publication_tables where schemaname in (${IN}) order by 1,2,3`),
  sql(PROD_REF, `select jobname, schedule, command from cron.job order by jobid`),
]);

// ── 2. plan the staging side ────────────────────────────────────────────────

const [stagExt, stagRoles, stagSchemas, stagRows, keys] = await Promise.all([
  sql(TARGET, `select extname from pg_extension`),
  sql(TARGET, `select rolname from pg_roles`),
  sql(TARGET, `select nspname from pg_namespace`),
  sql(TARGET, `select coalesce(sum(n_live_tup), 0)::bigint rows, count(*) filter (where n_live_tup > 0)::int tables from pg_stat_user_tables where schemaname in (${IN})`),
  mgmtGet(TARGET, "/api-keys?reveal=true"),
]);
const stagService = keys.find((k) => k.name === "service_role")?.api_key;
const stagAnon = keys.find((k) => k.name === "anon")?.api_key;
if (!stagService || !stagAnon) die("Could not read staging's own API keys.");

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const claims = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()); } catch { return {}; } };
/** Point a command at staging: swap the prod address, and any prod key, for staging's. A key for some other project is left as it is. */
const toStaging = (s) => s.replaceAll(PROD_REF, TARGET).replace(JWT, (j) => { const c = claims(j); return c.ref === PROD_REF ? (c.role === "anon" ? stagAnon : stagService) : j; });
const stillProd = (s) => s.includes(PROD_REF) || [...s.matchAll(JWT)].some((m) => claims(m[0]).ref === PROD_REF);

const have = (rows, col) => new Set(rows.map((r) => r[col]));
const missingExt = prodExt.filter((e) => !have(stagExt, "extname").has(e.extname));
const missingRoles = prodRoles.filter((r) => !have(stagRoles, "rolname").has(r.rolname));
const missingSchemas = schemaBlocks.filter((b) => !have(stagSchemas, "nspname").has(b.name));
const cronCommands = prodCron.map((j) => ({ ...j, command: toStaging(j.command) }));
const leak = cronCommands.filter((j) => stillProd(j.command));
if (leak.length) die(`These crons would still point at production after the swap. Refusing:\n  ${leak.map((j) => j.jobname).join("\n  ")}`);

step(2, "Plan");
console.log(`    staging rows to be wiped: ${stagRows[0].rows} in ${stagRows[0].tables} tables`);
console.log(`    extensions to add: ${missingExt.map((e) => e.extname).join(", ") || "none"}`);
console.log(`    roles to add: ${missingRoles.map((r) => r.rolname).join(", ") || "none"}`);
console.log(`    schemas to add: ${missingSchemas.map((b) => b.name).join(", ") || "none"}`);
console.log(`    then: ${prodBuckets.length} buckets, ${prodPolicies.length} storage/realtime policies, ${prodTriggers.length} cross-schema triggers, ${prodEventTriggers.length} event triggers, ${prodPubTables.length} realtime tables, ${prodCron.length} crons (all off)`);
if (DRY) { console.log("\nDry run: nothing was changed."); process.exit(0); }

// ── 3. prerequisites ────────────────────────────────────────────────────────

step(3, "Extensions, roles and schemas the blueprint relies on");
for (const e of missingExt) await write(`create extension if not exists "${e.extname}" with schema "${e.nspname}"`);
for (const r of missingRoles) {
  const on = (v, word) => (v ? word : `no${word}`);
  // Attributes only. A password is never copied: a role that logs in on prod gets none here.
  await write(`create role "${r.rolname}" with ${on(r.rolinherit, "inherit")} ${on(r.rolcreaterole, "createrole")} ${on(r.rolcreatedb, "createdb")} ${on(r.rolcanlogin, "login")} ${on(r.rolbypassrls, "bypassrls")}`);
}
for (const b of missingSchemas) await write(`${preamble}\n${b.body}`);

// ── 4. empty our schemas ────────────────────────────────────────────────────

step(4, "Emptying staging's own schemas");
// The schemas themselves stay: dropping one would also drop its default
// privileges, which the platform does not let us put back. Objects that belong
// to an extension stay too.
const notExt = (cls, col) => `not exists (select 1 from pg_depend d where d.classid = '${cls}'::regclass and d.objid = ${col} and d.deptype = 'e')`;
const drops = await sql(TARGET, `
  -- Tables first: a sequence that feeds an id column can only go with its table.
  select case when c.relkind = 'S' then 2 else 1 end ord, format('drop %s if exists %I.%I cascade', case c.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' when 'S' then 'sequence' else 'table' end, n.nspname, c.relname) stmt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in (${IN}) and c.relkind in ('r','p','v','m','f','S') and ${notExt("pg_class", "c.oid")}
  union all
  select 3, format('drop %s if exists %I.%I(%s) cascade', case p.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (${IN}) and ${notExt("pg_proc", "p.oid")}
  union all
  select 4, format('drop type if exists %I.%I cascade', n.nspname, t.typname)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in (${IN}) and t.typtype in ('e','d','r','m') and ${notExt("pg_type", "t.oid")}
  union all
  select 4, format('drop type if exists %I.%I cascade', n.nspname, t.typname)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_class c on c.oid = t.typrelid
    where n.nspname in (${IN}) and t.typtype = 'c' and c.relkind = 'c' and ${notExt("pg_type", "t.oid")}
  order by 1`);
// `if exists … cascade` because an earlier drop may already have taken the object with it.
// Small groups: every drop holds locks until its transaction ends, and Postgres caps those.
await sendAll(drops.map((d) => `${d.stmt};`), "emptying staging", 40);
const left = await sql(TARGET, `select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in (${IN}) and c.relkind in ('r','p','v','m','f','S') and ${notExt("pg_class", "c.oid")}`);
if (left[0].n) die(`${left[0].n} objects survived the wipe. Stopping before building on top of them.`);
console.log(`    ${drops.length} objects removed`);

// ── 5. build from the blueprint ─────────────────────────────────────────────

step(5, `Building ${structure.length} objects from prod's blueprint`);
{
  let group = [], bytes = 0, done = 0;
  const flush = async () => {
    if (!group.length) return;
    try {
      await write(`${preamble}\n${group.map((b) => b.body).join("\n")}`);
    } catch (e) {
      for (const b of group) {
        try { await write(`${preamble}\n${b.body}`); } catch (one) { die(`Building failed on ${b.type} ${b.schema}.${b.name}:\n  ${one.message.slice(0, 500)}`); }
      }
    }
    done += group.length;
    process.stdout.write(`\r    ${done}/${structure.length}`);
    group = []; bytes = 0;
  };
  for (const b of structure) {
    group.push(b); bytes += b.body.length;
    if (group.length >= 100 || bytes > 300_000) await flush();
  }
  await flush();
  console.log("");
}

// ── 6. permissions ──────────────────────────────────────────────────────────

step(6, "Permissions");
await sendAll(aclLines, "applying permissions", 800);
// A new project hands anon and authenticated access to every new table and
// function. Prod does not, so staging's permissions are now a superset.
// Compare what each side actually holds and correct staging to match.
const REL = `select case when c.relkind = 'S' then 'sequence' else 'table' end as kind, format('%I.%I', n.nspname, c.relname) as obj, case when r.rolname is null then 'public' else format('%I', r.rolname) end as grantee,
  string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs, bool_or(a.is_grantable) as grantable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where c.relkind in ('r','p','v','m','f','S') and n.nspname in (${IN}) and ${notExt("pg_class", "c.oid")}
  group by 1,2,3`;
const FN = `select 'routine' as kind, format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as obj, case when r.rolname is null then 'public' else format('%I', r.rolname) end as grantee,
  string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs, bool_or(a.is_grantable) as grantable
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles r on r.oid = a.grantee
  where n.nspname in (${IN}) and ${notExt("pg_proc", "p.oid")}
  group by 1,2,3`;
for (let pass = 1; ; pass++) {
  const fixes = [];
  for (const Q of [REL, FN]) {
    const [p, s] = await Promise.all([sql(PROD_REF, Q), sql(TARGET, Q)]);
    const key = (r) => `${r.kind}|${r.obj}|${r.grantee}`;
    const want = new Map(p.map((r) => [key(r), r]));
    const got = new Map(s.map((r) => [key(r), r]));
    const grant = (r) => `grant ${r.privs} on ${r.kind} ${r.obj} to ${r.grantee}${r.grantable ? " with grant option" : ""};`;
    for (const [k, r] of got) {
      const w = want.get(k);
      if (w && w.privs === r.privs && w.grantable === r.grantable) continue;
      fixes.push(`revoke all on ${r.kind} ${r.obj} from ${r.grantee};`);
      if (w) fixes.push(grant(w));
    }
    for (const [k, r] of want) if (!got.has(k)) fixes.push(grant(r));
  }
  console.log(`    pass ${pass}: ${fixes.length} corrections`);
  if (!fixes.length) break;
  if (pass === 4) die("Permissions did not settle after 3 passes.");
  await sendAll(fixes, "correcting permissions", 800);
}
// Postgres keeps "nobody but the owner" in two forms: no list at all, or a list
// naming only the owner. They mean the same, but prod has the written-out form on
// some objects. Granting the owner something it already holds writes the list out.
const EXPLICIT = `
  select format('grant %s on %s %I.%I to %I', case when c.relkind = 'S' then 'usage' else 'select' end, case when c.relkind = 'S' then 'sequence' else 'table' end, n.nspname, c.relname, pg_get_userbyid(c.relowner)) stmt,
         format('%I.%I', n.nspname, c.relname) k
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relacl is %s null and c.relkind in ('r','p','v','m','f','S') and n.nspname in (${IN}) and ${notExt("pg_class", "c.oid")}
  union all
  select format('grant execute on routine %I.%I(%s) to %I', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner)),
         format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proacl is %s null and n.nspname in (${IN}) and ${notExt("pg_proc", "p.oid")}`;
{
  const [written, bare] = await Promise.all([sql(PROD_REF, EXPLICIT.replaceAll("%s null", "not null")), sql(TARGET, EXPLICIT.replaceAll("%s null", "null"))]);
  const writtenOnProd = new Set(written.map((r) => r.k));
  const todo = bare.filter((r) => writtenOnProd.has(r.k)).map((r) => `${r.stmt};`);
  await sendAll(todo, "writing out owner-only permissions", 400);
  console.log(`    ${todo.length} owner-only permission lists written out`);
}
// "revoke all" on a table also removes that role's per-column grants, so those go on last.
await sendAll(columnGrants, "per-column permissions", 800);
console.log(`    ${columnGrants.length} per-column grants applied`);

// ── 7. what the blueprint does not carry ────────────────────────────────────

step(7, "Storage, realtime, triggers on Supabase's tables, crons");
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
await sendAll(
  prodBuckets.map((b) => `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? "null"}, ${b.allowed_mime_types ? `array[${b.allowed_mime_types.map(lit).join(",")}]::text[]` : "null"}) on conflict (id) do update set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;`),
  "storage buckets",
);
await sendAll(
  prodPolicies.map((p) => {
    const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/^{|}$/g, "").split(",");
    return `drop policy if exists ${q(p.policyname)} on ${p.schemaname}.${q(p.tablename)}; create policy ${q(p.policyname)} on ${p.schemaname}.${q(p.tablename)} as ${p.permissive} for ${p.cmd} to ${roles.join(", ")}${p.qual ? ` using (${p.qual})` : ""}${p.with_check ? ` with check (${p.with_check})` : ""};`;
  }),
  "storage and realtime policies",
  100,
);
await sendAll(prodTriggers.map((t) => `${toStaging(t.def).replace(/^CREATE TRIGGER/, "CREATE OR REPLACE TRIGGER")};`), "cross-schema triggers", 50);
await sendAll(
  prodEventTriggers.map((e) => `drop event trigger if exists ${q(e.evtname)}; create event trigger ${q(e.evtname)} on ${e.evtevent}${e.evttags?.length ? ` when tag in (${e.evttags.map(lit).join(", ")})` : ""} execute function ${e.fn}();`),
  "event triggers",
  20,
);
await sendAll(
  prodPubTables.map((p) => `do $$ begin alter publication ${q(p.pubname)} add table ${q(p.schemaname)}.${q(p.tablename)}; exception when duplicate_object then null; end $$;`),
  "realtime tables",
  100,
);
// One request, so one transaction: the scheduler never sees a job switched on.
await write([
  `select cron.unschedule(jobid) from cron.job;`,
  ...cronCommands.map((j) => `select cron.schedule(${lit(j.jobname)}, ${lit(j.schedule)}, ${lit(j.command)});`),
  `select cron.alter_job(jobid, active := false) from cron.job;`,
].join("\n"));
const on = await sql(TARGET, `select count(*)::int n from cron.job where active`);
if (on[0].n) die(`${on[0].n} crons are switched on after install. Stopping.`);
console.log(`    ${prodBuckets.length} buckets, ${prodPolicies.length} policies, ${prodTriggers.length} triggers, ${prodPubTables.length} realtime tables, ${prodCron.length} crons (0 switched on)`);

// ── 8. two things a blueprint cannot carry across faithfully ────────────────

step(8, "Repairs");
// (a) Functions that have the prod address or a prod key written into their body.
// Left alone they would call production from staging.
const hard = await sql(TARGET, `select format('%I.%I', n.nspname, p.proname) name, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in (${IN}) and p.prokind in ('f','p') and p.prosrc like '%${PROD_REF}%'`);
for (const f of hard) {
  const def = toStaging(f.def);
  if (stillProd(def)) die(`${f.name} would still point at production after the swap. Stopping.`);
  await write(def);
}
console.log(`    ${hard.length} functions repointed from prod to staging`);

// (b) CHECK rules Postgres writes out differently from how it stores them.
// "x IN (…)" and "x BETWEEN a AND b" come back from pg_dump in a longer form that
// rebuilds into a slightly different rule. Put the short form back, then keep the
// repair only if the stored rule now reads exactly like prod's.
const CHK = `select format('%I.%I', n.nspname, c.relname) tbl, con.conname, pg_get_constraintdef(con.oid) def from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where con.contype = 'c' and n.nspname in (${IN})`;
const [prodChk, stagChk] = await Promise.all([sql(PROD_REF, CHK), sql(TARGET, CHK)]);
const stagDef = new Map(stagChk.map((r) => [`${r.tbl}|${r.conname}`, r.def]));
const balanced = (x) => { let d = 0; for (const ch of x) { if (ch === "(") d++; else if (ch === ")" && --d < 0) return false; } return d === 0; };
const shortForm = (def) =>
  def
    .replace(/\((\w+)\)::text = ANY \(\(ARRAY\[(.*?)\]\)::text\[\]\)/g, (_, col, items) => `${col} IN (${items.replace(/::character varying/g, "")})`)
    .replace(/\(\((.+?) >= (\S+?)\) AND \(\1 <= (\S+?)\)\)/g, (all, x, lo, hi) => (balanced(x) ? `(${x} BETWEEN ${lo} AND ${hi})` : all));
let repaired = 0;
for (const r of prodChk) {
  const mine = stagDef.get(`${r.tbl}|${r.conname}`);
  if (mine === undefined || mine === r.def) continue;
  const tryDef = shortForm(r.def);
  if (tryDef === r.def) continue; // nothing we know how to shorten: db-eval will report it
  const name = q(r.conname);
  await write(`alter table ${r.tbl} drop constraint ${name}; alter table ${r.tbl} add constraint ${name} ${tryDef};`);
  const now = await sql(TARGET, `select pg_get_constraintdef(con.oid) def from pg_constraint con where con.conrelid = '${r.tbl}'::regclass and con.conname = ${lit(r.conname)}`);
  if (now[0]?.def === r.def) repaired++;
  // If it still differs the rule is at least equivalent, and db-eval reports it below.
}
console.log(`    ${repaired} CHECK rules put back in prod's stored form`);

await write(`notify pgrst, 'reload schema'`);

// ── 9. prove it ─────────────────────────────────────────────────────────────

step(9, `Built in ${Math.round((Date.now() - t0) / 1000)}s. Running db-eval to prove it`);
const { ok } = await report("rebuild", applyExceptions(await runChecks()));
process.exit(ok ? 0 : 1);

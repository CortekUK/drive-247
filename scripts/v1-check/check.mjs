#!/usr/bin/env node
/**
 * check.mjs — "is v1 still exactly where we left it?"
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run v1:check
 *
 * v2 is being built on `main`, in the same repo and against the same production
 * database as the v1 that ~30 paying tenants are using right now. There is no
 * separate branch and no separate database to catch a mistake, so this script is
 * the net: it re-reads production, compares it to scripts/v1-check/baseline.json,
 * and refuses to pass if anything under v1 has moved.
 *
 * Six sections:
 *
 *   SCHEMA    every schema difference, classified ADDITIVE or BREAKING
 *   TRIGGERS  a new trigger on a pre-existing table is BREAKING even though it
 *             is schema-additive — it changes v1's behaviour at runtime
 *   EDGE FNS  a v1 edge function whose contents changed
 *   V1 FILES  a v1 source file whose contents changed (warning, not a failure)
 *   SMOKE     read-only queries proving v1's core still answers
 *   RLS       informational only; see the note in that section
 *
 * READ ONLY. Every statement is a SELECT. Nothing here writes to production.
 *
 * Exit 0 = clean, 1 = something is BREAKING, 2 = the check could not run.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  BASELINE_PATH,
  PROJECT_REF,
  CORE_TABLES,
  sql,
  readSchema,
  edgeFunctionHashes,
  v1FileHashes,
} from './shared.mjs';

/* ---------------------------------------------------------------- output -- */

const C = process.stdout.isTTY
  ? {
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
    }
  : {
      red: (s) => s,
      green: (s) => s,
      yellow: (s) => s,
      dim: (s) => s,
      bold: (s) => s,
    };

const breaking = [];
const additive = [];
const warnings = [];

const BREAK = (section, msg) => breaking.push({ section, msg });
const ADD = (section, msg) => additive.push({ section, msg });
const WARN = (section, msg) => warnings.push({ section, msg });

/** One aligned line: "  BREAKING  new NOT NULL column rentals.foo" */
const line = (verdict, msg) => {
  const tag =
    verdict === 'BREAKING'
      ? C.red('BREAKING')
      : verdict === 'ADDITIVE'
        ? C.green('ADDITIVE')
        : verdict === 'WARN'
          ? C.yellow('WARN    ')
          : C.dim('NOTE    ');
  console.log(`  ${tag}  ${msg}`);
};

const header = (name, subtitle) => {
  console.log('');
  console.log(C.bold(`── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`));
  if (subtitle) console.log(C.dim(`   ${subtitle}`));
};

/** Don't drown the terminal when someone runs this after a huge change. */
const CAP = 40;
const emit = (rows) => {
  for (const r of rows.slice(0, CAP)) line(r.verdict, r.msg);
  if (rows.length > CAP) console.log(C.dim(`  … and ${rows.length - CAP} more`));
  if (rows.length === 0) console.log(C.dim('   no differences'));
};

/* ---------------------------------------------------------------- inputs -- */

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `\n  No baseline at ${BASELINE_PATH}.\n  Run:  npm run v1:snapshot\n`
  );
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

console.log('');
console.log(C.bold('  v1 guardrail'));
console.log(`  project   ${PROJECT_REF}`);
console.log(
  `  baseline  ${baseline.meta.generatedAt}  ${C.dim(baseline.meta.gitSha?.slice(0, 8) ?? '')}`
);

const live = await readSchema();
const base = baseline.schema;

/* ---------------------------------------------------------------- SCHEMA -- */

const schemaRows = [];
const push = (verdict, msg) => {
  schemaRows.push({ verdict, msg });
  (verdict === 'BREAKING' ? BREAK : ADD)('SCHEMA', msg);
};

const baseTables = new Set(Object.keys(base.tables));
const liveTables = new Set(Object.keys(live.tables));

for (const t of liveTables) if (!baseTables.has(t)) push('ADDITIVE', `new table  ${t}`);
for (const t of baseTables) if (!liveTables.has(t)) push('BREAKING', `table dropped  ${t}`);

for (const t of baseTables) {
  if (!liveTables.has(t)) continue;
  const b = base.tables[t].columns;
  const l = live.tables[t].columns;

  for (const c of Object.keys(l)) {
    if (b[c]) continue;
    // A new column is additive only if v1's existing INSERTs, which do not
    // mention it, still succeed — i.e. it is nullable or carries a default.
    if (l[c].nullable || l[c].default !== null) {
      push('ADDITIVE', `new column  ${t}.${c}  ${l[c].type}`);
    } else {
      push('BREAKING', `new NOT NULL column with no default  ${t}.${c}  ${l[c].type}`);
    }
  }

  for (const c of Object.keys(b)) {
    if (!l[c]) {
      push('BREAKING', `column dropped  ${t}.${c}`);
      continue;
    }
    if (b[c].type !== l[c].type) {
      push('BREAKING', `column type changed  ${t}.${c}  ${b[c].type} → ${l[c].type}`);
    }
    if (b[c].nullable && !l[c].nullable) {
      push('BREAKING', `column made NOT NULL  ${t}.${c}`);
    }
    if (!b[c].nullable && l[c].nullable) {
      push('ADDITIVE', `column made nullable  ${t}.${c}`);
    }
    if (b[c].default !== null && l[c].default === null) {
      push('BREAKING', `default removed  ${t}.${c}  (was ${b[c].default})`);
    } else if (b[c].default !== l[c].default) {
      push('ADDITIVE', `default changed  ${t}.${c}  ${b[c].default ?? 'none'} → ${l[c].default}`);
    }
  }
}

// Constraints. On a table that already existed, ANY new constraint can reject a
// write v1 makes today — a UNIQUE over existing rows, a CHECK, an FK. On a table
// that is itself new, nothing v1 does can reach it.
for (const k of Object.keys(live.constraints)) {
  if (base.constraints[k]) continue;
  const tbl = live.constraints[k].table_name;
  if (!baseTables.has(tbl)) {
    push('ADDITIVE', `new constraint on new table  ${k}`);
  } else {
    push('BREAKING', `new constraint on existing table  ${k}  ${live.constraints[k].definition}`);
  }
}
for (const k of Object.keys(base.constraints)) {
  if (!live.constraints[k]) {
    if (!liveTables.has(base.constraints[k].table_name)) continue; // table already reported
    push('BREAKING', `constraint dropped  ${k}`);
  } else if (base.constraints[k].definition !== live.constraints[k].definition) {
    push('BREAKING', `constraint redefined  ${k}`);
  }
}

// Indexes. A non-unique index is free; a UNIQUE one is a new rule over data v1
// already wrote, and can fail the migration or reject tomorrow's insert.
for (const k of Object.keys(live.indexes)) {
  if (base.indexes[k]) continue;
  const def = live.indexes[k].definition;
  if (/CREATE UNIQUE INDEX/i.test(def) && baseTables.has(live.indexes[k].table_name)) {
    push('BREAKING', `new UNIQUE index on existing table  ${k}`);
  } else {
    push('ADDITIVE', `new index  ${k}`);
  }
}
for (const k of Object.keys(base.indexes)) {
  if (!live.indexes[k]) {
    if (!liveTables.has(base.indexes[k].table_name)) continue;
    push('BREAKING', `index dropped  ${k}`);
  } else if (base.indexes[k].definition !== live.indexes[k].definition) {
    push('BREAKING', `index redefined  ${k}`);
  }
}

// Functions. Keyed by name(args), so a changed signature surfaces as one gone
// and one arrived — reported as the signature change it actually is, because
// that is what breaks every existing caller.
const byName = (map) => {
  const o = {};
  for (const k of Object.keys(map)) (o[map[k].name] ||= []).push(k);
  return o;
};
const baseFns = byName(base.functions);
const liveFns = byName(live.functions);

for (const name of Object.keys(liveFns)) {
  if (!baseFns[name]) {
    for (const k of liveFns[name]) push('ADDITIVE', `new function  ${k}`);
    continue;
  }
  for (const k of liveFns[name]) {
    if (!base.functions[k]) {
      push('BREAKING', `function signature changed  ${name}  new overload ${k}`);
    } else if (base.functions[k].result !== live.functions[k].result) {
      push(
        'BREAKING',
        `function return type changed  ${k}  ${base.functions[k].result} → ${live.functions[k].result}`
      );
    }
  }
}
for (const name of Object.keys(baseFns)) {
  for (const k of baseFns[name]) {
    if (!live.functions[k]) push('BREAKING', `function dropped  ${k}`);
  }
}

header('SCHEMA', 'additive-only: v1 and v2 share one production database');
emit(schemaRows);

/* -------------------------------------------------------------- TRIGGERS -- */

/**
 * Triggers get their own section because they are the case that slips past a
 * schema review. `CREATE TRIGGER` adds an object and alters no column, so it
 * reads as additive — but it changes what happens when v1 writes a row. A
 * BEFORE INSERT trigger with no exception handler aborts the insert if anything
 * inside it raises, and the caller sees the rental fail, not the trigger.
 */
const triggerRows = [];
const tpush = (verdict, msg) => {
  triggerRows.push({ verdict, msg });
  if (verdict === 'BREAKING') BREAK('TRIGGERS', msg);
  else ADD('TRIGGERS', msg);
};

for (const k of Object.keys(live.triggers)) {
  const t = live.triggers[k];
  if (base.triggers[k]) {
    const b = base.triggers[k];
    for (const f of ['function_name', 'timing', 'events', 'enabled']) {
      if (b[f] !== t[f]) tpush('BREAKING', `trigger ${f} changed  ${k}  ${b[f]} → ${t[f]}`);
    }
    continue;
  }
  if (!baseTables.has(t.table_name)) {
    tpush('ADDITIVE', `new trigger on new table  ${k}  ${t.timing} ${t.events} → ${t.function_name}`);
  } else {
    tpush(
      'BREAKING',
      `new trigger on pre-existing table  ${k}  ${t.timing} ${t.events} → ${t.function_name}`
    );
  }
}
for (const k of Object.keys(base.triggers)) {
  if (!live.triggers[k] && liveTables.has(base.triggers[k].table_name)) {
    tpush('BREAKING', `trigger dropped  ${k}`);
  }
}

header('TRIGGERS', 'a new trigger on a pre-existing table changes v1 at runtime');
emit(triggerRows);

/* -------------------------------------------------------------- EDGE FNS -- */

const liveEdge = edgeFunctionHashes();
const baseEdge = baseline.edgeFunctions;
const edgeRows = [];

for (const fn of Object.keys(baseEdge)) {
  if (!liveEdge[fn]) {
    edgeRows.push({ verdict: 'BREAKING', msg: `edge function removed  ${fn}` });
    BREAK('EDGE FNS', `edge function removed  ${fn}`);
  } else if (liveEdge[fn] !== baseEdge[fn]) {
    edgeRows.push({ verdict: 'BREAKING', msg: `edge function changed  ${fn}` });
    BREAK('EDGE FNS', `edge function changed  ${fn}`);
  }
}
const newEdge = Object.keys(liveEdge).filter((f) => !baseEdge[f]);
for (const fn of newEdge) edgeRows.push({ verdict: 'ADDITIVE', msg: `new edge function  ${fn}` });

header('EDGE FNS', 'never change a v1 function — add `x-v2` and point northwind at it');
emit(edgeRows);

/* -------------------------------------------------------------- V1 FILES -- */

/**
 * A warning, not a failure. Some edits to v1 files are legitimate and expected
 * — a real v1 bug fix, or the one-line branch at the top of a route that hands
 * off to the v2 screen. What this section exists to stop is the quiet kind:
 * "while I was in there I also reworked the old component". If a file is listed
 * here, you should be able to say why in one sentence.
 */
const liveFiles = v1FileHashes();
const baseFiles = baseline.v1Files;
const fileRows = [];

for (const f of Object.keys(baseFiles)) {
  if (!(f in liveFiles)) {
    fileRows.push({ verdict: 'WARN', msg: `v1 file deleted   ${f}` });
    WARN('V1 FILES', `deleted  ${f}`);
  } else if (liveFiles[f] !== baseFiles[f]) {
    fileRows.push({ verdict: 'WARN', msg: `v1 file changed   ${f}` });
    WARN('V1 FILES', `changed  ${f}`);
  }
}
const newFiles = Object.keys(liveFiles).filter((f) => !(f in baseFiles));

header('V1 FILES', 'new files are fine — that is the strangler pattern working');
if (fileRows.length === 0) {
  console.log(C.dim(`   no v1 file changed  (${newFiles.length} new file(s) since baseline)`));
} else {
  emit(fileRows);
  console.log(C.dim(`   ${newFiles.length} new file(s) since baseline — not a finding`));
}

/* ----------------------------------------------------------------- SMOKE -- */

/**
 * Proof that v1's core still answers, not just that its shape is unchanged.
 * Every query is a SELECT, and every tenant-scoped one carries an explicit
 * tenant_id filter — which is also the point being demonstrated: with RLS off
 * on these tables, that filter is the ONLY thing keeping one operator's data
 * away from another's.
 */
header('SMOKE', 'read-only queries against production');

const anyTenant = (
  await sql(`SELECT id FROM public.tenants ORDER BY created_at LIMIT 1`)
)[0]?.id;

const smoke = [
  [
    'core tables present',
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN (${CORE_TABLES.map((t) => `'${t}'`).join(',')})`,
    (r) => (r[0].n === CORE_TABLES.length ? null : `only ${r[0].n}/${CORE_TABLES.length} present`),
  ],
  [
    'rentals selectable, tenant-filtered',
    `SELECT count(*)::int AS n FROM public.rentals WHERE tenant_id = '${anyTenant}'`,
    () => null,
  ],
  [
    'customers selectable, tenant-filtered',
    `SELECT count(*)::int AS n FROM public.customers WHERE tenant_id = '${anyTenant}'`,
    () => null,
  ],
  [
    'vehicles selectable, tenant-filtered',
    `SELECT count(*)::int AS n FROM public.vehicles WHERE tenant_id = '${anyTenant}'`,
    () => null,
  ],
  [
    'payments selectable, tenant-filtered',
    `SELECT count(*)::int AS n FROM public.payments WHERE tenant_id = '${anyTenant}'`,
    () => null,
  ],
  [
    'RLS helpers present',
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('get_user_tenant_id','is_super_admin','is_primary_super_admin','is_global_master_admin')`,
    (r) => (r[0].n >= 4 ? null : `only ${r[0].n}/4 present`),
  ],
  [
    'control-center tables present',
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('batches','tenant_batches','batch_files')`,
    (r) => (r[0].n === 3 ? null : `only ${r[0].n}/3 present`),
  ],
  [
    'get_enabled_batch_keys() callable',
    `SELECT public.get_enabled_batch_keys() AS keys`,
    (r) => (Array.isArray(r[0].keys) ? null : 'did not return an array'),
  ],
  [
    'northwind canary exists',
    `SELECT count(*)::int AS n FROM public.tenants WHERE slug = 'northwind'`,
    (r) => (r[0].n === 1 ? null : 'northwind tenant not found'),
  ],
];

for (const [name, query, verify] of smoke) {
  let problem = null;
  try {
    const rows = await sql(query);
    problem = verify(rows);
  } catch (e) {
    problem = e.message.split('\n')[0].slice(0, 160);
  }
  if (problem) {
    console.log(`  ${C.red('BREAKING')}  ${name.padEnd(38)} ${problem}`);
    BREAK('SMOKE', `${name}: ${problem}`);
  } else {
    console.log(`  ${C.green('ok      ')}  ${name}`);
  }
}

/* ------------------------------------------------------------------- RLS -- */

/**
 * INFORMATIONAL. Never a failure.
 *
 * RLS is off on the core tables by a deliberate, deferred decision: tenant
 * isolation is enforced in application code, by a tenant_id filter on every
 * query. This section is here so nobody forgets that is the situation — not to
 * nag about turning RLS on.
 *
 * Note that several of these tables DO carry policies. Policies on a table with
 * RLS disabled are inert; they do not run. Seeing a policy in the dashboard is
 * not evidence that anything is enforced.
 */
const rlsRows = await sql(
  `SELECT c.relname AS name, c.relrowsecurity AS rls,
          (SELECT count(*) FROM pg_policies p
            WHERE p.schemaname='public' AND p.tablename=c.relname)::int AS policies
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN (${CORE_TABLES.map((t) => `'${t}'`).join(',')})
    ORDER BY 1`
);
const totalOff = (
  await sql(
    `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity`
  )
)[0].n;
const totalTables = Object.keys(live.tables).length;
const coreOff = rlsRows.filter((r) => !r.rls);

header('RLS', 'informational — isolation is enforced in application code');
console.log(
  `  ${C.dim('NOTE    ')}  ${coreOff.length} of ${CORE_TABLES.length} core tables have RLS DISABLED: ${coreOff
    .map((r) => r.name)
    .join(', ')}`
);
console.log(`  ${C.dim('NOTE    ')}  ${totalOff} of ${totalTables} public tables have RLS disabled overall`);
const inert = coreOff.filter((r) => r.policies > 0);
if (inert.length) {
  console.log(
    `  ${C.dim('NOTE    ')}  ${inert.length} of those carry policies that are INERT while RLS is off: ` +
      inert.map((r) => `${r.name}(${r.policies})`).join(', ')
  );
}
console.log(
  `  ${C.dim('NOTE    ')}  every query MUST filter by tenant_id. There is no database-level net.`
);

/* --------------------------------------------------------------- verdict -- */

console.log('');
console.log(C.bold(`── VERDICT ${'─'.repeat(51)}`));
console.log(
  `   ${breaking.length} breaking · ${additive.length} additive · ${warnings.length} warning(s)`
);

if (breaking.length) {
  console.log('');
  for (const b of breaking.slice(0, CAP)) console.log(`   ${C.red('✗')} ${b.section}  ${b.msg}`);
  if (breaking.length > CAP) console.log(C.dim(`   … and ${breaking.length - CAP} more`));
  console.log('');
  console.log(C.red('   FAIL — v1 has moved.'));
  console.log(
    C.dim(
      '   Either revert the change, or — if it was intentional and reviewed —\n' +
        '   re-run `npm run v1:snapshot` and commit the new baseline with the reason.'
    )
  );
  console.log('');
  process.exit(1);
}

console.log('');
console.log(C.green('   PASS — v1 is intact.'));
console.log('');

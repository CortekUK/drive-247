/**
 * shared.mjs — the pieces snapshot.mjs and check.mjs both need.
 *
 * One rule governs this whole directory: READ ONLY. Every statement issued from
 * here is a SELECT against production. There is no code path that writes, and
 * there must never be one — the guardrail exists to protect the live database,
 * so it cannot be a thing that can damage it.
 *
 * No dependencies. Node's built-in fetch, crypto and fs only, so `npm run
 * v1:check` works from a clean clone with nothing installed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const BASELINE_PATH = join(HERE, 'baseline.json');

/** Production. The guardrail is only meaningful against the database v1 runs on. */
export const PROJECT_REF = process.env.V1_CHECK_PROJECT_REF || 'hviqoaokxvlancmftwuo';

/**
 * A browser User-Agent is not cosmetic here. The Supabase Management API sits
 * behind Cloudflare, which answers the default Node/undici UA with error 1010
 * and no useful body. Every request must carry this.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * The token is read from the environment and is NEVER written into this repo.
 * It is a Supabase *Management* token — it can create, delete and drain any
 * project on the account — and this repo is pushed to GitHub. Committing it
 * would put it in git history permanently, where a rotation cannot reach it.
 */
export function token() {
  const t = process.env.SUPABASE_ACCESS_TOKEN;
  if (t) return t;
  console.error(
    [
      '',
      '  SUPABASE_ACCESS_TOKEN is not set.',
      '',
      '  The v1 guardrail reads the production schema through the Supabase',
      '  Management API and needs a management token (sbp_...).',
      '',
      '    SUPABASE_ACCESS_TOKEN=sbp_... npm run v1:check',
      '',
      '  The token is deliberately not stored in this repo.',
      '',
    ].join('\n')
  );
  process.exit(2);
}

/** Run one read-only SQL statement against production. Returns the rows. */
export async function sql(query) {
  if (/^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(query)) {
    throw new Error('v1-check issues SELECT only; refusing to run: ' + query.slice(0, 80));
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({ query }),
    }
  );
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    throw new Error(
      `SQL failed (HTTP ${res.status}): ${JSON.stringify(body)?.slice(0, 400)}`
    );
  }
  return body;
}

export const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/**
 * Tracked files only, via git. Using the index rather than a directory walk
 * keeps node_modules, .next, .turbo and every local scratch file out without
 * having to maintain an ignore list that drifts from .gitignore.
 */
export function trackedFiles(...patterns) {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString('utf8').split('\0').filter(Boolean);
}

export function hashFile(rel) {
  const p = join(REPO, rel);
  if (!existsSync(p)) return null;
  return sha(readFileSync(p));
}

/* --------------------------------------------------------------------------
 * The schema reads.
 *
 * Split into small statements rather than one big join: the Management API
 * returns a flat JSON array, and a single query mixing tables, columns,
 * indexes and triggers would need a shape discriminator on every row for no
 * gain. Each of these is cheap.
 * ------------------------------------------------------------------------ */

const Q = {
  tables: `
    SELECT c.relname AS name, c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 1`,

  columns: `
    SELECT table_name, column_name, data_type, udt_name,
           is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name`,

  constraints: `
    SELECT c.relname AS table_name, con.conname AS name,
           con.contype AS kind,
           pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY 1, 2`,

  indexes: `
    SELECT tablename AS table_name, indexname AS name, indexdef AS definition
      FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY 1, 2`,

  /**
   * Identity arguments + result type, not the body. A function body changing is
   * ordinary v1 maintenance; the SIGNATURE changing is what silently breaks
   * every existing caller, and that is what this guardrail is for.
   */
  functions: `
    SELECT p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS result
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
     ORDER BY 1, 2`,

  /**
   * tgtype is a bitmask: bit 0 = ROW, bit 1 = BEFORE, bits 2..5 = INSERT /
   * DELETE / UPDATE / TRUNCATE. Decoded here so a trigger that flips from
   * AFTER to BEFORE — which is exactly the change that can abort a v1 insert —
   * shows up as a difference rather than an opaque integer.
   */
  triggers: `
    SELECT c.relname  AS table_name,
           t.tgname   AS name,
           np.nspname || '.' || p.proname AS function_name,
           CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
                WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
                ELSE 'AFTER' END AS timing,
           btrim(
             CASE WHEN (t.tgtype & 4)  <> 0 THEN 'INSERT ' ELSE '' END ||
             CASE WHEN (t.tgtype & 8)  <> 0 THEN 'DELETE ' ELSE '' END ||
             CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE ' ELSE '' END ||
             CASE WHEN (t.tgtype & 32) <> 0 THEN 'TRUNCATE ' ELSE '' END
           ) AS events,
           t.tgenabled AS enabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace np ON np.oid = p.pronamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY 1, 2`,
};

/** The 7 core tables the whole business sits on, plus `tenants`. */
export const CORE_TABLES = [
  'rentals',
  'customers',
  'payments',
  'vehicles',
  'invoices',
  'ledger_entries',
  'app_users',
  'tenants',
];

/** Read production and return the comparable shape both scripts speak. */
export async function readSchema() {
  const [tables, columns, constraints, indexes, functions, triggers] =
    await Promise.all([
      sql(Q.tables),
      sql(Q.columns),
      sql(Q.constraints),
      sql(Q.indexes),
      sql(Q.functions),
      sql(Q.triggers),
    ]);

  const byTable = {};
  for (const t of tables) byTable[t.name] = { rls: t.rls, columns: {} };
  for (const c of columns) {
    const t = byTable[c.table_name];
    if (!t) continue; // a view or a matview; only real tables are tracked
    t.columns[c.column_name] = {
      type: c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type,
      nullable: c.is_nullable === 'YES',
      default: c.column_default,
    };
  }

  const keyed = (rows, k) => {
    const o = {};
    for (const r of rows) o[k(r)] = r;
    return o;
  };

  return {
    tables: byTable,
    constraints: keyed(constraints, (r) => `${r.table_name}.${r.name}`),
    indexes: keyed(indexes, (r) => `${r.table_name}.${r.name}`),
    functions: keyed(functions, (r) => `${r.name}(${r.args})`),
    triggers: keyed(triggers, (r) => `${r.table_name}.${r.name}`),
  };
}

/* --------------------------------------------------------------------------
 * The code reads.
 * ------------------------------------------------------------------------ */

/**
 * One hash per edge-function directory, over every tracked file inside it, so a
 * change anywhere in a function shows as that function changing. Paths are part
 * of the hash: moving a file inside a function is a change too.
 */
export function edgeFunctionHashes() {
  const files = trackedFiles('supabase/functions/**');
  const perFn = {};
  for (const f of files) {
    const m = f.match(/^supabase\/functions\/([^/]+)\//);
    if (!m) continue;
    (perFn[m[1]] ||= []).push(f);
  }
  const out = {};
  for (const [fn, list] of Object.entries(perFn)) {
    const h = createHash('sha256');
    for (const f of list.sort()) {
      h.update(f).update('\0').update(readFileSync(join(REPO, f)));
    }
    out[fn] = h.digest('hex').slice(0, 16);
  }
  return out;
}

/**
 * The v1 source manifest.
 *
 * Deliberately covers only what v2 must not edit in place: app source, and the
 * migrations already applied to production. New files are NOT a finding — a new
 * file beside the old one is the strangler pattern working exactly as intended.
 * Changed and deleted files are.
 */
export function v1FileHashes() {
  const files = trackedFiles(
    'apps/**/*.ts',
    'apps/**/*.tsx',
    'apps/**/*.js',
    'apps/**/*.jsx',
    'apps/**/*.mjs',
    'supabase/migrations/*.sql',
    'supabase/config.toml'
  );
  const out = {};
  for (const f of files) out[f] = hashFile(f);
  return out;
}

#!/usr/bin/env node
/**
 * settings-check.mjs — are the dials set the same?
 *
 * Two databases built from the same blueprint still behave differently if the
 * project around them is configured differently: which schemas the API exposes,
 * how many rows a request may return, how long a query may run, how login works.
 * None of that lives in the schema, so none of the other evals can see it.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/environments/database/settings-check.mjs
 *
 * Read-only. Anything that looks like a credential is never compared by value
 * and never printed: only "set" or "not set" is compared.
 */
import { PROD_REF, TARGET, sql, mgmtGet, compare, applyExceptions, report, requireSetup, isMain } from "./lib.mjs";

const SECRET = /secret|password|pass$|_key|token|private|credential|client_id|signing|hook_.*_uri|dsn/i;

/** Flatten a settings object into { k, d } rows, hiding credential values. */
function rows(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj ?? {})) {
    const k = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) out.push(...rows(value, k));
    else if (SECRET.test(key)) out.push({ k, d: value === null || value === "" || value === undefined ? "(not set)" : "(set)" });
    else out.push({ k, d: JSON.stringify(value ?? null) });
  }
  return out;
}

// Settings that decide how a query behaves. Memory and worker sizes are left
// out on purpose: they follow the size of the machine, which staging does not share.
const PG_SETTINGS = [
  "server_version_num", "server_encoding", "lc_collate", "lc_ctype", "TimeZone", "DateStyle", "IntervalStyle",
  "default_transaction_isolation", "default_transaction_read_only", "standard_conforming_strings", "search_path",
  "statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout", "row_security", "wal_level",
  "max_locks_per_transaction", "default_text_search_config", "bytea_output", "extra_float_digits", "cron.database_name",
  "pgrst.db_schemas", "pgrst.db_max_rows", "pgrst.db_extra_search_path", "session_preload_libraries", "shared_preload_libraries",
];

const SECTIONS = [
  // [check name, how to fetch, fewest keys prod must return]
  ["api_settings", (ref) => mgmtGet(ref, "/postgrest"), 3],
  ["auth_settings", (ref) => mgmtGet(ref, "/config/auth"), 50],
  ["postgres_config", (ref) => mgmtGet(ref, "/config/database/postgres"), 0],
  ["pooler_settings", async (ref) => {
    const p = await mgmtGet(ref, "/config/database/pooler");
    const { pool_mode, default_pool_size, max_client_conn, ignore_startup_parameters, database_type } = Array.isArray(p) ? p[0] : p;
    return { pool_mode, default_pool_size, max_client_conn, ignore_startup_parameters, database_type };
  }, 3],
  ["storage_settings", (ref) => mgmtGet(ref, "/config/storage"), 1],
  ["postgres_runtime", async (ref) => {
    const got = await sql(ref, `select name, setting from pg_settings where name in (${PG_SETTINGS.map((s) => `'${s}'`).join(",")})`);
    return Object.fromEntries(got.map((r) => [r.name, r.setting]));
  }, 15],
];

export async function runSettingsCheck() {
  const results = [];
  for (const [name, fetchOne, floor] of SECTIONS) {
    const safe = async (ref) => {
      try { return { value: await fetchOne(ref) }; } catch (e) { return { error: String(e.message).slice(0, 200) }; }
    };
    const [p, s] = await Promise.all([safe(PROD_REF), safe(TARGET)]);
    const r = compare(name, rows(p.value), rows(s.value));
    if (p.error) r.problems.push(`could not read prod: ${p.error}`);
    if (s.error) r.problems.push(`could not read staging: ${s.error}`);
    if (!p.error && r.prod < floor) r.problems.push(`prod returned ${r.prod} settings, floor is ${floor}: too few to trust this comparison`);
    results.push(r);
  }
  return results;
}

if (isMain(import.meta.url)) {
  requireSetup();
  const { ok } = await report("settings-check", applyExceptions(await runSettingsCheck()));
  process.exit(ok ? 0 : 1);
}

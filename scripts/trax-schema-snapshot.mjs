/*
 * Regenerates docs/trax/generated/schema-snapshot.json: the column types of the
 * tables the TRAX business catalog reads, straight from the deployed database.
 *
 * Structure only — no business rows are read, and nothing is written to the
 * database. apps/portal/src/__tests__/lib/trax-catalog-schema.test.ts checks the
 * catalog against this snapshot, so a catalog that names a column the database
 * does not have fails in CI rather than at runtime in front of a tenant.
 *
 * Needs a Supabase Management API token with read access. Provide a `sql(query)`
 * helper alongside this file, or set SUPABASE_ACCESS_TOKEN and adapt the import.
 */
import { sql } from "./sql.mjs";
import { writeFileSync } from "node:fs";
const TABLES = ['vehicles','rentals','customers','payments','pnl_entries','invoices','fines','ledger_entries',
  'vehicle_expenses','owner_payouts','rental_extensions','deposit_hold_links','tenant_subscriptions',
  'vehicle_maintenance_jobs','identity_verifications','payg_accruals','customer_users'];
const list = TABLES.map((t) => `'${t}'`).join(',');
const r = await sql(`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema='public' and table_name in (${list})
  order by table_name, column_name`);
const out = {};
for (const c of r.body ?? []) (out[c.table_name] ??= {})[c.column_name] = c.data_type;
const snapshot = {
  note: 'Column types of the tables the TRAX business catalog reads. Generated from the deployed database; regenerate with scripts/trax-schema-snapshot.mjs. Structure only — no business data.',
  project: 'hviqoaokxvlancmftwuo',
  readAt: new Date().toISOString().slice(0, 10),
  tables: out,
};
writeFileSync(new URL('../docs/trax/generated/schema-snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 1) + '\n');
console.log('tables:', Object.keys(out).length, 'columns:', Object.values(out).reduce((n, t) => n + Object.keys(t).length, 0));
const missing = TABLES.filter((t) => !out[t]);
if (missing.length) console.log('MISSING:', missing.join(', '));

/**
 * PGlite harness — real Postgres (18, compiled to WASM) in this Node process.
 * No network, no production, no Supabase CLI.
 *
 * What it builds, in order:
 *   1. The roles and helpers Supabase provides: `anon`, `authenticated`,
 *      `service_role` (BYPASSRLS), `auth.uid()` (Supabase's own definition),
 *      and Supabase's DEFAULT PRIVILEGES (every new table/function in public is
 *      granted to anon + authenticated + service_role) — so a REVOKE that the
 *      migrations forget shows up here as a real grant.
 *   2. From the LIVE fixture (tests/payment-plans/fixtures/live-ddl-2026-09-25.json,
 *      read-only dump of production on Sep 25 2026): every column of tenants,
 *      app_users, customers, vehicles, rentals, rental_extensions (PK only —
 *      "as minimal as FKs need"), and payments, ledger_entries,
 *      payment_applications, pnl_entries WITH their live constraints, indexes,
 *      triggers and RLS policies.
 *   3. The live function bodies (fixtures/live-functions-2026-09-25.sql):
 *      payment_apply_fifo_v2 (the live one — the repo copy is stale), the FIFO
 *      triggers, get_user_tenant_id, is_super_admin, …
 *   4. Stubs for what the fixture does not contain (listed in STUBS below).
 *   5. BOTH migrations, verbatim from supabase/migrations/.
 *   6. Test-only: pp_clock() is replaced so a test can drive the calendar
 *      (setNow). Production's pp_clock() is now().
 *
 * PP_MIGRATIONS_DIR (env) points step 5 at a scratch directory instead — used
 * only to prove a test goes red against a deliberately broken copy.
 */
import { PGlite, types } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
const FIXTURE_DIR = path.resolve(here, "../fixtures");

export const MIGRATION_FILES = [
  "20260925120000_ledger_allocation_prerequisites.sql",
  "20260925120100_payment_plans.sql",
] as const;

export function migrationPath(file: string): string {
  const dir = process.env.PP_MIGRATIONS_DIR || path.join(REPO_ROOT, "supabase/migrations");
  return path.join(dir, file);
}

interface FixtureColumn { table: string; column: string; type: string; nullable: "YES" | "NO"; default: string | null }
interface FixtureNamed { table: string; name: string; def: string }
interface FixtureRls { table: string; policy: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }
interface Fixture { columns: FixtureColumn[]; constraints: FixtureNamed[]; indexes: FixtureNamed[]; triggers: FixtureNamed[]; rls: FixtureRls[] }

export const fixture: Fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "live-ddl-2026-09-25.json"), "utf8"));
export const liveFunctionsSql = readFileSync(path.join(FIXTURE_DIR, "live-functions-2026-09-25.sql"), "utf8");

/** Tables built column-for-column from the fixture. Order matters only for readability. */
const TABLES = [
  "tenants", "app_users", "customers", "vehicles", "rentals", "rental_extensions",
  "payments", "ledger_entries", "payment_applications", "pnl_entries",
] as const;
/** Tables whose live constraints / indexes / triggers are in the fixture. */
const MONEY_TABLES = new Set(["payments", "ledger_entries", "payment_applications", "pnl_entries"]);

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

const SUPABASE_BOOTSTRAP = `
SET timezone = 'UTC';
ALTER DATABASE postgres SET timezone = 'UTC';
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default privileges (supabase/postgres initial schema): every new
-- table, function and sequence in public is granted to all three API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Supabase's own auth.uid().
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

/**
 * STUBS — objects the live triggers reference that are NOT in the fixture.
 * Each is the smallest thing that lets the live trigger run; none of them
 * touches money. What this leaves unproven is listed in the evidence report.
 */
const STUBS = `
-- payments triggers whose bodies were not dumped: no-ops here.
CREATE FUNCTION public.notify_payment_received() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN COALESCE(NEW, OLD); END $$;
CREATE FUNCTION public.notify_refund_processed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN COALESCE(NEW, OLD); END $$;
CREATE FUNCTION public.queue_for_rag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN COALESCE(NEW, OLD); END $$;
-- enqueue_financial_event_for_ledger_entry calls this inside its own
-- EXCEPTION block; a stub keeps the log quiet.
CREATE TYPE public.financial_event_type AS ENUM
  ('payment_receipt','rental_charge','mileage_charge','late_fee','damage_charge','charging_cost','insurance_charge','deposit_capture');
CREATE FUNCTION public.enqueue_financial_event(
  p_tenant_id uuid, p_event_type public.financial_event_type, p_amount_cents integer, p_currency text,
  p_rental_id uuid, p_customer_id uuid, p_vehicle_id uuid, p_source_table text, p_source_id uuid,
  p_description text, p_tax_cents integer, p_metadata jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Read by trigger_payg_settle_on_ledger_drain / trigger_settle_ghost_paid_payg_accruals.
CREATE TABLE public.payg_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid, invoice_status text, ledger_entry_ids uuid[],
  accrual_day_index integer, paid_at timestamptz, settling_payment_id uuid, superseded_by_accrual_id uuid);
-- Read by sync_fine_status_on_charge_settled.
CREATE TABLE public.fines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
`;

/** Test-only clock: pp_clock() reads pp_test.now when a test has set it. */
const TEST_CLOCK = `
CREATE OR REPLACE FUNCTION public.pp_clock()
 RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT COALESCE(NULLIF(current_setting('pp_test.now', true), '')::timestamptz, now()) $$;
`;

function buildTablesSql(): string {
  const out: string[] = [];
  for (const table of TABLES) {
    const cols = fixture.columns.filter((c) => c.table === table);
    if (cols.length === 0) throw new Error(`fixture has no columns for ${table}`);
    const lines = cols.map(
      (c) => `  ${ident(c.column)} ${c.type}${c.nullable === "NO" ? " NOT NULL" : ""}${c.default ? ` DEFAULT ${c.default}` : ""}`,
    );
    out.push(`CREATE TABLE public.${ident(table)} (\n${lines.join(",\n")}\n);`);
    if (!MONEY_TABLES.has(table)) out.push(`ALTER TABLE public.${ident(table)} ADD PRIMARY KEY (id);`);
  }
  // Live constraints: keys first (FKs need them), then CHECKs, then FKs.
  const rank = (def: string) => (def.startsWith("PRIMARY KEY") ? 0 : def.startsWith("UNIQUE") ? 1 : def.startsWith("CHECK") ? 2 : 3);
  const cons = fixture.constraints.filter((c) => MONEY_TABLES.has(c.table)).sort((a, b) => rank(a.def) - rank(b.def));
  for (const c of cons) out.push(`ALTER TABLE public.${ident(c.table)} ADD CONSTRAINT ${ident(c.name)} ${c.def};`);
  return out.join("\n");
}

function buildPoliciesSql(): string {
  const out: string[] = [];
  const tables = new Set(fixture.rls.map((r) => r.table).filter((t) => (TABLES as readonly string[]).includes(t)));
  for (const t of tables) out.push(`ALTER TABLE public.${ident(t)} ENABLE ROW LEVEL SECURITY;`);
  for (const r of fixture.rls) {
    if (!tables.has(r.table)) continue;
    const roles = r.roles.map((x) => (x === "public" ? "public" : ident(x))).join(", ");
    out.push(
      `CREATE POLICY ${ident(r.policy)} ON public.${ident(r.table)} FOR ${r.cmd} TO ${roles}` +
        (r.qual ? ` USING (${r.qual})` : "") +
        (r.with_check ? ` WITH CHECK (${r.with_check})` : "") +
        ";",
    );
  }
  return out.join("\n");
}

export interface BootOptions {
  /** false = stop after the live schema (no migrations). Default: both. */
  migrations?: false | readonly string[];
}

export interface Db {
  pg: PGlite;
  /** Rows of one statement. */
  q<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** First row or undefined. */
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  /** Drive pp_clock(). null = back to now(). */
  setNow(iso: string | null): Promise<void>;
  /**
   * Run `fn` as an API role inside a transaction (rolled back afterwards, so a
   * role test never leaves state behind). `sub` becomes auth.uid().
   */
  asRole<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, fn: (tx: TxLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface TxLike {
  q<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

const PARSERS = {
  [types.DATE]: (x: string) => x,
  [types.TIMESTAMPTZ]: (x: string) => new Date(x).toISOString(),
};

export async function bootDatabase(opts: BootOptions = {}): Promise<Db> {
  const pg = new PGlite({ parsers: PARSERS });
  await pg.exec(SUPABASE_BOOTSTRAP);
  await pg.exec(buildTablesSql());

  // Live indexes that are not already there as constraint-backed indexes.
  for (const ix of fixture.indexes.filter((i) => MONEY_TABLES.has(i.table))) {
    const exists = await pg.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [ix.name]);
    if (exists.rows.length === 0) await pg.exec(ix.def + ";");
  }

  await pg.exec(STUBS);
  await pg.exec(liveFunctionsSql);
  for (const t of fixture.triggers.filter((x) => MONEY_TABLES.has(x.table))) await pg.exec(t.def + ";");
  await pg.exec(buildPoliciesSql());
  // Supabase grants these to the API roles (default privileges already did).
  await pg.exec(`GRANT EXECUTE ON FUNCTION public.get_user_tenant_id(), public.is_super_admin() TO anon, authenticated, service_role;`);

  const migrations = opts.migrations === undefined ? MIGRATION_FILES : opts.migrations;
  if (migrations !== false) {
    for (const file of migrations) {
      const sql = readFileSync(migrationPath(file), "utf8");
      try {
        await pg.exec(sql);
      } catch (e) {
        throw new Error(`migration ${file} failed to apply: ${(e as Error).message}`);
      }
    }
    if (migrations.includes("20260925120100_payment_plans.sql")) await pg.exec(TEST_CLOCK);
  }
  return wrap(pg);
}

let template: Promise<File | Blob> | null = null;

/**
 * A fresh, fully-migrated database in well under a second: the first call
 * builds one (bootDatabase) and keeps its data directory; every call loads a
 * private copy of it. Each scenario run gets its own untouched database.
 */
export async function cloneDatabase(): Promise<Db> {
  if (!template) {
    template = (async () => {
      const db = await bootDatabase();
      const dump = await db.pg.dumpDataDir("none");
      await db.close();
      return dump;
    })();
  }
  const pg = new PGlite({ loadDataDir: await template, parsers: PARSERS });
  await pg.exec(`SET timezone = 'UTC'`);
  return wrap(pg);
}

function wrap(pg: PGlite): Db {
  const q = async <T,>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows;
  return {
    pg,
    q,
    one: async <T,>(sql: string, params?: unknown[]) => (await q<T>(sql, params))[0],
    exec: async (sql: string) => {
      await pg.exec(sql);
    },
    setNow: async (iso: string | null) => {
      await pg.query(`SELECT set_config('pp_test.now', $1, false)`, [iso ?? ""]);
    },
    asRole: async <T,>(role: string, sub: string | null, fn: (tx: TxLike) => Promise<T>) => {
      let result: T | undefined;
      let failure: unknown;
      const ROLLBACK = new Error("__rollback__");
      try {
        await pg.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE ${ident(role)}`);
          await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
            sub ? JSON.stringify({ sub, role }) : "",
          ]);
          try {
            result = await fn({ q: async (sql, params) => (await tx.query<any>(sql, params as any[])).rows });
          } catch (e) {
            failure = e;
          }
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }
      if (failure) throw failure;
      return result as T;
    },
    close: async () => {
      await pg.close();
    },
  };
}

// ─── Seeds ────────────────────────────────────────────────────────────────

export interface SeedCharge {
  category: string;
  amountCents: number;
  dueDate: string;
  reference?: string | null;
}

export interface SeededRental {
  tenantId: string;
  customerId: string;
  vehicleId: string;
  rentalId: string;
  chargeIds: string[];
}

let seedCounter = 0;

/** A tenant (optional: reuse one), customer, vehicle, rental and its ledger charges. */
export async function seedRental(
  db: Db,
  opts: {
    tenantId?: string;
    timezone?: string;
    startDate?: string;
    endDate?: string;
    /** Shorthand: one 'Rental' charge of this many cents, due on startDate. */
    owedCents?: number;
    charges?: SeedCharge[];
    withVehicle?: boolean;
  } = {},
): Promise<SeededRental> {
  seedCounter += 1;
  const n = seedCounter;
  const startDate = opts.startDate ?? "2026-10-02";
  let tenantId = opts.tenantId;
  if (!tenantId) {
    tenantId = (await db.one<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, timezone) VALUES ($1, $2, $3) RETURNING id`,
      [`t${n}`, `Tenant ${n}`, opts.timezone ?? "America/New_York"],
    ))!.id;
  }
  const customerId = (await db.one<{ id: string }>(
    `INSERT INTO customers (type, name, tenant_id) VALUES ('Individual', $1, $2) RETURNING id`,
    [`Customer ${n}`, tenantId],
  ))!.id;
  const vehicleId =
    opts.withVehicle === false
      ? null
      : (await db.one<{ id: string }>(`INSERT INTO vehicles (reg, tenant_id) VALUES ($1, $2) RETURNING id`, [`REG${n}`, tenantId]))!.id;
  const rentalId = (await db.one<{ id: string }>(
    `INSERT INTO rentals (customer_id, vehicle_id, tenant_id, start_date, end_date, monthly_amount, status)
     VALUES ($1, $2, $3, $4, $5, 0, 'Active') RETURNING id`,
    [customerId, vehicleId, tenantId, startDate, opts.endDate ?? null],
  ))!.id;

  const charges: SeedCharge[] = opts.charges ?? (opts.owedCents ? [{ category: "Rental", amountCents: opts.owedCents, dueDate: startDate }] : []);
  const chargeIds: string[] = [];
  for (const [i, c] of charges.entries()) {
    const row = await db.one<{ id: string }>(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category,
                                   amount, remaining_amount, reference)
       VALUES ($1, $2, $3, $4, $5, $5, 'Charge', $6, $7::numeric / 100, $7::numeric / 100, $8) RETURNING id`,
      [customerId, rentalId, vehicleId, tenantId, c.dueDate, c.category, c.amountCents, c.reference ?? `seed-${n}-${i}`],
    );
    chargeIds.push(row!.id);
  }
  return { tenantId: tenantId!, customerId, vehicleId: vehicleId as string, rentalId, chargeIds };
}

/** An ordinary captured payment on a rental (status 'Completed' → the live FIFO trigger applies it). */
export async function insertCompletedPayment(
  db: Db,
  r: Pick<SeededRental, "tenantId" | "customerId" | "rentalId"> & { vehicleId?: string | null },
  amountCents: number,
  paymentDate = "2026-10-02",
  extra: { method?: string; booking_source?: string; target_categories?: string[] } = {},
): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO payments (customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, method,
                           payment_type, status, booking_source, target_categories)
     VALUES ($1, $2, $3, $4, $5::numeric / 100, $5::numeric / 100, $6, $7, 'Payment', 'Completed', $8, $9) RETURNING id`,
    [
      r.customerId, r.rentalId, r.vehicleId ?? null, r.tenantId, amountCents, paymentDate, extra.method ?? "Cash",
      extra.booking_source ?? "admin", extra.target_categories ? JSON.stringify(extra.target_categories) : null,
    ],
  );
  return row!.id;
}

/** Numeric column → integer cents, exactly (no float math on the way). */
export function toCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

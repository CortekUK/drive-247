/**
 * The e2e runner's migration on REAL Postgres (PGlite — Postgres compiled to
 * WASM, in this process; no network, no production), plus the catalogue's
 * Finances tie-outs checked against the LIVE FIFO function bodies.
 *
 * What it proves, offline:
 *   1. supabase/migrations/20260926120300_dev_sim_runs.sql applies on top of
 *      the live schema fixture and the payment-plan migrations;
 *   2. e2e_register_fixture refuses every rental that is not a brand-new,
 *      marked, money-free northwind rental on a fixture customer — and
 *      refuses a run on any other tenant or on live Stripe;
 *   3. e2e_fixture_guard re-reads northwind + TEST mode on every call;
 *   4. e2e_shift_fixture moves ONLY the fixture's driving columns, by exactly
 *      the asked amount, and refuses everything outside its allow-list;
 *   5. RLS: northwind staff read their runs, other tenants see none, anon
 *      reads nothing, nobody but service_role writes or executes;
 *   6. the SQL-settled part of the catalogue's tie-outs (a booking paid by
 *      card, an extension paid by its link, an auto-extend renewal, a payment
 *      plan run by the real engine) comes out of the live FIFO exactly as the
 *      hand-derived numbers say.
 * The edge functions, Stripe, and the webhooks are NOT here — that is the live
 * tier (docs/E2E_TESTING.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDatabase, insertCompletedPayment, MIGRATION_FILES, seedRental, type Db } from "../payment-plans/harness/pglite";
import { compareTieOut, type Snapshot } from "./scenarios/observe.ts";
import { findScenario } from "./scenarios/index.ts";
import type { FinanceExpectation, Step } from "./scenarios/types.ts";

const MIGRATION = "20260926120300_dev_sim_runs.sql";
let db: Db;

beforeAll(async () => {
  db = await bootDatabase({ migrations: [...MIGRATION_FILES, MIGRATION] });
}, 240_000);
afterAll(async () => {
  await db?.close();
});

// ─── Seeds ──────────────────────────────────────────────────────────────────

let n = 0;
const one = async <T = Record<string, any>>(sql: string, params?: unknown[]) => (await db.one<T>(sql, params))!;

async function tenant(slug: string, mode = "test"): Promise<string> {
  const existing = await db.one<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  if (existing) return existing.id;
  return (await one<{ id: string }>(`INSERT INTO tenants (slug, company_name, timezone, stripe_mode, status) VALUES ($1, $1, 'America/New_York', $2, 'active') RETURNING id`, [slug, mode])).id;
}

async function newRun(tenantId: string, status = "running"): Promise<string> {
  const waiting = status === "waiting" ? `'{"stepIndex":1}'::jsonb` : "NULL";
  const finished = ["passed", "failed", "errored", "aborted"].includes(status) ? "now()" : "NULL";
  return (await one<{ id: string }>(`INSERT INTO dev_sim_runs (tenant_id, scenario_id, scenario, status, waiting_for, finished_at) VALUES ($1, 'SB1', '{}'::jsonb, $2, ${waiting}, ${finished}) RETURNING id`, [tenantId, status])).id;
}

async function fixtureRental(
  tenantId: string,
  runId: string,
  over: { name?: string; email?: string; phone?: string | null; marker?: Record<string, unknown> | null } = {},
): Promise<{ rentalId: string; customerId: string }> {
  n += 1;
  const customerId = (
    await one<{ id: string }>(`INSERT INTO customers (type, name, email, phone, tenant_id) VALUES ('Individual', $1, $2, $3, $4) RETURNING id`, [
      over.name ?? `E2E-FIXTURE SB1 ${n}`,
      over.email ?? `e2e-${n}@e2e.drive247.test`,
      over.phone === undefined ? null : over.phone,
      tenantId,
    ])
  ).id;
  const marker = over.marker === undefined ? { e2e_fixture: true, run_id: runId } : over.marker;
  const rentalId = (
    await one<{ id: string }>(
      `INSERT INTO rentals (customer_id, tenant_id, start_date, end_date, monthly_amount, status, creation_context,
                            payg_start_ts, payg_next_accrual_at, auto_extend_next_charge_at)
       VALUES ($1, $2, '2026-10-01', '2026-10-08', 100, 'Active', $3::jsonb,
               '2026-10-01T14:00:00Z', '2026-10-01T14:00:00Z', '2026-10-08T00:00:00Z') RETURNING id`,
      [customerId, tenantId, marker === null ? null : JSON.stringify(marker)],
    )
  ).id;
  return { rentalId, customerId };
}

const register = (runId: string, rentalId: string) => db.q(`SELECT public.e2e_register_fixture($1, $2)`, [runId, rentalId]);

// ─── 1–4: the functions ─────────────────────────────────────────────────────

describe("the migration applies", () => {
  it("creates the three tables and four functions", async () => {
    const t = await db.q<{ relname: string }>(`SELECT relname FROM pg_class WHERE relname IN ('dev_sim_runs','dev_sim_run_steps','dev_sim_fixtures') ORDER BY relname`);
    expect(t.map((r) => r.relname)).toEqual(["dev_sim_fixtures", "dev_sim_run_steps", "dev_sim_runs"]);
    const f = await db.q<{ proname: string }>(`SELECT proname FROM pg_proc WHERE proname LIKE 'e2e\\_%' ORDER BY proname`);
    expect(f.map((r) => r.proname)).toEqual(["e2e_fixture_guard", "e2e_lease_run", "e2e_register_fixture", "e2e_shift_fixture"]);
  });
  it("a waiting run must say what it waits for; a finished run must say when", async () => {
    const nw = await tenant("northwind");
    await expect(db.q(`INSERT INTO dev_sim_runs (tenant_id, scenario_id, scenario, status) VALUES ($1, 'x', '{}', 'waiting')`, [nw])).rejects.toThrow(/waiting_has_ask/);
    await expect(db.q(`INSERT INTO dev_sim_runs (tenant_id, scenario_id, scenario, status) VALUES ($1, 'x', '{}', 'passed')`, [nw])).rejects.toThrow(/finished_when_terminal/);
  });
});

describe("e2e_register_fixture — the only door into dev_sim_fixtures", () => {
  it("accepts a brand-new, marked, money-free northwind rental on a fixture customer — once", async () => {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    const f = await fixtureRental(nw, run);
    await register(run, f.rentalId);
    expect(await db.q(`SELECT rental_id FROM dev_sim_fixtures WHERE run_id = $1`, [run])).toEqual([{ rental_id: f.rentalId }]);
    await expect(register(run, f.rentalId)).rejects.toThrow(/duplicate key/);
    await expect(db.q(`UPDATE dev_sim_fixtures SET created_at = now() WHERE run_id = $1`, [run])).rejects.toThrow(/immutable/);
  });

  it("refuses a rental that is not marked, or marked for another run", async () => {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    const unmarked = await fixtureRental(nw, run, { marker: null });
    await expect(register(run, unmarked.rentalId)).rejects.toThrow(/not marked/);
    const other = await fixtureRental(nw, run, { marker: { e2e_fixture: true, run_id: "00000000-0000-4000-8000-000000000000" } });
    await expect(register(run, other.rentalId)).rejects.toThrow(/not marked/);
  });

  it("refuses a customer a message could reach", async () => {
    const nw = await tenant("northwind");
    for (const over of [{ email: "someone@gmail.com" }, { phone: "+15555550100" }, { name: "Abu Bakr" }]) {
      const run = await newRun(nw);
      const f = await fixtureRental(nw, run, over);
      await expect(register(run, f.rentalId), JSON.stringify(over)).rejects.toThrow(/not a fixture customer/);
    }
  });

  it("refuses an existing rental (older than 10 minutes) and one that has taken money", async () => {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    const old = await fixtureRental(nw, run);
    await db.q(`UPDATE rentals SET created_at = now() - interval '11 minutes' WHERE id = $1`, [old.rentalId]);
    await expect(register(run, old.rentalId)).rejects.toThrow(/older than 10 minutes/);
    const run2 = await newRun(nw);
    const paid = await fixtureRental(nw, run2);
    await db.q(`INSERT INTO payments (customer_id, rental_id, tenant_id, amount, payment_date, status) VALUES ($1, $2, $3, 1, '2026-10-01', 'Pending')`, [paid.customerId, paid.rentalId, nw]);
    await expect(register(run2, paid.rentalId)).rejects.toThrow(/already has payments/);
  });

  it("refuses a run on any tenant but northwind, and northwind in live mode", async () => {
    const other = await tenant("revtek");
    const run = await newRun(other);
    const f = await fixtureRental(other, run);
    await expect(register(run, f.rentalId)).rejects.toThrow(/only northwind in Stripe TEST mode/);

    const nw = await tenant("northwind");
    const run2 = await newRun(nw);
    const f2 = await fixtureRental(nw, run2);
    await db.q(`UPDATE tenants SET stripe_mode = 'live' WHERE id = $1`, [nw]);
    try {
      await expect(register(run2, f2.rentalId)).rejects.toThrow(/only northwind in Stripe TEST mode/);
    } finally {
      await db.q(`UPDATE tenants SET stripe_mode = 'test' WHERE id = $1`, [nw]);
    }
  });

  it("refuses a rental of another tenant even on a northwind run", async () => {
    const nw = await tenant("northwind");
    const other = await tenant("revtek");
    const run = await newRun(nw);
    const f = await fixtureRental(other, run);
    await expect(register(run, f.rentalId)).rejects.toThrow(/not northwind's/);
  });
});

describe("e2e_fixture_guard — re-read on every call", () => {
  it("returns the fixture while northwind is in TEST mode and the run is live; refuses otherwise", async () => {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    const f = await fixtureRental(nw, run);
    await register(run, f.rentalId);
    expect((await one<{ r: string }>(`SELECT public.e2e_fixture_guard($1) r`, [run])).r).toBe(f.rentalId);

    await db.q(`UPDATE tenants SET stripe_mode = 'live' WHERE id = $1`, [nw]);
    try {
      await expect(db.q(`SELECT public.e2e_fixture_guard($1)`, [run])).rejects.toThrow(/not in Stripe TEST mode/);
    } finally {
      await db.q(`UPDATE tenants SET stripe_mode = 'test' WHERE id = $1`, [nw]);
    }
    await db.q(`UPDATE customers SET phone = '+15555550100' WHERE id = $1`, [f.customerId]);
    await expect(db.q(`SELECT public.e2e_fixture_guard($1)`, [run])).rejects.toThrow(/not a fixture customer/);
    await db.q(`UPDATE customers SET phone = NULL WHERE id = $1`, [f.customerId]);
    await db.q(`UPDATE dev_sim_runs SET status = 'passed', finished_at = now() WHERE id = $1`, [run]);
    await expect(db.q(`SELECT public.e2e_fixture_guard($1)`, [run])).rejects.toThrow(/is passed, not running/);
  });
  it("refuses a run with no registered fixture", async () => {
    const run = await newRun(await tenant("northwind"));
    await expect(db.q(`SELECT public.e2e_fixture_guard($1)`, [run])).rejects.toThrow(/no registered fixture/);
  });
});

describe("e2e_shift_fixture — sim_shift for ONE fixture", () => {
  async function registered() {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    const f = await fixtureRental(nw, run);
    await register(run, f.rentalId);
    // A bystander with identical dates on the same tenant — must never move.
    const by = await fixtureRental(nw, run, { marker: null });
    return { run, ...f, bystander: by.rentalId };
  }
  const rentalRow = (id: string) => one(`SELECT start_date::text s, end_date::text e, payg_next_accrual_at, payg_start_ts, auto_extend_next_charge_at FROM rentals WHERE id = $1`, [id]);

  it("payg: 3 days moves exactly the fixture's PAYG clock and start date back 3 days", async () => {
    const { run, rentalId, bystander } = await registered();
    const rows = await one<{ n: number }>(`SELECT public.e2e_shift_fixture($1, 'payg', 3 * 1440) n`, [run]);
    expect(rows.n).toBe(1);
    const r = await rentalRow(rentalId);
    expect(r).toMatchObject({ s: "2026-09-28", payg_next_accrual_at: "2026-09-28T14:00:00.000Z", payg_start_ts: "2026-09-28T14:00:00.000Z", e: "2026-10-08" });
    expect(await rentalRow(bystander)).toMatchObject({ s: "2026-10-01", payg_next_accrual_at: "2026-10-01T14:00:00.000Z" });
  });

  it("auto_extend: moves the renewal clock, end_date, and its extensions' asked-at times", async () => {
    const { run, rentalId, bystander } = await registered();
    const nw = await tenant("northwind");
    await db.q(`INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number, status, created_at) VALUES ($1, $2, 1, 'approved', '2026-10-08T00:10:00Z')`, [rentalId, nw]);
    await db.q(`SELECT public.e2e_shift_fixture($1, 'auto_extend', 1440)`, [run]);
    expect(await rentalRow(rentalId)).toMatchObject({ e: "2026-10-07", auto_extend_next_charge_at: "2026-10-07T00:00:00.000Z", s: "2026-10-01" });
    expect((await one(`SELECT created_at FROM rental_extensions WHERE rental_id = $1`, [rentalId])).created_at).toBe("2026-10-07T00:10:00.000Z");
    expect(await rentalRow(bystander)).toMatchObject({ e: "2026-10-08", auto_extend_next_charge_at: "2026-10-08T00:00:00.000Z" });
  });

  it("refuses: an unknown domain, zero, more than 60 days, part-days on date columns, nothing to move", async () => {
    const { run } = await registered();
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'rentals', 1440)`, [run])).rejects.toThrow(/not allow-listed/);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'payg', 0)`, [run])).rejects.toThrow(/out of bounds/);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'payg', 61 * 1440)`, [run])).rejects.toThrow(/out of bounds/);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'payg', 90)`, [run])).rejects.toThrow(/whole days only/);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'payment_plan', 1440)`, [run])).rejects.toThrow(/moved no rows/);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'plan_attempts', 11)`, [run])).rejects.toThrow(/moved no rows/);
  });

  it("refuses a run whose fixture was never registered", async () => {
    const nw = await tenant("northwind");
    const run = await newRun(nw);
    await fixtureRental(nw, run);
    await expect(db.q(`SELECT public.e2e_shift_fixture($1, 'payg', 1440)`, [run])).rejects.toThrow(/no registered fixture/);
  });
});

describe("e2e_lease_run — one request per run", () => {
  it("leases once; another token waits; the holder renews; an expired lease is taken over", async () => {
    const run = await newRun(await tenant("northwind"));
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const lease = async (t: string) => (await one<{ ok: boolean }>(`SELECT public.e2e_lease_run($1, $2, 60) ok`, [run, t])).ok;
    expect(await lease(a)).toBe(true);
    expect(await lease(b)).toBe(false);
    expect(await lease(a)).toBe(true);
    await db.q(`UPDATE dev_sim_runs SET lease_until = now() - interval '1 second' WHERE id = $1`, [run]);
    expect(await lease(b)).toBe(true);
    await db.q(`UPDATE dev_sim_runs SET status = 'aborted', finished_at = now() WHERE id = $1`, [run]);
    expect(await lease(a)).toBe(false);
  });
});

// ─── 5: RLS ─────────────────────────────────────────────────────────────────

describe("RLS — staff read their tenant's runs; only service_role writes", () => {
  const NW_STAFF = "aaaaaaaa-0000-4000-8000-00000000000a";
  const OTHER_STAFF = "bbbbbbbb-0000-4000-8000-00000000000b";
  const SUPER = "cccccccc-0000-4000-8000-00000000000c";
  let run: string;

  beforeAll(async () => {
    const nw = await tenant("northwind");
    const other = await tenant("revtek");
    run = await newRun(nw);
    await db.q(`INSERT INTO dev_sim_run_steps (run_id, tenant_id, step_index, kind, status) VALUES ($1, $2, 0, 'check', 'ok')`, [run, nw]);
    await db.q(
      `INSERT INTO app_users (auth_user_id, email, role, tenant_id, is_super_admin) VALUES
         ($1, 'hq@northwind.test', 'head_admin', $4, false),
         ($2, 'hq@revtek.test', 'head_admin', $5, false),
         ($3, 'root@drive247.test', 'admin', NULL, true)`,
      [NW_STAFF, OTHER_STAFF, SUPER, nw, other],
    );
  });

  it("northwind staff see northwind's runs and steps; another tenant's staff see none; a super admin sees them", async () => {
    const see = (sub: string) => db.asRole("authenticated", sub, async (tx) => ({
      runs: (await tx.q(`SELECT id FROM dev_sim_runs WHERE id = $1`, [run])).length,
      steps: (await tx.q(`SELECT id FROM dev_sim_run_steps WHERE run_id = $1`, [run])).length,
    }));
    expect(await see(NW_STAFF)).toEqual({ runs: 1, steps: 1 });
    expect(await see(OTHER_STAFF)).toEqual({ runs: 0, steps: 0 });
    expect(await see(SUPER)).toEqual({ runs: 1, steps: 1 });
  });

  it("anon reads nothing at all", async () => {
    await expect(db.asRole("anon", null, (tx) => tx.q(`SELECT id FROM dev_sim_runs`))).rejects.toThrow(/permission denied/);
  });

  it("staff cannot write a run, a step or a fixture marker, nor execute the functions", async () => {
    const nw = await tenant("northwind");
    await expect(db.asRole("authenticated", NW_STAFF, (tx) => tx.q(`INSERT INTO dev_sim_runs (tenant_id, scenario_id, scenario) VALUES ($1, 'x', '{}')`, [nw]))).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", NW_STAFF, (tx) => tx.q(`UPDATE dev_sim_runs SET status = 'passed' WHERE id = $1`, [run]))).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", NW_STAFF, (tx) => tx.q(`DELETE FROM dev_sim_run_steps WHERE run_id = $1`, [run]))).rejects.toThrow(/permission denied/);
    for (const call of [`SELECT public.e2e_fixture_guard('${run}')`, `SELECT public.e2e_shift_fixture('${run}', 'payg', 1440)`, `SELECT public.e2e_register_fixture('${run}', '${run}')`, `SELECT public.e2e_lease_run('${run}', '${run}', 60)`]) {
      await expect(db.asRole("authenticated", NW_STAFF, (tx) => tx.q(call)), call).rejects.toThrow(/permission denied for function/);
    }
  });

  it("service_role can do all of it", async () => {
    const nw = await tenant("northwind");
    const id = await db.asRole("service_role", null, async (tx) => (await tx.q<{ id: string }>(`INSERT INTO dev_sim_runs (tenant_id, scenario_id, scenario) VALUES ($1, 'x', '{}') RETURNING id`, [nw]))[0].id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── 6: the catalogue's tie-outs against the live FIFO ─────────────────────

/** The same rows the runner's takeSnapshot reads, from PGlite. */
async function pgSnapshot(d: Db, rentalId: string, today: string): Promise<Snapshot> {
  const rental = await d.one(`SELECT * FROM rentals WHERE id = $1`, [rentalId]);
  const ledger = await d.q(`SELECT id, type, category, amount, remaining_amount, due_date::text due_date, customer_id, extension_id FROM ledger_entries WHERE rental_id = $1`, [rentalId]);
  const payments = await d.q(`SELECT id, amount, refund_amount, status, capture_status, payment_type, stripe_checkout_session_id, payment_plan_occurrence_id FROM payments WHERE rental_id = $1`, [rentalId]);
  const applications = await d.q(`SELECT payment_id, charge_entry_id, amount_applied FROM payment_applications WHERE charge_entry_id IN (SELECT id FROM ledger_entries WHERE rental_id = $1)`, [rentalId]);
  const extensions = await d.q(`SELECT id, sequence_number, status, extension_days, total_amount FROM rental_extensions WHERE rental_id = $1`, [rentalId]);
  return {
    takenAt: `${today}T15:00:00.000Z`,
    today,
    originalEndDate: String(rental?.end_date ?? today),
    endDateShiftDays: 0,
    rental: rental ?? null,
    ledger: ledger as never,
    payments: payments as never,
    applications: applications as never,
    extensions: extensions as never,
    accruals: [],
    installments: [],
    plan: null,
    occurrences: [],
    attempts: [],
    stripeIntents: null,
  };
}

function tieOutOf(id: string, label?: string): FinanceExpectation {
  const s = findScenario(id)!;
  const steps = s.steps.filter((st): st is Extract<Step, { kind: "tie_out" }> => st.kind === "tie_out");
  const t = label ? steps.find((st) => st.label === label) : steps.at(-1);
  if (!t) throw new Error(`${id} has no tie-out ${label ?? ""}`);
  return t.expect;
}

const failures = (r: { label: string; pass: boolean; expected: unknown; actual: unknown }[]) => r.filter((a) => !a.pass).map((a) => `${a.label}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`);

/** A payment the way charge-saved-card / the auto-extend clone / the extension webhook insert it: 'Completed', so the live FIFO trigger allocates it. */
async function extensionPayment(d: Db, r: { tenantId: string; customerId: string; rentalId: string }, extensionId: string, cents: number) {
  await d.q(
    `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_date, method, payment_type, status, booking_source, extension_id, target_categories)
     VALUES ($1, $2, $3, $4::numeric / 100, $4::numeric / 100, '2026-10-05', 'Card', 'Payment', 'Completed', 'website', $5,
             '["Extension Rental","Extension Tax","Extension Service Fee","Extension Insurance"]'::jsonb)`,
    [r.customerId, r.rentalId, r.tenantId, cents, extensionId],
  );
}

describe("the catalogue's tie-outs, on the live FIFO", () => {
  it("SB1: a $300.00 booking paid by card ties out as hand-derived", async () => {
    const r = await seedRental(db, { startDate: "2026-10-05", charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-05" }], withVehicle: false });
    expect(failures(compareTieOut("before", tieOutOf("SB1", "before payment"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
    await insertCompletedPayment(db, r, 30000, "2026-10-05", { method: "Card" });
    expect(failures(compareTieOut("after", tieOutOf("SB1"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
  });

  it("MX1/MX2: the extension's own bill — unpaid, then paid by its link — ties out as hand-derived", async () => {
    const r = await seedRental(db, { startDate: "2026-10-05", endDate: "2026-10-08", charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-05" }], withVehicle: false });
    await insertCompletedPayment(db, r, 30000, "2026-10-05", { method: "Card" });
    const ext = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number, status, previous_end_date, new_end_date, extension_days, rental_amount)
       VALUES ($1, $2, 1, 'approved', '2026-10-08', '2026-10-10', 2, 200) RETURNING id`,
      [r.rentalId, r.tenantId],
    ))!.id;
    await db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, extension_id, reference)
       VALUES ($1, $2, $3, '2026-10-05', '2026-10-10', 'Charge', 'Extension Rental', 200, 200, $4, 'Extension #1: 2 days')`,
      [r.customerId, r.rentalId, r.tenantId, ext],
    );
    expect(failures(compareTieOut("unpaid", tieOutOf("MX2"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
    await extensionPayment(db, r, ext, 20000);
    expect(failures(compareTieOut("paid", tieOutOf("MX1"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
  });

  it("AE1: a renewal paid by the saved card settles only its own charges", async () => {
    const r = await seedRental(db, { startDate: "2026-09-28", endDate: "2026-10-05", charges: [{ category: "Rental", amountCents: 35000, dueDate: "2026-09-28" }], withVehicle: false });
    await insertCompletedPayment(db, r, 35000, "2026-09-28", { method: "Card" });
    const ext = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number, status, previous_end_date, new_end_date, extension_days, rental_amount)
       VALUES ($1, $2, 1, 'approved', '2026-10-05', '2026-10-12', 7, 350) RETURNING id`,
      [r.rentalId, r.tenantId],
    ))!.id;
    await db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, extension_id, reference)
       VALUES ($1, $2, $3, '2026-10-05', '2026-10-12', 'Charge', 'Extension Rental', 350, 350, $4, 'Auto-extend #1: 7d')`,
      [r.customerId, r.rentalId, r.tenantId, ext],
    );
    expect(failures(compareTieOut("awaiting", tieOutOf("AE4", "renewal billed, link not paid"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
    await extensionPayment(db, r, ext, 35000);
    expect(failures(compareTieOut("renewed", tieOutOf("AE1"), await pgSnapshot(db, r.rentalId, "2026-10-05")))).toEqual([]);
  });

  it("PP-L1: the real plan engine's three payments (S1, on PGlite) tie out as hand-derived", async () => {
    const { SCENARIOS, runScenario } = await import("@fn/_shared/payment-plans/scenarios.ts");
    const { createPgliteContext, openDatabases } = await import("../payment-plans/harness/pglite-context");
    const S1 = SCENARIOS.find((s) => s.id === "S1")!;
    let ctxDb: Db | null = null;
    const run = await runScenario(S1, async () => {
      const c = await createPgliteContext();
      ctxDb = c.db;
      return c;
    });
    try {
      expect(run.pass, JSON.stringify(run.assertions.filter((a) => !a.pass))).toBe(true);
      const rentalId = (run.evidence as { plan: { rentalId: string } }).plan.rentalId;
      expect(failures(compareTieOut("complete", tieOutOf("PP-L1"), await pgSnapshot(ctxDb!, rentalId, "2026-10-20")))).toEqual([]);
    } finally {
      for (const d of openDatabases.splice(0)) await d.close();
    }
  }, 240_000);
});

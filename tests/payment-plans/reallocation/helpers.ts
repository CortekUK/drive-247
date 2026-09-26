/**
 * Shared seeds and readers for the reallocation evidence suite
 * (migration 20260926120100_payment_reallocation.sql).
 *
 * Every amount a test asserts is INTEGER CENTS read back through toCents —
 * never float arithmetic on numeric strings.
 */
import { insertCompletedPayment, seedRental, toCents, type Db, type SeededRental } from "../harness/pglite";

export { insertCompletedPayment, seedRental, toCents };
export type { Db, SeededRental };

let staffCounter = 0;

/** An app user. Default: an active head_admin of `tenantId`. */
export async function seedStaff(
  db: Db,
  tenantId: string | null,
  opts: { role?: string; superAdmin?: boolean; active?: boolean; name?: string } = {},
): Promise<string> {
  staffCounter += 1;
  const row = await db.one<{ id: string }>(
    `INSERT INTO app_users (auth_user_id, email, name, role, is_active, tenant_id, is_super_admin)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      `staff${staffCounter}@example.test`,
      opts.name ?? `Staff ${staffCounter}`,
      opts.role ?? "head_admin",
      opts.active ?? true,
      tenantId,
      opts.superAdmin ?? false,
    ],
  );
  return row!.id;
}

/** A second rental (own vehicle) for an EXISTING customer, with its charges. */
export async function seedSecondRental(
  db: Db,
  r: Pick<SeededRental, "tenantId" | "customerId">,
  charges: { category: string; amountCents: number; dueDate: string; reference?: string }[],
): Promise<{ rentalId: string; vehicleId: string; chargeIds: string[] }> {
  const vehicleId = (await db.one<{ id: string }>(
    `INSERT INTO vehicles (reg, tenant_id) VALUES ('R2-' || substr(gen_random_uuid()::text, 1, 8), $1) RETURNING id`,
    [r.tenantId],
  ))!.id;
  const rentalId = (await db.one<{ id: string }>(
    `INSERT INTO rentals (customer_id, vehicle_id, tenant_id, start_date, monthly_amount, status)
     VALUES ($1, $2, $3, '2026-10-10', 0, 'Active') RETURNING id`,
    [r.customerId, vehicleId, r.tenantId],
  ))!.id;
  const chargeIds: string[] = [];
  for (const [i, c] of charges.entries()) {
    chargeIds.push(
      (await db.one<{ id: string }>(
        `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category,
                                     amount, remaining_amount, reference)
         VALUES ($1, $2, $3, $4, $5, $5, 'Charge', $6, $7::numeric / 100, $7::numeric / 100, $8) RETURNING id`,
        [r.customerId, rentalId, vehicleId, r.tenantId, c.dueDate, c.category, c.amountCents, c.reference ?? `r2-${rentalId}-${i}`],
      ))!.id,
    );
  }
  return { rentalId, vehicleId, chargeIds };
}

/** One more charge on an existing rental. */
export async function addCharge(
  db: Db,
  r: Pick<SeededRental, "tenantId" | "customerId" | "rentalId" | "vehicleId">,
  c: { category: string; amountCents: number; dueDate: string; reference?: string; extensionId?: string | null },
): Promise<string> {
  return (await db.one<{ id: string }>(
    `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category,
                                 amount, remaining_amount, reference, extension_id)
     VALUES ($1, $2, $3, $4, $5, $5, 'Charge', $6, $7::numeric / 100, $7::numeric / 100, $8, $9) RETURNING id`,
    [r.customerId, r.rentalId, r.vehicleId, r.tenantId, c.dueDate, c.category, c.amountCents,
     c.reference ?? `add-${c.category}-${c.dueDate}-${Math.random().toString(36).slice(2, 8)}`, c.extensionId ?? null],
  ))!.id;
}

export type Target = [chargeId: string, cents: number];

export const targetsJson = (targets: Target[]) =>
  JSON.stringify(targets.map(([charge_entry_id, amount_cents]) => ({ charge_entry_id, amount_cents })));

/** payment_reallocate → the audit id. Throws the Postgres error. */
export async function reallocate(
  db: Db,
  paymentId: string,
  targets: Target[] | string,
  actor: string | null,
  reason = "moved to the right charge",
  note: string | null = null,
): Promise<string> {
  const row = await db.one<{ id: string }>(`SELECT payment_reallocate($1, $2::jsonb, $3, $4, $5) id`, [
    paymentId,
    typeof targets === "string" ? targets : targetsJson(targets),
    reason,
    note,
    actor,
  ]);
  return row!.id;
}

export async function recompute(db: Db, chargeId: string, actor: string | null, reason = "reconcile", note: string | null = null) {
  return (await db.one<{ id: string }>(`SELECT charge_recompute_remaining($1, $2, $3, $4) id`, [chargeId, reason, actor, note]))!.id;
}

export async function reconcileOptions(db: Db, rentalId: string, extensionId: string | null = null): Promise<any> {
  return (await db.one<{ o: any }>(`SELECT bill_reconcile_options($1, $2) o`, [rentalId, extensionId]))!.o;
}

/** Postgres' own answer to a call: "ok", or its SQLSTATE and message. */
export async function outcome(fn: () => Promise<unknown>): Promise<"ok" | { code: string; message: string }> {
  try {
    await fn();
    return "ok";
  } catch (e: any) {
    return { code: e?.code, message: e?.message };
  }
}

/** The refusal code the functions put first in every message. */
export async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const o = await outcome(fn);
  if (o === "ok") return "ok";
  const m = o.message.match(/^([a-z_]+): /);
  return m ? `${o.code} ${m[1]}` : `${o.code} (unprefixed) ${o.message}`;
}

export async function paymentState(db: Db, paymentId: string) {
  const p = await db.one<any>(`SELECT status, remaining_amount, target_categories FROM payments WHERE id = $1`, [paymentId]);
  return { status: p.status as string, remainingCents: toCents(p.remaining_amount), targetCategories: p.target_categories };
}

/** charge id → cents this payment has on it. */
export async function applications(db: Db, paymentId: string): Promise<Record<string, number>> {
  const rows = await db.q<{ charge_entry_id: string; amount_applied: string }>(
    `SELECT charge_entry_id, amount_applied FROM payment_applications WHERE payment_id = $1`,
    [paymentId],
  );
  return Object.fromEntries(rows.map((r) => [r.charge_entry_id, toCents(r.amount_applied)]));
}

export async function remainingCents(db: Db, chargeId: string): Promise<number> {
  return toCents((await db.one<{ r: string }>(`SELECT remaining_amount r FROM ledger_entries WHERE id = $1`, [chargeId]))!.r);
}

/** Revenue in cents per P&L category, for one tenant. */
export async function revenueByCategory(db: Db, tenantId: string): Promise<Record<string, number>> {
  const rows = await db.q<{ category: string; amount: string }>(
    `SELECT category, sum(amount) amount FROM pnl_entries WHERE tenant_id = $1 AND side = 'Revenue' GROUP BY category ORDER BY category`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((r) => [r.category, toCents(r.amount)]));
}

/** The P&L row the live FIFO keys by (payment, charge), or null. */
export async function pnlRow(db: Db, paymentId: string, chargeId: string) {
  const row = await db.one<any>(
    `SELECT category, amount, vehicle_id, tenant_id, entry_date, side FROM pnl_entries WHERE source_ref = $1`,
    [`${paymentId}_${chargeId}`],
  );
  return row ? { ...row, amount: toCents(row.amount) } : null;
}

/**
 * Every row of every table a reallocation, recompute or reconcile could touch,
 * in a stable order — for "nothing changed" assertions. updated_at columns are
 * dropped (a rolled-back write never reaches them anyway, but an ordinary
 * no-op read must not be confused by them).
 */
export async function everything(db: Db): Promise<Record<string, unknown[]>> {
  const tables: Record<string, string> = {
    payments: `SELECT id, status, amount, remaining_amount, refund_amount, target_categories, rental_id FROM payments ORDER BY id`,
    ledger_entries: `SELECT id, amount, remaining_amount, category FROM ledger_entries ORDER BY id`,
    payment_applications: `SELECT id, payment_id, charge_entry_id, amount_applied FROM payment_applications ORDER BY id`,
    pnl_entries: `SELECT id, vehicle_id, category, amount, source_ref, entry_date FROM pnl_entries ORDER BY id`,
    payment_allocation_changes: `SELECT id FROM payment_allocation_changes ORDER BY id`,
    fines: `SELECT id, status FROM fines ORDER BY id`,
  };
  const out: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(tables)) out[name] = await db.q(sql);
  return out;
}

/** The drift view's rows for one rental: charge id → drift cents. */
export async function driftRows(db: Db, rentalId: string): Promise<Record<string, number>> {
  const rows = await db.q<{ charge_entry_id: string; drift_amount: string }>(
    `SELECT charge_entry_id, drift_amount FROM v_ledger_allocation_drift WHERE rental_id = $1`,
    [rentalId],
  );
  return Object.fromEntries(rows.map((r) => [r.charge_entry_id, toCents(r.drift_amount)]));
}

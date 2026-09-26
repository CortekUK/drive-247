/**
 * Balance adjustments (migration 20260926120000_balance_adjustments.sql) on
 * real Postgres — the live money schema, live FIFO triggers and every earlier
 * payment-plans migration, in PGlite.
 *
 * Pinned:
 *   1. each operation writes its money row AND its audit row in one
 *      transaction — and the row-count asserts fire (a BEFORE trigger that
 *      swallows either insert makes the whole call fail and leaves nothing);
 *   2. the balance moves by exactly the amount (hand-derived below);
 *   3. append-only: no UPDATE, no direct DELETE/TRUNCATE, not even as owner;
 *      no API role can write; a customer delete still cascades;
 *   4. undo is a reversing entry (reverses_id), once, never of an undo;
 *   5. an off-platform payment is applied by the allocator EXACTLY like cash;
 *   6. who may do it, and the refusals that keep the number honest;
 *   7. the portal's reason lists are the SQL's lists.
 *
 * Every expected amount is written by hand from the fixture.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bootDatabase, insertCompletedPayment, migrationPath, MIGRATION_FILES, seedRental, toCents, type Db, type SeededRental } from "../harness/pglite";
import {
  REASON_CODES,
  UNDO_REASON_CODES,
  CORRECTION_DIRECTION,
  type AdjustmentKind,
} from "../../../apps/portal/src/components/balance/balance-words";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 90_000);
afterAll(async () => db?.close());

// ─── helpers ────────────────────────────────────────────────────────────────

async function outcome(sql: string, params: unknown[] = []): Promise<{ code: string; message: string } | "ok"> {
  try {
    await db.q(sql, params);
    return "ok";
  } catch (e: any) {
    return { code: e?.code, message: e?.message };
  }
}

async function staff(tenantId: string | null, opts: { role?: string; active?: boolean; superAdmin?: boolean; authId?: string } = {}) {
  const row = await db.one<{ id: string }>(
    `INSERT INTO app_users (auth_user_id, email, role, tenant_id, is_active, is_super_admin)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [opts.authId ?? null, `u${Math.random().toString(36).slice(2)}@x.test`, opts.role ?? "admin", tenantId, opts.active ?? true, opts.superAdmin ?? false],
  );
  return row!.id;
}

/** Σ remaining_amount over the customer's Charge rows — the ledger half of the shared balance rule. */
async function ledgerBalanceCents(customerId: string): Promise<number> {
  const r = await db.one<{ s: string }>(`SELECT COALESCE(sum(remaining_amount), 0)::text s FROM ledger_entries WHERE customer_id = $1 AND type = 'Charge'`, [customerId]);
  return toCents(r!.s);
}

const counts = async (customerId: string) => {
  const r = await db.one<{ l: number; a: number }>(
    `SELECT (SELECT count(*)::int FROM ledger_entries WHERE customer_id = $1) l,
            (SELECT count(*)::int FROM balance_adjustments WHERE customer_id = $1) a`,
    [customerId],
  );
  return r!;
};

const adjust = (
  r: Pick<SeededRental, "tenantId" | "customerId">,
  actor: string,
  kind: string,
  amount: string,
  reason: string,
  note: string,
  scope: { rentalId?: string | null; extensionId?: string | null; chargeId?: string | null } = {},
) =>
  db.one<{ j: any }>(
    `SELECT balance_adjust($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10) j`,
    [r.tenantId, r.customerId, actor, kind, amount, reason, note, scope.rentalId ?? null, scope.extensionId ?? null, scope.chargeId ?? null],
  ).then((x) => x!.j);

const adjustOutcome = (
  r: Pick<SeededRental, "tenantId" | "customerId">,
  actor: string,
  kind: string,
  amount: string,
  reason: string,
  note: string,
  scope: { rentalId?: string | null; extensionId?: string | null; chargeId?: string | null } = {},
) =>
  outcome(`SELECT balance_adjust($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10)`, [
    r.tenantId, r.customerId, actor, kind, amount, reason, note, scope.rentalId ?? null, scope.extensionId ?? null, scope.chargeId ?? null,
  ]);

const reverse = (r: Pick<SeededRental, "tenantId" | "customerId">, actor: string, id: string, reason = "entered_by_mistake", note = "typed the wrong one") =>
  db.one<{ j: any }>(`SELECT balance_adjustment_reverse($1, $2, $3, $4, $5, $6) j`, [r.tenantId, r.customerId, actor, id, reason, note]).then((x) => x!.j);
const reverseOutcome = (r: Pick<SeededRental, "tenantId" | "customerId">, actor: string, id: string, reason = "entered_by_mistake", note = "again") =>
  outcome(`SELECT balance_adjustment_reverse($1, $2, $3, $4, $5, $6)`, [r.tenantId, r.customerId, actor, id, reason, note]);

const recordOffPlatform = (r: Pick<SeededRental, "tenantId" | "customerId">, actor: string, paymentId: string, reason = "paid_in_person", note = "cash at the desk") =>
  db.one<{ j: any }>(`SELECT balance_record_off_platform_payment($1, $2, $3, $4, $5, $6) j`, [r.tenantId, r.customerId, actor, paymentId, reason, note]).then((x) => x!.j);
const recordOffPlatformOutcome = (r: Pick<SeededRental, "tenantId" | "customerId">, actor: string, paymentId: string) =>
  outcome(`SELECT balance_record_off_platform_payment($1, $2, $3, $4, 'paid_in_person', 'cash')`, [r.tenantId, r.customerId, actor, paymentId]);

/** A payment on the rental exactly as the portal's Record Payment inserts it, optionally off-platform. */
async function recordedPayment(r: SeededRental, amountCents: number, opts: { offPlatform: boolean; method: string }) {
  const row = await db.one<{ id: string }>(
    `INSERT INTO payments (customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, method,
                           payment_type, status, verification_status, booking_source, is_off_platform)
     VALUES ($1, $2, $3, $4, $5::numeric / 100, $5::numeric / 100, '2026-10-02', $6, 'Payment', 'Completed', 'approved', 'admin', $7)
     RETURNING id`,
    [r.customerId, r.rentalId, r.vehicleId, r.tenantId, amountCents, opts.method, opts.offPlatform],
  );
  return row!.id;
}

// ─── 1. schema ──────────────────────────────────────────────────────────────

describe("schema", () => {
  it("payments.is_off_platform is NOT NULL and defaults to false (every existing payment stays on-platform)", async () => {
    const col = await db.one<{ is_nullable: string; column_default: string }>(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'is_off_platform'`,
    );
    expect(col).toEqual({ is_nullable: "NO", column_default: "false" });
    const r = await seedRental(db, { owedCents: 1000 });
    const id = await insertCompletedPayment(db, r, 500);
    expect((await db.one<{ f: boolean }>(`SELECT is_off_platform f FROM payments WHERE id = $1`, [id]))!.f).toBe(false);
  });

  it("an off-platform payment can never carry a Stripe or Square handle", async () => {
    const r = await seedRental(db, { owedCents: 1000 });
    const res = await outcome(
      `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_type, status, is_off_platform, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 5, 5, 'Payment', 'Completed', true, 'pi_123')`,
      [r.customerId, r.rentalId, r.tenantId],
    );
    expect(res).toMatchObject({ code: "23514" });
  });

  it("no API role holds any write privilege on balance_adjustments; staff and service_role may read", async () => {
    const rows = await db.q<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'balance_adjustments' AND grantee IN ('anon','authenticated','service_role','PUBLIC')
        ORDER BY grantee, privilege_type`,
    );
    expect(rows).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
  });

  it("only service_role may EXECUTE the three writers", async () => {
    for (const fn of ["balance_adjust", "balance_record_off_platform_payment", "balance_adjustment_reverse"]) {
      const r = await db.one<{ auth: boolean; anon: boolean; svc: boolean }>(
        `SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth,
                bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) anon,
                bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')) svc
           FROM pg_proc p WHERE p.proname = $1`,
        [fn],
      );
      expect(r, fn).toEqual({ auth: false, anon: false, svc: true });
    }
  });
});

// ─── 2. goodwill and corrections move the balance by exactly the amount ─────

describe("balance_adjust — the ledger row and the audit row, together", () => {
  it("goodwill −30.00 on a 500.00 rental: one Adjustment charge (remaining −30.00), one audit row, balance 50000 → 47000", async () => {
    const r = await seedRental(db, { owedCents: 50000 });
    const actor = await staff(r.tenantId);
    expect(await ledgerBalanceCents(r.customerId)).toBe(50000);
    const before = await counts(r.customerId);

    const out = await adjust(r, actor, "goodwill", "-30.00", "late_delivery", "Car arrived two hours late", { rentalId: r.rentalId });

    expect(await counts(r.customerId)).toEqual({ l: before.l + 1, a: before.a + 1 });
    expect(await ledgerBalanceCents(r.customerId)).toBe(47000);
    const le = await db.one(`SELECT type, category, amount::text, remaining_amount::text, rental_id, vehicle_id, extension_id, reference FROM ledger_entries WHERE id = $1`, [out.ledger_entry_id]);
    expect(le).toMatchObject({ type: "Charge", category: "Adjustment", amount: "-30.00", remaining_amount: "-30.00", rental_id: r.rentalId, vehicle_id: r.vehicleId, extension_id: null });
    expect(le!.reference).toMatch(/^Car arrived two hours late · ADJ-[0-9a-f]{8}$/);
    const a = await db.one(`SELECT kind, amount::text, reason_code, note, rental_id, ledger_entry_id, payment_id, reverses_id, created_by FROM balance_adjustments WHERE id = $1`, [out.adjustment_id]);
    expect(a).toEqual({
      kind: "goodwill", amount: "-30.00", reason_code: "late_delivery", note: "Car arrived two hours late",
      rental_id: r.rentalId, ledger_entry_id: out.ledger_entry_id, payment_id: null, reverses_id: null, created_by: actor,
    });
  });

  it("goodwill on the customer ACCOUNT (no rental) moves the balance the same way", async () => {
    const r = await seedRental(db, { owedCents: 20000 });
    const actor = await staff(r.tenantId);
    const out = await adjust(r, actor, "goodwill", "-15.50", "loyalty", "Fifth rental with us");
    expect(await ledgerBalanceCents(r.customerId)).toBe(18450);
    expect((await db.one(`SELECT rental_id, vehicle_id FROM ledger_entries WHERE id = $1`, [out.ledger_entry_id]))).toEqual({ rental_id: null, vehicle_id: null });
  });

  it("a correction against an EXTENSION charge carries the rental and the extension", async () => {
    const r = await seedRental(db, { owedCents: 30000 });
    const actor = await staff(r.tenantId);
    const ext = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number) VALUES ($1, $2, 1) RETURNING id`, [r.rentalId, r.tenantId],
    ))!.id;
    const charge = (await db.one<{ id: string }>(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, extension_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1, $2, $3, $4, $5, '2026-10-05', '2026-10-05', 'Charge', 'Extension Rental', 200, 200, 'ext-1') RETURNING id`,
      [r.customerId, r.rentalId, r.vehicleId, r.tenantId, ext],
    ))!.id;
    const out = await adjust(r, actor, "charge_correction", "-25.00", "wrong_rate", "Weekly rate, not daily", { chargeId: charge });
    const le = await db.one(`SELECT rental_id, extension_id, amount::text FROM ledger_entries WHERE id = $1`, [out.ledger_entry_id]);
    expect(le).toEqual({ rental_id: r.rentalId, extension_id: ext, amount: "-25.00" });
    const a = await db.one(`SELECT rental_id, extension_id, target_charge_id FROM balance_adjustments WHERE id = $1`, [out.adjustment_id]);
    expect(a).toEqual({ rental_id: r.rentalId, extension_id: ext, target_charge_id: charge });
    // 300.00 rental + 200.00 extension − 25.00 = 475.00
    expect(await ledgerBalanceCents(r.customerId)).toBe(47500);
  });

  it("a credit can take a charge to zero, never below it (500.00 charge: 500.01 refused, 500.00 then 0.01 refused)", async () => {
    const r = await seedRental(db, { owedCents: 50000 });
    const actor = await staff(r.tenantId);
    const [charge] = r.chargeIds;
    expect(await adjustOutcome(r, actor, "charge_correction", "-500.01", "overcharged", "x", { chargeId: charge })).toMatchObject({
      code: "P0001", message: "That is more than the charge: at most 500.00 can be credited against it.",
    });
    await adjust(r, actor, "charge_correction", "-500.00", "duplicate_charge", "Charged twice", { chargeId: charge });
    expect(await adjustOutcome(r, actor, "charge_correction", "-0.01", "overcharged", "x", { chargeId: charge })).toMatchObject({
      code: "P0001", message: "That is more than the charge: at most 0.00 can be credited against it.",
    });
    expect(await ledgerBalanceCents(r.customerId)).toBe(0);
  });

  it("a DEBIT correction (charged too little) is settled by a later payment like any charge", async () => {
    // Rental 100.00 + Adjustment +20.00; a 120.00 cash payment clears both —
    // 'Adjustment' is reachable by the allocator since 20260925120000 (13.4).
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const out = await adjust(r, actor, "charge_correction", "20.00", "undercharged", "Forgot the child seat", { chargeId: r.chargeIds[0] });
    expect(await ledgerBalanceCents(r.customerId)).toBe(12000);
    await insertCompletedPayment(db, r, 12000);
    expect(await ledgerBalanceCents(r.customerId)).toBe(0);
    expect((await db.one<{ s: string }>(`SELECT amount_applied::text s FROM payment_applications WHERE charge_entry_id = $1`, [out.ledger_entry_id]))!.s).toBe("20.00");
  });

  it("a payment request is a positive Adjustment whose reference is what it is for", async () => {
    const r = await seedRental(db, { owedCents: 0 });
    const actor = await staff(r.tenantId);
    const out = await adjust(r, actor, "charge_correction", "300.00", "payment_request", "Parking ticket 12 Sep");
    const le = await db.one<{ amount: string; reference: string; rental_id: string | null }>(`SELECT amount::text, reference, rental_id FROM ledger_entries WHERE id = $1`, [out.ledger_entry_id]);
    expect(le!.amount).toBe("300.00");
    expect(le!.reference.startsWith("Parking ticket 12 Sep · ADJ-")).toBe(true);
    expect(await ledgerBalanceCents(r.customerId)).toBe(30000);
  });

  it("two same-day adjustments with the same words on the same rental do not collide", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    await adjust(r, actor, "goodwill", "-1.00", "goodwill", "Sorry", { rentalId: r.rentalId });
    await adjust(r, actor, "goodwill", "-1.00", "goodwill", "Sorry", { rentalId: r.rentalId });
    expect(await ledgerBalanceCents(r.customerId)).toBe(9800);
  });
});

// ─── 3. atomic, with the row counts asserted ───────────────────────────────

describe("atomic — both rows or neither, and the row-count asserts fire", () => {
  it("a swallowed LEDGER insert (BEFORE trigger returns NULL) fails the call and writes no audit row", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const before = await counts(r.customerId);
    await db.exec(`
      CREATE FUNCTION test_swallow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER test_swallow_ledger BEFORE INSERT ON ledger_entries FOR EACH ROW WHEN (NEW.category = 'Adjustment') EXECUTE FUNCTION test_swallow();`);
    try {
      expect(await adjustOutcome(r, actor, "goodwill", "-5.00", "goodwill", "x")).toMatchObject({
        code: "XX000", message: "balance_adjust: expected to write 1 ledger row, wrote 0",
      });
    } finally {
      await db.exec(`DROP TRIGGER test_swallow_ledger ON ledger_entries;`);
    }
    expect(await counts(r.customerId)).toEqual(before);
  });

  it("a swallowed AUDIT insert fails the call and rolls the ledger row back", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const before = await counts(r.customerId);
    await db.exec(`CREATE TRIGGER test_swallow_audit BEFORE INSERT ON balance_adjustments FOR EACH ROW EXECUTE FUNCTION test_swallow();`);
    try {
      expect(await adjustOutcome(r, actor, "goodwill", "-5.00", "goodwill", "x")).toMatchObject({
        code: "XX000", message: "balance_adjust: expected to write 1 audit row, wrote 0",
      });
      const p = await recordedPayment(r, 1000, { offPlatform: true, method: "Cash" });
      expect(await recordOffPlatformOutcome(r, actor, p)).toMatchObject({
        code: "XX000", message: "balance_record_off_platform_payment: expected to write 1 audit row, wrote 0",
      });
    } finally {
      await db.exec(`DROP TRIGGER test_swallow_audit ON balance_adjustments;`);
    }
    // the payment above is the only new ledger-free row; no Adjustment survived
    expect((await counts(r.customerId)).a).toBe(before.a);
    expect((await db.one<{ n: number }>(`SELECT count(*)::int n FROM ledger_entries WHERE customer_id = $1 AND category = 'Adjustment'`, [r.customerId]))!.n).toBe(0);
  });

  it("a failing audit insert (constraint) rolls the ledger row back too", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const before = await counts(r.customerId);
    await db.exec(`ALTER TABLE balance_adjustments ADD CONSTRAINT test_never CHECK (reason_code <> 'loyalty') NOT VALID;`);
    try {
      expect(await adjustOutcome(r, actor, "goodwill", "-5.00", "loyalty", "x")).toMatchObject({ code: "23514" });
    } finally {
      await db.exec(`ALTER TABLE balance_adjustments DROP CONSTRAINT test_never;`);
    }
    expect(await counts(r.customerId)).toEqual(before);
    expect(await ledgerBalanceCents(r.customerId)).toBe(10000);
  });
});

// ─── 4. append-only ─────────────────────────────────────────────────────────

describe("append-only", () => {
  let r: SeededRental;
  let id: string;
  beforeAll(async () => {
    r = await seedRental(db, { owedCents: 10000 });
    id = (await adjust(r, await staff(r.tenantId), "goodwill", "-5.00", "goodwill", "x")).adjustment_id;
  });

  it("UPDATE is refused even for the table owner", async () => {
    expect(await outcome(`UPDATE balance_adjustments SET note = 'edited' WHERE id = $1`, [id])).toMatchObject({ code: "23001" });
  });

  it("a direct DELETE and TRUNCATE are refused even for the table owner", async () => {
    expect(await outcome(`DELETE FROM balance_adjustments WHERE id = $1`, [id])).toMatchObject({ code: "23001" });
    expect(await outcome(`TRUNCATE balance_adjustments`)).toMatchObject({ code: "23001" });
    expect((await db.one<{ n: number }>(`SELECT count(*)::int n FROM balance_adjustments WHERE id = $1`, [id]))!.n).toBe(1);
  });

  it("no API role can insert, update or delete", async () => {
    for (const role of ["authenticated", "service_role", "anon"] as const) {
      await expect(db.asRole(role, null, (tx) => tx.q(`UPDATE balance_adjustments SET note = 'x' WHERE id = $1`, [id])), role).rejects.toMatchObject({ code: "42501" });
      await expect(db.asRole(role, null, (tx) => tx.q(`DELETE FROM balance_adjustments WHERE id = $1`, [id])), role).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.asRole(role, null, (tx) => tx.q(`INSERT INTO balance_adjustments (tenant_id, customer_id, kind, amount, reason_code, note, ledger_entry_id, created_by)
                                            SELECT tenant_id, customer_id, kind, amount, reason_code, note, ledger_entry_id, created_by FROM balance_adjustments WHERE id = $1`, [id])),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("deleting the customer still cascades (the audit dies with the account, it never blocks it)", async () => {
    const x = await seedRental(db, { owedCents: 1000 });
    const a = await staff(x.tenantId);
    const out = await adjust(x, a, "goodwill", "-1.00", "goodwill", "x");
    await reverse(x, a, out.adjustment_id);
    expect(await outcome(`DELETE FROM rentals WHERE customer_id = $1`, [x.customerId])).toBe("ok");
    expect(await outcome(`DELETE FROM customers WHERE id = $1`, [x.customerId])).toBe("ok");
    expect((await db.one<{ n: number }>(`SELECT count(*)::int n FROM balance_adjustments WHERE customer_id = $1`, [x.customerId]))!.n).toBe(0);
  });
});

// ─── 5. undo is a reversing entry ──────────────────────────────────────────

describe("undo — a new, opposite entry; once; never of an undo", () => {
  it("undoing goodwill −30.00 writes +30.00 (ledger and audit) and restores the balance", async () => {
    const r = await seedRental(db, { owedCents: 50000 });
    const actor = await staff(r.tenantId);
    const g = await adjust(r, actor, "goodwill", "-30.00", "goodwill", "Nice guy", { rentalId: r.rentalId });
    expect(await ledgerBalanceCents(r.customerId)).toBe(47000);
    const before = await counts(r.customerId);

    const u = await reverse(r, actor, g.adjustment_id, "wrong_customer", "Meant the other Sam");

    expect(await counts(r.customerId)).toEqual({ l: before.l + 1, a: before.a + 1 });
    expect(await ledgerBalanceCents(r.customerId)).toBe(50000);
    const row = await db.one(`SELECT kind, amount::text, reverses_id, reason_code, rental_id, ledger_entry_id FROM balance_adjustments WHERE id = $1`, [u.adjustment_id]);
    expect(row).toEqual({ kind: "goodwill", amount: "30.00", reverses_id: g.adjustment_id, reason_code: "wrong_customer", rental_id: r.rentalId, ledger_entry_id: u.ledger_entry_id });
    const le = await db.one<{ amount: string; remaining_amount: string; reference: string }>(`SELECT amount::text, remaining_amount::text, reference FROM ledger_entries WHERE id = $1`, [u.ledger_entry_id]);
    expect(le!.amount).toBe("30.00");
    expect(le!.remaining_amount).toBe("30.00");
    expect(le!.reference).toMatch(/^Undo of ADJ-[0-9a-f]{8}: Meant the other Sam · ADJ-[0-9a-f]{8}$/);
    // the original is untouched
    expect((await db.one(`SELECT amount::text, remaining_amount::text FROM ledger_entries WHERE id = $1`, [g.ledger_entry_id]))).toEqual({ amount: "-30.00", remaining_amount: "-30.00" });
  });

  it("a second undo is refused (23505) and an undo cannot itself be undone", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const g = await adjust(r, actor, "goodwill", "-5.00", "goodwill", "x");
    const u = await reverse(r, actor, g.adjustment_id);
    expect(await reverseOutcome(r, actor, g.adjustment_id)).toMatchObject({ code: "23505", message: "This entry has already been undone." });
    expect(await reverseOutcome(r, actor, u.adjustment_id)).toMatchObject({ code: "P0001", message: "This entry is itself an undo. Record a new adjustment instead." });
  });

  it("undoing a DEBIT correction is refused while later credits would exceed the charge", async () => {
    // Charge 100.00; +50.00 debit; then −150.00 credit (net 0). Undoing the
    // +50.00 would leave −150.00 against a 100.00 charge.
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const [c] = r.chargeIds;
    const debit = await adjust(r, actor, "charge_correction", "50.00", "undercharged", "x", { chargeId: c });
    const credit = await adjust(r, actor, "charge_correction", "-150.00", "overcharged", "x", { chargeId: c });
    expect(await reverseOutcome(r, actor, debit.adjustment_id)).toMatchObject({ code: "P0001", message: "Undo the later credit against this charge first." });
    await reverse(r, actor, credit.adjustment_id);
    expect(await reverseOutcome(r, actor, debit.adjustment_id)).toBe("ok");
    expect(await ledgerBalanceCents(r.customerId)).toBe(10000);
  });
});

// ─── 6. off-platform payments: applied exactly like cash ───────────────────

describe("off-platform payment — the allocator treats it exactly like cash", () => {
  const CHARGES = [
    { category: "Rental", amountCents: 50000, dueDate: "2026-10-01" },
    { category: "Tax", amountCents: 5000, dueDate: "2026-10-01" },
    { category: "Service Fee", amountCents: 2500, dueDate: "2026-10-01" },
  ];

  async function snapshot(r: SeededRental, paymentId: string) {
    const apps = await db.q<{ category: string; applied: string }>(
      `SELECT le.category, pa.amount_applied::text applied FROM payment_applications pa JOIN ledger_entries le ON le.id = pa.charge_entry_id
        WHERE pa.payment_id = $1 ORDER BY le.category`,
      [paymentId],
    );
    const pay = await db.one(`SELECT status, remaining_amount::text FROM payments WHERE id = $1`, [paymentId]);
    const remaining = await db.q<{ category: string; r: string }>(`SELECT category, remaining_amount::text r FROM ledger_entries WHERE rental_id = $1 AND type = 'Charge' ORDER BY category`, [r.rentalId]);
    const pnl = await db.q<{ category: string; amount: string }>(`SELECT category, amount::text FROM pnl_entries WHERE source_ref LIKE $1 ORDER BY category`, [`${paymentId}_%`]);
    return { apps, pay, remaining, pnl };
  }

  it.each([30000, 55000, 57500, 60000])("a %i-cent Zelle payment off the platform lands exactly where the same cash payment does", async (cents) => {
    const cashRental = await seedRental(db, { charges: CHARGES });
    const offRental = await seedRental(db, { charges: CHARGES, tenantId: cashRental.tenantId });
    const cash = await recordedPayment(cashRental, cents, { offPlatform: false, method: "Cash" });
    const off = await recordedPayment(offRental, cents, { offPlatform: true, method: "Zelle" });
    const a = await snapshot(cashRental, cash);
    const b = await snapshot(offRental, off);
    expect(b).toEqual(a);
    // and it was applied at all (hand-derived for 55000: Rental 500.00, Tax 50.00, nothing to Service Fee)
    if (cents === 55000) {
      expect(b.apps).toEqual([{ category: "Rental", applied: "500.00" }, { category: "Tax", applied: "50.00" }]);
      // payments.remaining_amount is an unscaled numeric, hence "0"
      expect(b.pay).toEqual({ status: "Applied", remaining_amount: "0" });
    }
  });

  it("recording it writes one audit row (amount −payment), once; a normal payment is refused", async () => {
    const r = await seedRental(db, { charges: CHARGES });
    const actor = await staff(r.tenantId);
    const off = await recordedPayment(r, 20000, { offPlatform: true, method: "Cash" });
    const out = await recordOffPlatform(r, actor, off);
    const row = await db.one(`SELECT kind, amount::text, payment_id, ledger_entry_id, rental_id, reason_code FROM balance_adjustments WHERE id = $1`, [out.adjustment_id]);
    expect(row).toEqual({ kind: "off_platform_payment", amount: "-200.00", payment_id: off, ledger_entry_id: null, rental_id: r.rentalId, reason_code: "paid_in_person" });
    expect(await recordOffPlatformOutcome(r, actor, off)).toMatchObject({ code: "23505", message: "This payment is already on the record." });

    const normal = await recordedPayment(r, 1000, { offPlatform: false, method: "Cash" });
    expect(await recordOffPlatformOutcome(r, actor, normal)).toMatchObject({ code: "P0001", message: "That payment was not recorded as received outside the platform." });
  });

  it("undo waits for the payment to be reversed, then records a +amount entry with no ledger row", async () => {
    const r = await seedRental(db, { charges: CHARGES });
    const actor = await staff(r.tenantId);
    const off = await recordedPayment(r, 20000, { offPlatform: true, method: "Check" });
    const rec = await recordOffPlatform(r, actor, off);
    expect(await reverseOutcome(r, actor, rec.adjustment_id)).toMatchObject({ code: "P0001", message: "Reverse the payment first: it still counts as money received." });

    const ledgerBefore = (await counts(r.customerId)).l;
    // what reverse-payment does to the row (the function itself is Deno, not SQL)
    await db.q(`UPDATE payments SET status = 'Reversed', remaining_amount = 0 WHERE id = $1`, [off]);
    const u = await reverse(r, actor, rec.adjustment_id, "entered_by_mistake", "It bounced");
    expect(await db.one(`SELECT kind, amount::text, payment_id, ledger_entry_id, reverses_id FROM balance_adjustments WHERE id = $1`, [u.adjustment_id])).toEqual({
      kind: "off_platform_payment", amount: "200.00", payment_id: off, ledger_entry_id: null, reverses_id: rec.adjustment_id,
    });
    expect((await counts(r.customerId)).l).toBe(ledgerBefore);
  });
});

// ─── 7. who may, and the refusals that keep the number honest ──────────────

describe("who may make a change", () => {
  it("a viewer, a deactivated account and another business's staff are refused (42501); a super admin is not", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const other = await seedRental(db, { owedCents: 100 });
    const viewer = await staff(r.tenantId, { role: "viewer" });
    const gone = await staff(r.tenantId, { active: false });
    const outsider = await staff(other.tenantId);
    const sa = await staff(null, { superAdmin: true });
    for (const [who, msg] of [
      [viewer, "Read-only accounts cannot change a balance."],
      [gone, "This staff account is deactivated."],
      [outsider, "This staff account belongs to a different business."],
    ] as const) {
      expect(await adjustOutcome(r, who, "goodwill", "-1.00", "goodwill", "x")).toMatchObject({ code: "42501", message: msg });
    }
    expect(await adjustOutcome(r, sa, "goodwill", "-1.00", "goodwill", "x")).toBe("ok");
  });

  it("a customer of another tenant is not found (P0002)", async () => {
    const r = await seedRental(db, { owedCents: 100 });
    const other = await seedRental(db, { owedCents: 100 });
    const actor = await staff(r.tenantId);
    expect(await adjustOutcome({ tenantId: r.tenantId, customerId: other.customerId }, actor, "goodwill", "-1.00", "goodwill", "x")).toMatchObject({ code: "P0002" });
  });
});

describe("refusals", () => {
  it("rentals the balance does not count: PAYG, cancelled, rejected", async () => {
    for (const [col, val, msg] of [
      ["is_pay_as_you_go", true, "This rental is billed day by day, so its balance comes from the daily bills. Adjust the customer account instead."],
      ["status", "Cancelled", "This rental is cancelled, so its charges no longer count toward the balance. Adjust the customer account instead."],
      ["approval_status", "rejected", "This rental is cancelled, so its charges no longer count toward the balance. Adjust the customer account instead."],
    ] as const) {
      const r = await seedRental(db, { owedCents: 10000 });
      const actor = await staff(r.tenantId);
      await db.q(`UPDATE rentals SET ${col} = $2 WHERE id = $1`, [r.rentalId, val]);
      expect(await adjustOutcome(r, actor, "goodwill", "-1.00", "goodwill", "x", { rentalId: r.rentalId }), col).toMatchObject({ code: "P0001", message: msg });
    }
  });

  it("sign and target rules", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const [c] = r.chargeIds;
    const cases: [string, string, string, { chargeId?: string }, string][] = [
      ["goodwill", "5.00", "goodwill", {}, "Goodwill can only lower what the customer owes."],
      ["goodwill", "-5.00", "goodwill", { chargeId: c }, 'Goodwill is not against one charge. To fix a charge, choose "A charge was wrong".'],
      ["charge_correction", "5.00", "overcharged", { chargeId: c }, "An overcharge is corrected with a credit, not a further charge."],
      ["charge_correction", "-5.00", "undercharged", { chargeId: c }, "An undercharge is corrected with an extra charge, not a credit."],
      ["charge_correction", "5.00", "payment_request", { chargeId: c }, "A payment request is a new charge, not a change to an existing one."],
      ["charge_correction", "-5.00", "wrong_rate", {}, "Pick the charge that was wrong."],
      ["goodwill", "-5.00", "not_a_reason", {}, "Pick a reason from the list."],
      ["goodwill", "0", "goodwill", {}, "Enter an amount that is not zero."],
      ["goodwill", "-5.001", "goodwill", {}, "Amounts have at most two decimal places."],
      ["goodwill", "-5.00", "goodwill", {}, "Say why: a note is required."],
    ];
    for (const [kind, amount, reason, scope, msg] of cases) {
      const note = msg === "Say why: a note is required." ? "   " : "x";
      expect(await adjustOutcome(r, actor, kind, amount, reason, note, scope), msg).toMatchObject({ code: "P0001", message: msg });
    }
    expect(await counts(r.customerId)).toMatchObject({ a: 0 });
  });

  it("the deposit is not corrected here", async () => {
    const r = await seedRental(db, { charges: [{ category: "Security Deposit", amountCents: 20000, dueDate: "2026-10-01" }] });
    const actor = await staff(r.tenantId);
    expect(await adjustOutcome(r, actor, "charge_correction", "-5.00", "overcharged", "x", { chargeId: r.chargeIds[0] })).toMatchObject({
      message: "The deposit is changed from the deposit panel, not here.",
    });
  });
});

// ─── 8. RLS ─────────────────────────────────────────────────────────────────

describe("RLS — staff read their own tenant's adjustments only", () => {
  it("tenant A staff see A's rows, not B's; anon sees nothing", async () => {
    const a = await seedRental(db, { owedCents: 1000 });
    const b = await seedRental(db, { owedCents: 1000 });
    const authA = "aaaaaaaa-0000-4000-8000-00000000000a";
    const actorA = await staff(a.tenantId, { authId: authA });
    const actorB = await staff(b.tenantId);
    await adjust(a, actorA, "goodwill", "-1.00", "goodwill", "a");
    await adjust(b, actorB, "goodwill", "-1.00", "goodwill", "b");
    const seen = await db.asRole("authenticated", authA, (tx) => tx.q<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM balance_adjustments`));
    expect(seen).toEqual([{ tenant_id: a.tenantId }]);
    await expect(db.asRole("anon", null, (tx) => tx.q(`SELECT 1 FROM balance_adjustments`))).rejects.toMatchObject({ code: "42501" });
  });
});

// ─── 9. the migration itself ────────────────────────────────────────────────

describe("the migration file", () => {
  const FILE = "20260926120000_balance_adjustments.sql";

  it("is loaded by the harness (marker on its first line) after the allocation prerequisites it depends on", () => {
    expect(MIGRATION_FILES).toContain(FILE);
    expect(MIGRATION_FILES.indexOf(FILE)).toBeGreaterThan(MIGRATION_FILES.indexOf("20260925120000_ledger_allocation_prerequisites.sql"));
  });

  it("re-applying it is a no-op: no error, rows and privileges unchanged", async () => {
    const before = await db.one<{ n: number }>(`SELECT count(*)::int n FROM balance_adjustments`);
    await db.exec(readFileSync(migrationPath(FILE), "utf8"));
    expect(await db.one<{ n: number }>(`SELECT count(*)::int n FROM balance_adjustments`)).toEqual(before);
    const grants = await db.q(`SELECT grantee, privilege_type FROM information_schema.role_table_grants
                                WHERE table_name = 'balance_adjustments' AND grantee IN ('anon','authenticated','service_role') ORDER BY 1, 2`);
    expect(grants).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
  });
});

// ─── 10. one list of reasons ────────────────────────────────────────────────

describe("the portal's reason lists are the SQL's", () => {
  it.each(["charge_correction", "off_platform_payment", "goodwill"] as AdjustmentKind[])("%s", async (kind) => {
    const r = await db.one<{ codes: string[] }>(`SELECT balance_reason_codes($1, false) codes`, [kind]);
    expect(r!.codes).toEqual([...REASON_CODES[kind]]);
  });

  it("undo", async () => {
    const r = await db.one<{ codes: string[] }>(`SELECT balance_reason_codes(NULL, true) codes`);
    expect(r!.codes).toEqual([...UNDO_REASON_CODES]);
  });

  it("every correction reason has a direction rule", () => {
    expect(Object.keys(CORRECTION_DIRECTION).sort()).toEqual([...REASON_CODES.charge_correction].sort());
  });
});

// ─── 11. undo never strands money (Wave 1 fixes D5, D2) ─────────────────────

describe("undo of an entry money has already touched", () => {
  const remainingOf = async (ledgerId: string) =>
    (await db.one<{ r: string }>(`SELECT remaining_amount::text r FROM ledger_entries WHERE id = $1`, [ledgerId]))!.r;

  it("D5: a payment request that was partly paid cannot be undone — nothing is written", async () => {
    // Hand-derived. A rental with no other charges. Request +50.00 on it: one
    // Adjustment charge, remaining 50.00, balance 5000. A 20.00 cash payment on
    // the rental reaches the only open charge (Adjustment, 13.4): remaining
    // 30.00, balance 3000. Undoing would write −50.00 while the 20.00 stays
    // applied to the original row — the customer would read 20.00 in credit
    // for money that paid a charge that "never happened". Refused.
    const r = await seedRental(db, {});
    const actor = await staff(r.tenantId);
    const req = await adjust(r, actor, "charge_correction", "50.00", "payment_request", "Parking ticket", { rentalId: r.rentalId });
    expect(await ledgerBalanceCents(r.customerId)).toBe(5000);
    await insertCompletedPayment(db, r, 2000);
    expect(await remainingOf(req.ledger_entry_id)).toBe("30.00");
    expect(await ledgerBalanceCents(r.customerId)).toBe(3000);
    const before = await counts(r.customerId);

    expect(await reverseOutcome(r, actor, req.adjustment_id)).toMatchObject({
      code: "P0001",
      message: "Part of this has been paid — record a correction instead.",
    });
    expect(await counts(r.customerId)).toEqual(before);
    expect(await ledgerBalanceCents(r.customerId)).toBe(3000);
  });

  it("D5: a debit correction paid in full cannot be undone either; an unpaid one can", async () => {
    // Rental 100.00 + debit +50.00 against it. A 150.00 payment: Rental 100.00
    // (priority 1), then the Adjustment 50.00 (13.4) → both remaining 0.00,
    // balance 0. Undo refused. A second, unpaid +10.00 debit undoes cleanly:
    // 1000 → 0.
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const [c] = r.chargeIds;
    const paid = await adjust(r, actor, "charge_correction", "50.00", "undercharged", "Child seat", { chargeId: c });
    await insertCompletedPayment(db, r, 15000);
    expect(await remainingOf(paid.ledger_entry_id)).toBe("0.00");
    expect(await ledgerBalanceCents(r.customerId)).toBe(0);
    expect(await reverseOutcome(r, actor, paid.adjustment_id)).toMatchObject({
      code: "P0001",
      message: "Part of this has been paid — record a correction instead.",
    });

    const unpaid = await adjust(r, actor, "charge_correction", "10.00", "undercharged", "Fuel", { chargeId: c });
    expect(await ledgerBalanceCents(r.customerId)).toBe(1000);
    expect(await reverseOutcome(r, actor, unpaid.adjustment_id)).toBe("ok");
    expect(await ledgerBalanceCents(r.customerId)).toBe(0);
  });

  it("D5: a credit (negative) entry is never 'paid' — its undo is unaffected", async () => {
    const r = await seedRental(db, { owedCents: 10000 });
    const actor = await staff(r.tenantId);
    const g = await adjust(r, actor, "goodwill", "-30.00", "goodwill", "Late", { rentalId: r.rentalId });
    await insertCompletedPayment(db, r, 7000);
    // 100.00 − 30.00 − 70.00 paid = 0; the credit row is untouched by the allocator
    expect(await remainingOf(g.ledger_entry_id)).toBe("-30.00");
    expect(await reverseOutcome(r, actor, g.adjustment_id)).toBe("ok");
    expect(await ledgerBalanceCents(r.customerId)).toBe(3000);
  });

  it.each([
    ["a partial refund, still marked Applied", "Applied", "50.00"],
    ["a partial refund, then reversed", "Reversed", "50.00"],
    ["status Refunded", "Refunded", "200.00"],
    ["status Partial Refund", "Partial Refund", "0"],
  ])("D2: an off-platform payment with %s cannot be undone", async (_label, status, refund) => {
    const r = await seedRental(db, { owedCents: 50000 });
    const actor = await staff(r.tenantId);
    const off = await recordedPayment(r, 20000, { offPlatform: true, method: "Cash" });
    const rec = await recordOffPlatform(r, actor, off);
    await db.q(`UPDATE payments SET status = $2, refund_amount = $3::numeric WHERE id = $1`, [off, status, refund]);
    const before = await counts(r.customerId);
    expect(await reverseOutcome(r, actor, rec.adjustment_id)).toMatchObject({
      code: "P0001",
      message: "This payment has been refunded, in part or in full, so it cannot be undone. Record a correction for what is still wrong instead.",
    });
    expect(await counts(r.customerId)).toEqual(before);
  });

  it("D2: a reversed payment with nothing refunded still undoes (the refusal is only for refunds)", async () => {
    const r = await seedRental(db, { owedCents: 50000 });
    const actor = await staff(r.tenantId);
    const off = await recordedPayment(r, 20000, { offPlatform: true, method: "Cash" });
    const rec = await recordOffPlatform(r, actor, off);
    await db.q(`UPDATE payments SET status = 'Reversed', remaining_amount = 0, refund_amount = 0 WHERE id = $1`, [off]);
    expect(await reverseOutcome(r, actor, rec.adjustment_id)).toBe("ok");
  });
});

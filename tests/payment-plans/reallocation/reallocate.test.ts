/**
 * payment_reallocate (migration 20260926120100) on real Postgres, against the
 * LIVE payment_apply_fifo_v2 (as rebuilt by 20260925120000). Every payment in
 * this file is placed by the live FIFO trigger first — the reallocation always
 * starts from what production would have written.
 *
 * Expected values are derived by hand in the comments, in cents.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneDatabase } from "../harness/pglite";
import {
  addCharge,
  applications,
  everything,
  insertCompletedPayment,
  outcome,
  paymentState,
  pnlRow,
  reallocate,
  refusal,
  remainingCents,
  revenueByCategory,
  seedRental,
  seedSecondRental,
  seedStaff,
  targetsJson,
  toCents,
  type Db,
} from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await cloneDatabase();
}, 120_000);
afterAll(async () => db?.close());

/** Tax 300.00 (due 10-02) + Fine 150.00 (due 10-05); a 300.00 payment the FIFO puts all on Tax (priority 2 < 12). */
async function taxAndFine() {
  const r = await seedRental(db, {
    charges: [
      { category: "Tax", amountCents: 30000, dueDate: "2026-10-02" },
      { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
    ],
  });
  const [tax, fine] = r.chargeIds;
  const pid = await insertCompletedPayment(db, r, 30000);
  const actor = await seedStaff(db, r.tenantId);
  return { r, tax, fine, pid, actor };
}

describe("payment reallocation — moving money between charges", () => {
  it("moves 100.00 of a 300.00 payment from Tax to Fine: Tax 300 − 100 = 200 applied / 100 owed; Fine 0 + 100 applied / 150 − 100 = 50 owed", async () => {
    const { r, tax, fine, pid, actor } = await taxAndFine();
    // What the FIFO did: all 30000 on Tax.
    expect(await applications(db, pid)).toEqual({ [tax]: 30000 });
    expect([await remainingCents(db, tax), await remainingCents(db, fine)]).toEqual([0, 15000]);

    await reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor);

    expect(await applications(db, pid)).toEqual({ [tax]: 20000, [fine]: 10000 });
    // Tax: 0 + (30000 − 20000) = 10000 owed. Fine: 15000 − (10000 − 0) = 5000 owed.
    expect([await remainingCents(db, tax), await remainingCents(db, fine)]).toEqual([10000, 5000]);
    // Σ placed 30000 = net 30000 → Applied, nothing left over.
    expect(await paymentState(db, pid)).toMatchObject({ status: "Applied", remainingCents: 0 });
    // Revenue keyed exactly as the FIFO keys it; Fine is booked as 'Fines'.
    expect(await pnlRow(db, pid, tax)).toMatchObject({ category: "Tax", amount: 20000, side: "Revenue" });
    expect(await pnlRow(db, pid, fine)).toMatchObject({
      category: "Fines", amount: 10000, side: "Revenue", vehicle_id: r.vehicleId, tenant_id: r.tenantId, entry_date: "2026-10-05",
    });
  });

  it("keeps revenue whole and moves it between categories: {Tax 300} → {Tax 200, Fines 100}, total 300 = 300", async () => {
    const { r, tax, fine, pid, actor } = await taxAndFine();
    const before = await revenueByCategory(db, r.tenantId);
    expect(before).toEqual({ Tax: 30000 });
    await reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor);
    const after = await revenueByCategory(db, r.tenantId);
    expect(after).toEqual({ Fines: 10000, Tax: 20000 });
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    expect(sum(after)).toBe(sum(before));
  });

  it("moves revenue across four categories and back again, with the category totals exact at every step", async () => {
    // Rental 400, Tax 40, Insurance 60, Excess Mileage 100 (priority 13.3). A 500.00 payment:
    // FIFO: Rental 400 → Tax 40 → Insurance 60 → 500 placed; Excess Mileage untouched.
    const r = await seedRental(db, {
      charges: [
        { category: "Rental", amountCents: 40000, dueDate: "2026-10-02" },
        { category: "Tax", amountCents: 4000, dueDate: "2026-10-02" },
        { category: "Insurance", amountCents: 6000, dueDate: "2026-10-02" },
        { category: "Excess Mileage", amountCents: 10000, dueDate: "2026-10-09" },
      ],
    });
    const [rental, tax, ins, miles] = r.chargeIds;
    const pid = await insertCompletedPayment(db, r, 50000);
    const actor = await seedStaff(db, r.tenantId);
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ Insurance: 6000, Rental: 40000, Tax: 4000 });

    // Step 1: take 100 off Rental for the mileage: Rental 300, Tax 40, Insurance 60, Miles 100 = 500.
    await reallocate(db, pid, [[rental, 30000], [tax, 4000], [ins, 6000], [miles, 10000]], actor);
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ "Excess Mileage": 10000, Insurance: 6000, Rental: 30000, Tax: 4000 });
    expect(await remainingCents(db, rental)).toBe(10000);
    expect(await remainingCents(db, miles)).toBe(0);

    // Step 2: back to the FIFO's own placement — the P&L returns to exactly where it started.
    await reallocate(db, pid, [[rental, 40000], [tax, 4000], [ins, 6000]], actor);
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ Insurance: 6000, Rental: 40000, Tax: 4000 });
    expect(await pnlRow(db, pid, miles)).toBeNull();
    expect([await remainingCents(db, rental), await remainingCents(db, miles)]).toEqual([0, 10000]);
  });

  it("moves a payment between two rentals of the same customer; revenue follows the car that earned it", async () => {
    // Rental A: Rental 200.00. Payment 200.00 on A → FIFO puts all 20000 on A.
    const a = await seedRental(db, { charges: [{ category: "Rental", amountCents: 20000, dueDate: "2026-10-02" }] });
    const b = await seedSecondRental(db, a, [{ category: "Rental", amountCents: 20000, dueDate: "2026-10-10" }]);
    const pid = await insertCompletedPayment(db, a, 20000);
    const actor = await seedStaff(db, a.tenantId);

    // 50 stays on A, 150 goes to B.
    const audit = await reallocate(db, pid, [[a.chargeIds[0], 5000], [b.chargeIds[0], 15000]], actor);

    // A: 0 + (20000 − 5000) = 15000 owed. B: 20000 − 15000 = 5000 owed.
    expect(await remainingCents(db, a.chargeIds[0])).toBe(15000);
    expect(await remainingCents(db, b.chargeIds[0])).toBe(5000);
    expect(await paymentState(db, pid)).toMatchObject({ status: "Applied", remainingCents: 0 });
    // The payment still says it arrived on A; its money now sits on both.
    expect((await db.one<any>(`SELECT rental_id FROM payments WHERE id=$1`, [pid]))!.rental_id).toBe(a.rentalId);
    expect(await pnlRow(db, pid, a.chargeIds[0])).toMatchObject({ amount: 5000, vehicle_id: a.vehicleId });
    expect(await pnlRow(db, pid, b.chargeIds[0])).toMatchObject({ amount: 15000, vehicle_id: b.vehicleId, entry_date: "2026-10-10" });
    const row = await db.one<any>(`SELECT rental_ids FROM payment_allocation_changes WHERE id = $1`, [audit]);
    expect([...row.rental_ids].sort()).toEqual([a.rentalId, b.rentalId].sort());
  });
});

describe("payment reallocation — what it refuses, with nothing written", () => {
  it("refuses another customer's charge in the same company", async () => {
    const { r, tax, pid, actor } = await taxAndFine();
    const other = await seedRental(db, { tenantId: r.tenantId, charges: [{ category: "Fine", amountCents: 5000, dueDate: "2026-10-05" }] });
    const snap = await everything(db);
    expect(await refusal(() => reallocate(db, pid, [[tax, 25000], [other.chargeIds[0], 5000]], actor))).toBe("P0001 charge_not_eligible");
    expect(await everything(db)).toEqual(snap);
  });

  it("refuses another company's charge", async () => {
    const { tax, pid, actor } = await taxAndFine();
    const other = await seedRental(db, { charges: [{ category: "Fine", amountCents: 5000, dueDate: "2026-10-05" }] });
    const snap = await everything(db);
    expect(await refusal(() => reallocate(db, pid, [[tax, 25000], [other.chargeIds[0], 5000]], actor))).toBe("P0001 charge_not_eligible");
    expect(await everything(db)).toEqual(snap);
  });

  it("refuses to place more than the payment: 200 + 150 = 350 > 300", async () => {
    const { tax, fine, pid, actor } = await taxAndFine();
    const snap = await everything(db);
    const o = await outcome(() => reallocate(db, pid, [[tax, 20000], [fine, 15000]], actor));
    expect(o).toMatchObject({ code: "P0001" });
    expect((o as any).message).toBe("over_allocation: this payment can place at most 300.00 (300.00 received), and the amounts add up to 350.00");
    expect(await everything(db)).toEqual(snap);
  });

  it("refuses to put more on a charge than it still owes: Fine owes 150, asked 160 (the total 300 would fit)", async () => {
    const { tax, fine, pid, actor } = await taxAndFine();
    const snap = await everything(db);
    expect(await refusal(() => reallocate(db, pid, [[tax, 14000], [fine, 16000]], actor))).toBe("P0001 exceeds_charge_remaining");
    expect(await everything(db)).toEqual(snap);
  });

  it("lets a partially refunded payment place only its net: 300 received − 100 refunded = 200", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-02" }] });
    const pid = await insertCompletedPayment(db, r, 30000);
    const actor = await seedStaff(db, r.tenantId);
    // What process-refund writes: refund_amount and the status; the allocation is left in place.
    await db.q(`UPDATE payments SET refund_amount = 100, status = 'Partial Refund' WHERE id = $1`, [pid]);
    const charge = r.chargeIds[0];

    const snap = await everything(db);
    const o = await outcome(() => reallocate(db, pid, [[charge, 30000]], actor));
    expect((o as any).message).toBe(
      "over_allocation: this payment can place at most 200.00 (300.00 received less 100.00 refunded), and the amounts add up to 300.00",
    );
    expect(await everything(db)).toEqual(snap);

    // 200 is accepted: the charge now owes 30000 − 20000 = 10000 (the refunded 100 no longer pays it).
    await reallocate(db, pid, [[charge, 20000]], actor);
    expect(await applications(db, pid)).toEqual({ [charge]: 20000 });
    expect(await remainingCents(db, charge)).toBe(10000);
    // The refund state is kept; net 20000 − placed 20000 = 0 left.
    expect(await paymentState(db, pid)).toMatchObject({ status: "Partial Refund", remainingCents: 0 });
    expect(await pnlRow(db, pid, charge)).toMatchObject({ amount: 20000 });
  });

  it("refuses money that was never captured, a payment still being applied, a reversed and a fully refunded one", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    const actor = await seedStaff(db, r.tenantId);
    const charge = r.chargeIds[0];
    const pay = async (status: string, capture: string | null, refund = 0) =>
      (await db.one<{ id: string }>(
        `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_date, status, capture_status, refund_amount)
         VALUES ($1, $2, $3, 100, 100, '2026-10-02', $4, $5, $6) RETURNING id`,
        [r.customerId, r.rentalId, r.tenantId, status, capture, refund],
      ))!.id;
    const cases: [string, string][] = [
      [await pay("Pending", "requires_capture"), "P0001 payment_not_captured"],
      [await pay("Credit", "requires_capture"), "P0001 payment_not_captured"],
      [await pay("Credit", "expired"), "P0001 payment_not_captured"],
      [await pay("Reversed", null), "P0001 payment_reversed"],
      [await pay("Refunded", "captured", 100), "P0001 payment_refunded"],
    ];
    // 'Completed' only exists while the FIFO runs; written here with the trigger's own guard (remaining 0 skips it).
    const completed = (await db.one<{ id: string }>(
      `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_date, status)
       VALUES ($1, $2, $3, 100, 0, '2026-10-02', 'Completed') RETURNING id`,
      [r.customerId, r.rentalId, r.tenantId],
    ))!.id;
    cases.push([completed, "P0001 payment_not_settled"]);
    const got = [];
    for (const [pid] of cases) got.push(await refusal(() => reallocate(db, pid, [[charge, 5000]], actor)));
    expect(got).toEqual(cases.map((c) => c[1]));
  });

  it("refuses an operator from another company, a deactivated one, and no operator at all", async () => {
    const { tax, fine, pid } = await taxAndFine();
    const elsewhere = await seedStaff(db, (await seedRental(db, {})).tenantId);
    const t = (await db.one<any>(`SELECT tenant_id FROM payments WHERE id=$1`, [pid]))!.tenant_id;
    const inactive = await seedStaff(db, t, { active: false });
    const ok: [string, number][] = [[tax, 20000], [fine, 10000]];
    expect(await refusal(() => reallocate(db, pid, ok, elsewhere))).toBe("42501 forbidden");
    expect(await refusal(() => reallocate(db, pid, ok, inactive))).toBe("42501 forbidden");
    expect(await refusal(() => reallocate(db, pid, ok, null))).toBe("42501 forbidden");
    // A super admin (tenant_id NULL by design) may act on any company.
    const sa = await seedStaff(db, null, { superAdmin: true, role: "admin" });
    expect(await outcome(() => reallocate(db, pid, ok, sa))).toBe("ok");
  });

  it("refuses malformed targets before reading anything: dollars under 'amount', fractions of a cent, a charge twice, zero, no reason", async () => {
    const { tax, pid, actor } = await taxAndFine();
    const raw = (json: string, reason = "why") => () =>
      db.q(`SELECT payment_reallocate($1, $2::jsonb, $3, NULL, $4)`, [pid, json, reason, actor]);
    expect(await refusal(raw(JSON.stringify([{ charge_entry_id: tax, amount: 100 }])))).toBe("22023 invalid_input");
    expect(await refusal(raw(JSON.stringify([{ charge_entry_id: tax, amount_cents: 100.5 }])))).toBe("22023 invalid_input");
    expect(await refusal(raw(JSON.stringify([{ charge_entry_id: tax, amount_cents: "100" }])))).toBe("22023 invalid_input");
    expect(await refusal(raw(JSON.stringify([{ charge_entry_id: tax, amount_cents: 0 }])))).toBe("22023 invalid_input");
    expect(await refusal(raw(targetsJson([[tax, 100], [tax, 200]])))).toBe("22023 invalid_input");
    expect(await refusal(raw(JSON.stringify({ charge_entry_id: tax, amount_cents: 100 })))).toBe("22023 invalid_input");
    expect(await refusal(raw(targetsJson([[tax, 100]]), "   "))).toBe("22023 invalid_input");
    expect(await refusal(raw(targetsJson([["00000000-0000-4000-8000-000000000000", 100]])))).toBe("P0002 not_found");
  });

  it("refuses a change that changes nothing, so the audit holds only real changes", async () => {
    const { tax, pid, actor } = await taxAndFine();
    expect(await refusal(() => reallocate(db, pid, [[tax, 30000]], actor))).toBe("P0001 no_change");
  });

  it("refuses a Payment ledger row, a credit (negative Adjustment) and a charge of zero as targets", async () => {
    const { r, tax, pid, actor } = await taxAndFine();
    const credit = await addCharge(db, r, { category: "Adjustment", amountCents: -2500, dueDate: "2026-10-03" });
    const zero = await addCharge(db, r, { category: "Other", amountCents: 0, dueDate: "2026-10-04" });
    const paymentRow = (await db.one<{ id: string }>(
      `INSERT INTO ledger_entries (customer_id, rental_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1, $2, $3, '2026-10-02', '2026-10-02', 'Payment', 'Rental', -25, 0, 'pay-row') RETURNING id`,
      [r.customerId, r.rentalId, r.tenantId],
    ))!.id;
    const snap = await everything(db);
    const got = [];
    for (const bad of [credit, zero, paymentRow]) got.push(await refusal(() => reallocate(db, pid, [[tax, 27500], [bad, 2500]], actor)));
    expect(got).toEqual(["P0001 charge_not_eligible", "P0001 charge_not_eligible", "P0001 charge_not_eligible"]);
    expect(await everything(db)).toEqual(snap);
  });
});

describe("payment reallocation — payment status and what is left over", () => {
  it("goes Applied → Partial (place 250 of 300: 50 left) → Applied (300) → Credit (nothing placed: 300 left) → Applied", async () => {
    const { tax, fine, pid, actor } = await taxAndFine();
    const seen: string[] = [];
    const note = async () => {
      const s = await paymentState(db, pid);
      seen.push(`${s.status} ${s.remainingCents}`);
    };
    await note();
    await reallocate(db, pid, [[tax, 25000]], actor);
    await note();
    await reallocate(db, pid, [[tax, 25000], [fine, 5000]], actor);
    await note();
    await reallocate(db, pid, [], actor, "release to credit");
    await note();
    await reallocate(db, pid, [[tax, 30000]], actor);
    await note();
    expect(seen).toEqual(["Applied 0", "Partial 5000", "Applied 0", "Credit 30000", "Applied 0"]);
  });

  it("leaves a Partial payment exactly as the FIFO would read it: a new Rental charge takes the 50 left over, Σ applied = 300", async () => {
    const { r, tax, pid, actor } = await taxAndFine();
    await reallocate(db, pid, [[tax, 25000]], actor);
    // trigger_auto_allocate_payments runs the live FIFO for Credit/Partial payments on a new Rental charge.
    const rent = await addCharge(db, r, { category: "Rental", amountCents: 8000, dueDate: "2026-10-09" });
    expect(await applications(db, pid)).toEqual({ [tax]: 25000, [rent]: 5000 });
    expect(await paymentState(db, pid)).toMatchObject({ status: "Applied", remainingCents: 0 });
    expect(await remainingCents(db, rent)).toBe(3000);
  });

  it("widens a category-targeted payment's list so the live target guard admits the new charge: [Tax] → [Tax, Fine]", async () => {
    const r = await seedRental(db, {
      charges: [
        { category: "Tax", amountCents: 30000, dueDate: "2026-10-02" },
        { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
      ],
    });
    const pid = await insertCompletedPayment(db, r, 30000, "2026-10-02", { target_categories: ["Tax"] });
    const actor = await seedStaff(db, r.tenantId);
    expect(await applications(db, pid)).toEqual({ [r.chargeIds[0]]: 30000 });
    const audit = await reallocate(db, pid, [[r.chargeIds[0], 20000], [r.chargeIds[1], 10000]], actor);
    expect((await paymentState(db, pid)).targetCategories).toEqual(["Tax", "Fine"]);
    const a = await db.one<any>(`SELECT before, after FROM payment_allocation_changes WHERE id=$1`, [audit]);
    expect([a.before.payment.target_categories, a.after.payment.target_categories]).toEqual([["Tax"], ["Tax", "Fine"]]);
  });
});

describe("payment reallocation — revenue rules shared with the live FIFO", () => {
  it("books no revenue for a Security Deposit, moving money on or off it: 100 onto the deposit leaves revenue 300 − 100 = 200", async () => {
    const r = await seedRental(db, {
      charges: [
        { category: "Rental", amountCents: 30000, dueDate: "2026-10-02" },
        { category: "Security Deposit", amountCents: 20000, dueDate: "2026-10-02" },
      ],
    });
    const [rental, deposit] = r.chargeIds;
    const pid = await insertCompletedPayment(db, r, 30000);
    const actor = await seedStaff(db, r.tenantId);
    await reallocate(db, pid, [[rental, 20000], [deposit, 10000]], actor);
    expect(await pnlRow(db, pid, deposit)).toBeNull();
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ Rental: 20000 });
    expect(await remainingCents(db, deposit)).toBe(10000);
    // …and back off it: revenue 300 again, still nothing for the deposit.
    await reallocate(db, pid, [[rental, 30000]], actor);
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ Rental: 30000 });
    expect(await remainingCents(db, deposit)).toBe(20000);
  });

  it("maps every ledger category to the same P&L category the live FIFO books", async () => {
    // One charge per category; the FIFO pays each (one payment each, so every
    // row is FIFO-written), and the mapping function must agree with every row.
    const cats = (await db.one<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'ledger_entries_category_check'`,
    ))!.d;
    const ledgerCats = [...cats.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).filter((c) => c !== "Security Deposit");
    expect(ledgerCats.length).toBe(22);
    const mismatches: string[] = [];
    for (const [i, category] of ledgerCats.entries()) {
      const r = await seedRental(db, { charges: [{ category, amountCents: 1000, dueDate: `2026-11-${String(1 + i).padStart(2, "0")}` }] });
      const pid = await insertCompletedPayment(db, r, 1000);
      const fifo = await pnlRow(db, pid, r.chargeIds[0]);
      const mine = (await db.one<{ c: string }>(`SELECT pal__pnl_category($1) c`, [category]))!.c;
      if (fifo?.category !== mine) mismatches.push(`${category}: FIFO ${fifo?.category} vs pal__pnl_category ${mine}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("re-syncs a revenue row that disagreed with its allocation when that allocation changes, and shows both in the audit", async () => {
    // History the old FIFO left: allocation 100, P&L 200 (the dropped second application).
    const { r, tax, fine, pid, actor } = await taxAndFine();
    await db.q(`UPDATE pnl_entries SET amount = 400 WHERE source_ref = $1`, [`${pid}_${tax}`]);
    const audit = await reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor);
    // The Tax row now equals its allocation (20000), not 40000 − 10000.
    expect(await pnlRow(db, pid, tax)).toMatchObject({ amount: 20000 });
    const a = await db.one<any>(`SELECT before, after FROM payment_allocation_changes WHERE id=$1`, [audit]);
    const taxApp = (s: any) => s.applications.find((x: any) => x.charge_entry_id === tax);
    expect([taxApp(a.before).pnl_cents, taxApp(a.before).applied_cents]).toEqual([40000, 30000]);
    expect([taxApp(a.after).pnl_cents, taxApp(a.after).applied_cents]).toEqual([20000, 20000]);
    expect(await revenueByCategory(db, r.tenantId)).toEqual({ Fines: 10000, Tax: 20000 });
  });

  it("re-opens the fine a Fine charge paid: fines.status Paid → Charged when money moves off it", async () => {
    const fineId = (await db.one<{ id: string }>(`INSERT INTO fines (status) VALUES ('Open') RETURNING id`))!.id;
    const r = await seedRental(db, {
      charges: [
        { category: "Fine", amountCents: 10000, dueDate: "2026-10-02", reference: `FINE-${fineId}` },
        { category: "Other", amountCents: 10000, dueDate: "2026-10-03" },
      ],
    });
    const pid = await insertCompletedPayment(db, r, 10000);
    const actor = await seedStaff(db, r.tenantId);
    // The live trigger marked it Paid when the FIFO drained the charge.
    expect((await db.one<any>(`SELECT status FROM fines WHERE id=$1`, [fineId]))!.status).toBe("Paid");
    await reallocate(db, pid, [[r.chargeIds[1], 10000]], actor);
    expect((await db.one<any>(`SELECT status FROM fines WHERE id=$1`, [fineId]))!.status).toBe("Charged");
    // And back: the live trigger pays it again.
    await reallocate(db, pid, [[r.chargeIds[0], 10000]], actor);
    expect((await db.one<any>(`SELECT status FROM fines WHERE id=$1`, [fineId]))!.status).toBe("Paid");
  });
});

describe("payment reallocation — the audit row", () => {
  it("records who, why, and every application before and after, in cents", async () => {
    const { r, tax, fine, pid, actor } = await taxAndFine();
    await db.q(`UPDATE app_users SET name = 'Dana Ops', email = 'dana@example.test' WHERE id = $1`, [actor]);
    const audit = await reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor, "customer asked to pay the fine", "phone call 10-06");
    const a = await db.one<any>(`SELECT * FROM payment_allocation_changes WHERE id = $1`, [audit]);
    expect({
      tenant_id: a.tenant_id, kind: a.kind, payment_id: a.payment_id, charge_entry_id: a.charge_entry_id,
      customer_id: a.customer_id, rental_ids: a.rental_ids, reason: a.reason, note: a.note,
      created_by: a.created_by, created_by_label: a.created_by_label,
    }).toEqual({
      tenant_id: r.tenantId, kind: "reallocate", payment_id: pid, charge_entry_id: null,
      customer_id: r.customerId, rental_ids: [r.rentalId], reason: "customer asked to pay the fine", note: "phone call 10-06",
      created_by: actor, created_by_label: "Dana Ops <dana@example.test>",
    });
    const pay = { id: pid, rental_id: r.rentalId, customer_id: r.customerId, amount_cents: 30000, refund_cents: 0, net_cents: 30000, target_categories: null };
    const chargeRow = (id: string, category: string, due: string, amount: number, remaining: number, ref: string) =>
      ({ charge_entry_id: id, category, rental_id: r.rentalId, extension_id: null, due_date: due, reference: ref, amount_cents: amount, remaining_cents: remaining });
    const refs = await db.q<any>(`SELECT id, reference FROM ledger_entries WHERE id = ANY($1)`, [[tax, fine]]);
    const ref = (id: string) => refs.find((x: any) => x.id === id).reference;
    expect(a.before).toEqual({
      payment: { ...pay, status: "Applied", remaining_cents: 0 },
      placed_cents: 30000,
      applications: [{ charge_entry_id: tax, category: "Tax", rental_id: r.rentalId, due_date: "2026-10-02", applied_cents: 30000, pnl_cents: 30000 }],
      charges: [chargeRow(tax, "Tax", "2026-10-02", 30000, 0, ref(tax)), chargeRow(fine, "Fine", "2026-10-05", 15000, 15000, ref(fine))],
    });
    expect(a.after).toEqual({
      payment: { ...pay, status: "Applied", remaining_cents: 0 },
      placed_cents: 30000,
      applications: [
        { charge_entry_id: tax, category: "Tax", rental_id: r.rentalId, due_date: "2026-10-02", applied_cents: 20000, pnl_cents: 20000 },
        { charge_entry_id: fine, category: "Fine", rental_id: r.rentalId, due_date: "2026-10-05", applied_cents: 10000, pnl_cents: 10000 },
      ],
      charges: [chargeRow(tax, "Tax", "2026-10-02", 30000, 10000, ref(tax)), chargeRow(fine, "Fine", "2026-10-05", 15000, 5000, ref(fine))],
    });
  });

  it("cannot be edited or deleted by anyone, the owner included, but dies with its company", async () => {
    const { r, tax, fine, pid, actor } = await taxAndFine();
    const audit = await reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor);
    expect(await refusal(() => db.q(`UPDATE payment_allocation_changes SET reason = 'edited' WHERE id = $1`, [audit]))).toMatch(/^23001/);
    expect(await refusal(() => db.q(`DELETE FROM payment_allocation_changes WHERE id = $1`, [audit]))).toMatch(/^23001/);
    expect(await refusal(() => db.q(`TRUNCATE payment_allocation_changes`))).toMatch(/^23001/);
    // Deleting the operator blanks created_by (ON DELETE SET NULL) and keeps the label.
    await db.q(`DELETE FROM app_users WHERE id = $1`, [actor]);
    expect(await db.one<any>(`SELECT created_by, created_by_label IS NOT NULL has_label FROM payment_allocation_changes WHERE id = $1`, [audit]))
      .toEqual({ created_by: null, has_label: true });
    // A tenant delete cascades through (the audit dies with the company, like its ledger).
    const scratch = await cloneDatabase();
    try {
      const x = await seedRental(scratch, { charges: [{ category: "Tax", amountCents: 1000, dueDate: "2026-10-02" }, { category: "Other", amountCents: 1000, dueDate: "2026-10-02" }] });
      const p2 = await insertCompletedPayment(scratch, x, 1000);
      const a2 = await seedStaff(scratch, x.tenantId);
      await reallocate(scratch, p2, [[x.chargeIds[1], 1000]], a2);
      await scratch.q(`DELETE FROM tenants WHERE id = $1`, [x.tenantId]);
      expect((await scratch.one<any>(`SELECT count(*)::int n FROM payment_allocation_changes`))!.n).toBe(0);
    } finally {
      await scratch.close();
    }
    void r;
  });
});

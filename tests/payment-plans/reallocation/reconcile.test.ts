/**
 * bill_reconcile_options (migration 20260926120100): read-only. For a bill
 * that does not tie out it explains the gap per charge and lists the exact
 * operations that close it — and running those operations, as listed, makes
 * the bill tie out. Every case below runs the proposed steps and re-checks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneDatabase } from "../harness/pglite";
import {
  addCharge,
  applications,
  driftRows,
  everything,
  insertCompletedPayment,
  paymentState,
  reallocate,
  recompute,
  reconcileOptions,
  refusal,
  remainingCents,
  seedRental,
  seedStaff,
  type Db,
} from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await cloneDatabase();
}, 120_000);
afterAll(async () => db?.close());

/** Run one fix's steps, in order, the way the panel will. Adjustment steps are Wave 1's and are skipped here. */
async function runSteps(steps: any[], actor: string): Promise<string[]> {
  const ran: string[] = [];
  for (const s of steps) {
    if (s.action === "recompute_charge") await recompute(db, s.charge_entry_id, actor, "reconcile");
    else if (s.action === "reallocate")
      await reallocate(db, s.payment_id, s.targets.map((t: any) => [t.charge_entry_id, t.amount_cents]), actor, "reconcile");
    else throw new Error(`step ${s.action} is not run by this test`);
    ran.push(s.action);
  }
  return ran;
}

async function historicPayment(
  r: { customerId: string; rentalId: string; tenantId: string; vehicleId: string },
  cents: number,
  date: string,
  apps: [string, number][],
) {
  const pid = (await db.one<{ id: string }>(
    `INSERT INTO payments (customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, status, method)
     VALUES ($1, $2, $3, $4, $5::numeric / 100, 0, $6, 'Applied', 'Cash') RETURNING id`,
    [r.customerId, r.rentalId, r.vehicleId, r.tenantId, cents, date],
  ))!.id;
  for (const [charge, c] of apps) {
    await db.q(`INSERT INTO payment_applications (payment_id, charge_entry_id, amount_applied) VALUES ($1, $2, $3::numeric / 100)`, [pid, charge, c]);
    await db.q(
      `INSERT INTO pnl_entries (vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
       VALUES ($1, $2, $3, 'Revenue', 'Rental', $4::numeric / 100, $5)`,
      [r.vehicleId, r.tenantId, date, c, `${pid}_${charge}`],
    );
  }
  return pid;
}

describe("reconcile this bill — read only", () => {
  it("is declared STABLE, so Postgres itself refuses any write from inside it", async () => {
    const v = await db.one<{ v: string }>(`SELECT provolatile v FROM pg_proc WHERE proname = 'bill_reconcile_options'`);
    expect(v!.v).toBe("s");
  });

  it("writes nothing, on a bill with every kind of gap", async () => {
    const r = await seedRental(db, {
      charges: [
        { category: "Rental", amountCents: 30000, dueDate: "2026-10-02" },
        { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
      ],
    });
    await insertCompletedPayment(db, r, 30000);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [r.chargeIds[1]]);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 50 WHERE id = $1`, [r.chargeIds[0]]);
    const snap = await everything(db);
    const o = await reconcileOptions(db, r.rentalId);
    expect(o.ties_out).toBe(false);
    expect(await everything(db)).toEqual(snap);
  });

  it("reports a bill that ties out as such: 300 charged, 300 paid, nothing to fix", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-02" }] });
    await insertCompletedPayment(db, r, 30000);
    const o = await reconcileOptions(db, r.rentalId);
    expect(o).toMatchObject({
      ties_out: true,
      charges: [],
      totals: { charges_checked: 1, charged_cents: 30000, settled_cents: 30000, applied_cents: 30000, gap_cents: 0, over_applied_cents: 0 },
    });
  });

  it("refuses an unknown rental and an extension of another rental", async () => {
    const r = await seedRental(db, {});
    const other = await seedRental(db, {});
    const ext = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number) VALUES ($1, $2, 1) RETURNING id`,
      [other.rentalId, other.tenantId],
    ))!.id;
    expect(await refusal(() => reconcileOptions(db, "00000000-0000-4000-8000-000000000000"))).toBe("P0002 not_found");
    expect(await refusal(() => reconcileOptions(db, r.rentalId, ext))).toBe("P0002 not_found");
  });
});

describe("reconcile this bill — the gaps it explains and the fixes that close them", () => {
  it("settled with no payment behind it: Fine 150 marked paid, 0 recorded → re-open 150, or pay 100 of it from a 100.00 credit (50 left owed), or write it off", async () => {
    // Rental 300 paid by P1 (FIFO). Fine 150 then marked paid by a path that recorded nothing.
    const r = await seedRental(db, {
      charges: [
        { category: "Rental", amountCents: 30000, dueDate: "2026-10-02" },
        { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
      ],
    });
    const [rental, fine] = r.chargeIds;
    const p1 = await insertCompletedPayment(db, r, 30000);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [fine]);
    // P2: 100.00 arrives when nothing is open → the FIFO leaves it as Credit 100.
    const p2 = await insertCompletedPayment(db, r, 10000, "2026-10-06");
    expect(await paymentState(db, p2)).toMatchObject({ status: "Credit", remainingCents: 10000 });
    const actor = await seedStaff(db, r.tenantId);

    const o = await reconcileOptions(db, r.rentalId);
    // Totals: charged 45000; settled 30000 + 15000; applied 30000; gap 15000.
    expect(o.totals).toEqual({ charges_checked: 2, charged_cents: 45000, settled_cents: 45000, applied_cents: 30000, gap_cents: 15000, over_applied_cents: 0 });
    expect(o.charges).toHaveLength(1);
    const c = o.charges[0];
    expect(c).toMatchObject({
      charge_entry_id: fine, category: "Fine", amount_cents: 15000, remaining_cents: 0, settled_cents: 15000,
      applied_cents: 0, drift_cents: 15000, over_applied_cents: 0, in_drift_view: true, problem: "settled_without_payment",
      explanation: "150.00 of this Fine charge is marked paid, but no payment is recorded against it (marked paid 150.00; payments recorded 0.00).",
      applications: [],
    });
    const recomputeStep = { action: "recompute_charge", charge_entry_id: fine, remaining_cents_before: 0, remaining_cents_after: 15000 };
    expect(c.fixes.map((f: any) => f.kind)).toEqual(["reopen", "use_payment", "write_off"]);
    expect(c.fixes[0]).toMatchObject({ remaining_cents_after: 15000, steps: [recomputeStep] });
    // P2's 100 is the only unplaced money: min(drift 15000, unplaced 10000, room 15000) = 10000.
    expect(c.fixes[1]).toMatchObject({
      payment_id: p2,
      remaining_cents_after: 5000,
      steps: [
        recomputeStep,
        { action: "reallocate", payment_id: p2, targets: [{ charge_entry_id: fine, amount_cents: 10000 }],
          changes: [{ charge_entry_id: fine, from_cents: 0, to_cents: 10000 }], unplaced_cents_used: 10000 },
      ],
    });
    expect(c.fixes[2].steps[1]).toEqual({
      action: "record_adjustment", via: "adjust-customer-balance", amount_cents: 15000,
      body: { kind: "goodwill", direction: "decrease", amount: 150, reason_code: "other",
              customerId: r.customerId, tenantId: r.tenantId, rentalId: r.rentalId, extensionId: null },
    });
    expect(o.unplaced_payments).toEqual([
      { payment_id: p2, rental_id: r.rentalId, payment_date: "2026-10-06", method: "Cash", status: "Credit", unplaced_cents: 10000 },
    ]);

    // Run the use_payment fix exactly as listed.
    expect(await runSteps(c.fixes[1].steps, actor)).toEqual(["recompute_charge", "reallocate"]);
    expect(await remainingCents(db, fine)).toBe(5000);
    expect(await applications(db, p2)).toEqual({ [fine]: 10000 });
    expect(await paymentState(db, p2)).toMatchObject({ status: "Applied", remainingCents: 0 });
    expect(await applications(db, p1)).toEqual({ [rental]: 30000 });
    expect((await reconcileOptions(db, r.rentalId)).ties_out).toBe(true);
  });

  it("repairs a dropped allocation: a 200.00 payment recorded 100 against a 200 charge it fully settled → record its other 100 there", async () => {
    // The pre-20260925 FIFO bug: applied twice, second allocation dropped, remaining drained, P&L booked 200.
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 20000, dueDate: "2026-10-02" }] });
    const charge = r.chargeIds[0];
    const p = await historicPayment(r, 20000, "2026-10-02", [[charge, 10000]]);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [charge]);
    await db.q(`UPDATE pnl_entries SET amount = 200 WHERE source_ref = $1`, [`${p}_${charge}`]);
    // A bigger, newer credit on the same rental — offered too, but second.
    const credit = await insertCompletedPayment(db, r, 50000, "2026-10-08");
    expect(await paymentState(db, credit)).toMatchObject({ status: "Credit", remainingCents: 50000 });
    const actor = await seedStaff(db, r.tenantId);

    const c = (await reconcileOptions(db, r.rentalId)).charges[0];
    expect(c).toMatchObject({ problem: "settled_without_payment", drift_cents: 10000, applied_cents: 10000 });
    // The payment has 20000 − 10000 = 10000 not placed anywhere, and is already on this charge: offered first.
    expect(c.fixes.filter((f: any) => f.kind === "use_payment").map((f: any) => f.payment_id)).toEqual([p, credit]);
    const use = c.fixes.find((f: any) => f.kind === "use_payment");
    expect(use).toMatchObject({
      payment_id: p,
      remaining_cents_after: 0,
      steps: [
        { action: "recompute_charge", remaining_cents_before: 0, remaining_cents_after: 10000 },
        { action: "reallocate", targets: [{ charge_entry_id: charge, amount_cents: 20000 }], changes: [{ from_cents: 10000, to_cents: 20000 }] },
      ],
    });
    await runSteps(use.steps, actor);
    expect(await applications(db, p)).toEqual({ [charge]: 20000 });
    expect(await remainingCents(db, charge)).toBe(0);
    // Revenue stays 200 (it was already booked), never 300.
    expect((await db.one<any>(`SELECT amount FROM pnl_entries WHERE source_ref = $1`, [`${p}_${charge}`]))!.amount).toBe("200.00");
    expect((await reconcileOptions(db, r.rentalId)).ties_out).toBe(true);
  });

  it("payments cover more than is marked paid: 300 applied, 250 marked paid → mark the other 50 paid", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-02" }] });
    await insertCompletedPayment(db, r, 30000);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 50 WHERE id = $1`, [r.chargeIds[0]]);
    const actor = await seedStaff(db, r.tenantId);
    const c = (await reconcileOptions(db, r.rentalId)).charges[0];
    expect(c).toMatchObject({
      problem: "payments_exceed_settled", drift_cents: -5000,
      explanation: "Payments recorded against this Rental charge add up to 300.00, but only 250.00 of it is marked paid: 50.00 more is paid than the charge shows.",
    });
    expect(c.fixes).toHaveLength(1);
    expect(c.fixes[0]).toMatchObject({ kind: "recompute", remaining_cents_after: 0, steps: [{ action: "recompute_charge", remaining_cents_before: 5000, remaining_cents_after: 0 }] });
    await runSteps(c.fixes[0].steps, actor);
    expect((await reconcileOptions(db, r.rentalId)).ties_out).toBe(true);
  });

  it("payments exceed the charge (866.95 recorded on 525.00, all marked paid) → move 341.95 off first, then recompute: 0 owed", async () => {
    // The Goniko shape. remaining 0 + over 34195 = 34195 ≤ 52500, so moving first cannot re-open past the charge.
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 52500, dueDate: "2026-10-02" }] });
    const charge = r.chargeIds[0];
    const p = await historicPayment(r, 86695, "2026-10-02", [[charge, 86695]]);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [charge]);
    const actor = await seedStaff(db, r.tenantId);

    const c = (await reconcileOptions(db, r.rentalId)).charges[0];
    expect(c).toMatchObject({
      problem: "payments_exceed_charge", drift_cents: 52500 - 86695, over_applied_cents: 34195,
      explanation: "Payments recorded against this Rental charge add up to 866.95, but the charge is only 525.00: 341.95 too much is recorded here.",
    });
    expect(c.fixes[0]).toMatchObject({
      kind: "move_excess", unresolved_cents: 0, remaining_cents_after: 0,
      steps: [
        { action: "reallocate", payment_id: p, targets: [{ charge_entry_id: charge, amount_cents: 52500 }],
          changes: [{ charge_entry_id: charge, from_cents: 86695, to_cents: 52500 }], unplaced_cents_added: 34195 },
        { action: "recompute_charge", charge_entry_id: charge, remaining_cents_before: 34195, remaining_cents_after: 0 },
      ],
    });
    await runSteps(c.fixes[0].steps, actor);
    expect(await remainingCents(db, charge)).toBe(0);
    // 86695 − 52500 = 34195 of the payment is now unused credit.
    expect(await paymentState(db, p)).toMatchObject({ status: "Partial", remainingCents: 34195 });
    expect((await reconcileOptions(db, r.rentalId)).ties_out).toBe(true);
  });

  it("payments exceed the charge by a whole charge (two 100.00 on one 100.00, none marked paid) → recompute first (−100), then take the later payment off: 0 owed", async () => {
    // remaining 10000 + over 10000 = 20000 > 10000: moving first would re-open past the charge, so recompute leads.
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    const charge = r.chargeIds[0];
    const p1 = await historicPayment(r, 10000, "2026-10-02", [[charge, 10000]]);
    const p2 = await historicPayment(r, 10000, "2026-10-04", [[charge, 10000]]);
    const actor = await seedStaff(db, r.tenantId);

    const c = (await reconcileOptions(db, r.rentalId)).charges[0];
    expect(c).toMatchObject({ problem: "payments_exceed_charge", drift_cents: -20000, over_applied_cents: 10000 });
    expect(c.fixes[0].steps).toEqual([
      { action: "recompute_charge", charge_entry_id: charge, remaining_cents_before: 10000, remaining_cents_after: -10000 },
      { action: "reallocate", payment_id: p2, targets: [], changes: [{ charge_entry_id: charge, from_cents: 10000, to_cents: 0 }], unplaced_cents_added: 10000 },
    ]);
    await runSteps(c.fixes[0].steps, actor);
    expect(await remainingCents(db, charge)).toBe(0);
    expect(await applications(db, p1)).toEqual({ [charge]: 10000 });
    expect(await paymentState(db, p2)).toMatchObject({ status: "Credit", remainingCents: 10000 });
    expect((await reconcileOptions(db, r.rentalId)).ties_out).toBe(true);
  });

  it("names exactly the charges v_ledger_allocation_drift names for the rental, plus over-applied ones the view cannot see", async () => {
    const r = await seedRental(db, {
      charges: [
        { category: "Rental", amountCents: 10000, dueDate: "2026-10-02" },
        { category: "Tax", amountCents: 1000, dueDate: "2026-10-02" },
        { category: "Insurance", amountCents: 2000, dueDate: "2026-10-02" },
        { category: "Other", amountCents: 3000, dueDate: "2026-10-03" },
      ],
    });
    await insertCompletedPayment(db, r, 13000); // Rental 100, Tax 10, Insurance 20
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [r.chargeIds[3]]); // Other: +30 drift
    await db.q(`UPDATE ledger_entries SET remaining_amount = 5 WHERE id = $1`, [r.chargeIds[1]]); // Tax: −5 drift
    const view = await driftRows(db, r.rentalId);
    const o = await reconcileOptions(db, r.rentalId);
    const named = Object.fromEntries(o.charges.filter((c: any) => c.in_drift_view).map((c: any) => [c.charge_entry_id, c.drift_cents]));
    expect(named).toEqual(view);
    expect(Object.keys(view).sort()).toEqual([r.chargeIds[1], r.chargeIds[3]].sort());
  });

  it("limits the bill to one extension's charges when an extension is given", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    const ext = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number) VALUES ($1, $2, 1) RETURNING id`,
      [r.rentalId, r.tenantId],
    ))!.id;
    const extCharge = await addCharge(db, r, { category: "Extension Rental", amountCents: 5000, dueDate: "2026-10-09", extensionId: ext });
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE rental_id = $1`, [r.rentalId]); // both drift
    const all = await reconcileOptions(db, r.rentalId);
    const one = await reconcileOptions(db, r.rentalId, ext);
    expect(all.charges.map((c: any) => c.charge_entry_id).sort()).toEqual([r.chargeIds[0], extCharge].sort());
    expect(one.charges.map((c: any) => c.charge_entry_id)).toEqual([extCharge]);
    expect(one.totals).toMatchObject({ charges_checked: 1, charged_cents: 5000, gap_cents: 5000 });
    expect(one.charges[0].fixes.find((f: any) => f.kind === "write_off").steps[1].body.extensionId).toBe(ext);
  });
});

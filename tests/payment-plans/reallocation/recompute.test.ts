/**
 * charge_recompute_remaining (migration 20260926120100): for ONE charge listed
 * in v_ledger_allocation_drift, remaining_amount := amount − Σ applications.
 *
 * Drift is produced here the way production produced it (measured Sep 25
 * 2026, docs/PAYMENT_PLANS_DESIGN.md §4.1): remaining_amount written by a path
 * that left no allocation record, or an allocation recorded twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneDatabase } from "../harness/pglite";
import {
  applications,
  driftRows,
  everything,
  insertCompletedPayment,
  paymentState,
  reallocate,
  recompute,
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

/** A captured payment with its allocation written by hand — history the FIFO did not write. */
async function historicPayment(r: { customerId: string; rentalId: string; tenantId: string; vehicleId: string }, cents: number, date: string, apps: [string, number][]) {
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

describe("recompute a charge's remaining amount from its payments", () => {
  it("re-opens a charge marked paid with no payment behind it: remaining 0 → 150.00 − 0 = 150.00, and the drift view drops it", async () => {
    const r = await seedRental(db, { charges: [{ category: "Excess Mileage", amountCents: 15000, dueDate: "2026-10-02" }] });
    const actor = await seedStaff(db, r.tenantId);
    const charge = r.chargeIds[0];
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [charge]); // settled 150, applied 0
    expect(await driftRows(db, r.rentalId)).toEqual({ [charge]: 15000 });

    const audit = await recompute(db, charge, actor, "reconcile", "no payment behind it");
    expect(await remainingCents(db, charge)).toBe(15000);
    expect(await driftRows(db, r.rentalId)).toEqual({});

    const a = await db.one<any>(`SELECT * FROM payment_allocation_changes WHERE id = $1`, [audit]);
    const snap = (remaining: number, drift: number) => ({
      charge_entry_id: charge, category: "Excess Mileage", rental_id: r.rentalId, extension_id: null, due_date: "2026-10-02",
      reference: expect.any(String), amount_cents: 15000, remaining_cents: remaining, settled_cents: 15000 - remaining,
      applied_cents: 0, drift_cents: drift, applications: [],
    });
    expect({ kind: a.kind, payment_id: a.payment_id, charge_entry_id: a.charge_entry_id, rental_ids: a.rental_ids, reason: a.reason, note: a.note, created_by: a.created_by })
      .toEqual({ kind: "recompute_remaining", payment_id: null, charge_entry_id: charge, rental_ids: [r.rentalId], reason: "reconcile", note: "no payment behind it", created_by: actor });
    expect(a.before).toEqual(snap(0, 15000));
    expect(a.after).toEqual(snap(15000, 0));
  });

  it("marks paid what the payments already cover: 300.00 applied, remaining 50.00 → 300 − 300 = 0", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-02" }] });
    const actor = await seedStaff(db, r.tenantId);
    await insertCompletedPayment(db, r, 30000);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 50 WHERE id = $1`, [r.chargeIds[0]]); // settled 250, applied 300
    expect(await driftRows(db, r.rentalId)).toEqual({ [r.chargeIds[0]]: -5000 });
    await recompute(db, r.chargeIds[0], actor);
    expect(await remainingCents(db, r.chargeIds[0])).toBe(0);
    expect(await driftRows(db, r.rentalId)).toEqual({});
  });

  it("changes only the charge it is given; a second drifted charge on the same rental stays drifted", async () => {
    const r = await seedRental(db, {
      charges: [
        { category: "Tax", amountCents: 1000, dueDate: "2026-10-02" },
        { category: "Other", amountCents: 2000, dueDate: "2026-10-02" },
      ],
    });
    const actor = await seedStaff(db, r.tenantId);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE rental_id = $1`, [r.rentalId]);
    await recompute(db, r.chargeIds[0], actor);
    expect(await driftRows(db, r.rentalId)).toEqual({ [r.chargeIds[1]]: 2000 });
    expect([await remainingCents(db, r.chargeIds[0]), await remainingCents(db, r.chargeIds[1])]).toEqual([1000, 0]);
  });

  it("refuses a charge that already ties out, and writes nothing", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 30000, dueDate: "2026-10-02" }] });
    const actor = await seedStaff(db, r.tenantId);
    await insertCompletedPayment(db, r, 10000);
    const snap = await everything(db);
    expect(await refusal(() => recompute(db, r.chargeIds[0], actor))).toBe("P0001 not_drifted");
    expect(await everything(db)).toEqual(snap);
  });

  it("refuses an operator from another company and an unknown charge", async () => {
    const r = await seedRental(db, { charges: [{ category: "Tax", amountCents: 1000, dueDate: "2026-10-02" }] });
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [r.chargeIds[0]]);
    const stranger = await seedStaff(db, (await seedRental(db, {})).tenantId);
    expect(await refusal(() => recompute(db, r.chargeIds[0], stranger))).toBe("42501 forbidden");
    expect(await refusal(() => recompute(db, "00000000-0000-4000-8000-000000000000", stranger))).toBe("P0002 not_found");
  });

  it("goes negative when the payments recorded exceed the charge (100 − 200 = −100), and reallocating the excess off brings it to 0", async () => {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    const actor = await seedStaff(db, r.tenantId);
    const charge = r.chargeIds[0];
    // Two 100.00 payments both recorded against the one 100.00 charge; remaining never moved.
    const p1 = await historicPayment(r, 10000, "2026-10-02", [[charge, 10000]]);
    const p2 = await historicPayment(r, 10000, "2026-10-03", [[charge, 10000]]);
    expect(await driftRows(db, r.rentalId)).toEqual({ [charge]: -20000 }); // settled 0 − applied 200

    await recompute(db, charge, actor);
    expect(await remainingCents(db, charge)).toBe(-10000);
    expect(await driftRows(db, r.rentalId)).toEqual({});

    // Take the second payment off: −10000 + 10000 = 0. It becomes 100.00 of unused credit.
    await reallocate(db, p2, [], actor, "recorded twice");
    expect(await remainingCents(db, charge)).toBe(0);
    expect(await paymentState(db, p2)).toMatchObject({ status: "Credit", remainingCents: 10000 });
    expect(await applications(db, p1)).toEqual({ [charge]: 10000 });
  });

  it("re-opens the fine behind a FINE- charge it re-opens: fines.status Paid → Charged", async () => {
    const fineId = (await db.one<{ id: string }>(`INSERT INTO fines (status) VALUES ('Charged') RETURNING id`))!.id;
    const r = await seedRental(db, { charges: [{ category: "Fine", amountCents: 5000, dueDate: "2026-10-02", reference: `FINE-${fineId}` }] });
    const actor = await seedStaff(db, r.tenantId);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [r.chargeIds[0]]); // the live trigger marks it Paid
    expect((await db.one<any>(`SELECT status FROM fines WHERE id = $1`, [fineId]))!.status).toBe("Paid");
    await recompute(db, r.chargeIds[0], actor);
    expect((await db.one<any>(`SELECT status FROM fines WHERE id = $1`, [fineId]))!.status).toBe("Charged");
  });
});

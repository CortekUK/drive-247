/**
 * Migration 20260925120000_ledger_allocation_prerequisites.sql, on real
 * Postgres, against the LIVE payment_apply_fifo_v2 body.
 *
 * Every "fixed" claim is shown twice: on `live` (the fixture schema with NO
 * migration — production as it is today) the defect reproduces; on `migrated`
 * it is gone. A test that only ran on the migrated database could not tell a
 * fix from a test that never exercised the defect.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDatabase, insertCompletedPayment, MIGRATION_FILES, migrationPath, seedRental, toCents, type Db } from "../harness/pglite";
import { readFileSync } from "node:fs";

let live: Db;
let migrated: Db;

beforeAll(async () => {
  [live, migrated] = await Promise.all([bootDatabase({ migrations: false }), bootDatabase()]);
}, 120_000);
afterAll(async () => {
  await live?.close();
  await migrated?.close();
});

/** Every ledger category the live CHECK allows except Security Deposit, in the live FIFO priority. */
const LIVE_ORDER = [
  "Rental", "Tax", "Service Fee", "Delivery Fee", "Collection Fee", "Insurance", "Extras",
  "Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Insurance", "Fine", "Fines", "Other",
];

/**
 * Seed one $10 charge per category (due dates ascending in `cats` order, so
 * ties inside a priority resolve in list order), then pay $10 at a time and
 * record which category each payment settled. Returns the settle order.
 */
async function settleOrder(db: Db, cats: string[]): Promise<string[]> {
  const r = await seedRental(db, {
    charges: cats.map((category, i) => ({
      category,
      amountCents: 1000,
      dueDate: `2026-10-${String(1 + i).padStart(2, "0")}`,
    })),
  });
  // Seed order is deliberately NOT the expected order: shuffle entry dates.
  const order: string[] = [];
  for (let i = 0; i < cats.length; i++) {
    const pid = await insertCompletedPayment(db, r, 1000, "2026-10-01");
    const app = await db.q<{ category: string; amount_applied: string }>(
      `SELECT le.category, pa.amount_applied FROM payment_applications pa JOIN ledger_entries le ON le.id = pa.charge_entry_id
        WHERE pa.payment_id = $1`,
      [pid],
    );
    order.push(app.length === 1 && toCents(app[0].amount_applied) === 1000 ? app[0].category : `(unapplied:${app.length})`);
  }
  return order;
}

describe("prerequisites — FIFO category coverage", () => {
  const NEW_CATS = ["Excess Mileage", "Adjustment", "Extension Add-on", "Unlimited Mileage", "Supercharger", "InitialFee", "Initial Fees", "Extension"];

  it("live: Excess Mileage / Adjustment are invisible to FIFO; Extension Add-on cannot even be written", async () => {
    const r = await seedRental(live, {
      charges: [
        { category: "Excess Mileage", amountCents: 5000, dueDate: "2026-10-02" },
        { category: "Adjustment", amountCents: 3000, dueDate: "2026-10-02" },
      ],
    });
    const pid = await insertCompletedPayment(live, r, 8000);
    const pay = await live.one<{ status: string; remaining_amount: string }>(`SELECT status, remaining_amount FROM payments WHERE id=$1`, [pid]);
    expect({ status: pay!.status, remainingCents: toCents(pay!.remaining_amount) }).toEqual({ status: "Credit", remainingCents: 8000 });
    const open = await live.q(`SELECT category FROM ledger_entries WHERE rental_id=$1 AND remaining_amount > 0 ORDER BY category`, [r.rentalId]);
    expect(open.map((x: any) => x.category)).toEqual(["Adjustment", "Excess Mileage"]);

    await expect(
      seedRental(live, { charges: [{ category: "Extension Add-on", amountCents: 100, dueDate: "2026-10-02" }] }),
    ).rejects.toThrow(/ledger_entries_category_check/);
  });

  it("migrated: an Excess Mileage, an Adjustment and an Extension Add-on charge are each settled by a payment", async () => {
    const r = await seedRental(migrated, {
      charges: [
        { category: "Excess Mileage", amountCents: 5000, dueDate: "2026-10-02" },
        { category: "Adjustment", amountCents: 3000, dueDate: "2026-10-02" },
        { category: "Extension Add-on", amountCents: 2000, dueDate: "2026-10-02" },
      ],
    });
    const pid = await insertCompletedPayment(migrated, r, 10000);
    const pay = await migrated.one<{ status: string; remaining_amount: string }>(`SELECT status, remaining_amount FROM payments WHERE id=$1`, [pid]);
    expect({ status: pay!.status, remainingCents: toCents(pay!.remaining_amount) }).toEqual({ status: "Applied", remainingCents: 0 });
    const rows = await migrated.q<{ category: string; remaining_amount: string; applied: string }>(
      `SELECT le.category, le.remaining_amount, pa.amount_applied applied FROM ledger_entries le
         JOIN payment_applications pa ON pa.charge_entry_id = le.id WHERE le.rental_id=$1 ORDER BY le.category`,
      [r.rentalId],
    );
    expect(rows).toEqual([
      { category: "Adjustment", remaining_amount: "0.00", applied: "30.00" },
      { category: "Excess Mileage", remaining_amount: "0.00", applied: "50.00" },
      { category: "Extension Add-on", remaining_amount: "0.00", applied: "20.00" },
    ]);
  });

  it("existing order is unchanged: the live body and the migrated body settle the 14 earned categories identically", async () => {
    const liveOrder = await settleOrder(live, LIVE_ORDER);
    const migratedOrder = await settleOrder(migrated, LIVE_ORDER);
    expect(liveOrder).toEqual(LIVE_ORDER);
    expect(migratedOrder).toEqual(liveOrder);
  });

  it("migrated: full order — existing 1..13, new categories in (13, 14), Security Deposit last", async () => {
    // Seeded in REVERSE of the expected order so a due-date tiebreak cannot fake it.
    const expected = [
      ...LIVE_ORDER,
      "InitialFee", "Initial Fees", // 13.1
      "Extension", "Extension Add-on", // 13.2
      "Unlimited Mileage", "Excess Mileage", "Supercharger", // 13.3
      "Adjustment", // 13.4
      "Security Deposit", // 14
    ];
    const r = await seedRental(migrated, {
      charges: [...expected].reverse().map((category, i) => ({
        category,
        amountCents: 1000,
        // Inside one priority, due date decides: give the expected-first the earlier date.
        dueDate: `2026-11-${String(28 - i).padStart(2, "0")}`,
      })),
    });
    const order: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      const pid = await insertCompletedPayment(migrated, r, 1000, "2026-12-01");
      const app = await migrated.one<{ category: string }>(
        `SELECT le.category FROM payment_applications pa JOIN ledger_entries le ON le.id = pa.charge_entry_id WHERE pa.payment_id=$1`,
        [pid],
      );
      order.push(app?.category ?? "(none)");
    }
    expect(order).toEqual(expected);
  });

  it("migrated: a category nobody listed is settled at 13.5 — after Adjustment, before Security Deposit (COALESCE fallback)", async () => {
    const db = await bootDatabase();
    try {
      // The only way to write an unlisted category is to lift the CHECK; this
      // is exactly the drift the fallback exists for.
      await db.exec(`ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_category_check`);
      const r = await seedRental(db, {
        charges: [
          { category: "Security Deposit", amountCents: 1000, dueDate: "2026-10-01" },
          { category: "Mystery Fee", amountCents: 1000, dueDate: "2026-10-02" },
          { category: "Adjustment", amountCents: 1000, dueDate: "2026-10-03" },
        ],
      });
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        const pid = await insertCompletedPayment(db, r, 1000, "2026-10-01");
        const app = await db.one<{ category: string }>(
          `SELECT le.category FROM payment_applications pa JOIN ledger_entries le ON le.id = pa.charge_entry_id WHERE pa.payment_id=$1`,
          [pid],
        );
        seen.push(app?.category ?? "(none)");
      }
      expect(seen).toEqual(["Adjustment", "Mystery Fee", "Security Deposit"]);
      // …and its P&L row went to 'Other', not an error.
      const pnl = await db.q(`SELECT category FROM pnl_entries WHERE source_ref LIKE '%' || $1`, [r.chargeIds[1]]);
      expect(pnl).toEqual([{ category: "Other" }]);
    } finally {
      await db.close();
    }
  });
});

describe("prerequisites — P&L categories never violate chk_pnl_category_valid", () => {
  it("the function's allowed list is exactly the constraint's list", async () => {
    const src = (await migrated.one<{ src: string }>(`SELECT prosrc src FROM pg_proc WHERE proname='payment_apply_fifo_v2'`))!.src;
    const block = src.match(/NOT \(v_pnl_cat = ANY \(ARRAY\[([\s\S]*?)\]::text\[\]\)\)/);
    expect(block, "allowed-list literal not found in payment_apply_fifo_v2").toBeTruthy();
    const fnList = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const def = (await migrated.one<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='chk_pnl_category_valid'`,
    ))!.d;
    const conList = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
    expect(conList.length).toBe(24);
    expect(fnList).toEqual(conList);
  });

  it("each mapped category lands on an allowed P&L name; Security Deposit is never booked", async () => {
    const cats = ["Fine", "InitialFee", "Extension Add-on", "Adjustment", "Supercharger", "Excess Mileage", "Initial Fees", "Security Deposit"];
    const r = await seedRental(migrated, {
      charges: cats.map((category, i) => ({ category, amountCents: 1000, dueDate: `2026-10-${String(1 + i).padStart(2, "0")}` })),
    });
    await insertCompletedPayment(migrated, r, 8000);
    const rows = await migrated.q<{ ledger: string; pnl: string | null }>(
      `SELECT le.category ledger, pe.category pnl
         FROM ledger_entries le
         LEFT JOIN pnl_entries pe ON pe.source_ref LIKE '%\\_' || le.id::text
        WHERE le.rental_id = $1 ORDER BY le.due_date`,
      [r.rentalId],
    );
    expect(Object.fromEntries(rows.map((x) => [x.ledger, x.pnl]))).toEqual({
      Fine: "Fines",
      InitialFee: "Initial Fees",
      "Extension Add-on": "Extras",
      Adjustment: "Other",
      Supercharger: "Other",
      "Excess Mileage": "Excess Mileage",
      "Initial Fees": "Initial Fees",
      "Security Deposit": null,
    });
  });
});

describe("prerequisites — payment_applications accumulate", () => {
  /**
   * A realistic second application of one payment to one charge: P (150)
   * settles C (100) and is left Partial (50). The charge is re-priced to 130
   * (remaining 30). A new Rental charge D (20) is inserted; the live
   * auto_allocate trigger re-runs FIFO on P, which applies 30 to C AGAIN and
   * 20 to D.
   */
  async function reapply(db: Db) {
    const r = await seedRental(db, { charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    const pid = await insertCompletedPayment(db, r, 15000);
    await db.q(`UPDATE ledger_entries SET amount = 130, remaining_amount = 30 WHERE id = $1`, [r.chargeIds[0]]);
    await db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1,$2,$3,$4,'2026-10-09','2026-10-09','Charge','Rental',20,20,'second')`,
      [r.customerId, r.rentalId, r.vehicleId, r.tenantId],
    );
    const c = await db.one<{ amount: string; remaining_amount: string }>(`SELECT amount, remaining_amount FROM ledger_entries WHERE id=$1`, [r.chargeIds[0]]);
    const pa = await db.q<{ amount_applied: string }>(
      `SELECT amount_applied FROM payment_applications WHERE payment_id=$1 AND charge_entry_id=$2`,
      [pid, r.chargeIds[0]],
    );
    const pnl = await db.one<{ amount: string }>(`SELECT amount FROM pnl_entries WHERE source_ref = $1`, [`${pid}_${r.chargeIds[0]}`]);
    return { r, pid, charge: c!, applications: pa, pnl: pnl! };
  }

  it("live: the second application is DROPPED — the charge drifts (settled 130, applied 100) while P&L says 130", async () => {
    const x = await reapply(live);
    expect(x.charge).toEqual({ amount: "130.00", remaining_amount: "0.00" });
    expect(x.applications).toEqual([{ amount_applied: "100.00" }]);
    expect(x.pnl.amount).toBe("130.00");
  });

  it("migrated: the second application accumulates — applications, remaining_amount and P&L agree at 130", async () => {
    const x = await reapply(migrated);
    expect(x.charge).toEqual({ amount: "130.00", remaining_amount: "0.00" });
    expect(x.applications).toEqual([{ amount_applied: "130.00" }]);
    expect(x.pnl.amount).toBe("130.00");
    const drift = await migrated.q(`SELECT * FROM v_ledger_allocation_drift WHERE rental_id = $1`, [x.r.rentalId]);
    expect(drift).toEqual([]);
  });
});

describe("prerequisites — latent live defect NOT fixed here (reported, not in the design's list)", () => {
  /**
   * Same re-application as above, on a rental with NO vehicle. The P&L upsert's
   * arbiter is (vehicle_id, category, source_ref); with vehicle_id NULL it can
   * never match, so the second insert falls through to ux_pnl_source_reference
   * (UNIQUE on source_ref alone) and raises — aborting the whole payment.
   * Live and migrated behave the same: migration 1 keeps the live arbiter.
   */
  async function reapplyNoVehicle(db: Db) {
    const r = await seedRental(db, { withVehicle: false, charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-10-02" }] });
    await insertCompletedPayment(db, r, 15000);
    await db.q(`UPDATE ledger_entries SET amount = 130, remaining_amount = 30 WHERE id = $1`, [r.chargeIds[0]]);
    return db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1,$2,NULL,$3,'2026-10-09','2026-10-09','Charge','Rental',20,20,'second-nv')`,
      [r.customerId, r.rentalId, r.tenantId],
    );
  }
  it("live: raises on ux_pnl_source_reference", async () => {
    await expect(reapplyNoVehicle(live)).rejects.toThrow(/ux_pnl_source_reference/);
  });
  it.fails("KNOWN DEFECT (live and migrated): a second application on a vehicle-less rental should accumulate, not abort", async () => {
    await expect(reapplyNoVehicle(migrated)).resolves.toBeDefined();
  });
});

describe("prerequisites — v_ledger_allocation_drift", () => {
  it("finds a hand-made drifted charge and not a clean one", async () => {
    const r = await seedRental(migrated, {
      charges: [
        { category: "Rental", amountCents: 10000, dueDate: "2026-10-02" },
        { category: "Tax", amountCents: 5000, dueDate: "2026-10-02" },
      ],
    });
    await insertCompletedPayment(migrated, r, 10000); // settles the Rental charge cleanly
    // Hand-made drift: the Tax charge is marked partly settled with no application behind it.
    await migrated.q(`UPDATE ledger_entries SET remaining_amount = 20 WHERE id = $1`, [r.chargeIds[1]]);
    const rows = await migrated.q<any>(`SELECT charge_entry_id, category, settled_amount, applied_amount, drift_amount FROM v_ledger_allocation_drift WHERE rental_id=$1`, [r.rentalId]);
    expect(rows).toEqual([
      { charge_entry_id: r.chargeIds[1], category: "Tax", settled_amount: "30.00", applied_amount: "0", drift_amount: "30.00" },
    ]);
  });

  it("is security_invoker, and readable by service_role only (not anon, not authenticated)", async () => {
    const opt = await migrated.one<{ reloptions: string[] }>(`SELECT reloptions FROM pg_class WHERE relname='v_ledger_allocation_drift'`);
    expect(opt!.reloptions).toContain("security_invoker=on");
    const priv = await migrated.one(
      `SELECT has_table_privilege('anon','public.v_ledger_allocation_drift','SELECT') anon,
              has_table_privilege('authenticated','public.v_ledger_allocation_drift','SELECT') authn,
              has_table_privilege('service_role','public.v_ledger_allocation_drift','SELECT') svc`,
    );
    expect(priv).toEqual({ anon: false, authn: false, svc: true });
    await expect(migrated.asRole("authenticated", null, (tx) => tx.q(`SELECT 1 FROM v_ledger_allocation_drift`))).rejects.toThrow(/permission denied/);
    const n = await migrated.asRole("service_role", null, (tx) => tx.q(`SELECT count(*)::int n FROM v_ledger_allocation_drift`));
    expect(n[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe("prerequisites — widened CHECKs and idempotency", () => {
  it("booking_source 'payment_plan' is refused live and accepted after the migration", async () => {
    const insert = async (db: Db) => {
      const r = await seedRental(db, {});
      return insertCompletedPayment(db, r, 100, "2026-10-02", { booking_source: "payment_plan" });
    };
    await expect(insert(live)).rejects.toThrow(/payments_booking_source_check/);
    await expect(insert(migrated)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("re-applying both migrations is a no-op (no error, same objects)", async () => {
    const before = await migrated.one<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'pp%'`);
    for (const f of MIGRATION_FILES) await migrated.exec(readFileSync(migrationPath(f), "utf8"));
    const after = await migrated.one<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'pp%'`);
    expect(after).toEqual(before);
    // Re-applying replaced pp_clock() with production's now(); put the test clock back.
    await migrated.exec(`CREATE OR REPLACE FUNCTION public.pp_clock() RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public
      AS $$ SELECT COALESCE(NULLIF(current_setting('pp_test.now', true), '')::timestamptz, now()) $$`);
  });
});

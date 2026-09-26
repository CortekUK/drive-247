/**
 * 20260926120200_open_ended_plans.sql on real Postgres (PGlite), with the
 * LIVE FIFO and the LIVE finalize_rental_extension doing the money.
 *
 * Every expected amount is hand-derived from auto-extend's pricing formula
 * (renewal-pricing.ts) with the fixture numbers written out:
 *   monthly_amount 350.00 − discount_applied 16.16 = 333.84 → 33384 cents
 *   tax 7%: round2(333.84 × 0.07) = round2(23.3688) = 23.37 → 2337 cents
 *   service fee $5.00 fixed → 500 cents
 *   one week = 33384 + 2337 + 500 = 36221 cents; [2026-10-02, 2026-10-09), 7 days
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootDatabase, insertCompletedPayment, seedRental, toCents, type Db, type SeededRental } from "../harness/pglite";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => db.setNow("2026-09-30T14:00:00.000Z"));

const BD = { rentalCents: 33384, taxCents: 2337, serviceFeeCents: 500, totalCents: 36221 };
const WEEK1 = [{ seq: 1, dueDate: "2026-10-02", periodStart: "2026-10-02", periodEnd: "2026-10-09", days: 7, amountCents: 36221, isStub: false }];
const UUID_A = "00000000-0000-4000-8000-00000000000a";

function renewalPlanJson(r: Pick<SeededRental, "tenantId" | "rentalId" | "customerId">, over: Record<string, unknown> = {}) {
  return {
    tenantId: r.tenantId,
    rentalId: r.rentalId,
    customerId: r.customerId,
    rule: { freq: "weekly", interval: 1, byWeekday: [5], anchor: "2026-10-02", firstOccurrence: "on_anchor", end: { kind: "open", through: "2026-10-02" } },
    amount: { mode: "fixed", amountCents: 36221 },
    currency: "usd",
    timezone: "America/New_York",
    chargeLocalTime: "10:00",
    collectionMethod: "auto_charge",
    fallbackToLink: true,
    maxAttempts: 3,
    retryAfterDays: 2,
    reminderOffsets: [-2, 0, 2],
    paymentProvider: "stripe",
    stripePaymentMethodId: null,
    extendsRental: true,
    renewal: { periodUnit: "week", periodCount: 1, insurance: null, sendAgreementEachPeriod: false },
    ...over,
  };
}

async function seedRenewalRental(extra: { endDate?: string; taxPercentage?: number } = {}) {
  return seedRental(db, {
    startDate: "2026-09-25",
    endDate: extra.endDate ?? "2026-10-02",
    monthlyAmount: 350,
    discountApplied: 16.16,
    tenantPricing: { taxPercentage: extra.taxPercentage ?? 7, serviceFeeFixed: 5 },
  });
}

async function setup(opts: { plan?: Record<string, unknown>; drafts?: unknown[]; endDate?: string } = {}) {
  const r = await seedRenewalRental({ endDate: opts.endDate });
  const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb, NULL) id`, [
    JSON.stringify(renewalPlanJson(r, opts.plan)),
    JSON.stringify(opts.drafts ?? WEEK1),
  ]))!.id;
  const occ = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1 AND seq = 1`, [planId]))!.id;
  return { r, planId, occ };
}

const post = async (occ: string, bd: unknown = BD, insurance = false, giveDays = false) =>
  (await db.one<{ r: any }>(`SELECT pp_post_renewal_period($1, $2::jsonb, $3, $4, NULL) r`, [occ, JSON.stringify(bd), insurance, giveDays]))!.r;
const occRow = (id: string) => db.one<any>(`SELECT * FROM payment_plan_occurrences WHERE id = $1`, [id]);
const endDate = async (rentalId: string) => (await db.one<{ end_date: string }>(`SELECT end_date FROM rentals WHERE id = $1`, [rentalId]))!.end_date;
const ext = (id: string) => db.one<any>(`SELECT * FROM rental_extensions WHERE id = $1`, [id]);
const charges = async (extensionId: string) =>
  (await db.q<any>(
    `SELECT category, amount, remaining_amount, due_date, reference, type, rental_id FROM ledger_entries WHERE extension_id = $1
      ORDER BY CASE category WHEN 'Extension Rental' THEN 1 WHEN 'Extension Tax' THEN 2 WHEN 'Extension Service Fee' THEN 3 ELSE 4 END`,
    [extensionId],
  )).map((c) => [c.category, toCents(c.amount), toCents(c.remaining_amount), c.due_date]);
const events = (planId: string, kind: string) => db.q<any>(`SELECT * FROM payment_plan_events WHERE plan_id = $1 AND kind = $2 ORDER BY created_at, ctid`, [planId, kind]);
const claim = async (occ: string, method = "auto_charge") => (await db.one<{ r: any }>(`SELECT pp_claim($1, $2, 'acct_x') r`, [occ, method]))!.r;
async function cardSuccess(occ: string) {
  const c = await claim(occ);
  expect(c.ok, JSON.stringify(c)).toBe(true);
  await db.q(`SELECT pp_mark_in_flight($1)`, [c.claim.attemptId]);
  const pay = (await db.one<{ id: string }>(`SELECT pp_record_success($1,$2,'pi_ok','acct_x','test','stripe','uk','2026-10-02','Card',NULL) id`, [
    c.claim.attemptId,
    c.claim.amountCents,
  ]))!.id;
  return { claim: c.claim, paymentId: pay };
}
const count = async (sql: string, params: unknown[] = []) => Number((await db.one<{ n: string }>(sql, params))!.n);

// ─────────────────────────────────────────────────────────────────────────────

describe("schema", () => {
  it("a renewal plan must carry its period and an open end; any other plan none of it", async () => {
    const r = await seedRenewalRental();
    const noRenewal = renewalPlanJson(r, { renewal: null });
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(noRenewal), JSON.stringify(WEEK1)])).rejects.toThrow(/payment_plans_renewal_shape/);
    const r2 = await seedRenewalRental();
    const notOpen = renewalPlanJson(r2, { rule: { freq: "weekly", interval: 1, byWeekday: [5], anchor: "2026-10-02", firstOccurrence: "on_anchor", end: { kind: "count", count: 1 } } });
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(notOpen), JSON.stringify(WEEK1)])).rejects.toThrow(/payment_plans_renewal_shape/);
    const r3 = await seedRenewalRental();
    const stray = renewalPlanJson(r3, { extendsRental: false });
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(stray), JSON.stringify(WEEK1)])).rejects.toThrow(/payment_plans_renewal_shape/);
  });

  it("refuses an unknown renewal key, a bad unit and a non-boolean cover", async () => {
    for (const renewal of [
      { periodUnit: "week", periodCount: 1, insurance: null, sendAgreementEachPeriod: false, typo: 1 },
      { periodUnit: "fortnight", periodCount: 1, insurance: null, sendAgreementEachPeriod: false },
      { periodUnit: "week", periodCount: 1, insurance: { cdw: "yes" }, sendAgreementEachPeriod: false },
      { periodUnit: "week", periodCount: 1, insurance: { roadside: true }, sendAgreementEachPeriod: false },
    ]) {
      const r = await seedRenewalRental();
      await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(renewalPlanJson(r, { renewal })), JSON.stringify(WEEK1)])).rejects.toThrow();
    }
  });

  it("a new occurrence cannot be born posted; a posted extension_id and renews are immutable", async () => {
    const { occ } = await setup();
    const p = await post(occ);
    await expect(db.q(`UPDATE payment_plan_occurrences SET extension_id = NULL WHERE id = $1`, [occ])).rejects.toThrow(/immutable/);
    await expect(db.q(`UPDATE payment_plan_occurrences SET renews = false WHERE id = $1`, [occ])).rejects.toThrow(/immutable/);
    const { planId: other } = await setup();
    await expect(
      db.q(
        `INSERT INTO payment_plan_occurrences (tenant_id, plan_id, rental_id, seq, due_date, due_at, period_start, period_end, amount, collection_method, renews, extension_id)
         SELECT tenant_id, id, rental_id, 9, '2026-10-02', now(), '2026-10-02', '2026-10-09', 1, 'manual', true, $2 FROM payment_plans WHERE id = $1`,
        [other, p.extensionId],
      ),
    ).rejects.toThrow(/cannot carry an extension/);
  });

  it("an extension a plan posted cannot be deleted from under it", async () => {
    const { occ } = await setup();
    const p = await post(occ);
    await db.q(`DELETE FROM ledger_entries WHERE extension_id = $1`, [p.extensionId]);
    await expect(db.q(`DELETE FROM rental_extensions WHERE id = $1`, [p.extensionId])).rejects.toThrow(/foreign key/);
  });
});

describe("pp_create_plan — a renewing plan", () => {
  it("starts on the rental's end date with exactly one period, a renewal; pp_get_plan returns the renewal block", async () => {
    const { r, planId, occ } = await setup();
    const o = await occRow(occ);
    expect([o.renews, o.extension_id, o.insurance_status, o.period_start, o.period_end, toCents(o.amount)]).toEqual([true, null, null, "2026-10-02", "2026-10-09", 36221]);
    const got = (await db.one<{ p: any }>(`SELECT pp_get_plan($1) p`, [planId]))!.p;
    expect(got.renewal).toEqual({ periodUnit: "week", periodCount: 1, insurance: null, sendAgreementEachPeriod: false });
    expect(got).toEqual({ ...renewalPlanJson(r), id: planId, status: "active", version: 1 });
  });

  it("refuses an anchor that is not the rental's end date (a gap of free days, or days billed twice)", async () => {
    const r = await seedRenewalRental();
    const plan = renewalPlanJson(r, { rule: { freq: "weekly", interval: 1, byWeekday: [6], anchor: "2026-10-03", firstOccurrence: "on_anchor", end: { kind: "open", through: "2026-10-03" } } });
    const drafts = [{ ...WEEK1[0], dueDate: "2026-10-03", periodStart: "2026-10-03", periodEnd: "2026-10-10" }];
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(plan), JSON.stringify(drafts)])).rejects.toThrow(/starts on the rental's end date \(2026-10-02\)/);
  });

  it("refuses more than one period at creation, or a first period that does not start on the anchor", async () => {
    const r = await seedRenewalRental();
    const two = [...WEEK1, { seq: 2, dueDate: "2026-10-09", periodStart: "2026-10-09", periodEnd: "2026-10-16", days: 7, amountCents: 36221, isStub: false }];
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(renewalPlanJson(r)), JSON.stringify(two)])).rejects.toThrow(/exactly one period/);
    const r2 = await seedRenewalRental();
    const shifted = [{ ...WEEK1[0], periodStart: "2026-10-03", periodEnd: "2026-10-10" }];
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(renewalPlanJson(r2)), JSON.stringify(shifted)])).rejects.toThrow(/exactly one period/);
    expect(await count(`SELECT count(*) n FROM payment_plans WHERE rental_id IN ($1, $2)`, [r.rentalId, r2.rentalId])).toBe(0);
  });

  it("a plan that does not renew serialises exactly as before (no renewal key) and its occurrences are not renewals", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    const { basePlanJson, BASE_DRAFTS } = await import("../harness/plan-fixture");
    const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(basePlanJson(r)), JSON.stringify(BASE_DRAFTS)]))!.id;
    const got = (await db.one<{ p: any }>(`SELECT pp_get_plan($1) p`, [planId]))!.p;
    expect("renewal" in got).toBe(false);
    expect(await count(`SELECT count(*) n FROM payment_plan_occurrences WHERE plan_id = $1 AND renews`, [planId])).toBe(0);
  });
});

describe("pp_post_renewal_period — the extension and its charges, atomically, once", () => {
  it("writes auto-extend's shape: an approved extension 10-02 → 10-09 and Extension Rental / Tax / Service Fee with its id, due on the period's end", async () => {
    const { r, planId, occ } = await setup();
    const p = await post(occ);
    expect(p).toEqual({ extensionId: expect.any(String), posted: true, sequenceNumber: 1, endDateMoved: false });
    const e = await ext(p.extensionId);
    expect([e.status, e.rental_id, e.sequence_number, e.previous_end_date, e.new_end_date, e.extension_days, toCents(e.rental_amount), toCents(e.tax_amount), toCents(e.service_fee_amount), toCents(e.insurance_amount)]).toEqual([
      "approved", r.rentalId, 1, "2026-10-02", "2026-10-09", 7, 33384, 2337, 500, 0,
    ]);
    expect(await charges(p.extensionId)).toEqual([
      ["Extension Rental", 33384, 33384, "2026-10-09"],
      ["Extension Tax", 2337, 2337, "2026-10-09"],
      ["Extension Service Fee", 500, 500, "2026-10-09"],
    ]);
    const refs = (await db.q<{ reference: string }>(`SELECT reference FROM ledger_entries WHERE extension_id = $1 ORDER BY amount DESC`, [p.extensionId])).map((x) => x.reference);
    expect(refs).toEqual(["Payment plan renewal #1: 7d (2026-10-02 → 2026-10-09)", "Payment plan renewal #1: Tax", "Payment plan renewal #1: Service Fee"]);
    const o = await occRow(occ);
    expect([o.extension_id, toCents(o.amount), o.insurance_status, o.status]).toEqual([p.extensionId, 36221, "none", "scheduled"]);
    expect((await events(planId, "period_posted")).map((x) => [x.dedupe_key, toCents(x.amount)])).toEqual([[`period_posted:${occ}`, 36221]]);
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
  });

  it("is idempotent per occurrence: a second post writes nothing and returns the same extension", async () => {
    const { r, occ } = await setup();
    const a = await post(occ);
    const b = await post(occ);
    expect(b).toEqual({ extensionId: a.extensionId, posted: false, sequenceNumber: 1, endDateMoved: false });
    expect(await count(`SELECT count(*) n FROM rental_extensions WHERE rental_id = $1`, [r.rentalId])).toBe(1);
    expect(await count(`SELECT count(*) n FROM ledger_entries WHERE rental_id = $1`, [r.rentalId])).toBe(3);
  });

  it("one extension can back only one occurrence (unique index), whatever writes it", async () => {
    const { occ } = await setup();
    const p = await post(occ);
    const { planId: p2 } = await setup();
    const occ2 = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1`, [p2]))!.id;
    await expect(db.q(`UPDATE payment_plan_occurrences SET extension_id = $2, insurance_status = 'none' WHERE id = $1`, [occ2, p.extensionId])).rejects.toThrow(/ux_payment_plan_occurrences_extension|duplicate key/);
  });

  it("writes no zero rows: with no tax, only Extension Rental and Service Fee", async () => {
    const r = await seedRenewalRental({ taxPercentage: 0 });
    const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(renewalPlanJson(r)), JSON.stringify(WEEK1)]))!.id;
    const occ = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1`, [planId]))!.id;
    const p = await post(occ, { rentalCents: 33384, taxCents: 0, serviceFeeCents: 500, totalCents: 33884 });
    expect((await charges(p.extensionId)).map((c) => [c[0], c[1]])).toEqual([["Extension Rental", 33384], ["Extension Service Fee", 500]]);
    expect(toCents((await occRow(occ)).amount)).toBe(33884);
  });

  it("checks the arithmetic: a total that is not the sum, a negative part, a zero total, an unknown key", async () => {
    const { occ } = await setup();
    for (const bd of [
      { ...BD, totalCents: 36220 },
      { ...BD, taxCents: -1, totalCents: 36220 - 2337 + 1 },
      { rentalCents: 0, taxCents: 0, serviceFeeCents: 0, totalCents: 0 },
      { ...BD, insuranceCents: 5 },
      { rentalCents: 1.5, taxCents: 0, serviceFeeCents: 0, totalCents: 1.5 },
    ]) {
      await expect(post(occ, bd)).rejects.toThrow();
    }
    expect((await occRow(occ)).extension_id).toBeNull();
  });

  it("refuses a period that is not a renewal, one already being collected, and one on a paused plan", async () => {
    const plain = await seedRental(db, { owedCents: 60000 });
    const { basePlanJson, BASE_DRAFTS } = await import("../harness/plan-fixture");
    const pid = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(basePlanJson(plain)), JSON.stringify(BASE_DRAFTS)]))!.id;
    const plainOcc = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1 AND seq = 1`, [pid]))!.id;
    await expect(post(plainOcc)).rejects.toThrow(/not a renewal period/);

    const { planId, occ } = await setup();
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [planId]);
    await expect(post(occ)).rejects.toThrow(/is paused/);
    await db.q(`SELECT pp_resume_plan($1, NULL, NULL)`, [planId]);
    await db.setNow("2026-10-02T14:00:00.000Z");
    await db.q(`SELECT * FROM pp_collect_due('2026-10-02T14:00:00Z', NULL, $1)`, [planId]);
    // A manual claim on an unposted period is refused (nothing on the ledger to pay) …
    expect(await claim(occ, "manual")).toEqual({ ok: false, reason: "not_claimable" });
    expect((await occRow(occ)).attempt_no).toBe(0);
  });

  it("is atomic: when a charge row cannot be written, no extension exists and the period stays unposted", async () => {
    const { r, occ } = await setup();
    await db.exec(`
      CREATE FUNCTION pg_temp_fail_tax() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.category = 'Extension Tax' THEN RAISE EXCEPTION 'injected: tax row refused'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER zz_fail_tax BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_tax();`);
    try {
      await expect(post(occ)).rejects.toThrow(/injected: tax row refused/);
    } finally {
      await db.exec(`DROP TRIGGER zz_fail_tax ON ledger_entries; DROP FUNCTION pg_temp_fail_tax();`);
    }
    expect(await count(`SELECT count(*) n FROM rental_extensions WHERE rental_id = $1`, [r.rentalId])).toBe(0);
    expect(await count(`SELECT count(*) n FROM ledger_entries WHERE rental_id = $1`, [r.rentalId])).toBe(0);
    const o = await occRow(occ);
    expect([o.extension_id, o.insurance_status]).toEqual([null, null]);
  });

  it("give the days now: the end date moves at posting (forward only), and the payment later moves nothing", async () => {
    const { r, planId, occ } = await setup();
    const p = await post(occ, BD, false, true);
    expect(p.endDateMoved).toBe(true);
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
    const rental = await db.one<any>(`SELECT previous_end_date, original_end_date FROM rentals WHERE id = $1`, [r.rentalId]);
    expect([rental.previous_end_date, rental.original_end_date]).toEqual(["2026-10-02", "2026-10-02"]);
    expect((await events(planId, "rental_extended")).map((e) => [e.dedupe_key, e.detail.via])).toEqual([[`rental_extended:given:${occ}`, "give_days_now"]]);
    await db.setNow("2026-10-02T14:00:00.000Z");
    await db.q(`SELECT * FROM pp_collect_due('2026-10-02T14:00:00Z', NULL, $1)`, [planId]);
    await cardSuccess(occ);
    expect((await ext(p.extensionId)).status).toBe("paid");
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
    expect((await events(planId, "rental_extended")).map((e) => [e.detail.via, e.detail.endDateMoved])).toEqual([["give_days_now", true], ["payment", false]]);
  });

  it("never shrinks: give-days-now on a rental whose end is already later leaves it", async () => {
    const { r, occ } = await setup();
    await db.q(`UPDATE rentals SET end_date = '2026-10-20' WHERE id = $1`, [r.rentalId]);
    const p = await post(occ, BD, false, true);
    expect(p.endDateMoved).toBe(false);
    expect(await endDate(r.rentalId)).toBe("2026-10-20");
  });
});

describe("collecting a renewal period — pp_claim, pp_record_success, finalize_rental_extension", () => {
  async function due(planId: string) {
    await db.setNow("2026-10-02T14:00:00.000Z");
    await db.q(`SELECT * FROM pp_collect_due('2026-10-02T14:00:00Z', NULL, $1)`, [planId]);
  }

  it("an unposted period, and one whose insurance is undecided, is not claimable", async () => {
    const { planId, occ } = await setup();
    await due(planId);
    expect(await claim(occ)).toEqual({ ok: false, reason: "not_claimable" });
    await post(occ, BD, true);
    expect((await occRow(occ)).insurance_status).toBe("pending");
    expect(await claim(occ)).toEqual({ ok: false, reason: "not_claimable" });
    expect(await claim(occ, "checkout_link")).toEqual({ ok: false, reason: "not_claimable" });
    expect(await count(`SELECT count(*) n FROM payment_plan_attempts WHERE occurrence_id = $1`, [occ])).toBe(0);
  });

  it("a card success pays THIS extension only, and finalize_rental_extension moves the end date in the same transaction", async () => {
    const { r, planId, occ } = await setup();
    // An older extension of the same rental, unpaid — a generic payment would pay it first (due earlier).
    const older = (await db.one<{ id: string }>(
      `INSERT INTO rental_extensions (rental_id, tenant_id, sequence_number, status, previous_end_date, new_end_date, extension_days)
       VALUES ($1, $2, 1, 'approved', '2026-09-25', '2026-10-02', 7) RETURNING id`,
      [r.rentalId, r.tenantId],
    ))!.id;
    await db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, extension_id, reference)
       VALUES ($1, $2, $3, '2026-09-25', '2026-10-02', 'Charge', 'Extension Rental', 100, 100, $4, 'older')`,
      [r.customerId, r.rentalId, r.tenantId, older],
    );
    const p = await post(occ);
    expect(p.sequenceNumber).toBe(2);
    await due(planId);
    const { claim: c, paymentId } = await cardSuccess(occ);
    expect(c.amountCents).toBe(36221);
    const pay = await db.one<any>(`SELECT extension_id, target_categories, status, booking_source FROM payments WHERE id = $1`, [paymentId]);
    expect(pay.extension_id).toBe(p.extensionId);
    expect(pay.target_categories).toEqual(["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Add-on", "Extension Insurance"]);
    expect([pay.status, pay.booking_source]).toEqual(["Applied", "payment_plan"]);
    expect((await charges(p.extensionId)).map((x) => x[2])).toEqual([0, 0, 0]);
    expect(toCents((await db.one<any>(`SELECT remaining_amount FROM ledger_entries WHERE extension_id = $1`, [older]))!.remaining_amount)).toBe(10000);
    const e = await ext(p.extensionId);
    expect([e.status, toCents(e.paid_amount), e.stripe_payment_intent_id]).toEqual(["paid", 36221, "pi_ok"]);
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
    const o = await occRow(occ);
    expect([o.status, toCents(o.amount_paid)]).toEqual(["paid", 36221]);
    expect((await events(planId, "rental_extended")).map((x) => [x.dedupe_key, x.detail.via, x.detail.endDateMoved, x.detail.endDate])).toEqual([
      [`rental_extended:${occ}`, "payment", true, "2026-10-09"],
    ]);
  });

  it("a declined charge moves nothing: the end date, the extension and its charges stay as they were", async () => {
    const { r, planId, occ } = await setup();
    const p = await post(occ);
    await due(planId);
    const c = await claim(occ);
    await db.q(`SELECT pp_mark_in_flight($1)`, [c.claim.attemptId]);
    await db.q(`SELECT pp_record_failure($1, 'failed', 'pi_x', 'insufficient_funds', 'card_declined', 'no', '2026-10-04T14:00:00Z')`, [c.claim.attemptId]);
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
    expect((await ext(p.extensionId)).status).toBe("approved");
    expect((await charges(p.extensionId)).map((x) => x[2])).toEqual([33384, 2337, 500]);
    expect(await count(`SELECT count(*) n FROM payments WHERE rental_id = $1`, [r.rentalId])).toBe(0);
    expect((await events(planId, "rental_extended")).length).toBe(0);
  });

  it("if finalize fails, NOTHING is recorded (no payment, attempt still in flight) — the engine then refunds", async () => {
    const { r, planId, occ } = await setup();
    await post(occ);
    await due(planId);
    const c = await claim(occ);
    await db.q(`SELECT pp_mark_in_flight($1)`, [c.claim.attemptId]);
    const live = (await db.one<{ def: string }>(`SELECT pg_get_functiondef('public.finalize_rental_extension(uuid,uuid)'::regprocedure) def`))!.def;
    await db.exec(`CREATE OR REPLACE FUNCTION public.finalize_rental_extension(p_extension_id uuid, p_payment_id uuid)
      RETURNS TABLE(out_extension_id uuid, out_rental_id uuid, out_previous_end_date date, out_new_end_date date, out_status text, out_end_date_updated boolean)
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected: finalize failed'; END $$;`);
    try {
      await expect(db.q(`SELECT pp_record_success($1, 36221, 'pi_ok', 'acct_x', 'test', 'stripe', 'uk', '2026-10-02', 'Card', NULL)`, [c.claim.attemptId])).rejects.toThrow(/injected: finalize failed/);
    } finally {
      await db.exec(live);
    }
    expect(await count(`SELECT count(*) n FROM payments WHERE rental_id = $1`, [r.rentalId])).toBe(0);
    expect((await db.one<any>(`SELECT status FROM payment_plan_attempts WHERE id = $1`, [c.claim.attemptId]))!.status).toBe("in_flight");
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
  });

  it("a partial manual record leaves the end date; the rest pays it and moves it", async () => {
    const { r, planId, occ } = await setup();
    await post(occ);
    await due(planId);
    // What recordManualPayment does: claim, record — and release the claim if the record is refused.
    const manual = async (cents: number) => {
      const c = await claim(occ, "manual");
      expect(c.ok, JSON.stringify(c)).toBe(true);
      try {
        return await db.q(`SELECT pp_record_success($1, $2, NULL, NULL, NULL, 'stripe', 'uk', '2026-10-02', 'Cash', NULL, 'desk', NULL)`, [c.claim.attemptId, cents]);
      } catch (e) {
        await db.q(`SELECT pp_record_failure($1, 'abandoned')`, [c.claim.attemptId]);
        throw e;
      }
    };
    await manual(20000);
    let o = await occRow(occ);
    expect([o.status, toCents(o.amount_paid)]).toEqual(["partially_paid", 20000]);
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
    // More than the 16221 still owed would be credit locked to this extension forever: refused.
    await expect(manual(16222)).rejects.toThrow(/owes 16221 cents/);
    await manual(16221);
    o = await occRow(occ);
    expect([o.status, toCents(o.amount_paid)]).toEqual(["paid", 36221]);
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
  });

  it("credit covers the period in full: no attempt, the period is PAID by the ledger, and the end date moves (finalize without a payment row)", async () => {
    const { r, planId, occ } = await setup();
    const creditId = await insertCompletedPayment(db, r, 50000, "2026-09-25");
    expect((await db.one<any>(`SELECT status FROM payments WHERE id = $1`, [creditId]))!.status).toBe("Credit");
    const p = await post(occ);
    await due(planId);
    expect(await claim(occ)).toEqual({ ok: false, reason: "nothing_owed" });
    const o = await occRow(occ);
    expect([o.status, toCents(o.amount_paid), o.attempt_no]).toEqual(["paid", 36221, 0]);
    const e = await ext(p.extensionId);
    expect([e.status, toCents(e.paid_amount)]).toEqual(["paid", 36221]);
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
    // The credit payment was NOT stamped with the extension (its remainder stays usable).
    const credit = await db.one<any>(`SELECT extension_id, status, remaining_amount FROM payments WHERE id = $1`, [creditId]);
    expect([credit.extension_id, credit.status, toCents(credit.remaining_amount)]).toEqual([null, "Partial", 13779]);
    expect((await events(planId, "covered_by_balance")).length).toBe(1);
    expect((await events(planId, "rental_extended")).map((x) => x.detail.via)).toEqual(["credit"]);
    // A renewing plan never completes by itself.
    expect((await db.one<any>(`SELECT status FROM payment_plans WHERE id = $1`, [planId]))!.status).toBe("active");
  });

  it("partial credit: the claim is only what the extension still owes (36221 − 13779 = 22442)", async () => {
    const { r, planId, occ } = await setup();
    await insertCompletedPayment(db, r, 13779, "2026-09-25");
    await post(occ);
    await due(planId);
    const { claim: c } = await cardSuccess(occ);
    expect(c.amountCents).toBe(22442);
    const o = await occRow(occ);
    expect([o.status, toCents(o.amount_paid)]).toEqual(["paid", 36221]);
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
  });

  it("a link paid for MORE than the period owes (priced while a 10000 base charge was open): the period is paid first, the rest pays the base charge — nothing stays locked to the extension", async () => {
    const r = await seedRental(db, {
      startDate: "2026-09-25",
      endDate: "2026-10-02",
      monthlyAmount: 350,
      discountApplied: 16.16,
      tenantPricing: { taxPercentage: 7, serviceFeeFixed: 5 },
      charges: [{ category: "Rental", amountCents: 10000, dueDate: "2026-09-25" }],
    });
    const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(renewalPlanJson(r, { collectionMethod: "checkout_link" })), JSON.stringify(WEEK1)]))!.id;
    const occ = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1`, [planId]))!.id;
    const p = await post(occ);
    await due(planId);
    const c = await claim(occ, "checkout_link");
    expect(c.claim.amountCents).toBe(36221);
    await db.q(`SELECT pp_mark_in_flight($1)`, [c.claim.attemptId]);
    // 36221 + 10000 = 46221: what payment-plan-pay's cap (the rental's owed) allowed.
    const payId = (await db.one<{ id: string }>(`SELECT pp_record_success($1, 46221, 'pi_link', 'acct_x', 'test', 'stripe', 'uk', '2026-10-02', 'Card', 'cs_1') id`, [c.claim.attemptId]))!.id;
    expect((await charges(p.extensionId)).map((x) => x[2])).toEqual([0, 0, 0]);
    expect(toCents((await db.one<any>(`SELECT remaining_amount FROM ledger_entries WHERE id = $1`, [r.chargeIds[0]]))!.remaining_amount)).toBe(0);
    const pay = await db.one<any>(`SELECT status, remaining_amount, target_categories, extension_id FROM payments WHERE id = $1`, [payId]);
    expect([pay.status, toCents(pay.remaining_amount), pay.target_categories, pay.extension_id]).toEqual(["Applied", 0, null, p.extensionId]);
    expect((await occRow(occ)).status).toBe("paid");
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
  });

  it("a written-off period (charges zeroed without money) is skipped when due, and its end date does NOT move", async () => {
    const { r, planId, occ } = await setup();
    const p = await post(occ);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE extension_id = $1`, [p.extensionId]);
    await due(planId);
    expect(await claim(occ)).toEqual({ ok: false, reason: "nothing_owed" });
    expect((await occRow(occ)).status).toBe("skipped");
    expect((await ext(p.extensionId)).status).toBe("approved");
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
  });
});

describe("pp_record_renewal_insurance — no premium without a policy", () => {
  it("insured: the Extension Insurance charge, the policy on the extension, and the premium on the period — before any attempt", async () => {
    const { planId, occ } = await setup();
    const p = await post(occ, BD, true);
    await db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify({ outcome: "insured", policyRef: UUID_A, premiumCents: 18865, coveredFrom: "2026-10-02", coveredTo: "2026-10-09" })]);
    expect((await charges(p.extensionId)).map((c) => [c[0], c[1]])).toEqual([["Extension Rental", 33384], ["Extension Tax", 2337], ["Extension Service Fee", 500], ["Extension Insurance", 18865]]);
    const e = await ext(p.extensionId);
    expect([toCents(e.insurance_amount), e.bonzah_policy_id, !!e.bonzah_confirmed_at]).toEqual([18865, UUID_A, true]);
    const o = await occRow(occ);
    expect([toCents(o.amount), o.insurance_status]).toEqual([55086, "insured"]);
    expect((await events(planId, "insurance_bought")).map((x) => toCents(x.amount))).toEqual([18865]);
  });

  it("refuses 'insured' without a policy or without a premium; not_insurable / failed add NOTHING", async () => {
    const { planId, occ } = await setup();
    const p = await post(occ, BD, true);
    for (const d of [{ outcome: "insured", premiumCents: 18865 }, { outcome: "insured", policyRef: UUID_A }, { outcome: "insured", policyRef: "not-a-uuid", premiumCents: 5 }, { outcome: "insured", policyRef: UUID_A, premiumCents: 0 }, { outcome: "bought" }]) {
      await expect(db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify(d)])).rejects.toThrow();
    }
    await db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify({ outcome: "not_insurable", reason: "tomorrow, Pacific" })]);
    expect((await charges(p.extensionId)).length).toBe(3);
    const o = await occRow(occ);
    expect([toCents(o.amount), o.insurance_status]).toEqual([36221, "not_insurable"]);
    expect((await ext(p.extensionId)).bonzah_policy_id).toBeNull();
    expect((await events(planId, "insurance_not_bought")).map((x) => x.detail.reason)).toEqual(["tomorrow, Pacific"]);
    // the same decision again is a no-op; a different one is refused
    await db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify({ outcome: "not_insurable", reason: "again" })]);
    await expect(db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify({ outcome: "insured", policyRef: UUID_A, premiumCents: 18865 })])).rejects.toThrow(/already decided/);
    expect((await charges(p.extensionId)).length).toBe(3);
  });

  it("never adds a premium to a period that is already being collected", async () => {
    const { planId, occ } = await setup();
    await post(occ, BD, true);
    await db.q(`UPDATE payment_plan_occurrences SET insurance_status = 'pending' WHERE id = $1`, [occ]);
    // Simulate a claim slipping in (only possible by hand — pp_claim refuses while pending):
    await db.setNow("2026-10-02T14:00:00.000Z");
    await db.q(`SELECT * FROM pp_collect_due('2026-10-02T14:00:00Z', NULL, $1)`, [planId]);
    await db.q(`UPDATE payment_plan_occurrences SET attempt_no = 1 WHERE id = $1`, [occ]);
    await expect(db.q(`SELECT pp_record_renewal_insurance($1, $2::jsonb)`, [occ, JSON.stringify({ outcome: "insured", policyRef: UUID_A, premiumCents: 18865 })])).rejects.toThrow(/already being collected/);
  });
});

describe("pp_append_renewal_period — the chain", () => {
  it("appends the next period where the chain ends, once, and moves the open plan's horizon", async () => {
    const { r, planId, occ } = await setup();
    await post(occ);
    const draft = { seq: 1, dueDate: "2026-10-09", periodStart: "2026-10-09", periodEnd: "2026-10-16", days: 7, amountCents: 36221, isStub: false };
    const a = (await db.one<{ r: any }>(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL) r`, [planId, JSON.stringify(draft)]))!.r;
    expect(a).toEqual({ occurrenceId: expect.any(String), appended: true });
    const b = (await db.one<{ r: any }>(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL) r`, [planId, JSON.stringify(draft)]))!.r;
    expect(b).toEqual({ occurrenceId: a.occurrenceId, appended: false });
    const o = await occRow(a.occurrenceId);
    expect([o.seq, o.renews, o.due_at, o.status, toCents(o.amount)]).toEqual([2, true, "2026-10-09T14:00:00.000Z", "scheduled", 36221]);
    expect((await db.one<{ p: any }>(`SELECT pp_get_plan($1) p`, [planId]))!.p.rule.end).toEqual({ kind: "open", through: "2026-10-09" });
    expect(await endDate(r.rentalId)).toBe("2026-10-02");
  });

  it("refuses a gap or an overlap, a bad period, and a plan that is not active", async () => {
    const { planId } = await setup();
    const mk = (start: string, end: string) => ({ seq: 1, dueDate: start, periodStart: start, periodEnd: end, days: 7, amountCents: 36221, isStub: false });
    await expect(db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [planId, JSON.stringify(mk("2026-10-10", "2026-10-17"))])).rejects.toThrow(/starts on 2026-10-09/);
    await expect(db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [planId, JSON.stringify(mk("2026-10-08", "2026-10-15"))])).rejects.toThrow(/starts on 2026-10-09/);
    await expect(db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [planId, JSON.stringify({ ...mk("2026-10-09", "2026-10-16"), days: 6 })])).rejects.toThrow(/days/);
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [planId]);
    await expect(db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [planId, JSON.stringify(mk("2026-10-09", "2026-10-16"))])).rejects.toThrow(/is paused/);
  });

  it("one live occurrence per period even if two writers race (unique index)", async () => {
    const { planId } = await setup();
    await expect(
      db.q(
        `INSERT INTO payment_plan_occurrences (tenant_id, plan_id, rental_id, seq, due_date, due_at, period_start, period_end, amount, collection_method, renews)
         SELECT tenant_id, id, rental_id, 7, '2026-10-02', now(), '2026-10-02', '2026-10-09', 1, 'manual', true FROM payment_plans WHERE id = $1`,
        [planId],
      ),
    ).rejects.toThrow(/ux_payment_plan_occurrences_renewal_period|duplicate key/);
  });
});

describe("the rest of the store around a renewal", () => {
  it("pp_reconcile_renewals: a period settled by a payment OUTSIDE the plan is paid and its end date moves", async () => {
    const { r, planId, occ } = await setup();
    const p = await post(occ);
    // An operator records a generic payment on the rental (no plan, no extension): the FIFO pays the period.
    await insertCompletedPayment(db, r, 36221, "2026-10-01");
    expect((await charges(p.extensionId)).map((c) => c[2])).toEqual([0, 0, 0]);
    const settled = (await db.q<{ id: string }>(`SELECT id FROM pp_reconcile_renewals(NULL, $1) id`, [planId])).map((x) => x.id);
    expect(settled).toEqual([occ]);
    expect((await occRow(occ)).status).toBe("paid");
    expect((await ext(p.extensionId)).status).toBe("paid");
    expect(await endDate(r.rentalId)).toBe("2026-10-09");
    expect((await db.q(`SELECT id FROM pp_reconcile_renewals(NULL, $1) id`, [planId])).length).toBe(0);
  });

  it("pp_reconcile_renewals leaves a written-off period, an undecided insurance, and a charge in flight alone", async () => {
    const a = await setup();
    const pa = await post(a.occ);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE extension_id = $1`, [pa.extensionId]);
    const b = await setup();
    await post(b.occ, BD, true);
    await insertCompletedPayment(db, b.r, 36221, "2026-10-01");
    const settled = await db.q(`SELECT id FROM pp_reconcile_renewals(NULL, NULL) id`);
    expect(settled.map((x: any) => x.id)).not.toContain(a.occ);
    expect(settled.map((x: any) => x.id)).not.toContain(b.occ);
    expect(await endDate(a.r.rentalId)).toBe("2026-10-02");
  });

  it("pp_replace_future refuses a renewing plan; on any other plan it never supersedes a renewal period", async () => {
    const { planId } = await setup();
    await expect(db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'x')`, [planId, JSON.stringify(WEEK1)])).rejects.toThrow(/renews the rental/);

    const plain = await seedRental(db, { owedCents: 60000, endDate: "2026-10-23" });
    const { basePlanJson, BASE_DRAFTS } = await import("../harness/plan-fixture");
    const pid = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(basePlanJson(plain)), JSON.stringify(BASE_DRAFTS)]))!.id;
    const extend = (await db.one<{ r: any }>(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL) r`, [
      pid,
      JSON.stringify({ seq: 1, dueDate: "2026-09-30", periodStart: "2026-10-23", periodEnd: "2026-10-30", days: 7, amountCents: 36221, isStub: false }),
    ]))!.r;
    await post(extend.occurrenceId);
    await db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'rev')`, [pid, JSON.stringify(BASE_DRAFTS)]);
    const statuses = await db.q<any>(`SELECT seq, renews, status FROM payment_plan_occurrences WHERE plan_id = $1 ORDER BY seq`, [pid]);
    expect(statuses.map((s) => [s.seq, s.renews, s.status])).toEqual([
      [1, false, "superseded"], [2, false, "superseded"], [3, false, "superseded"], [4, true, "scheduled"],
      [5, false, "scheduled"], [6, false, "scheduled"], [7, false, "scheduled"],
    ]);
  });

  it("pp_skip_occurrence refuses a renewal period and never rolls an amount into one", async () => {
    const { occ } = await setup();
    await expect(db.q(`SELECT pp_skip_occurrence($1, NULL)`, [occ])).rejects.toThrow(/renewal period/);
    const plain = await seedRental(db, { owedCents: 60000, endDate: "2026-10-23" });
    const { basePlanJson, BASE_DRAFTS } = await import("../harness/plan-fixture");
    const pid = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(basePlanJson(plain)), JSON.stringify(BASE_DRAFTS)]))!.id;
    await db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [
      pid,
      JSON.stringify({ seq: 1, dueDate: "2026-10-20", periodStart: "2026-10-23", periodEnd: "2026-10-30", days: 7, amountCents: 36221, isStub: false }),
    ]);
    const s3 = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id = $1 AND seq = 3`, [pid]))!.id;
    await expect(db.q(`SELECT pp_skip_occurrence($1, NULL)`, [s3])).rejects.toThrow(/last open occurrence/);
  });

  it("pp_list_renewal_plans: every active renewing plan, and a plan holding an unposted renewal period", async () => {
    const a = await setup();
    const plain = await seedRental(db, { owedCents: 60000, endDate: "2026-10-23" });
    const { basePlanJson, BASE_DRAFTS } = await import("../harness/plan-fixture");
    const pid = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb) id`, [JSON.stringify(basePlanJson(plain)), JSON.stringify(BASE_DRAFTS)]))!.id;
    const ids = async () => (await db.q<{ p: any }>(`SELECT p FROM pp_list_renewal_plans(NULL, NULL) p`)).map((x) => x.p.id);
    expect(await ids()).toContain(a.planId);
    expect(await ids()).not.toContain(pid);
    await db.q(`SELECT pp_append_renewal_period($1, $2::jsonb, NULL)`, [
      pid,
      JSON.stringify({ seq: 1, dueDate: "2026-10-20", periodStart: "2026-10-23", periodEnd: "2026-10-30", days: 7, amountCents: 36221, isStub: false }),
    ]);
    expect(await ids()).toContain(pid);
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [a.planId]);
    expect(await ids()).not.toContain(a.planId);
  });

  it("the event kinds CHECK allows the five new kinds and nothing else new", async () => {
    const { planId } = await setup();
    for (const kind of ["period_posted", "insurance_bought", "insurance_not_bought", "rental_extended", "agreement_choice"]) {
      await db.q(`SELECT pp_record_event($1::jsonb)`, [JSON.stringify({ planId, kind })]);
    }
    await expect(db.q(`SELECT pp_record_event($1::jsonb)`, [JSON.stringify({ planId, kind: "period_paid" })])).rejects.toThrow(/payment_plan_events_kind_check/);
  });
});

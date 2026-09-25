/**
 * The pp_* store contract (design §5) on real Postgres, with the LIVE FIFO
 * trigger doing the allocation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootDatabase, insertCompletedPayment, seedRental, toCents, type Db, type SeededRental } from "../harness/pglite";
import { BASE_DRAFTS, BASE_DUE_AT, basePlanJson } from "../harness/plan-fixture";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => db.setNow("2026-10-02T14:00:00.000Z"));

const RANDOM = "00000000-0000-4000-8000-000000000000";

interface Occ { id: string; seq: number; status: string; amount: string; amount_paid: string; attempt_no: number; due_date: string; due_at: string; next_attempt_at: string | null; plan_version: number }

async function setup(opts: { owedCents?: number; charges?: any[]; plan?: Record<string, unknown>; drafts?: unknown[] } = {}) {
  const r = await seedRental(db, { owedCents: opts.charges ? undefined : opts.owedCents ?? 60000, charges: opts.charges });
  const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb, NULL) id`, [
    JSON.stringify(basePlanJson(r, opts.plan)),
    JSON.stringify(opts.drafts ?? BASE_DRAFTS),
  ]))!.id;
  const occs = await listOcc(planId);
  return { r, planId, occs };
}
const listOcc = (planId: string) => db.q<Occ>(`SELECT * FROM payment_plan_occurrences WHERE plan_id=$1 ORDER BY seq`, [planId]);
const occ = async (id: string) => (await db.one<Occ>(`SELECT * FROM payment_plan_occurrences WHERE id=$1`, [id]))!;
const claim = async (occId: string, method = "auto_charge", account: string | null = "acct_x") =>
  (await db.one<{ r: any }>(`SELECT pp_claim($1, $2, $3) r`, [occId, method, account]))!.r;
const inFlight = (attemptId: string) => db.q(`SELECT pp_mark_in_flight($1)`, [attemptId]);
const success = async (attemptId: string, cents: number, o: { ref?: string | null; provider?: string; platform?: string; method?: string; cs?: string | null } = {}) =>
  (await db.one<{ id: string }>(`SELECT pp_record_success($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id`, [
    attemptId, cents, o.ref === undefined ? "pi_1" : o.ref, "acct_x", "test", o.provider ?? "stripe", o.platform ?? "uk", "2026-10-02",
    o.method ?? "Card", o.cs ?? null,
  ]))!.id;
const failure = (attemptId: string, status: string, next: string | null = null, decline: string | null = null) =>
  db.q(`SELECT pp_record_failure($1,$2,NULL,$3,NULL,NULL,$4)`, [attemptId, status, decline, next]);
const collect = (asOf: string, planId?: string) => db.q<Occ>(`SELECT * FROM pp_collect_due($1, NULL, $2)`, [asOf, planId ?? null]);
const owed = async (rentalId: string) => Number((await db.one<{ n: string }>(`SELECT pp_rental_owed_cents($1) n`, [rentalId]))!.n);
const events = (planId: string) => db.q<{ kind: string; dedupe_key: string | null; amount: string | null; occurrence_id: string | null }>(
  `SELECT kind, dedupe_key, amount, occurrence_id FROM payment_plan_events WHERE plan_id=$1 ORDER BY created_at, kind`, [planId]);

/** Claim → in_flight → success, the whole card path. */
async function chargeOk(occId: string, cents?: number) {
  const c = await claim(occId);
  expect(c.ok, JSON.stringify(c)).toBe(true);
  await inFlight(c.claim.attemptId);
  const pid = await success(c.claim.attemptId, cents ?? c.claim.amountCents);
  return { claim: c.claim, paymentId: pid };
}

describe("pp_create_plan / pp_get_plan", () => {
  it("writes the plan, three scheduled occurrences at 10:00 New York (14:00Z) and a plan_created event", async () => {
    const { r, planId, occs } = await setup();
    expect(occs.map((o) => [o.seq, o.due_date, o.due_at, o.amount, o.status, o.plan_version])).toEqual([
      [1, "2026-10-02", BASE_DUE_AT[0], "200.00", "scheduled", 1],
      [2, "2026-10-09", BASE_DUE_AT[1], "200.00", "scheduled", 1],
      [3, "2026-10-16", BASE_DUE_AT[2], "200.00", "scheduled", 1],
    ]);
    const plan = await db.one(`SELECT status, version, anchor_source FROM payment_plans WHERE id=$1`, [planId]);
    expect(plan).toEqual({ status: "active", version: 1, anchor_source: "rental_start" });
    expect((await events(planId)).map((e) => e.kind)).toEqual(["plan_created"]);
    // pp_get_plan returns types.ts PlanRow: the input, plus identity/status/version.
    const got = (await db.one<{ p: any }>(`SELECT pp_get_plan($1) p`, [planId]))!.p;
    expect(got).toEqual({ ...basePlanJson(r), id: planId, status: "active", version: 1 });
  });

  it("accepts a draft dueAt that agrees with Postgres and refuses one that does not", async () => {
    const ok = BASE_DRAFTS.map((d, i) => ({ ...d, dueAt: BASE_DUE_AT[i] }));
    await expect(setup({ drafts: ok })).resolves.toBeDefined();
    const bad = BASE_DRAFTS.map((d, i) => ({ ...d, dueAt: i === 1 ? "2026-10-09T13:00:00.000Z" : BASE_DUE_AT[i] }));
    await expect(setup({ drafts: bad })).rejects.toThrow(/disagrees with Postgres/);
  });

  it("refuses a rental of another tenant, and a customer that is not the rental's", async () => {
    const a = await seedRental(db, { owedCents: 100 });
    const b = await seedRental(db, { owedCents: 100 });
    const cross = { ...basePlanJson(a), tenantId: b.tenantId };
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(cross), JSON.stringify(BASE_DRAFTS)])).rejects.toThrow(/does not belong to tenant/);
    const wrongCustomer = { ...basePlanJson(a), customerId: b.customerId };
    await expect(db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(wrongCustomer), JSON.stringify(BASE_DRAFTS)])).rejects.toThrow(/does not belong to customer/);
  });

  it("refuses unknown fields, fractional cents, an unknown time zone and zero occurrences", async () => {
    const r = await seedRental(db, { owedCents: 100 });
    const call = (plan: unknown, drafts: unknown = BASE_DRAFTS) =>
      db.q(`SELECT pp_create_plan($1::jsonb, $2::jsonb)`, [JSON.stringify(plan), JSON.stringify(drafts)]);
    await expect(call({ ...basePlanJson(r), colour: "red" })).rejects.toThrow(/unknown field "colour"/);
    await expect(call({ ...basePlanJson(r), amount: { mode: "split_total", totalCents: 600.5 } })).rejects.toThrow(/bigint/);
    await expect(call({ ...basePlanJson(r), timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(call(basePlanJson(r), [])).rejects.toThrow(/at least one occurrence/);
    await expect(call(basePlanJson(r), [{ ...BASE_DRAFTS[0], amountCents: 0 }])).rejects.toThrow(/amount_check/);
  });
});

describe("pp_collect_due", () => {
  it("flips scheduled → due at due_at, not a second before", async () => {
    const { planId, occs } = await setup();
    expect(await collect("2026-10-02T13:59:59.999Z", planId)).toEqual([]);
    expect((await occ(occs[0].id)).status).toBe("scheduled");
    const due = await collect("2026-10-02T14:00:00.000Z", planId);
    expect(due.map((o) => [o.seq, o.status])).toEqual([[1, "due"]]);
  });

  it("returns failed rows only once next_attempt_at has passed", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await failure(c.claim.attemptId, "failed", "2026-10-04T14:00:00.000Z", "insufficient_funds");
    expect(await collect("2026-10-03T14:00:00.000Z", planId)).toEqual([]);
    expect((await collect("2026-10-04T14:00:00.000Z", planId)).map((o) => [o.seq, o.status])).toEqual([[1, "failed"]]);
  });

  it("a failed occurrence with no retry time is never returned (fallback / operator only)", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await failure(c.claim.attemptId, "failed", null, "expired_card");
    const later = await collect("2027-01-01T00:00:00.000Z", planId);
    expect(later.map((o) => o.seq)).toEqual([2, 3]); // the others fell due; occ1 never comes back
  });

  it("never flips or returns a paused plan's occurrences", async () => {
    const { planId, occs } = await setup();
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [planId]);
    expect(await collect("2026-10-20T00:00:00.000Z", planId)).toEqual([]);
    expect((await occ(occs[0].id)).status).toBe("scheduled");
  });

  it("returns a partially_paid occurrence once it is due (S10: collect the rest)", async () => {
    const { planId, occs } = await setup();
    await db.setNow("2026-10-01T15:00:00.000Z");
    const m = await claim(occs[0].id, "manual", null);
    await success(m.claim.attemptId, 5000, { method: "Cash", ref: null });
    expect((await occ(occs[0].id)).status).toBe("partially_paid");
    expect(await collect("2026-10-01T20:00:00.000Z", planId)).toEqual([]);
    expect((await collect(BASE_DUE_AT[0], planId)).map((o) => [o.seq, o.status])).toEqual([[1, "partially_paid"]]);
  });
});

describe("pp_claim", () => {
  it("claims a due occurrence: attempt 1, key pp:{account}:{occ}:1, amount = remaining, occurrence → processing", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id, "auto_charge", "acct_x");
    expect(c).toEqual({
      ok: true,
      claim: { attemptId: expect.any(String), attemptNo: 1, idempotencyKey: `pp:acct_x:${occs[0].id}:1`, amountCents: 20000 },
    });
    const o = await occ(occs[0].id);
    expect([o.status, o.attempt_no]).toEqual(["processing", 1]);
    const a = await db.one(`SELECT status, method, provider, provider_account, amount FROM payment_plan_attempts WHERE id=$1`, [c.claim.attemptId]);
    expect(a).toEqual({ status: "claimed", method: "auto_charge", provider: "stripe", provider_account: "acct_x", amount: "200.00" });
  });

  it("uses 'platform' in the key when there is no connected account", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id, "auto_charge", null);
    expect(c.claim.idempotencyKey).toBe(`pp:platform:${occs[0].id}:1`);
  });

  it("held_elsewhere while another attempt is claimed or in flight — whatever the method", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    expect(await claim(occs[0].id)).toEqual({ ok: false, reason: "held_elsewhere" });
    await inFlight(c.claim.attemptId);
    expect(await claim(occs[0].id, "manual", null)).toEqual({ ok: false, reason: "held_elsewhere" });
    expect(await claim(occs[0].id, "checkout_link")).toEqual({ ok: false, reason: "held_elsewhere" });
    expect(Number((await db.one<{ n: string }>(`SELECT count(*) n FROM payment_plan_attempts WHERE occurrence_id=$1`, [occs[0].id]))!.n)).toBe(1);
  });

  it("not_claimable: a scheduled occurrence (card), a paid one, a paused plan (card), a cancelled plan (any)", async () => {
    const a = await setup();
    expect(await claim(a.occs[0].id)).toEqual({ ok: false, reason: "not_claimable" }); // scheduled
    await collect(BASE_DUE_AT[0], a.planId);
    await chargeOk(a.occs[0].id);
    expect(await claim(a.occs[0].id)).toEqual({ ok: false, reason: "not_claimable" }); // paid

    const b = await setup();
    await collect(BASE_DUE_AT[0], b.planId);
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [b.planId]);
    expect(await claim(b.occs[0].id)).toEqual({ ok: false, reason: "not_claimable" });
    expect(await claim(b.occs[0].id, "checkout_link")).toEqual({ ok: false, reason: "not_claimable" });
    const m = await claim(b.occs[0].id, "manual", null); // the operator can still record money
    expect(m.ok).toBe(true);
    await db.q(`SELECT pp_record_failure($1,'abandoned')`, [m.claim.attemptId]);
    await db.q(`SELECT pp_cancel_plan($1, NULL, 'x')`, [b.planId]);
    expect(await claim(b.occs[0].id, "manual", null)).toEqual({ ok: false, reason: "not_claimable" });
  });

  it("a manual claim may take a scheduled occurrence and leaves its status alone; a link claim leaves requires_action alone", async () => {
    const { planId, occs } = await setup();
    const m = await claim(occs[1].id, "manual", null);
    expect(m.ok).toBe(true);
    expect((await occ(occs[1].id)).status).toBe("scheduled");

    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await failure(c.claim.attemptId, "requires_action", null, "authentication_required");
    const l = await claim(occs[0].id, "checkout_link");
    await inFlight(l.claim.attemptId);
    expect([(await occ(occs[0].id)).status, l.claim.attemptNo]).toEqual(["requires_action", 2]);
  });

  it("D5: never claims more than the rental owes", async () => {
    // The rental owes 150.00 in total; the occurrence asks 200.00.
    const { r, planId, occs } = await setup({ owedCents: 15000 });
    expect(await owed(r.rentalId)).toBe(15000);
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    expect(c.claim.amountCents).toBe(15000);
  });

  it("D5: applies unapplied rental credit first, then caps at what is still owed", async () => {
    // A 50.00 payment lands before any charge → Credit. A 100.00 Tax charge
    // follows (the live auto-allocate trigger only fires for Rental charges, so
    // the credit stays unapplied). Owed = 100 − 50 = 50.
    const r = await seedRental(db, {});
    const credit = await insertCompletedPayment(db, r, 5000);
    expect((await db.one<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [credit]))!.status).toBe("Credit");
    await db.q(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1,$2,$3,$4,'2026-10-02','2026-10-02','Charge','Tax',100,100,'tax')`,
      [r.customerId, r.rentalId, r.vehicleId, r.tenantId],
    );
    expect(await owed(r.rentalId)).toBe(5000);
    const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb,$2::jsonb) id`, [JSON.stringify(basePlanJson(r)), JSON.stringify(BASE_DRAFTS)]))!.id;
    const [o1] = await listOcc(planId);
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(o1.id);
    expect(c.claim.amountCents).toBe(5000);
    expect((await db.one<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [credit]))!.status).toBe("Applied");
  });

  it("nothing owed → the occurrence is skipped with ONE covered_by_balance event, and the plan completes when it was the last", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    await chargeOk(occs[0].id);
    await insertCompletedPayment(db, r, 40000, "2026-10-05"); // paid off outside the plan
    expect(await owed(r.rentalId)).toBe(0);
    await collect(BASE_DUE_AT[1], planId);
    expect(await claim(occs[1].id)).toEqual({ ok: false, reason: "nothing_owed" });
    await collect(BASE_DUE_AT[2], planId);
    expect(await claim(occs[2].id)).toEqual({ ok: false, reason: "nothing_owed" });
    expect((await listOcc(planId)).map((o) => o.status)).toEqual(["paid", "skipped", "skipped"]);
    const ev = (await events(planId)).map((e) => e.kind);
    expect(ev.filter((k) => k === "covered_by_balance")).toHaveLength(2);
    expect(ev.filter((k) => k === "plan_completed")).toHaveLength(1);
    expect((await db.one<{ status: string }>(`SELECT status FROM payment_plans WHERE id=$1`, [planId]))!.status).toBe("completed");
    expect(await db.q(`SELECT 1 FROM payment_plan_attempts a JOIN payment_plan_occurrences o ON o.id=a.occurrence_id WHERE o.id IN ($1,$2)`, [occs[1].id, occs[2].id])).toEqual([]);
  });

  it("two racing claims: the unique index, not the code path, is what stops the second", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    // Bypass pp_claim's own check and try to write the second holder directly.
    await expect(
      db.q(
        `INSERT INTO payment_plan_attempts (tenant_id, occurrence_id, attempt_no, method, idempotency_key, status, provider, provider_account, amount)
         SELECT tenant_id, id, 2, 'auto_charge', 'pp:acct_x:' || id || ':2', 'claimed', 'stripe', 'acct_x', 200 FROM payment_plan_occurrences WHERE id=$1`,
        [occs[0].id],
      ),
    ).rejects.toThrow(/ux_payment_plan_attempts_one_in_flight/);
    expect(c.ok).toBe(true);
  });
});

describe("pp_record_success", () => {
  it("one payments row, status 'Completed' on insert → the LIVE FIFO trigger applies it to the rental's charge", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const { claim: c, paymentId } = await chargeOk(occs[0].id);
    const p = await db.one<any>(`SELECT * FROM payments WHERE id=$1`, [paymentId]);
    expect({
      amount: p.amount, status: p.status, remaining: toCents(p.remaining_amount), payment_type: p.payment_type, booking_source: p.booking_source,
      occ: p.payment_plan_occurrence_id, capture: p.capture_status, pi: p.stripe_payment_intent_id, cs: p.stripe_checkout_session_id,
      provider: p.payment_provider, platform: p.platform_account, vehicle: p.vehicle_id, paid_at: p.paid_at, method: p.method,
    }).toEqual({
      amount: "200.00", status: "Applied", remaining: 0, payment_type: "Payment", booking_source: "payment_plan",
      occ: occs[0].id, capture: "captured", pi: "pi_1", cs: null, provider: "stripe", platform: "uk", vehicle: r.vehicleId,
      paid_at: "2026-10-02T14:00:00.000Z", method: "Card",
    });
    expect(await db.q(`SELECT remaining_amount FROM ledger_entries WHERE id=$1`, [r.chargeIds[0]])).toEqual([{ remaining_amount: "400.00" }]);
    expect(await db.q(`SELECT charge_entry_id, amount_applied FROM payment_applications WHERE payment_id=$1`, [paymentId])).toEqual([
      { charge_entry_id: r.chargeIds[0], amount_applied: "200.00" },
    ]);
    expect(await db.q(`SELECT category, amount FROM pnl_entries WHERE source_ref=$1`, [`${paymentId}_${r.chargeIds[0]}`])).toEqual([
      { category: "Rental", amount: "200.00" },
    ]);
    const o = await occ(occs[0].id);
    expect([o.status, o.amount_paid]).toEqual(["paid", "200.00"]);
    const a = await db.one(`SELECT status, payment_id, provider_mode FROM payment_plan_attempts WHERE id=$1`, [c.attemptId]);
    expect(a).toEqual({ status: "succeeded", payment_id: paymentId, provider_mode: "test" });
    expect(await owed(r.rentalId)).toBe(40000);
  });

  it("is idempotent: a second call returns the same payment id and writes nothing", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const { claim: c, paymentId } = await chargeOk(occs[0].id);
    const again = await success(c.attemptId, 20000);
    expect(again).toBe(paymentId);
    expect(await db.q(`SELECT id FROM payments WHERE payment_plan_occurrence_id=$1`, [occs[0].id])).toEqual([{ id: paymentId }]);
    expect((await events(planId)).filter((e) => e.kind === "charge_succeeded")).toHaveLength(1);
  });

  it("is atomic: a failure at its LAST step leaves no payment, no allocation, no P&L, and the attempt still in flight", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    // Force a failure inside pp_record_success: its final write is the event row.
    await db.exec(`CREATE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
                   CREATE TRIGGER test_boom BEFORE INSERT ON payment_plan_events FOR EACH ROW EXECUTE FUNCTION test_boom();`);
    try {
      await expect(success(c.claim.attemptId, 20000)).rejects.toThrow(/boom/);
    } finally {
      await db.exec(`DROP TRIGGER test_boom ON payment_plan_events; DROP FUNCTION test_boom();`);
    }
    expect(await db.q(`SELECT 1 FROM payments WHERE rental_id=$1`, [r.rentalId])).toEqual([]);
    expect(await db.q(`SELECT 1 FROM payment_applications pa JOIN ledger_entries le ON le.id=pa.charge_entry_id WHERE le.rental_id=$1`, [r.rentalId])).toEqual([]);
    expect(await db.q(`SELECT 1 FROM pnl_entries WHERE source_ref LIKE '%' || $1`, [r.chargeIds[0]])).toEqual([]);
    expect(await db.q(`SELECT remaining_amount FROM ledger_entries WHERE id=$1`, [r.chargeIds[0]])).toEqual([{ remaining_amount: "600.00" }]);
    expect(await db.one(`SELECT status, payment_id FROM payment_plan_attempts WHERE id=$1`, [c.claim.attemptId])).toEqual({ status: "in_flight", payment_id: null });
    expect((await occ(occs[0].id)).status).toBe("processing");
    // …and the same call then succeeds from that clean state.
    const pid = await success(c.claim.attemptId, 20000);
    expect((await db.q(`SELECT id FROM payments WHERE rental_id=$1`, [r.rentalId])).map((x: any) => x.id)).toEqual([pid]);
  });

  it("is atomic on a payments CHECK too (platform_account 'xx' → nothing written)", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await expect(success(c.claim.attemptId, 20000, { platform: "xx" })).rejects.toThrow(/payments_platform_account_check/);
    expect(await db.q(`SELECT 1 FROM payments WHERE rental_id=$1`, [r.rentalId])).toEqual([]);
    expect((await db.one<{ status: string }>(`SELECT status FROM payment_plan_attempts WHERE id=$1`, [c.claim.attemptId]))!.status).toBe("in_flight");
  });

  it("D5 at the money boundary: a card success for more than was claimed is refused", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await expect(success(c.claim.attemptId, 20001)).rejects.toThrow(/claimed 20000 cents, provider reported 20001/);
    expect(await db.q(`SELECT 1 FROM payments WHERE rental_id=$1`, [r.rentalId])).toEqual([]);
  });

  it("a card success reported on another account than the claim's is refused (the account is part of the key)", async () => {
    const { r, planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id, "auto_charge", "acct_other");
    await inFlight(c.claim.attemptId);
    await expect(success(c.claim.attemptId, 20000)).rejects.toThrow(/claimed on account acct_other, provider reported acct_x/);
    expect(await db.q(`SELECT 1 FROM payments WHERE rental_id=$1`, [r.rentalId])).toEqual([]);
  });

  it("writes the provider handle for its provider only (Square: square_payment_id; the exclusivity CHECK holds)", async () => {
    const { planId, occs } = await setup({ plan: { paymentProvider: "square" } });
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await expect(success(c.claim.attemptId, 20000, { provider: "square", cs: "cs_x" })).rejects.toThrow(/Square payment has no Stripe checkout session/);
    const pid = await success(c.claim.attemptId, 20000, { provider: "square", ref: "sqpay_1" });
    expect(await db.one(`SELECT payment_provider, square_payment_id, stripe_payment_intent_id FROM payments WHERE id=$1`, [pid])).toEqual({
      payment_provider: "square", square_payment_id: "sqpay_1", stripe_payment_intent_id: null,
    });
  });

  it("a manual record: no provider handle, no capture status, a manual_recorded event; a part-payment → partially_paid", async () => {
    const { planId, occs } = await setup();
    await db.setNow("2026-10-01T15:00:00.000Z");
    const m = await claim(occs[0].id, "manual", null);
    expect(m.claim.idempotencyKey).toBe(`pp:platform:${occs[0].id}:1`);
    const pid = await success(m.claim.attemptId, 5000, { method: "Cash", ref: null });
    expect(await db.one(`SELECT method, capture_status, stripe_payment_intent_id, status FROM payments WHERE id=$1`, [pid])).toEqual({
      method: "Cash", capture_status: null, stripe_payment_intent_id: null, status: "Applied",
    });
    const o = await occ(occs[0].id);
    expect([o.status, o.amount_paid]).toEqual(["partially_paid", "50.00"]);
    expect((await events(planId)).map((e) => e.kind)).toContain("manual_recorded");
  });

  it("a checkout-link success records the session id on the payment and settles a requires_action occurrence straight to paid", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await failure(c.claim.attemptId, "requires_action", null, "authentication_required");
    const l = await claim(occs[0].id, "checkout_link");
    await inFlight(l.claim.attemptId);
    const pid = await success(l.claim.attemptId, 20000, { ref: "pi_link", cs: "cs_link" });
    expect(await db.one(`SELECT stripe_checkout_session_id, stripe_payment_intent_id FROM payments WHERE id=$1`, [pid])).toEqual({
      stripe_checkout_session_id: "cs_link", stripe_payment_intent_id: "pi_link",
    });
    expect((await occ(occs[0].id)).status).toBe("paid");
  });
});

describe("pp_settle_occurrence — partial, full, refund (D12)", () => {
  it("refunded in full → re-opened as due, attempt_no kept; a card claim is then refused, a manual one is not", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const { paymentId } = await chargeOk(occs[0].id);
    // What process-refund writes on a full refund.
    await db.q(`UPDATE payments SET refund_amount = 200, status = 'Refunded' WHERE id=$1`, [paymentId]);
    const s = (await db.one<{ r: any }>(`SELECT to_jsonb(pp_settle_occurrence($1)) r`, [occs[0].id]))!.r;
    expect([s.status, s.amount_paid, s.attempt_no, s.paid_at]).toEqual(["due", 0, 1, null]);
    // It is due, and collect_due returns it — the refusal must come from the claim.
    expect((await collect("2026-10-03T14:00:00.000Z", planId)).map((o) => o.id)).toContain(occs[0].id);
    expect(await claim(occs[0].id, "auto_charge")).toEqual({ ok: false, reason: "not_claimable" });
    const m = await claim(occs[0].id, "manual", null);
    expect(m.ok).toBe(true);
  });

  it("refunded in part → partially_paid; a card claim is still refused", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const { paymentId } = await chargeOk(occs[0].id);
    await db.q(`UPDATE payments SET refund_amount = 50, status = 'Partial Refund' WHERE id=$1`, [paymentId]);
    const s = (await db.one<{ r: any }>(`SELECT to_jsonb(pp_settle_occurrence($1)) r`, [occs[0].id]))!.r;
    expect([s.status, s.amount_paid]).toEqual(["partially_paid", 150]);
    expect((await collect("2026-10-03T14:00:00.000Z", planId)).map((o) => o.id)).toContain(occs[0].id);
    expect(await claim(occs[0].id, "auto_charge")).toEqual({ ok: false, reason: "not_claimable" });
  });

  it("a pre-auth (requires_capture) linked payment does not count as paid", async () => {
    const { r, planId, occs } = await setup();
    await db.q(
      `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_date, payment_type, status, capture_status, payment_plan_occurrence_id)
       VALUES ($1,$2,$3,200,200,'2026-10-02','Payment','Pending','requires_capture',$4)`,
      [r.customerId, r.rentalId, r.tenantId, occs[0].id],
    );
    const s = (await db.one<{ r: any }>(`SELECT to_jsonb(pp_settle_occurrence($1)) r`, [occs[0].id]))!.r;
    expect([s.status, s.amount_paid]).toEqual(["scheduled", 0]);
    expect(planId).toBeTruthy();
  });

  it("the plan completes when every occurrence is paid — one plan_completed event", async () => {
    const { planId, occs } = await setup();
    for (const [i, o] of occs.entries()) {
      await db.setNow(BASE_DUE_AT[i]);
      await collect(BASE_DUE_AT[i], planId);
      await chargeOk(o.id);
    }
    expect((await db.one<{ status: string }>(`SELECT status FROM payment_plans WHERE id=$1`, [planId]))!.status).toBe("completed");
    expect((await events(planId)).filter((e) => e.kind === "plan_completed")).toHaveLength(1);
  });
});

describe("refunds written by anyone re-settle the occurrence (payments trigger)", () => {
  /** A paid occurrence 1 and its payment. */
  async function paidOcc1() {
    const x = await setup();
    await collect(BASE_DUE_AT[0], x.planId);
    const { paymentId } = await chargeOk(x.occs[0].id);
    return { ...x, paymentId };
  }

  it("the webhook's plain UPDATE of refund_amount + status re-opens the occurrence (D12), and a card claim is then refused", async () => {
    const { planId, occs, paymentId } = await paidOcc1();
    // charge.refunded / process-refund write exactly this; no pp_* call.
    await db.q(`UPDATE payments SET refund_amount = 200, status = 'Refunded' WHERE id = $1`, [paymentId]);
    const o = await occ(occs[0].id);
    expect([o.status, o.amount_paid, o.attempt_no]).toEqual(["due", "0.00", 1]);
    expect((await collect("2026-10-03T14:00:00.000Z", planId)).map((x) => x.id)).toContain(occs[0].id);
    expect(await claim(occs[0].id)).toEqual({ ok: false, reason: "not_claimable" });
  });

  it("the same UPDATE made by portal staff (authenticated) also re-opens it — the trigger does not need their EXECUTE grant", async () => {
    const { r, occs, paymentId } = await paidOcc1();
    const staff = "44444444-4444-4444-8444-444444444444";
    await db.q(`INSERT INTO app_users (auth_user_id, email, role, tenant_id) VALUES ($1, 'staff@x.test', 'admin', $2) ON CONFLICT DO NOTHING`, [staff, r.tenantId]);
    const seen = await db.asRole("authenticated", staff, async (tx) => {
      await tx.q(`UPDATE payments SET refund_amount = 200, status = 'Refunded' WHERE id = $1`, [paymentId]);
      return (await tx.q<{ status: string }>(`SELECT status FROM payment_plan_occurrences WHERE id = $1`, [occs[0].id]))[0]?.status;
    });
    expect(seen).toBe("due"); // (asRole rolls back afterwards)
  });

  it("a partial refund → partially_paid; a chargeback reversal → due", async () => {
    const a = await paidOcc1();
    await db.q(`UPDATE payments SET refund_amount = 50, status = 'Partial Refund' WHERE id = $1`, [a.paymentId]);
    expect([(await occ(a.occs[0].id)).status, (await occ(a.occs[0].id)).amount_paid]).toEqual(["partially_paid", "150.00"]);
    const b = await paidOcc1();
    await db.q(`UPDATE payments SET status = 'Reversed' WHERE id = $1`, [b.paymentId]);
    expect([(await occ(b.occs[0].id)).status, (await occ(b.occs[0].id)).amount_paid]).toEqual(["due", "0.00"]);
    expect(await claim(b.occs[0].id)).toEqual({ ok: false, reason: "not_claimable" });
  });

  it("payment_intent.succeeded's Completed → Applied flip leaves a paid occurrence paid (no event, no FIFO re-run, no ledger change)", async () => {
    const { r, planId, occs, paymentId } = await paidOcc1();
    const before = { ev: (await events(planId)).length, ledger: await db.q(`SELECT remaining_amount FROM ledger_entries WHERE rental_id=$1`, [r.rentalId]) };
    await db.q(`UPDATE payments SET status = 'Completed' WHERE id = $1`, [paymentId]);
    await db.q(`UPDATE payments SET status = 'Applied' WHERE id = $1`, [paymentId]);
    const o = await occ(occs[0].id);
    expect([o.status, o.amount_paid, o.attempt_no]).toEqual(["paid", "200.00", 1]);
    expect((await events(planId)).length).toBe(before.ev);
    expect(await db.q(`SELECT remaining_amount FROM ledger_entries WHERE rental_id=$1`, [r.rentalId])).toEqual(before.ledger);
    expect(await db.q(`SELECT count(*)::int n FROM payment_applications WHERE payment_id=$1`, [paymentId])).toEqual([{ n: 1 }]);
  });

  it("does not fire for a payment with no occurrence, nor for an UPDATE that changes neither refund nor status", async () => {
    const tg = await db.one<{ def: string }>(`SELECT pg_get_triggerdef(oid) def FROM pg_trigger WHERE tgname = 'pp_payment_settles_occurrence'`);
    expect(tg!.def).toMatch(/AFTER UPDATE ON public\.payments FOR EACH ROW WHEN \(\(\(new\.payment_plan_occurrence_id IS NOT NULL\) AND/);
    const { r, occs, paymentId } = await paidOcc1();
    const stamp = async () => (await occ(occs[0].id)) as any;
    const before = await stamp();
    await db.setNow("2026-10-05T00:00:00.000Z"); // a settle now would move updated_at
    const external = await insertCompletedPayment(db, r, 1000, "2026-10-04");
    await db.q(`UPDATE payments SET refund_amount = 10, status = 'Refunded' WHERE id = $1`, [external]);
    await db.q(`UPDATE payments SET method = 'Card (external)' WHERE id = $1`, [paymentId]);
    expect((await stamp()).updated_at).toBe(before.updated_at);
  });
});

describe("pp_record_success — who and why on a manual record", () => {
  it("p_note and p_actor land on the attempt (created_by) and the event (actor_id, detail.note)", async () => {
    const { r, planId, occs } = await setup();
    const actor = (await db.one<{ id: string }>(`INSERT INTO app_users (email, role, tenant_id) VALUES ('op@x.test', 'admin', $1) RETURNING id`, [r.tenantId]))!.id;
    const m = await claim(occs[0].id, "manual", null);
    const pid = (await db.one<{ id: string }>(`SELECT pp_record_success($1, 20000, NULL, NULL, NULL, 'stripe', 'uk', '2026-10-01', 'Cash', NULL, $2, $3) id`, [
      m.claim.attemptId, "Paid at the desk", actor,
    ]))!.id;
    expect(pid).toBeTruthy();
    expect(await db.one(`SELECT created_by FROM payment_plan_attempts WHERE id=$1`, [m.claim.attemptId])).toEqual({ created_by: actor });
    const ev = await db.one<any>(`SELECT actor_id, detail FROM payment_plan_events WHERE plan_id=$1 AND kind='manual_recorded'`, [planId]);
    expect([ev.actor_id, ev.detail.note]).toEqual([actor, "Paid at the desk"]);
  });

  it("exactly one pp_record_success exists (no stale 10-argument overload for PostgREST to trip on)", async () => {
    const rows = await db.q<{ sig: string }>(`SELECT oid::regprocedure::text sig FROM pg_proc WHERE proname = 'pp_record_success'`);
    expect(rows).toEqual([{ sig: "pp_record_success(uuid,bigint,text,text,text,text,text,date,text,text,text,uuid)" }]);
  });
});

describe("pp_record_failure / pp_stale_attempts", () => {
  it("failed → occurrence failed with its retry time; requires_action → requires_action; abandoned → back to due", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[2], planId);
    const a = await claim(occs[0].id); await inFlight(a.claim.attemptId);
    await failure(a.claim.attemptId, "failed", "2026-10-04T14:00:00.000Z", "insufficient_funds");
    const b = await claim(occs[1].id); await inFlight(b.claim.attemptId);
    await failure(b.claim.attemptId, "requires_action", null, "authentication_required");
    const c = await claim(occs[2].id);
    await failure(c.claim.attemptId, "abandoned");
    const all = await listOcc(planId);
    expect(all.map((o) => [o.status, o.next_attempt_at, o.attempt_no])).toEqual([
      ["failed", "2026-10-04T14:00:00.000Z", 1],
      ["requires_action", null, 1],
      ["due", null, 1],
    ]);
    const att = await db.one(`SELECT status, decline_code, finished_at FROM payment_plan_attempts WHERE id=$1`, [a.claim.attemptId]);
    expect(att).toEqual({ status: "failed", decline_code: "insufficient_funds", finished_at: "2026-10-02T14:00:00.000Z" });
  });

  it("indeterminate keeps the occurrence processing; stale after the lease, never a checkout link", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[1], planId);
    const a = await claim(occs[0].id); await inFlight(a.claim.attemptId);
    await failure(a.claim.attemptId, "indeterminate");
    expect((await occ(occs[0].id)).status).toBe("processing");
    const l = await claim(occs[1].id, "checkout_link"); await inFlight(l.claim.attemptId);
    const stale = (asOf: string) => db.q<{ id: string }>(`SELECT id FROM pp_stale_attempts(600, $1) s WHERE s.occurrence_id IN ($2,$3)`, [asOf, occs[0].id, occs[1].id]);
    expect(await stale("2026-10-02T14:09:59.000Z")).toEqual([]);
    expect((await stale("2026-10-02T14:10:00.000Z")).map((x) => x.id)).toEqual([a.claim.attemptId]);
  });

  it("a succeeded attempt cannot be failed afterwards", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const { claim: c } = await chargeOk(occs[0].id);
    await expect(failure(c.attemptId, "failed")).rejects.toThrow(/already succeeded/);
  });
});

describe("pp_replace_future", () => {
  it("supersedes open occurrences, appends seqs after the max, bumps the version, writes one revision", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    await chargeOk(occs[0].id);
    const patch = { rule: { freq: "weekly", interval: 2, byWeekday: [5], anchor: "2026-10-16", firstOccurrence: "on_anchor", end: { kind: "count", count: 2 } } };
    const drafts = [
      { seq: 1, dueDate: "2026-10-16", periodStart: "2026-10-16", periodEnd: "2026-10-30", days: 14, amountCents: 20000, isStub: false },
      { seq: 2, dueDate: "2026-10-30", periodStart: "2026-10-30", periodEnd: "2026-11-13", days: 14, amountCents: 20000, isStub: false },
    ];
    await expect(db.q(`SELECT pp_replace_future($1, 7, $2::jsonb, $3::jsonb, NULL, 'x')`, [planId, JSON.stringify(patch), JSON.stringify(drafts)])).rejects.toThrow(/version conflict/);
    const v = (await db.one<{ v: number }>(`SELECT pp_replace_future($1, 1, $2::jsonb, $3::jsonb, NULL, 'every 2 weeks') v`, [planId, JSON.stringify(patch), JSON.stringify(drafts)]))!.v;
    expect(v).toBe(2);
    expect((await listOcc(planId)).map((o) => [o.seq, o.due_date, o.status, o.amount, o.plan_version])).toEqual([
      [1, "2026-10-02", "paid", "200.00", 1],
      [2, "2026-10-09", "superseded", "200.00", 1],
      [3, "2026-10-16", "superseded", "200.00", 1],
      [4, "2026-10-16", "scheduled", "200.00", 2],
      [5, "2026-10-30", "scheduled", "200.00", 2],
    ]);
    const rev = await db.q<any>(`SELECT version, reason, before->'rule'->>'interval' b, after->'rule'->>'interval' a FROM payment_plan_revisions WHERE plan_id=$1`, [planId]);
    expect(rev).toEqual([{ version: 2, reason: "every 2 weeks", b: "1", a: "2" }]);
    expect((await db.one<{ interval_count: number; version: number }>(`SELECT interval_count, version FROM payment_plans WHERE id=$1`, [planId]))).toEqual({ interval_count: 2, version: 2 });
  });

  it("refuses while a card charge is in flight; refuses unknown / status patches", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await expect(db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'x')`, [planId, JSON.stringify(BASE_DRAFTS)])).rejects.toThrow(/charge in flight/);
    await failure(c.claim.attemptId, "abandoned");
    await expect(db.q(`SELECT pp_replace_future($1, 1, '{"status":"paused"}'::jsonb, $2::jsonb, NULL, 'x')`, [planId, JSON.stringify(BASE_DRAFTS)])).rejects.toThrow(/cannot be patched/);
    await expect(db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, '  ')`, [planId, JSON.stringify(BASE_DRAFTS)])).rejects.toThrow(/reason is required/);
  });

  it("abandons an open checkout link on a superseded occurrence (a late payment on it is still recordable)", async () => {
    const { planId, occs } = await setup({ plan: { collectionMethod: "checkout_link" } });
    await collect(BASE_DUE_AT[0], planId);
    const l = await claim(occs[0].id, "checkout_link"); await inFlight(l.claim.attemptId);
    await db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'redo')`, [planId, JSON.stringify(BASE_DRAFTS)]);
    expect((await db.one<{ status: string }>(`SELECT status FROM payment_plan_attempts WHERE id=$1`, [l.claim.attemptId]))!.status).toBe("abandoned");
    const pid = await success(l.claim.attemptId, 20000, { cs: "cs_late" });
    expect(pid).toBeTruthy();
    const o = await occ(occs[0].id);
    expect([o.status, o.amount_paid]).toEqual(["superseded", "200.00"]); // history row records the money, never moves
  });
});

describe("pp_skip_occurrence / pp_move_occurrence / pp_set_method", () => {
  it("skip rolls the remaining amount into the next open occurrence and refuses the last", async () => {
    const { planId, occs } = await setup();
    await db.q(`SELECT pp_skip_occurrence($1, NULL)`, [occs[1].id]);
    expect((await listOcc(planId)).map((o) => [o.seq, o.status, o.amount])).toEqual([
      [1, "scheduled", "200.00"], [2, "skipped", "200.00"], [3, "scheduled", "400.00"],
    ]);
    await expect(db.q(`SELECT pp_skip_occurrence($1, NULL)`, [occs[2].id])).rejects.toThrow(/last open occurrence/);
    const ev = (await events(planId)).find((e) => e.kind === "occurrence_skipped")!;
    expect([ev.occurrence_id, ev.amount]).toEqual([occs[1].id, "200.00"]);
  });

  it("skip on a part-paid occurrence rolls only what is left", async () => {
    const { planId, occs } = await setup();
    const m = await claim(occs[0].id, "manual", null);
    await success(m.claim.attemptId, 5000, { method: "Cash", ref: null });
    await db.q(`SELECT pp_skip_occurrence($1, NULL)`, [occs[0].id]);
    expect((await listOcc(planId)).map((o) => o.amount)).toEqual(["200.00", "350.00", "200.00"]);
  });

  it("move recomputes due_at in the plan's zone (across the DST end) and keeps the first moved_from", async () => {
    const { planId, occs } = await setup();
    await db.q(`SELECT pp_move_occurrence($1, '2026-10-12', NULL)`, [occs[1].id]);
    await db.q(`SELECT pp_move_occurrence($1, '2026-11-02', NULL)`, [occs[1].id]);
    const o = await db.one(`SELECT due_date, due_at, moved_from FROM payment_plan_occurrences WHERE id=$1`, [occs[1].id]);
    expect(o).toEqual({ due_date: "2026-11-02", due_at: "2026-11-02T15:00:00.000Z", moved_from: "2026-10-09" });
    expect((await events(planId)).filter((e) => e.kind === "occurrence_moved")).toHaveLength(2);
  });

  it("move / skip / set_method refuse a paid or processing occurrence", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await expect(db.q(`SELECT pp_move_occurrence($1, '2026-10-12', NULL)`, [occs[0].id])).rejects.toThrow(/is processing/);
    await expect(db.q(`SELECT pp_skip_occurrence($1, NULL)`, [occs[0].id])).rejects.toThrow(/is processing/);
    await expect(db.q(`SELECT pp_set_method($1, 'manual', NULL)`, [occs[0].id])).rejects.toThrow(/is processing/);
    await inFlight(c.claim.attemptId);
    await success(c.claim.attemptId, 20000);
    await expect(db.q(`SELECT pp_move_occurrence($1, '2026-10-12', NULL)`, [occs[0].id])).rejects.toThrow(/is paid/);
  });
});

describe("pause / resume / cancel", () => {
  it("pause and resume refuse the wrong state; cancel abandons open links and cancels open occurrences", async () => {
    const { planId, occs } = await setup();
    await expect(db.q(`SELECT pp_resume_plan($1, NULL, NULL)`, [planId])).rejects.toThrow(/not paused/);
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [planId]);
    await expect(db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [planId])).rejects.toThrow(/not active/);
    await db.q(`SELECT pp_resume_plan($1, NULL, NULL)`, [planId]);
    await collect(BASE_DUE_AT[0], planId);
    const l = await claim(occs[0].id, "checkout_link"); await inFlight(l.claim.attemptId);
    await db.q(`SELECT pp_cancel_plan($1, NULL, 'customer left')`, [planId]);
    expect((await listOcc(planId)).map((o) => o.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect((await db.one<{ status: string }>(`SELECT status FROM payment_plan_attempts WHERE id=$1`, [l.claim.attemptId]))!.status).toBe("abandoned");
    expect((await events(planId)).map((e) => e.kind)).toEqual(expect.arrayContaining(["plan_paused", "plan_resumed", "plan_cancelled"]));
  });

  it("cancel refuses while a card charge is in flight", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    await claim(occs[0].id);
    await expect(db.q(`SELECT pp_cancel_plan($1, NULL, 'x')`, [planId])).rejects.toThrow(/charge in flight/);
  });
});

describe("pp_list_for_reminders / pp_record_event", () => {
  it("windows on the PLAN-LOCAL date: 2026-09-30T03:00Z is still 09-29 in New York", async () => {
    const { planId, occs } = await setup();
    const at = (asOf: string) => db.q<{ id: string }>(`SELECT id FROM pp_list_for_reminders($1, 2, NULL, $2)`, [asOf, planId]);
    expect(await at("2026-09-30T03:00:00.000Z")).toEqual([]); // local 09-29: 10-02 is 3 days away
    expect((await at("2026-09-30T05:00:00.000Z")).map((x) => x.id)).toEqual([occs[0].id]); // local 09-30
  });

  it("dedupes on dedupe_key: first insert true, second false, one row", async () => {
    const { planId, occs } = await setup();
    const ev = { planId, occurrenceId: occs[0].id, kind: "reminder", dedupeKey: `reminder:${occs[0].id}:-2`, channel: "email", amountCents: 20000 };
    const first = (await db.one<{ ok: boolean }>(`SELECT pp_record_event($1::jsonb) ok`, [JSON.stringify(ev)]))!.ok;
    const second = (await db.one<{ ok: boolean }>(`SELECT pp_record_event($1::jsonb) ok`, [JSON.stringify(ev)]))!.ok;
    expect([first, second]).toEqual([true, false]);
    expect(await db.q(`SELECT amount, channel FROM payment_plan_events WHERE dedupe_key=$1`, [ev.dedupeKey])).toEqual([{ amount: "200.00", channel: "email" }]);
    await expect(db.q(`SELECT pp_record_event($1::jsonb)`, [JSON.stringify({ ...ev, dedupeKey: "x", colour: 1 })])).rejects.toThrow(/unknown field/);
    await expect(db.q(`SELECT pp_record_event($1::jsonb)`, [JSON.stringify({ ...ev, dedupeKey: "y", kind: "party" })])).rejects.toThrow(/kind_check/);
  });
});

describe("every state-changing function raises instead of silently doing nothing", () => {
  const calls: [string, string, unknown[]][] = [
    ["pp_claim", `SELECT pp_claim($1, 'auto_charge', NULL)`, [RANDOM]],
    ["pp_mark_in_flight", `SELECT pp_mark_in_flight($1)`, [RANDOM]],
    ["pp_record_success", `SELECT pp_record_success($1, 100, NULL, NULL, NULL, 'stripe', 'uk', '2026-10-02', 'Card', NULL)`, [RANDOM]],
    ["pp_record_failure", `SELECT pp_record_failure($1, 'failed')`, [RANDOM]],
    ["pp_settle_occurrence", `SELECT pp_settle_occurrence($1)`, [RANDOM]],
    ["pp_pause_plan", `SELECT pp_pause_plan($1, NULL, NULL)`, [RANDOM]],
    ["pp_resume_plan", `SELECT pp_resume_plan($1, NULL, NULL)`, [RANDOM]],
    ["pp_cancel_plan", `SELECT pp_cancel_plan($1, NULL, NULL)`, [RANDOM]],
    ["pp_move_occurrence", `SELECT pp_move_occurrence($1, '2026-10-12', NULL)`, [RANDOM]],
    ["pp_skip_occurrence", `SELECT pp_skip_occurrence($1, NULL)`, [RANDOM]],
    ["pp_set_method", `SELECT pp_set_method($1, 'manual', NULL)`, [RANDOM]],
    ["pp_set_link_token", `SELECT pp_set_link_token($1, 'h')`, [RANDOM]],
    ["pp_set_payment_method", `SELECT pp_set_payment_method($1, 'pm_1')`, [RANDOM]],
    ["pp_replace_future", `SELECT pp_replace_future($1, 1, '{}'::jsonb, '[]'::jsonb, NULL, 'x')`, [RANDOM]],
    ["pp_record_event", `SELECT pp_record_event(jsonb_build_object('planId', $1::text, 'kind', 'reminder'))`, [RANDOM]],
  ];
  it.each(calls)("%s on a missing row raises", async (_name, sql, params) => {
    await expect(db.q(sql, params)).rejects.toThrow(/not found|is not|not active|not paused/);
  });

  it("pp_mark_in_flight twice raises (claimed → in_flight only)", async () => {
    const { planId, occs } = await setup();
    await collect(BASE_DUE_AT[0], planId);
    const c = await claim(occs[0].id);
    await inFlight(c.claim.attemptId);
    await expect(inFlight(c.claim.attemptId)).rejects.toThrow(/is not claimed \(status in_flight\)/);
  });
});

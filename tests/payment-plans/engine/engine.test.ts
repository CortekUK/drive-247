/**
 * Engine mechanics — the paths the §10.1 scenarios do not reach on their own:
 * compensation when a charged payment cannot be recorded, recovery's choice
 * between replaying a key and looking a charge up, the never-sent claim,
 * integration bugs, eligibility, and the form → row helper's money rule.
 *
 * Fixture values are arbitrary (UTC zone, 2031 dates, round cents) so nothing
 * here restates a golden or scenario literal.
 */
import { describe, expect, it } from "vitest";
import { MemoryPlanStore } from "../../../supabase/functions/_shared/payment-plans/memory-store.ts";
import { RecordingNotifier, SimulatedLinkMinter, SimulatedProvider } from "../../../supabase/functions/_shared/payment-plans/providers.ts";
import {
  collectOccurrenceNow,
  idempotencyKey,
  isAutoEligible,
  onLinkPaid,
  planFormToRowAndSchedule,
  recordManualPayment,
  runTick,
  type EngineDeps,
  type PlanForm,
} from "../../../supabase/functions/_shared/payment-plans/engine.ts";
import type { AttemptRow, OccurrenceRow } from "../../../supabase/functions/_shared/payment-plans/types.ts";

const DAY1 = "2031-03-03T10:00:00.000Z";
const later = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

async function world(opts: { method?: "auto_charge" | "checkout_link" | "manual"; owed?: number; fallbackToLink?: boolean } = {}) {
  const store = new MemoryPlanStore({ rentals: [{ id: "rent", tenantId: "ten", customerId: "cus", owedCents: opts.owed ?? 70000 }], now: "2031-02-01T00:00:00.000Z" });
  const provider = new SimulatedProvider({ account: "acct_mech" });
  const notifier = new RecordingNotifier();
  const links = new SimulatedLinkMinter();
  const deps: EngineDeps = { store, provider, notifier, links };
  const draft = planFormToRowAndSchedule(
    {
      freq: "daily",
      interval: 7,
      anchor: "2031-03-03",
      firstOccurrence: "on_anchor",
      end: { kind: "count", count: 2 },
      amountMode: "split_total",
      collectionMethod: opts.method ?? "auto_charge",
      fallbackToLink: opts.fallbackToLink ?? true,
      reminderOffsets: [-1, 0],
    },
    { tenantId: "ten", rentalId: "rent", customerId: "cus", rentalEnd: null, timezone: "UTC", currency: "USD", paymentProvider: "stripe", owedCents: opts.owed ?? 70000 },
  );
  const planId = await store.createPlan({ plan: draft.plan, occurrences: draft.occurrences });
  const occs = await store.listOccurrences(planId);
  return { store, provider, notifier, links, deps, planId, occs };
}

describe("compensation — a charge that cannot be recorded is given back", () => {
  it("record fails → refund succeeds → attempt failed, operator alerted, no payment row", async () => {
    const w = await world();
    w.store.failNext("recordSuccess", "simulated database outage");
    const tick = await runTick(w.deps, { asOf: DAY1 });
    const occ = w.occs[0];
    expect(tick.actions.find((a) => a.occurrenceId === occ.id)?.action).toBe("failed");
    expect(w.provider.refunds).toHaveLength(1);
    expect(w.store.listPayments()).toHaveLength(0);
    const [attempt] = await w.store.listAttempts({ occurrenceId: occ.id });
    expect(attempt.status).toBe("failed");
    expect(attempt.errorCode).toBe("record_failed_refunded");
    expect(w.notifier.sent.some((n) => n.kind === "alert" && n.to === "operator")).toBe(true);
    // Never charged again automatically: a later tick leaves it alone.
    await runTick(w.deps, { asOf: later(DAY1, 3 * 86400) });
    expect(w.provider.chargesFor(occ.id)).toHaveLength(1);
  });

  it("record fails AND refund fails → attempt indeterminate, plan paused, alert; recovery later records the real money once", async () => {
    const w = await world();
    w.store.failNext("recordSuccess");
    w.provider.scriptRefunds(["fail"]);
    await runTick(w.deps, { asOf: DAY1 });
    const occ = w.occs[0];
    const [attempt] = await w.store.listAttempts({ occurrenceId: occ.id });
    expect(attempt.status).toBe("indeterminate");
    expect((await w.store.getPlan(w.planId))!.status).toBe("paused");
    expect(w.notifier.sent.filter((n) => n.kind === "alert")).not.toHaveLength(0);

    // Plan paused → recovery LOOKS UP (never replays on a non-active plan).
    const callsBefore = w.provider.calls.length;
    const tick = await runTick(w.deps, { asOf: later(DAY1, 900) });
    expect(tick.recovered[0]).toMatchObject({ path: "looked_up", outcome: "charged" });
    expect(w.provider.calls.length).toBe(callsBefore);
    expect(w.store.listPayments({ occurrenceId: occ.id })).toHaveLength(1);
    expect(w.provider.chargesFor(occ.id)).toHaveLength(1);
  });
});

describe("recovery — replay the same key, or look it up; never a new key blind", () => {
  it("< 23 h: replays the SAME key", async () => {
    const w = await world();
    const occ = w.occs[0];
    w.provider.queue(occ.id, ["indeterminate_before_charge", "succeed"]);
    await runTick(w.deps, { asOf: DAY1 });
    await runTick(w.deps, { asOf: later(DAY1, 1200) });
    const keys = w.provider.calls.filter((c) => c.metadata.occurrence_id === occ.id).map((c) => c.idempotencyKey);
    expect(keys).toEqual([idempotencyKey("acct_mech", occ.id, 1), idempotencyKey("acct_mech", occ.id, 1)]);
    expect(w.store.listPayments({ occurrenceId: occ.id })).toHaveLength(1);
  });

  it("inside the lease (< 600 s) nothing is recovered", async () => {
    const w = await world();
    w.provider.queue(w.occs[0].id, ["indeterminate_before_charge"]);
    await runTick(w.deps, { asOf: DAY1 });
    const tick = await runTick(w.deps, { asOf: later(DAY1, 300) });
    expect(tick.recovered).toHaveLength(0);
    expect(w.provider.calls).toHaveLength(1);
  });

  it("≥ 23 h: looks the charge up; finding none, abandons and only then charges with the NEXT key", async () => {
    const w = await world();
    const occ = w.occs[0];
    w.provider.queue(occ.id, ["indeterminate_before_charge", "succeed"]);
    await runTick(w.deps, { asOf: DAY1 });
    const tick = await runTick(w.deps, { asOf: later(DAY1, 24 * 3600) });
    expect(tick.recovered[0]).toMatchObject({ path: "looked_up", outcome: "abandoned" });
    const keys = w.provider.calls.filter((c) => c.metadata.occurrence_id === occ.id).map((c) => c.idempotencyKey);
    expect(keys).toEqual([idempotencyKey("acct_mech", occ.id, 1), idempotencyKey("acct_mech", occ.id, 2)]);
    expect(w.provider.chargesFor(occ.id)).toHaveLength(1);
  });

  it("a claim that never reached the provider is abandoned, then charged afresh", async () => {
    const w = await world();
    const occ = w.occs[0];
    w.store.failNext("markInFlight");
    const first = await runTick(w.deps, { asOf: DAY1 });
    expect(first.errors).toHaveLength(1);
    expect(w.provider.calls).toHaveLength(0);
    const second = await runTick(w.deps, { asOf: later(DAY1, 700) });
    expect(second.recovered[0]).toMatchObject({ path: "abandoned_unsent" });
    expect(w.provider.calls.map((c) => c.idempotencyKey)).toEqual([idempotencyKey("acct_mech", occ.id, 2)]);
    expect((await w.store.getOccurrence(occ.id))!.status).toBe("paid");
  });
});

describe("integration bugs and fallbacks", () => {
  it("an integration bug pauses the plan, alerts the operator, and never emails the customer", async () => {
    const w = await world();
    w.provider.queue(w.occs[0].id, [{ decline: "livemode_mismatch" }]);
    const tick = await runTick(w.deps, { asOf: DAY1 });
    expect(tick.actions.find((a) => a.occurrenceId === w.occs[0].id)?.action).toBe("paused_integration");
    expect((await w.store.getPlan(w.planId))!.status).toBe("paused");
    expect(w.notifier.sent.filter((n) => n.to === "customer" && n.kind !== "reminder")).toHaveLength(0);
    expect(w.notifier.sent.some((n) => n.kind === "alert")).toBe(true);
  });

  it("with fallbackToLink off, a dead card tells the customer instead of sending a link", async () => {
    const w = await world({ fallbackToLink: false });
    w.provider.queue(w.occs[0].id, [{ decline: "expired_card" }]);
    await runTick(w.deps, { asOf: DAY1 });
    expect(w.notifier.sent.some((n) => n.kind === "link")).toBe(false);
    expect(w.notifier.sent.some((n) => n.kind === "failed" && n.to === "customer")).toBe(true);
    expect(w.links.minted).toHaveLength(0);
  });

  it("the customer-facing reason for a stolen card is the generic one", async () => {
    const w = await world();
    w.provider.queue(w.occs[0].id, [{ decline: "stolen_card" }]);
    await runTick(w.deps, { asOf: DAY1 });
    const told = w.notifier.sent.filter((n) => n.detail && "reason" in n.detail).map((n) => String(n.detail!.reason));
    expect(told.length).toBeGreaterThan(0);
    for (const t of told) expect(t.toLowerCase()).not.toMatch(/stolen|lost|fraud/);
  });
});

describe("links, manual records, webhook idempotency", () => {
  it("a recorded manual payment releases the outstanding link first", async () => {
    const w = await world({ method: "checkout_link" });
    await runTick(w.deps, { asOf: DAY1 });
    const occ = w.occs[0];
    const before = await w.store.listAttempts({ occurrenceId: occ.id });
    expect(before.map((a) => [a.method, a.status])).toEqual([["checkout_link", "in_flight"]]);
    const r = await recordManualPayment(w.deps, { occurrenceId: occ.id, amountCents: occ.amountCents, method: "Cash", paymentDate: "2031-03-04" });
    expect(r.releasedLinks).toBe(1);
    const after = await w.store.listAttempts({ occurrenceId: occ.id });
    expect(after.map((a) => [a.method, a.status])).toEqual([
      ["checkout_link", "abandoned"],
      ["manual", "succeeded"],
    ]);
  });

  it("a second, DIFFERENT paid session for a succeeded attempt is reported, not recorded", async () => {
    const w = await world({ method: "checkout_link" });
    await runTick(w.deps, { asOf: DAY1 });
    const [link] = await w.store.listAttempts({ occurrenceId: w.occs[0].id });
    const first = await onLinkPaid(w.deps, { attemptId: link.id, providerRef: "pi_a", amountCents: link.amountCents, paidAt: DAY1 });
    const again = await onLinkPaid(w.deps, { attemptId: link.id, providerRef: "pi_a", amountCents: link.amountCents, paidAt: DAY1 });
    const other = await onLinkPaid(w.deps, { attemptId: link.id, providerRef: "pi_b", amountCents: link.amountCents, paidAt: DAY1 });
    expect(first.status).toBe("recorded");
    expect(again.status).toBe("already_recorded");
    expect(other.status).toBe("duplicate_payment");
    expect(w.store.listPayments()).toHaveLength(1);
    expect(w.notifier.sent.some((n) => n.kind === "alert" && n.detail?.problem === "duplicate_link_payment")).toBe(true);
  });

  it("a card saved at Checkout becomes the plan's card", async () => {
    const w = await world({ method: "checkout_link" });
    await runTick(w.deps, { asOf: DAY1 });
    const [link] = await w.store.listAttempts({ occurrenceId: w.occs[0].id });
    await onLinkPaid(w.deps, { attemptId: link.id, providerRef: "pi_c", amountCents: link.amountCents, paidAt: DAY1, paymentMethodRef: "pm_saved" });
    expect((await w.store.getPlan(w.planId))!.stripePaymentMethodId).toBe("pm_saved");
  });

  it("after a refund (D12) neither the cron nor a card Retry charges again — pp_claim refuses; a link or a manual record still can", async () => {
    const w = await world();
    await runTick(w.deps, { asOf: DAY1 });
    const occ = w.occs[0];
    const [payment] = w.store.listPayments({ occurrenceId: occ.id });
    await w.store.refundPayment(payment.id, payment.amountCents);
    await runTick(w.deps, { asOf: later(DAY1, 86400) });
    expect(w.provider.chargesFor(occ.id)).toHaveLength(1);
    // pp_claim refuses an auto_charge on a refunded occurrence even for the operator.
    const retry = await collectOccurrenceNow(w.deps, occ.id, later(DAY1, 90000));
    expect(retry.action).toBe("not_claimable");
    expect(w.provider.chargesFor(occ.id)).toHaveLength(1);
    const manual = await recordManualPayment(w.deps, { occurrenceId: occ.id, amountCents: payment.amountCents, method: "Bank Transfer", paymentDate: "2031-03-05" });
    expect(manual.paymentId).toBeTruthy();
    expect((await w.store.getOccurrence(occ.id))!.status).toBe("paid");
  });
});

describe("reminders are deduplicated per occurrence and offset", () => {
  it("two ticks on the same local day send one reminder", async () => {
    const w = await world({ method: "manual" });
    const dayBefore = "2031-03-02T08:00:00.000Z";
    await runTick(w.deps, { asOf: dayBefore });
    await runTick(w.deps, { asOf: later(dayBefore, 6 * 3600) });
    const reminders = (await w.store.listEvents(w.planId)).filter((e) => e.kind === "reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].dedupeKey).toBe(`reminder:${w.occs[0].id}:-1`);
    expect(w.notifier.sent.filter((n) => n.kind === "reminder")).toHaveLength(1);
  });
});

describe("isAutoEligible", () => {
  const occ = (over: Partial<OccurrenceRow>): OccurrenceRow => ({
    id: "o",
    planId: "p",
    tenantId: "t",
    rentalId: "r",
    seq: 1,
    planVersion: 1,
    dueDate: "2031-01-01",
    dueAt: "2031-01-01T10:00:00.000Z",
    periodStart: null,
    periodEnd: null,
    amountCents: 100,
    amountPaidCents: 0,
    collectionMethod: "auto_charge",
    status: "due",
    attemptNo: 0,
    nextAttemptAt: null,
    ...over,
  });
  const att = (method: AttemptRow["method"], status: AttemptRow["status"]): AttemptRow => ({
    id: "a",
    occurrenceId: "o",
    attemptNo: 1,
    method,
    idempotencyKey: "k",
    status,
    provider: "simulated",
    providerAccount: null,
    providerMode: null,
    providerRef: null,
    paymentId: null,
    amountCents: 100,
    declineCode: null,
    errorCode: null,
    errorMessage: null,
  });
  const now = "2031-01-02T00:00:00.000Z";

  it("due and never attempted → eligible; not before its due_at", () => {
    expect(isAutoEligible(occ({}), [], now)).toBe(true);
    expect(isAutoEligible(occ({ dueAt: "2031-01-03T10:00:00.000Z" }), [], now)).toBe(false);
  });
  it("a manual record or a never-sent abandoned claim does not count as an attempt", () => {
    expect(isAutoEligible(occ({ status: "partially_paid", attemptNo: 1 }), [att("manual", "succeeded")], now)).toBe(true);
    expect(isAutoEligible(occ({ attemptNo: 1 }), [att("auto_charge", "abandoned")], now)).toBe(true);
  });
  it("any card or link attempt that reached someone blocks it (D12 and failed links)", () => {
    expect(isAutoEligible(occ({ attemptNo: 1 }), [att("auto_charge", "succeeded")], now)).toBe(false);
    expect(isAutoEligible(occ({ attemptNo: 1 }), [att("checkout_link", "in_flight")], now)).toBe(false);
  });
  it("failed → only once next_attempt_at has arrived", () => {
    expect(isAutoEligible(occ({ status: "failed", attemptNo: 1, nextAttemptAt: "2031-01-01T12:00:00.000Z" }), [], now)).toBe(true);
    expect(isAutoEligible(occ({ status: "failed", attemptNo: 1, nextAttemptAt: "2031-01-05T12:00:00.000Z" }), [], now)).toBe(false);
    expect(isAutoEligible(occ({ status: "failed", attemptNo: 3, nextAttemptAt: null }), [], now)).toBe(false);
  });
  it("requires_action, scheduled and processing are never auto-collected", () => {
    for (const status of ["requires_action", "scheduled", "processing", "paid"] as const) {
      expect(isAutoEligible(occ({ status }), [], now)).toBe(false);
    }
  });
});

describe("planFormToRowAndSchedule — the server owns split totals", () => {
  const base: PlanForm = {
    freq: "daily",
    interval: 1,
    anchor: "2031-06-01",
    firstOccurrence: "on_anchor",
    end: { kind: "count", count: 4 },
    amountMode: "split_total",
    collectionMethod: "manual",
  };
  const ctx = { tenantId: "t", rentalId: "r", customerId: "c", rentalEnd: null, timezone: "UTC", currency: "EUR", paymentProvider: "stripe" as const, owedCents: 12346 };

  it("a split plan collects exactly what the rental owes, whatever the form says", () => {
    const d = planFormToRowAndSchedule({ ...base, ...({ totalCents: 99999999 } as object) } as PlanForm, ctx);
    expect(d.plan.amount).toEqual({ mode: "split_total", totalCents: 12346 });
    expect(d.summary.totalCents).toBe(12346);
    expect(d.summary.differsFromOwed).toBe(false);
    expect(d.plan.currency).toBe("eur");
  });

  it("a fixed plan is the operator's price, and the summary says when it differs from the balance", () => {
    const d = planFormToRowAndSchedule({ ...base, amountMode: "fixed", fixedAmountCents: 5000 }, ctx);
    expect(d.summary.totalCents).toBe(20000);
    expect(d.summary.differsFromOwed).toBe(true);
  });

  it("'until the rental ends' needs the rental's end date", () => {
    expect(() => planFormToRowAndSchedule({ ...base, end: { kind: "rental_end" } }, ctx)).toThrow(/end date/);
  });

  it("refuses a DST-window charge time and an unknown zone", () => {
    expect(() => planFormToRowAndSchedule({ ...base, chargeLocalTime: "02:30" }, ctx)).toThrow();
    expect(() => planFormToRowAndSchedule(base, { ...ctx, timezone: "Mars/Olympus_Mons" })).toThrow(/timezone/i);
  });
});

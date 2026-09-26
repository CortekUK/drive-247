/**
 * The renewal engine (renewals.ts + the renewal half of engine.ts) beyond the
 * S20–S26 scenarios: insurance retries and give-ups, no insurer, an Extend on
 * a plan that does not renew, the refusals, reconcile, the form. Every case
 * runs on BOTH stores — the memory store and real Postgres (PGlite, the SQL
 * functions of 20260926120200 with the live FIFO and finalize) — and must
 * give the same answer.
 *
 * Fixture (hand-derived, as in scenarios.ts): end 2026-10-02; 350.00 − 16.16 =
 * 333.84; tax 7% → 23.37; fee 5.00 → 36221 cents a week. CDW at 26.95 a night.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createMemoryContext, engineDeps, type ScenarioContext } from "@fn/_shared/payment-plans/scenarios.ts";
import { planFormToRowAndSchedule, recordManualPayment, runTick, type PlanForm } from "@fn/_shared/payment-plans/engine.ts";
import { extendPlan, type RenewalStore } from "@fn/_shared/payment-plans/renewals.ts";
import { buildSchedule } from "@fn/_shared/payment-plans/schedule.ts";
import { PlanRuleError, PlanStoreError } from "@fn/_shared/payment-plans/errors.ts";
import type { RenewalCoverage } from "@fn/_shared/payment-plans/types.ts";
import { closeOpenDatabases, createPgliteContext } from "../harness/pglite-context";

afterAll(async () => closeOpenDatabases());

const TZ = "America/New_York";
const SEED = { endDate: "2026-10-02", monthlyAmount: 350, discountApplied: 16.16, taxPercentage: 7, serviceFeeFixed: 5 };
const PRICING = { monthlyAmount: 350, discountApplied: 16.16, tenant: { tax_enabled: true, tax_percentage: 7, service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 5, service_fee_amount: 0 } };

function form(over: Partial<PlanForm> = {}, renewal: Partial<NonNullable<PlanForm["renewal"]>> = {}): PlanForm {
  return {
    freq: "weekly",
    interval: 1,
    byWeekday: [5],
    anchor: "2026-10-02",
    firstOccurrence: "on_anchor",
    end: { kind: "open", through: "2026-10-02" },
    amountMode: "fixed",
    collectionMethod: "auto_charge",
    reminderOffsets: [-2, 0, 2],
    renewal: { extendsRental: true, periodUnit: "week", periodCount: 1, insurance: null, sendAgreementEachPeriod: false, ...renewal },
    ...over,
  };
}

async function renewalPlan(ctx: ScenarioContext, insurance: RenewalCoverage | null = null) {
  await ctx.at("2026-09-25T12:00:00.000Z");
  const rental = await ctx.seedRenewalRental(SEED);
  const pricing = await ctx.store.renewalPricing(rental.rentalId);
  const draft = planFormToRowAndSchedule(form({}, { insurance }), {
    tenantId: rental.tenantId, rentalId: rental.rentalId, customerId: rental.customerId, rentalEnd: pricing.rentalEnd, timezone: TZ,
    currency: "usd", paymentProvider: "stripe", owedCents: 0, stripePaymentMethodId: "pm_sim_card", renewalPricing: pricing,
  });
  const planId = await ctx.store.createPlan({ plan: draft.plan, occurrences: draft.occurrences });
  const [occ1] = await ctx.store.listOccurrences(planId);
  return { rental, planId, occ1 };
}

const renewalDeps = (ctx: ScenarioContext) => ({ store: ctx.store as RenewalStore, notifier: ctx.notifier, insurer: ctx.insurer });
const calls = (ctx: ScenarioContext, occId: string) => ctx.provider.calls.filter((c) => c.metadata?.occurrence_id === occId).map((c) => c.amountCents);
const alerts = (ctx: ScenarioContext, problem: string) => ctx.notifier.sent.filter((n) => n.kind === "alert" && (n.detail as { problem?: string } | undefined)?.problem === problem).length;
const ticked = async (ctx: ScenarioContext, asOf: string) => {
  const t = (await ctx.tick(asOf)) as { errors: unknown[] };
  expect(t.errors, asOf).toEqual([]);
  return t;
};

type Factory = () => ScenarioContext | Promise<ScenarioContext>;
const STORES: [string, Factory][] = [
  ["memory", createMemoryContext],
  ["pglite", createPgliteContext],
];

describe.each(STORES)("renewals on the %s store", (_name, make) => {
  it("insurance: a transient failure is retried on the next tick (still before due), then bought: 7 nights × 2695 = 18865 → 55086 charged", async () => {
    const ctx = await make();
    const { rental, occ1 } = await renewalPlan(ctx, { cdw: true });
    ctx.insurer.queue(["retry"]);
    await ticked(ctx, "2026-09-30T14:00:00.000Z");
    let o = (await ctx.store.getOccurrence(occ1.id))!;
    expect([o.insuranceStatus, o.amountCents]).toEqual(["pending", 36221]);
    // A pending period cannot be collected, not even by hand.
    await expect(recordManualPayment(engineDeps(ctx), { occurrenceId: occ1.id, amountCents: 100, method: "Cash", paymentDate: "2026-09-30", asOf: "2026-09-30T15:00:00.000Z" })).rejects.toThrow(/cannot take a manual record/);
    await ticked(ctx, "2026-10-01T14:00:00.000Z");
    o = (await ctx.store.getOccurrence(occ1.id))!;
    expect([o.insuranceStatus, o.amountCents]).toEqual(["insured", 55086]);
    await ticked(ctx, "2026-10-02T14:00:00.000Z");
    expect(calls(ctx, occ1.id)).toEqual([55086]);
    expect(await ctx.rentalEndDate(rental.rentalId)).toBe("2026-10-09");
  });

  it("insurance: failing until the period is due → given up at the due tick: NO premium, operator alerted, 36221 charged", async () => {
    const ctx = await make();
    const { rental, occ1 } = await renewalPlan(ctx, { cdw: true, pai: true });
    ctx.insurer.queue(["retry", "retry", "retry"]);
    await ticked(ctx, "2026-09-30T14:00:00.000Z");
    await ticked(ctx, "2026-10-01T14:00:00.000Z");
    expect((await ctx.store.getOccurrence(occ1.id))!.insuranceStatus).toBe("pending");
    await ticked(ctx, "2026-10-02T14:00:00.000Z");
    const o = (await ctx.store.getOccurrence(occ1.id))!;
    expect([o.insuranceStatus, o.amountCents]).toEqual(["failed", 36221]);
    expect(calls(ctx, occ1.id)).toEqual([36221]);
    expect(alerts(ctx, "insurance_not_bought")).toBe(1);
    const [e] = await ctx.extensions(rental.rentalId);
    expect([e.insuranceCents, e.bonzahPolicyId, e.charges.length]).toEqual([0, null, 3]);
  });

  it("insurance: Bonzah not sellable → not insurable, no premium", async () => {
    const ctx = await make();
    const { occ1 } = await renewalPlan(ctx, { cdw: true });
    ctx.insurer.queue(["unsellable"]);
    await ticked(ctx, "2026-09-30T14:00:00.000Z");
    const o = (await ctx.store.getOccurrence(occ1.id))!;
    expect([o.insuranceStatus, o.amountCents]).toEqual(["not_insurable", 36221]);
  });

  it("no insurer wired: a period that asks for cover is charged without it, and the operator is told", async () => {
    const ctx = await make();
    const { occ1 } = await renewalPlan(ctx, { sli: true });
    const deps = { ...engineDeps(ctx), insurer: null };
    await runTick(deps, { asOf: "2026-09-30T14:00:00.000Z" });
    await runTick(deps, { asOf: "2026-10-02T14:00:00.000Z" });
    expect((await ctx.store.getOccurrence(occ1.id))!.insuranceStatus).toBe("failed");
    expect(calls(ctx, occ1.id)).toEqual([36221]);
    expect(alerts(ctx, "insurance_not_bought")).toBe(1);
  });

  it("a period settled by a payment outside the plan is reconciled on the next tick: paid, end date moved, no card call", async () => {
    const ctx = await make();
    const { rental, occ1 } = await renewalPlan(ctx);
    await ticked(ctx, "2026-09-30T14:00:00.000Z");
    await ctx.at("2026-10-01T12:00:00.000Z");
    await ctx.store.recordExternalPayment(rental.rentalId, 36221, "2026-10-01");
    const t = (await ticked(ctx, "2026-10-01T14:00:00.000Z")) as { renewals?: { reconciled: string[] } };
    expect(t.renewals?.reconciled).toEqual([occ1.id]);
    expect((await ctx.store.getOccurrence(occ1.id))!.status).toBe("paid");
    expect(await ctx.rentalEndDate(rental.rentalId)).toBe("2026-10-09");
    await ticked(ctx, "2026-10-02T14:00:00.000Z");
    expect(calls(ctx, occ1.id)).toEqual([]);
  });

  it("a manual record on a renewal period may not exceed what it owes; the exact amount pays it and moves the end date", async () => {
    const ctx = await make();
    const { rental, occ1 } = await renewalPlan(ctx);
    await ticked(ctx, "2026-09-30T14:00:00.000Z");
    const deps = engineDeps(ctx);
    await expect(recordManualPayment(deps, { occurrenceId: occ1.id, amountCents: 36222, method: "Cash", paymentDate: "2026-09-30", asOf: "2026-09-30T15:00:00.000Z" })).rejects.toThrow(/owes 36221 cents/);
    await recordManualPayment(deps, { occurrenceId: occ1.id, amountCents: 36221, method: "Cash", paymentDate: "2026-09-30", asOf: "2026-09-30T15:05:00.000Z" });
    expect((await ctx.store.getOccurrence(occ1.id))!.status).toBe("paid");
    expect(await ctx.rentalEndDate(rental.rentalId)).toBe("2026-10-09");
  });

  it("a renewing plan cannot be edited, and its period cannot be skipped", async () => {
    const ctx = await make();
    const { planId, occ1 } = await renewalPlan(ctx);
    await expect(ctx.store.replaceFuture({ planId, expectedVersion: 1, planPatch: {}, occurrences: [{ seq: 1, dueDate: "2026-10-02", periodStart: "2026-10-02", periodEnd: "2026-10-09", days: 7, amountCents: 36221, isStub: false }], reason: "x" })).rejects.toMatchObject({ code: "refused" });
    await expect(ctx.store.skipOccurrence(occ1.id)).rejects.toMatchObject({ code: "refused" });
  });

  it("Extend on a plan that does NOT renew: two weeks from the rental's end, posted and due today, collected on the plan; the end date moves as each is paid", async () => {
    const ctx = await make();
    await ctx.at("2026-09-25T12:00:00.000Z");
    const rental = await ctx.seedRenewalRental(SEED);
    // A plain 3-payment plan on the same rental (owing nothing: amounts are the operator's fixed price).
    const rule = { freq: "weekly" as const, interval: 1, byWeekday: [5 as const], anchor: "2026-10-09", firstOccurrence: "on_anchor" as const, end: { kind: "count" as const, count: 3 } };
    const amount = { mode: "fixed" as const, amountCents: 1000 };
    const planId = await ctx.store.createPlan({
      plan: { tenantId: rental.tenantId, rentalId: rental.rentalId, customerId: rental.customerId, rule, amount, currency: "usd", timezone: TZ, chargeLocalTime: "10:00", collectionMethod: "auto_charge", fallbackToLink: true, maxAttempts: 3, retryAfterDays: 2, reminderOffsets: [], paymentProvider: "stripe", stripePaymentMethodId: "pm_sim_card", extendsRental: false },
      occurrences: buildSchedule(rule, amount),
    });
    const res = await extendPlan(renewalDeps(ctx), { planId, periods: 2, giveDaysNow: false, sendAgreement: true, periodUnit: "week", periodCount: 1, asOf: "2026-10-01T15:00:00.000Z" });
    expect(res.periods.map((p) => [p.periodStart, p.periodEnd, p.amountCents, p.insurance.outcome])).toEqual([
      ["2026-10-02", "2026-10-09", 36221, "none"],
      ["2026-10-09", "2026-10-16", 36221, "none"],
    ]);
    expect(res.endDate).toBe("2026-10-02");
    const occs = await ctx.store.listOccurrences(planId);
    expect(occs.map((o) => [o.seq, !!o.renews, o.dueDate, o.status])).toEqual([
      [1, false, "2026-10-09", "scheduled"],
      [2, false, "2026-10-16", "scheduled"],
      [3, false, "2026-10-23", "scheduled"],
      [4, true, "2026-10-01", "scheduled"],
      [5, true, "2026-10-01", "scheduled"],
    ]);
    await ticked(ctx, "2026-10-01T15:00:00.000Z");
    expect([calls(ctx, occs[3].id), calls(ctx, occs[4].id)]).toEqual([[36221], [36221]]);
    expect(await ctx.rentalEndDate(rental.rentalId)).toBe("2026-10-16");
    expect((await ctx.extensions(rental.rentalId)).map((e) => [e.sequenceNumber, e.status, e.newEndDate])).toEqual([
      [1, "paid", "2026-10-09"],
      [2, "paid", "2026-10-16"],
    ]);
    // The plain plan is untouched (its first payment is not due until 10-09).
    expect(calls(ctx, occs[0].id)).toEqual([]);
  });

  it("Extend refuses 0 or 13 periods and a paused plan, writing nothing", async () => {
    const ctx = await make();
    const { planId } = await renewalPlan(ctx);
    const deps = renewalDeps(ctx);
    const asOf = "2026-09-28T15:00:00.000Z";
    await expect(extendPlan(deps, { planId, periods: 0, giveDaysNow: true, sendAgreement: false, asOf })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(extendPlan(deps, { planId, periods: 13, giveDaysNow: true, sendAgreement: false, asOf })).rejects.toMatchObject({ code: "invalid_input" });
    await ctx.store.pausePlan(planId, null, "away");
    await expect(extendPlan(deps, { planId, periods: 1, giveDaysNow: true, sendAgreement: false, asOf })).rejects.toMatchObject({ code: "refused" });
    expect(await ctx.extensions((await ctx.store.getPlan(planId))!.rentalId)).toEqual([]);
  });
});

describe("the renewing form (planFormToRowAndSchedule)", () => {
  const ctxBase = { tenantId: "t", rentalId: "r", customerId: "c", rentalEnd: "2026-10-02", timezone: TZ, currency: "usd", paymentProvider: "stripe" as const, owedCents: 12345, renewalPricing: PRICING };

  it("derives everything from the rental: anchor = end date, the rhythm = the period, one period priced 36221, extendsRental", () => {
    const d = planFormToRowAndSchedule(form({ anchor: "2020-01-01", freq: "daily", interval: 9 }, { insurance: { cdw: true } }), ctxBase);
    expect(d.plan.rule).toEqual({ freq: "weekly", interval: 1, byWeekday: [5], anchor: "2026-10-02", firstOccurrence: "on_anchor", end: { kind: "open", through: "2026-10-02" } });
    expect(d.plan.amount).toEqual({ mode: "fixed", amountCents: 36221 });
    expect([d.plan.extendsRental, d.plan.renewal]).toEqual([true, { periodUnit: "week", periodCount: 1, insurance: { cdw: true, rcli: false, sli: false, pai: false }, sendAgreementEachPeriod: false }]);
    expect(d.occurrences).toEqual([{ seq: 1, dueDate: "2026-10-02", periodStart: "2026-10-02", periodEnd: "2026-10-09", days: 7, amountCents: 36221, isStub: false }]);
    expect([d.summary.count, d.summary.totalCents, d.summary.differsFromOwed, d.summary.dueAts]).toEqual([1, 36221, false, ["2026-10-02T14:00:00.000Z"]]);
    expect(d.summary.renewal?.breakdown).toEqual({ rentalCents: 33384, taxCents: 2337, serviceFeeCents: 500, totalCents: 36221 });
  });

  it("monthly on the 31st and every 2 days: the rule the plan row stores", () => {
    const m = planFormToRowAndSchedule(form({}, { periodUnit: "month" }), { ...ctxBase, rentalEnd: "2026-01-31" });
    expect([m.plan.rule.freq, m.plan.rule.byMonthDay, m.occurrences[0].periodEnd]).toEqual(["monthly", 31, "2026-03-03"]);
    const d = planFormToRowAndSchedule(form({}, { periodUnit: "day", periodCount: 2 }), ctxBase);
    expect([d.plan.rule.freq, d.plan.rule.interval, d.occurrences[0].periodEnd, d.occurrences[0].days]).toEqual(["daily", 2, "2026-10-04", 2]);
  });

  it("refuses: an end that is not open, a rental with no end date, no pricing, a count of 53, a $0 rate", () => {
    expect(() => planFormToRowAndSchedule(form({ end: { kind: "count", count: 3 } }), ctxBase)).toThrow(RangeError);
    expect(() => planFormToRowAndSchedule(form(), { ...ctxBase, rentalEnd: null })).toThrow(PlanRuleError);
    expect(() => planFormToRowAndSchedule(form(), { ...ctxBase, renewalPricing: null })).toThrow(RangeError);
    expect(() => planFormToRowAndSchedule(form({}, { periodCount: 53 }), ctxBase)).toThrow(PlanRuleError);
    expect(() => planFormToRowAndSchedule(form(), { ...ctxBase, renewalPricing: { ...PRICING, discountApplied: 350, tenant: { ...PRICING.tenant, service_fee_enabled: false } } })).toThrow(/nothing to renew/);
  });

  it("a PlanStoreError, not a crash, when a store refuses a renewal plan whose anchor is not the rental's end", async () => {
    const ctx = createMemoryContext();
    await ctx.at("2026-09-25T12:00:00.000Z");
    const rental = await ctx.seedRenewalRental(SEED);
    const d = planFormToRowAndSchedule(form(), { ...ctxBase, tenantId: rental.tenantId, rentalId: rental.rentalId, customerId: rental.customerId, rentalEnd: "2026-10-03" });
    await expect(ctx.store.createPlan({ plan: d.plan, occurrences: d.occurrences })).rejects.toBeInstanceOf(PlanStoreError);
  });
});

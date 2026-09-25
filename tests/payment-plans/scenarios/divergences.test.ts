/**
 * Store divergences found by the parity work that no §10.1 scenario reaches.
 * Each is `it.fails`: the assertion states what SHOULD hold (the two stores
 * agree), it fails today, and vitest reports it green-as-known-failing. The
 * day someone aligns the stores, the test flips red and must be converted to
 * a plain `it` — so the finding can neither rot nor be forgotten.
 */
import { afterAll, describe, expect, it } from "vitest";
import { BASE_DUE_AT, BASE_RULE, createMemoryContext, engineDeps, type ScenarioContext } from "@fn/_shared/payment-plans/scenarios.ts";
import { recordManualPayment } from "@fn/_shared/payment-plans/engine.ts";
import { buildSchedule } from "@fn/_shared/payment-plans/schedule.ts";
import { closeOpenDatabases, createPgliteContext } from "../harness/pglite-context";

afterAll(async () => closeOpenDatabases());

/**
 * occ1 paid by card, then refunded in full (the D12 path), then occ2 and occ3
 * paid on schedule. Finally the operator tries to re-collect occ1 by hand —
 * D12 says "only an operator action collects it".
 */
async function refundThenRecollect(ctx: ScenarioContext) {
  await ctx.at("2026-09-25T12:00:00.000Z");
  const rental = await ctx.seedRental(60000);
  const rule = BASE_RULE;
  const amount = { mode: "split_total" as const, totalCents: 60000 };
  const planId = await ctx.store.createPlan({
    plan: {
      tenantId: rental.tenantId, rentalId: rental.rentalId, customerId: rental.customerId, rule, amount,
      currency: "usd", timezone: "America/New_York", chargeLocalTime: "10:00", collectionMethod: "auto_charge",
      fallbackToLink: true, maxAttempts: 3, retryAfterDays: 2, reminderOffsets: [-2, 0, 2], paymentProvider: "stripe",
      stripePaymentMethodId: "pm_sim_card", extendsRental: false,
    },
    occurrences: buildSchedule(rule, amount),
  });
  const [o1] = await ctx.store.listOccurrences(planId);
  await ctx.tick(BASE_DUE_AT[0]);
  const pay = (await ctx.payments(rental.rentalId)).find((p) => p.occurrenceId === o1.id)!;
  await ctx.at("2026-10-03T15:00:00.000Z");
  await ctx.store.refundPayment(pay.id, 20000);
  const owedAfterRefund = await ctx.store.rentalOwedCents(rental.rentalId);
  await ctx.tick(BASE_DUE_AT[1]);
  await ctx.tick(BASE_DUE_AT[2]);
  let recollect: "recorded" | "refused";
  try {
    await recordManualPayment(engineDeps(ctx), { occurrenceId: o1.id, amountCents: 20000, method: "Cash", paymentDate: "2026-10-20", asOf: "2026-10-20T15:00:00.000Z" });
    recollect = "recorded";
  } catch {
    recollect = "refused";
  }
  return { owedAfterRefund, recollect, occ1: (await ctx.store.getOccurrence(o1.id))!.status };
}

describe("store divergence: what a refund does to the rental balance", () => {
  it("both stores run the path (the numbers the report quotes)", async () => {
    const mem = await refundThenRecollect(createMemoryContext());
    const pg = await refundThenRecollect(await createPgliteContext());
    expect(mem).toEqual({ owedAfterRefund: 60000, recollect: "recorded", occ1: "paid" });
    expect(pg).toEqual({ owedAfterRefund: 40000, recollect: "refused", occ1: "skipped" });
  });

  it.fails("KNOWN DIVERGENCE: the stores should agree on a refunded rental's balance and on re-collecting it", async () => {
    const mem = await refundThenRecollect(createMemoryContext());
    const pg = await refundThenRecollect(await createPgliteContext());
    expect(pg).toEqual(mem);
  });
});

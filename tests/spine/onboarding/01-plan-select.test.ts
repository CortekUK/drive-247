// =============================================================================
// SPINE STEP 1 — PLAN SELECT.
//
//     plan select.  --- 99
//
// "yeh aap hard coded hi ek value rakhoge, 99 ki, ya jo bhi 299 ki koi bhi
//  value hogi — jab humne test chalaya to humein koi na koi yeh wali value
//  deni padegi."
//
// The run is SEEDED with one fixed plan and one fixed amount. Everything after
// this reads that number off the chain instead of inventing its own, which is
// what makes step 4's "the 99 reached Stripe" assertion mean anything.
//
// The real risk this step guards is not "does a constant still equal 99". It is
// that the amount a visitor SEES and the amount the platform CHARGES live in
// two different files, in two different runtimes, that no compiler compares:
//
//   apps/web/src/lib/plans.ts                     — the marketing card (display)
//   supabase/functions/_shared/signup-plans.ts    — the money (server)
//
// Both files say in their own header comments that they must be kept identical.
// Nothing enforced it until this test. A divergence here is silent and it bills
// people the wrong amount.
// =============================================================================

import { describe, expect, it } from "vitest";
import { SIGNUP_PLANS as CLIENT_PLANS, type SignupPlanId } from "@web/lib/plans";
import { SIGNUP_PLANS as SERVER_PLANS } from "@fn/_shared/signup-plans.ts";
import { chain, guarded } from "../../helpers/chain";

const STEP = "01-plan-select" as const;

/**
 * The seed. Hardcoded exactly as described — a run needs *some* value, and this
 * is it. Change it here and the whole chain re-prices itself.
 */
const SEEDED = {
  planId: "starter" as SignupPlanId,
  priceUsd: 99,
  amountCents: 9900,
};

describe("01 — plan select (the run is seeded with one fixed amount)", () => {
  it(`seeds the chain with ${SEEDED.planId} at $${SEEDED.priceUsd}`, () =>
    guarded(STEP, () => {
      const clientPlan = CLIENT_PLANS.find((p) => p.id === SEEDED.planId);
      expect(
        clientPlan,
        `The seeded plan "${SEEDED.planId}" is gone from apps/web/src/lib/plans.ts.\n` +
          `FAILURE MODE (a): a developer renamed or removed a plan. Re-seed this test ` +
          `with a plan that exists.`,
      ).toBeDefined();

      expect(clientPlan!.amountCents).toBe(SEEDED.amountCents);
      // The big number on the card and the number that reaches Stripe are
      // different fields. They have to agree or the card is a lie.
      expect(clientPlan!.priceUsd * 100).toBe(clientPlan!.amountCents);

      chain.seed("plan", {
        id: clientPlan!.id,
        name: clientPlan!.name,
        amountCents: clientPlan!.amountCents,
        currency: clientPlan!.currency,
        interval: clientPlan!.interval,
        maxVehicles: clientPlan!.maxVehicles,
      });
    }));

  it("charges what it advertises — the seeded plan costs the same on both sides", () =>
    guarded(STEP, () => {
      const client = CLIENT_PLANS.find((p) => p.id === SEEDED.planId)!;
      const server = SERVER_PLANS[SEEDED.planId];

      expect(
        server,
        `supabase/functions/_shared/signup-plans.ts has no "${SEEDED.planId}" entry, but ` +
          `apps/web/src/lib/plans.ts advertises it. A visitor can pick a plan the server ` +
          `cannot price — signup-begin answers PLAN_UNKNOWN and the flow dies at step 2.`,
      ).toBeDefined();

      expect(
        server.amountCents,
        `PRICE MISMATCH on "${SEEDED.planId}": the card shows ${client.amountCents} cents, ` +
          `the server charges ${server.amountCents}. One of the two files was edited alone.`,
      ).toBe(client.amountCents);
    }));

  it("every plan matches field-for-field across the display and money catalogues", () =>
    guarded(STEP, () => {
      // Not just the seeded one: a mismatch on `scale` bills the wrong amount
      // just as effectively, and nobody would have run the seeded test against it.
      const mismatches: string[] = [];

      for (const client of CLIENT_PLANS) {
        const server = SERVER_PLANS[client.id];
        if (!server) {
          mismatches.push(`${client.id}: advertised on the site, absent from the server catalogue`);
          continue;
        }
        for (const f of ["name", "amountCents", "currency", "interval", "maxVehicles"] as const) {
          if (client[f] !== server[f]) {
            mismatches.push(
              `${client.id}.${f}: site says ${JSON.stringify(client[f])}, ` +
                `server says ${JSON.stringify(server[f])}`,
            );
          }
        }
      }
      for (const id of Object.keys(SERVER_PLANS)) {
        if (!CLIENT_PLANS.some((p) => p.id === id)) {
          mismatches.push(`${id}: billable on the server, never shown on the site`);
        }
      }

      expect(
        mismatches,
        "\nPLAN CATALOGUE DRIFT — the two files that must stay identical have diverged:\n" +
          mismatches.map((m) => `  - ${m}`).join("\n") +
          "\n\n  apps/web/src/lib/plans.ts is what the customer sees.\n" +
          "  supabase/functions/_shared/signup-plans.ts is what the customer pays.\n" +
          "  FAILURE MODE (a): someone edited one of them. Edit the other.\n",
      ).toEqual([]);
    }));

  it("keeps the Stripe lookup key in step with the price", () =>
    guarded(STEP, () => {
      // signup-plans.ts, its own header: "you MUST bump the `lookupKey` suffix —
      // Stripe Prices are immutable, so a stale lookup_key would keep resolving
      // the OLD price and quietly bill the old amount forever."
      //
      // The keys embed the amount (d247_signup_starter_usd_9900_v1), so a price
      // change that forgot the key is visible from here.
      for (const [id, plan] of Object.entries(SERVER_PLANS)) {
        expect(
          plan.lookupKey,
          `Plan "${id}" costs ${plan.amountCents} cents but its Stripe lookup key is ` +
            `"${plan.lookupKey}", which does not mention that amount.\n` +
            `Stripe Prices are immutable: a stale key resolves the OLD Price and bills ` +
            `the OLD amount, for ever, with no error anywhere.`,
        ).toContain(String(plan.amountCents));
      }

      chain.pass(STEP, `${SEEDED.planId} @ ${SEEDED.amountCents} cents`);
    }));
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findTrialGrant,
  normaliseEmail,
  resolveTrialDays,
  isAwaitingCard,
  isSecured,
  normaliseTrialDays,
  savedPaymentMethodOf,
  setupClientSecretOf,
  trialCreateParams,
  trialTermsChanged,
} from "../_shared/signup-trial.ts";

const DAY = 86_400;

Deno.test("a trialing subscription with no card is NOT paid — the trap this guards", () => {
  const sub = { status: "trialing", default_payment_method: null, pending_setup_intent: { status: "requires_payment_method", client_secret: "seti_x_secret" } };
  assertEquals(isSecured(sub), false);
  assertEquals(isAwaitingCard(sub), true);
  assertEquals(setupClientSecretOf(sub), "seti_x_secret");
});

Deno.test("a trial counts once the card is saved, either way Stripe records it", () => {
  assertEquals(isSecured({ status: "trialing", default_payment_method: "pm_1" }), true);
  const viaIntent = { status: "trialing", default_payment_method: null, pending_setup_intent: { status: "succeeded", payment_method: "pm_2" } };
  assertEquals(isSecured(viaIntent), true);
  assertEquals(savedPaymentMethodOf(viaIntent), "pm_2");
  assertEquals(setupClientSecretOf(viaIntent), null);
});

Deno.test("active is paid; incomplete and cancelled are not", () => {
  assertEquals(isSecured({ status: "active" }), true);
  assertEquals(isSecured({ status: "incomplete" }), false);
  assertEquals(isSecured({ status: "canceled", default_payment_method: "pm_1" }), false);
  assertEquals(isSecured(null), false);
});

Deno.test("trial params: none for 0, cancel-if-no-card for a trial", () => {
  assertEquals(trialCreateParams(0), {});
  assertEquals(trialCreateParams(5), {
    trial_period_days: 5,
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
  });
});

Deno.test("trial days are clamped to 0..90 whole days", () => {
  assertEquals(normaliseTrialDays(5), 5);
  assertEquals(normaliseTrialDays("7"), 7);
  assertEquals(normaliseTrialDays(90), 90);
  assertEquals(normaliseTrialDays(91), 0);
  assertEquals(normaliseTrialDays(2.5), 0);
  assertEquals(normaliseTrialDays(null), 0);
});

Deno.test("trial terms changed mid-signup", () => {
  const fiveDay = { trial_start: 1_000_000, trial_end: 1_000_000 + 5 * DAY };
  assertEquals(trialTermsChanged(fiveDay, 5), false);
  assertEquals(trialTermsChanged(fiveDay, 7), true);
  assertEquals(trialTermsChanged(fiveDay, 0), true);
  assertEquals(trialTermsChanged({ trial_start: null, trial_end: null }, 5), true);
  assertEquals(trialTermsChanged({ trial_start: null, trial_end: null }, 0), false);
});


/** A tiny stand-in for the supabase query builder. */
function fakeDb(row: unknown, error: unknown = null) {
  const q: any = {
    select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => q };
}

Deno.test("a personal grant overrides the plan's trial", async () => {
  const db = fakeDb({ id: "g1", trial_days: 14 });
  assertEquals(await resolveTrialDays(db, " Mike@Example.com ", { trialDays: 5 }), 14);
});

Deno.test("no grant falls back to the plan; a missing table is just 'no grant'", async () => {
  assertEquals(await resolveTrialDays(fakeDb(null), "a@b.co", { trialDays: 5 }), 5);
  assertEquals(await resolveTrialDays(fakeDb(null, { code: "42P01" }), "a@b.co", { trialDays: 0 }), 0);
  assertEquals(await findTrialGrant(fakeDb({ id: "g", trial_days: 500 }), "a@b.co"), null);
});

Deno.test("emails are compared trimmed and lower-cased", () => {
  assertEquals(normaliseEmail("  Mike@Example.COM "), "mike@example.com");
});

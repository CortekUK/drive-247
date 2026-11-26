// Proves spec 08 against staging: the plan prices, the codes, and that the card
// step shows the server's numbers (one place for the math).
import { statement, run, sql, equal, ok } from "../../eval-kit.mjs";
import { source } from "./lib/account.mjs";

statement("08.2", "Each visible plan has one price in cents, the same in its Stripe lookup key", async () => {
  const plans = await sql(`select plan_key, amount_cents, stripe_lookup_key from signup_plans where is_visible`);
  ok(plans.length > 0, "no visible plans");
  for (const p of plans) {
    ok(Number.isInteger(p.amount_cents) && p.amount_cents > 0, `${p.plan_key} has no price in cents`);
    ok(String(p.stripe_lookup_key).includes(`_${p.amount_cents}_`), `${p.plan_key}: lookup key ${p.stripe_lookup_key} is not for ${p.amount_cents} cents`);
  }
});

statement("08.3", "Visible plans with a trial have a trial length of 1 to 90 days", async () => {
  const plans = await sql(`select plan_key, trial_days from signup_plans where is_visible and trial_days > 0`);
  for (const p of plans) ok(p.trial_days >= 1 && p.trial_days <= 90, `${p.plan_key} trial ${p.trial_days}`);
});

statement("08.8", "BF30 ends on 1 Dec 2026 04:59:59 UTC and is 30% for 3 months", async () => {
  const [c] = await sql(`select discount_type, discount_value, duration, duration_months, expires_at from platform_promo_codes where code = 'BF30'`);
  ok(c, "BF30 is not on staging");
  equal([c.discount_type, Number(c.discount_value), c.duration, c.duration_months], ["percent", 30, "repeating", 3], "BF30");
  equal(new Date(c.expires_at).toISOString(), "2026-12-01T04:59:59.000Z", "expires_at");
});

statement("08.12", "The card step shows the server's amount; the server works it out in the one place", async () => {
  const step = source("apps/web/src/components/onboarding/steps/payment-step.tsx");
  ok(/bill\?\.discountedBillCents\s*\?\?/.test(step), "the BF30 box does not show the server's bill.discountedBillCents");
  const fnSrc = source("supabase/functions/signup-payment-intent-v2/index.ts");
  ok(/signupBill\(/.test(fnSrc) && (fnSrc.match(/bill:\s*billFor\(/g) || []).length >= 3, "signup-payment-intent-v2 does not return `bill` on every card-step answer");
  const promo = source("supabase/functions/_shared/platform-promo.ts");
  ok(/couponMonthsFor\(/.test(promo) && !/deferredCouponMonths|promoVariant\(/.test(promo), "the coupon length is not taken from couponMonthsFor");
});

await run(import.meta.url);

# Spec 08 · Prices, trials and promo codes

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 3 · **Status:** Draft · **Math spec**

## What this covers

What the card step shows and what Stripe charges: plan prices, the free trial, promo codes (BF30
and others), rounding, and changing plan with a code applied. The signup order change does not
touch this math; this spec records it so it can be proved.

## Behaviour

- 08.1 Money is in whole cents wherever it is stored or passed (`amount_cents`, coupon
  `amount_off`).
- 08.2 A plan's price on the landing page, on the card step and on the Stripe price is the same
  number, read from `signup_plans.amount_cents`.
- 08.3 With a trial, the card step shows $0.00 due today and nothing is charged at signup.
- 08.4 The first charge is on the day the trial ends (`trial_days` after signup) and is the plan
  price, less any discount still running.
- 08.5 BF30 takes 30% off each of the first 3 **paid** monthly bills. The trial is not one of
  them. The 4th paid bill is the full price.
- 08.6 A percentage discount is rounded to the cent, half up, on each bill
  (`Math.round(cents × (100 − pct) / 100)`). Stripe's own rounding must give the same cents; the
  eval compares.
- 08.7 Codes are matched without regard to case or surrounding spaces (" bf30 " = BF30).
- 08.8 A code that does not exist, has ended (`expires_at`), or is not active is refused with a
  message, and the plan price shows without it.
- 08.9 A code limited to some plans (`restrict_signup_plan_keys`) is refused on any other plan.
- 08.10 Changing plan with a code applied keeps the code and works the discount out on the new
  plan's price.
- 08.11 Removing the code returns the full price.
- 08.12 *(Defect to fix)* The discount is worked out in two places: in the browser for display
  (`apps/web/src/lib/black-friday.ts`, `promo-offer.ts`) and on the server for Stripe
  (`_shared/platform-promo.ts`). The one place is `_shared/platform-promo-rules.ts`; the card step
  shows the amount the server returns.
- 08.13 *(Defect to fix)* With a trial, the coupon is stretched by `floor(trialDays / 30)` months
  (`deferredCouponMonths`). Stripe counts a repeating coupon's months from the subscription start,
  so for a trial of 30 days or more the 3rd discounted bill can fall on the coupon's last day. The
  stretch is changed so that exactly 3 paid bills are discounted for every trial length (08.5).

## Worked examples

Live staging plans (26 Nov 2026): Starter $129.00, Growth $229.00, Scale $349.00, 14-day trial.

| # | Case | Working (by hand) | Expected |
|---|---|---|---|
| 1 | Starter, no code | — | $129.00 a month |
| 2 | Starter + BF30 | $129.00 × 0.70 = $90.30 | Bills 1–3: $90.30, bill 4: $129.00 |
| 3 | Growth + BF30 | $229.00 × 0.70 = $160.30 | Bills 1–3: $160.30, bill 4: $229.00 |
| 4 | Scale + BF30 | $349.00 × 0.70 = $244.30 | Bills 1–3: $244.30, bill 4: $349.00 |
| 5 | Growth, 14-day trial, signup 26 Nov 2026 | 26 Nov + 14 days = 10 Dec | Today $0.00; 10 Dec $160.30 (BF30), 10 Jan $160.30, 10 Feb $160.30, 10 Mar $229.00 |
| 6 | Rounding, $99.99 + 30% | 9,999 × 0.70 = 6,999.3 → 6,999 | $69.99 |
| 7 | Rounding half, $0.05 + 30% | 5 × 0.70 = 3.5 → 4 (half up) | $0.04 |
| 8 | 100% off, $129.00 | 12,900 × 0 = 0 | $0.00, never below 0 |
| 9 | 30-day trial + BF30, signup 26 Nov 2026 | First bill 26 Dec; bills 26 Dec, 26 Jan, 26 Feb discounted | 26 Dec, 26 Jan, 26 Feb: $160.30 (Growth); 26 Mar: $229.00 |
| 10 | Growth + BF30, changed to Scale | $349.00 × 0.70 = $244.30 | $244.30, not $160.30 |
| 11 | " bf30 " typed | trims and uppercases to BF30 | Same as row 3 |
| 12 | BF30 after 1 Dec 2026 04:59:59 UTC | expired | Refused; $229.00 |

## Database

None. `signup_plans` and `platform_promo_codes` are read, not changed.

## Functions

`signup-payment-intent-v2` returns `{ amountDueTodayCents, firstChargeCents, firstChargeAt,
discountedBills, fullPriceCents }` for the card step to show (08.12).

## Screens

`apps/web/src/components/onboarding/steps/payment-step.tsx` (design unchanged).

## Money and safety

This is real money. Every row above is run by Vitest, and the QA report redoes rows 2–5 and 9 on
a calculator against the card step, the Stripe test dashboard and the invoice.

## Proof

| Statement | Proved by |
|---|---|
| 08.1, 08.5, 08.6, 08.7, 08.13 (rows 1–12) | `evals/08-prices-trials-and-promo-codes.test.ts` (Vitest) |
| 08.2, 08.3, 08.4, 08.8, 08.9, 08.10, 08.11, 08.12 | `evals/08-prices-trials-and-promo-codes.mjs` (staging, Stripe test mode) |
| Rows 2–5, 9 on the screen and invoice | QA report |

## Not in this spec

Apple Pay and Google Pay showing on a phone (QA report only).

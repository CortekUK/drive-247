# Spec 09 · Prices and charges

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 3, 14, 16, 17 · **Status:** Draft

## What this covers

The price of each check, when a check counts as finished, and the charge row that records what the
company owes. Sending the charge to Stripe and showing it is spec 10. This is a money spec.

## Behaviour

- **09.1** All money is whole cents, as integers, everywhere it is stored or passed. No fractions of a cent.
- **09.2** The standard check costs the company 0 cents, always.
- **09.3** A premium check costs the company `provider_cost_cents + state_fee_cents + margin_cents`. Each part is an integer; the total is their plain sum, with no rounding step.
- **09.4** `margin_cents` is 50 for every premium check. It is per check, not per session.
- **09.5** The price parts are frozen on the session's check row when the session is made. A change to the price list afterwards does not change an open session's charge.
- **09.6** The state fee is the `verification_state_fees` row for the service and the licence state, read when the premium check finishes. A service without `has_state_fee` has a fee of 0.
- **09.7** A premium check is finished, and charged, when RentID returns `complete` for it, whatever the outcome.
- **09.8** Not charged: link never opened; renter stopped; session expired, cancelled or replaced; standard check failed or needs a look; consent refused; switched off; state not covered; RentID error, `failed` or out of credit.
- **09.9** A finished premium check creates exactly one `verification_charges` row, holding the three parts and the total. A second attempt for the same session and service creates nothing (spec 01.11).
- **09.10** When a check with `has_state_fee` finishes in a state with no fee row, the charge row is created with `state_fee_cents = 0` and `last_error = 'state_fee_unknown'`, is not sent to Stripe, and Drive247's team is told. It is sent only after the team sets the fee.
- **09.11** Verifying the same customer twice with premium checks makes two charges.
- **09.12** The one place the math lives is `_shared/verification/pricing.ts` (`priceOf()`, `chargeFor()`, `displayTotal()`); the portal shows the result of `context`, never its own sum.
- **09.13** Prices at launch, from the price list: licence status `provider_cost_cents = 299` (to confirm: RentID's credits per check), `margin_cents = 50`, `has_state_fee = true`. Driving record and criminal record are seeded `switched_off` with cost 0 until RentID gives their price.

## Worked examples

By hand. RentID charge 299 cents per check (until confirmed), margin 50 per check.

| # | Ticked and finished | RentID | State fee | Margin | Working | Company pays |
|---|---|---|---|---|---|---|
| 1 | Standard only | 0 | 0 | 0 | 0 | **$0.00** |
| 2 | Standard + licence status, fee 0 | 299 | 0 | 50 | 299 + 0 + 50 = 349 | **$3.49** |
| 3 | Standard + driving record, fee $8.00 | 299 | 800 | 50 | 299 + 800 + 50 = 1149 | **$11.49** |
| 4 | Standard + driving record, fee 0 | 299 | 0 | 50 | 349 | **$3.49** |
| 5 | Standard + licence status (fee 0) + driving record (fee $8.00) | 598 | 800 | 100 | 349 + 1149 = 1498 | **$14.98** |
| 6 | Standard + all three, fees $8.00 and $5.00 (criminal has no state fee) | 897 | 1300 | 150 | 349 + 1149 + 849 = 2347 | **$23.47** |
| 7 | Licence status, link never opened | 0 | 0 | 0 | not finished | **$0.00** |
| 8 | Licence status, standard check fails | 0 | 0 | 0 | never run | **$0.00** |
| 9 | Licence status, RentID says suspended | 299 | 0 | 50 | finished: 349 | **$3.49** |
| 10 | Licence status, state not covered | 0 | 0 | 0 | not finished | **$0.00** |
| 11 | Licence status twice for one customer in a month | 598 | 0 | 100 | 349 × 2 = 698 | **$6.98** |
| 12 | Month: 7 licence status (fee 0) + 2 driving records ($8.00) | 2691 | 1600 | 450 | 349 × 7 = 2443; 1149 × 2 = 2298; 2443 + 2298 = 4741 | **$47.41** |
| 13 | Licence status, fee $25.00 (the largest expected) | 299 | 2500 | 50 | 2849 | **$28.49** |
| 14 | Licence status, consent refused | 0 | 0 | 0 | not run | **$0.00** |
| 15 | Licence status, price list changed to 349 after the session was made | 299 | 0 | 50 | frozen: 349 | **$3.49** |

Row 6 assumes the brief's split (fee $8.00 on the driving record, $5.00 on another): with RentID's
documents saying the criminal record carries no state fee, the $5.00 is the licence status fee:
licence status 299 + 500 + 50 = 849, driving record 1149, criminal 349: 849 + 1149 + 349 = 2347. The
total is the same, $23.47.

## Database

`verification_charges` and the frozen columns on `verification_session_checks` (spec 01). Seed
rows for `verification_services` and `verification_state_fees` (fees from RentID's state fee PDF,
when Ghulam sends it).

## Functions

`chargeFor(check, stateFeeCents)` in `pricing.ts` returns `{ provider_cost_cents, state_fee_cents,
margin_cents, total_cents }`. The charge row is inserted by the code that finishes a premium check
(spec 08), with `on conflict (session_id, service_key) do nothing`.

## Screens

None. (The total on screen 1 is spec 04; the bill is spec 10.)

## Money and safety

This decides what each company pays Drive247. Exactly once (09.9), never on an unfinished check
(09.8), never with a guessed state fee (09.10).

## Proof

| Statement | Proved by |
|---|---|
| 09.1 to 09.4, 09.6, 09.12 (math) | `evals/09-prices-and-charges.test.ts` (Vitest, all 15 rows) and the QA report |
| 09.5, 09.7 to 09.11, 09.13 | `evals/09-prices-and-charges.mjs` |

## Not in this spec

- Refunds: not in this round. A wrong charge is fixed in Stripe by Drive247's team.

# Spec 10 · The next bill and the Billing tab

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 17 · **Status:** Draft

## What this covers

Putting each charge row on the company's next Drive247 subscription bill as a Stripe pending
invoice item, exactly once, and showing the checks on the Billing tab and on receipts. Tested on
Stripe test mode only (D18). This is a money spec.

## Behaviour

- **10.1** A charge row is sent to Stripe as one invoice item on the company's subscription customer, attached to the subscription, for `total_cents` in `usd`.
- **10.2** The account and mode come from the company's latest live subscription row (`stripe_account` uk/uae) and `tenants.subscription_stripe_mode`, through `_shared/subscription-stripe.ts`, as `integration-billing` does.
- **10.3** The item's description is "<service name> · <customer name> · <d Mon>", e.g. "Licence active with the state · Marcus Hill · 2 Dec".
- **10.4** The item's metadata carries `d247_kind = 'verification_check'`, `d247_charge_id`, `service_key`, `tenant_id`.
- **10.5** The Stripe call uses the idempotency key `d247-vcheck-<charge id>`, so a retry never makes a second item.
- **10.6** On success the charge row gets `stripe_invoice_item_id`, `stripe_account`, `stripe_mode` and `sent_at`.
- **10.7** On failure the row keeps `sent_at = null`, `attempts + 1` and `last_error`. The sweep retries unsent rows every 5 minutes, up to 12 attempts, then tells Drive247's team.
- **10.8** A row is never shown as billed unless it has `sent_at`.
- **10.9** A company whose subscription is `trialing` gets the item on the invoice that ends the trial.
- **10.10** The amount of the Stripe item equals the charge row's `total_cents`.
- **10.11** After a Stripe test clock moves the subscription past its period end, the new invoice carries one line per sent charge, each for its `total_cents`, and the invoice total includes them.
- **10.12** `integration-billing` action `upcoming` labels a line with `metadata.d247_kind = 'verification_check'` as kind `verification`, with the item's description as its label.
- **10.13** The Billing tab's next bill shows the plan, then one row per premium service with its count and amount (e.g. "Licence active with the state × 7 · $24.43"), then "Standard check, <n> checks, Free", then the total.
- **10.14** The count of free standard checks is the number of standard checks finished this billing period for the company, read from our own tables.
- **10.15** A list "This month's checks" on the Billing tab shows each finished check: the customer, the check, the day and the amount, free ones marked Free, and unsent charges marked "Not on a bill yet".
- **10.16** A paid bill's receipt lists the check lines as Stripe has them (through `invoice_lines`).
- **10.17** Staging only ever uses Stripe test mode: the sending code refuses to run when the project is staging and the mode is live.
- **10.18** The company's own Stripe Connect account is never used for these charges.

## Worked examples

From spec 09, end to end on a test clock. Each row is checked four ways: the screen total, the
charge row, the Stripe item, the invoice line.

| # | Charges sent | Working | Invoice lines for checks |
|---|---|---|---|
| 2 | 1 × licence status, fee 0 | 349 | one line, $3.49 |
| 3 | 1 × driving record, fee $8.00 (switch on, eval only) | 1149 | one line, $11.49 |
| 5 | licence status 349 + driving record 1149 | 1498 | two lines, $3.49 and $11.49 |
| 6 | 849 + 1149 + 349 | 2347 | three lines, total $23.47 |
| 11 | 349 twice | 698 | two lines of $3.49 |
| 12 | 7 × 349, 2 × 1149 | 2443 + 2298 = 4741 | nine lines, total $47.41; Billing shows "× 7 · $24.43" and "× 2 · $22.98" |

## Database

Spec 01 (`verification_charges`). No change to `tenant_subscription_invoices`: `subscription-webhook`
already stores invoices whatever lines they carry (as `base_amount`).

## Functions

- `_shared/verification/billing.ts`: `sendCharge(chargeId)`. Used right after a charge is created
  (spec 08) and by the sweep.
- `integration-billing/lines.ts` `labelInvoiceLine`: one new branch for `d247_kind = 'verification_check'`.
- `verification-v2` action `usage` `{ periodStart, periodEnd }`: the list in 10.15 and the count in 10.14.

## Screens

- Portal, `components/billing-v2/` next bill rows (through `useUpcomingInvoice` and `rowsFromInvoice`):
  verification lines grouped by service, then the free line.
- A new usage category `verification` in `lib/usage-categories.ts` with a `useVerificationCategoryData`
  hook, so the existing usage dashboard lists "This month's checks".
- `receipt-dialog-v2.tsx`: unchanged code; the lines come from Stripe.

## Money and safety

Every amount sent equals a charge row (10.10), once (10.5), on the right account (10.2), never live on
staging (10.17), never on the company's Connect account (10.18). Northwind on staging has no
subscription today: a test-mode subscription on the UAE test account is needed first (to agree in the group).

## Proof

| Statement | Proved by |
|---|---|
| 10.1 to 10.7, 10.9 to 10.12, 10.14, 10.17, 10.18 | `evals/10-next-bill.mjs` (Stripe test mode, a test clock, Northwind's test subscription) |
| 10.13, 10.15, 10.16, 10.8 | QA report (the Billing tab and a receipt, compared with a calculator) |

## Not in this spec

- Metered billing (`report-usage-event`): not used, because a meter has one fixed price per unit and a state fee changes the amount per check.

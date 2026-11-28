# Spec 04 · The Verify dialog, screen 1: what to check

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 3, 21 · **Status:** Draft

## What this covers

The first screen of the Verify dialog: the table of services built from the price list, the ticks
the company used last time, the locked standard check, the greyed rows, and the total. Sending and the
progress screen are spec 05.

## Behaviour

- **04.1** The table lists every row of `verification_services` in `sort_order`. Nothing in the screen's code names a service or a price.
- **04.2** Each row shows a tick, the name, the description, and "Free" or the price.
- **04.3** The standard check is always ticked and its tick cannot be removed.
- **04.4** A service with `availability = 'coming_soon'` shows "Coming soon" and cannot be ticked.
- **04.5** A service with `availability = 'switched_off'` shows "Not available yet" and cannot be ticked.
- **04.6** When the staff member may not tick premium checks (spec 03.12, 03.13), premium rows cannot be ticked and say "Ask an admin to add premium checks".
- **04.7** When the company's subscription is not `active` or `trialing`, premium rows cannot be ticked and say "Subscribe to use premium checks".
- **04.8** The ticks start as the company's `verification_tenant_prefs.last_ticks`, keeping only services that can be ticked now. A company with no prefs row starts with the standard check only.
- **04.9** Sending a check saves its ticks as the company's `last_ticks`. "Last time" belongs to the company: a different staff member of the same company sees the same ticks next.
- **04.10** A premium price is shown as `provider_cost_cents + margin_cents`, written as dollars to two places ("$3.49").
- **04.11** For a service with `has_state_fee`, when the customer's licence state is known and `verification_state_fees` has a row for it, the price includes that fee; otherwise it reads "$3.49 + state fee".
- **04.12** Above the Next button the screen shows "For <first name>: <total>", the sum of what is ticked. When any ticked fee is not known it shows "from <total without the fees>". It never shows an exact total that could turn out wrong.
- **04.13** Under the table it says: "Premium checks are added to your next subscription bill. You are only charged for a check the customer finishes."
- **04.14** When the customer was verified before, the screen says "Verified on <date>" so staff see it before paying again.
- **04.15** When the customer's licence state is known and a premium service is known not to cover it, that row cannot be ticked and says "Not available in this state yet". Before the state is known it can be ticked.
- **04.16** Pressing Verify on a customer with an open session opens the progress screen (spec 05), not this screen.
- **04.17** The screen's data comes from one call, `verification-v2` action `context`, which returns the services, the prefs, the staff member's rights, the subscription answer, the customer's known state, any open session and the last verified date.

## Worked examples

The displayed total for one customer. Prices from spec 09 (licence status $2.99 + $0.50; state fee by state).

| # | Ticked | State known? | Fee known? | Working | Shown |
|---|---|---|---|---|---|
| 1 | Standard only | n/a | n/a | 0 | "For Marcus: Free" |
| 2 | Standard + licence status | No | n/a | 299 + 50 = 349, fee unknown | "For Marcus: from $3.49" |
| 3 | Standard + licence status | TX | Yes, $0.00 | 299 + 0 + 50 = 349 | "For Marcus: $3.49" |
| 4 | Standard + licence status | FL | Yes, $8.00 | 299 + 800 + 50 = 1149 | "For Marcus: $11.49" |
| 5 | Standard + licence status | WA | No row | 299 + 50, fee unknown | "For Marcus: from $3.49" |

## Database

Reads spec 01's tables. The save in 04.9 is an upsert of `verification_tenant_prefs` done by the
`start` action with the service role.

## Functions

`verification-v2` action `context` (staff JWT; the tenant from the caller's `app_users` row):
input `{ customerId }`; output `{ services[], lastTicks[], canStart, canTickPremium, premiumBySubscription,
knownState, stateFees{}, openSession|null, lastVerifiedAt|null, customer{ name, email, phone } }`.
Errors: 401 no session, 403 `not_enabled`, 404 customer not in this company.

## Screens

Portal, a new component `components/verification-v2/verify-dialog-v2.tsx` (screen 1:
`screen-what.tsx`). A dialog, never a side sheet; fits a 1280 by 720 laptop screen without scrolling
inside it; works in dark mode.

## Money and safety

The total shown is an estimate for the staff member; the charge is made from the frozen session
prices (spec 09). Showing "from" when a fee is unknown keeps the screen from promising a lower price.

## Proof

| Statement | Proved by |
|---|---|
| 04.1, 04.8, 04.9, 04.17 | `evals/04-verify-dialog.mjs` (calls `context`, then `start`) |
| 04.10, 04.11, 04.12 (math) | `evals/04-verify-dialog.test.ts` (Vitest, the 5 rows above, on the shared `displayTotal()` in `_shared/verification/pricing.ts`) and the QA report |
| 04.2 to 04.7, 04.13 to 04.16 | QA report |

## Not in this spec

- Screens 2 and 3 (spec 05). The charge itself (spec 09).

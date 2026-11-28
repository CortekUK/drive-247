# Spec 11 · The warning when a rental is created or extended

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 15, 18 · **Status:** Draft

## What this covers

What the v2 rental screens say about the customer's verification, and the licence expiry check
against the return date, on create and on extension. Whether a rental may go ahead is still decided
by the company's existing settings and waiver.

## Behaviour

- **11.1** When staff pick a customer whose status is not Verified on the v2 create flow, the screen says "<name> is not verified" with the status word, and offers a Verify button that opens the Verify dialog there.
- **11.2** When the status is Needs a look, the screen says "<name>'s check needs a look" with the reason.
- **11.3** When the customer is Verified with a `verification_warning`, the same red warning shows on the rental screen.
- **11.4** When the customer is Verified and `licence_expiry_date` is before the return date, the screen says "The licence on file runs out on <date>, before this rental ends on <date>."
- **11.5** The same check runs when an extension is saved, against the new return date, with no new session and no new charge.
- **11.6** The expiry comparison is `licenceValidThrough(expiry, returnDate)` in one shared file; the portal and the server call the same rule (spec 07.31 family).
- **11.7** Whether the rental may go ahead is unchanged: a not-verified customer still needs the existing manual verification or waiver (`allow_rental_without_id_verification` and a reason), as today.
- **11.8** A customer with typed details only, where the company allows a rental without verification, can be rented to through the waiver, and the rental shows "Not verified".
- **11.9** The rental is counted as verified by the existing code when `identity_verification_status` is `verified` or `manually_verified`: the module's mapping (spec 03.8) keeps that true for a Verified customer.
- **11.10** Other companies see today's rental screens unchanged.

## Worked examples

The expiry rule (11.4, 11.5). Today 23 Dec 2026, licence expiry 10 Mar 2027.

| # | Return date | Working | Shown |
|---|---|---|---|
| 1 | 27 Dec 2026 | expiry after return | nothing |
| 2 | 10 Mar 2027 | expiry equal to return date: valid that day | nothing |
| 3 | 12 Mar 2027 | expiry before return | the warning |
| 4 | extension 5 Mar → 15 Mar 2027 | new return after expiry | the warning on the extension |

## Database

None.

## Functions

`licenceValidThrough(expiryIso, returnIso): boolean`: true when the expiry date is on or after the
return date. It lives in `_shared/verification/rules.ts`. The portal cannot import Deno code, so
`apps/portal/src/lib/verification-v2/rules.ts` is a byte-for-byte copy, and `evals/11-rental-warning.mjs`
fails if the two files differ (the same pattern the email layout already uses).

## Screens

- Portal v2 create flow: `components/rentals-v2/rental-create-v2.tsx` and
  `rental-detail/stage-customer.tsx` (the chips at lines 236 to 278 gain the new status words).
- Extensions: `components/rentals/AdminExtendRentalDialog.tsx` is shared with v1; the warning is added
  in a v2 fork mounted from `rail-extensions.tsx`, so v1 is not changed.

## Money and safety

None charged here (11.5). The warning protects the company from renting past a licence's expiry.

## Proof

| Statement | Proved by |
|---|---|
| 11.6, 11.9 | `evals/11-rental-warning.mjs` |
| 11.4, 11.5 (rule) | `evals/11-rental-warning.test.ts` (Vitest, the 4 rows) |
| 11.1 to 11.3, 11.7, 11.8, 11.10 | QA report |

## Not in this spec

- Changing who may waive verification. Unchanged.

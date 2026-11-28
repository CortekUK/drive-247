# Spec 03 · The one status, the Verify button and who may use it

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 3, 5, 9, 15, 19, 20, 21 · **Status:** Draft

## What this covers

The seven statuses and how they show on the customers list and the customer's page; the Verify and
Remind buttons; who may press Verify; who may tick premium checks; and the subscription rule for
premium checks. The dialog itself is spec 04.

## Behaviour

- **03.1** A customer's status is the status of their latest session (`customers.verification_session_id`). A customer with no session is `not_verified`.
- **03.2** A session whose `expires_at` has passed while it is `link_sent` or `in_progress` shows as `expired`, even before the sweep (spec 05) writes it. The screen works it out from the clock.
- **03.3** The words shown are exactly: Not verified, Link sent, In progress, Verified, Needs a look, Failed, Expired.
- **03.4** The customers list row shows the status word, and a **Verify** button when the status is Not verified, Failed, Expired or Needs a look.
- **03.5** The row shows a **Remind** button when the status is Link sent or In progress.
- **03.6** A Verified customer with a `verification_warning` shows a red warning mark on the row, with the warning as its label.
- **03.7** The customer's page, Verification section, shows the same status, the same buttons, the last session's result lines and its moments.
- **03.8** Every place that reads `customers.identity_verification_status` keeps working, because the module keeps writing it: not_verified, expired → `unverified`; link_sent, in_progress, needs_review → `pending`; verified → `verified`; failed → `rejected`. A customer marked `manually_verified` by staff keeps that value until a new session finishes.
- **03.9** A viewer sees the status and the result but no Verify or Remind button.
- **03.10** A manager whose Customers access is view-only sees no Verify or Remind button.
- **03.11** A request to start a check from a viewer's token is refused with 403, whatever the browser shows.
- **03.12** Head admins, admins, and managers with edit access to Customers may tick premium checks.
- **03.13** Ops may start a check with the standard check only. A start request from an ops token that includes a premium check is refused with 403 `premium_not_allowed`.
- **03.14** Premium checks need the company's latest subscription to be `active` or `trialing`. Otherwise a start request with a premium check is refused with 402 `subscription_required`, and the dialog greys them with "Subscribe to use premium checks".
- **03.15** The standard check needs no subscription.
- **03.16** The module is switched on for Northwind only. For any other company the Verify button is not shown and the start request is refused with 403 `not_enabled`.

## Worked examples

None.

## Database

None beyond spec 01. The mapping in 03.8 lives in one place: the database function
`verification_v2_set_customer_status(p_customer uuid, p_session uuid, p_status verification_status_v2)`
(spec 05), which writes both columns together.

## Functions

The checks in 03.11 to 03.16 are made by `verification-v2` (spec 05) on every `start`, using one
shared helper, `_shared/verification/permissions.ts`:

- `canStart(role, canEditCustomers)`: true for head_admin, admin, ops, and a manager with Customers edit.
- `canTickPremium(role, canEditCustomers)`: true for head_admin, admin, and a manager with Customers edit.
- `premiumAllowedBySubscription(status)`: true for `active` and `trialing` only.
- `isVerificationEnabled(tenantSlug)`: true for `northwind` only (one list, like `integration-billing/gate.ts`).

The portal reads the same answers from `verification-v2` action `context` (spec 04), so the screen
and the server cannot disagree.

## Screens

- **Portal, customers list** (`app/(dashboard)/customers/page.tsx`, the v2 table at lines 1034 to 1135):
  the Verification column uses the new words and gains the Verify / Remind button and the warning mark.
  The old `StartVerificationDialog` stays only for the v1 table.
- **Portal, customer's page** (`components/customers-v2/customer-detail/section-verification.tsx`):
  the headline uses the new status; "Send a verification link" opens the new dialog instead of
  `StartVerificationDialog`; the timeline shows the session's moments. The CheckMyDriver tab and the
  out-of-date banner stay as they are.
- Role and access come from `useAuth()` and `useManagerPermissions()`; the Northwind switch from a
  new `V2Area` `"verification"` in `lib/v2.ts` listing `NORTHWIND`.

## Money and safety

Premium checks spend the company's money, so the role and subscription rules are enforced by the
server (03.11, 03.13, 03.14), not only by hiding buttons.

## Proof

| Statement | Proved by |
|---|---|
| 03.1, 03.8, 03.11, 03.13, 03.14, 03.15, 03.16 | `evals/03-status-and-button.mjs` |
| 03.2, 03.12 | `evals/03-status-and-button.mjs` (the helper, called with each case) |
| 03.3 to 03.7, 03.9, 03.10 | QA report (what the list and the page show) |

## Not in this spec

- What the dialog shows (spec 04) and how a session is made (spec 05).
- The warning when creating a rental (spec 11).

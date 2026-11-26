# Spec 09 · The signups list

**Feature:** feat-001 · Account creation and the account · **PRD stories:** "How we know it is working" · **Status:** Draft

## What this covers

What Super admin → Customer management → Signups shows for each attempt after the order change.

## Behaviour

- 09.1 The steps recorded are `details` (1), `business` (2), `card` (3), `done` (4), in
  `signup-lead`'s `STEP_ORDER`.
- 09.2 A step only moves forward; recording an earlier step never moves it back.
- 09.3 Rows recorded under the old order keep their meaning: `email_code` and `password` are shown
  as "at the email code (old signup)" and "at the password (old signup)".
- 09.4 Each finished signup shows whether the email is confirmed and a password is set, and, if
  not, how long is left before the 3-day point or that it has passed.
- 09.5 The page labels match the new order: "stopped at about you / the business / the card".

## Worked examples

None.

## Database

`signup_leads.last_step` check (if any) accepts `card` = 3 and `done` = 4 for new rows and keeps
the old values. The `admin_signups` function adds `email_confirmed` and `password_set`. Migration
`supabase/migrations/20261127000000_signup_steps_three.sql`, applied to staging first.

## Functions

`signup-lead` (`STEP_ORDER`); `admin_signups` RPC.

## Screens

`apps/admin/components/admin/customer-management/signups-tab.tsx` (`LEAD_STEP_LABEL`).

## Money and safety

The list shows email addresses; it stays super-admin only.

## Proof

| Statement | Proved by |
|---|---|
| 09.1, 09.2, 09.3, 09.4 | `evals/09-signups-list.mjs` |
| 09.5 | QA report |

## Not in this spec

Anything else on the Customer management page.

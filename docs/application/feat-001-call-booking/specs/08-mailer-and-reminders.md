# Spec 08 · Sending once, and the reminders

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 6, 7, 12, 16 · **Status:** Draft

## What this covers

The job that sends what is queued in the email ledger exactly once, and the rule that queues the
two reminders. What each email says is spec 07.

## Behaviour

**Queuing**

- 08.1 An action that sends email queues its ledger rows in the same transaction as the change. If the change fails, nothing is queued.
- 08.2 The key of a ledger row is `<booking id>:<kind>:<sequence>` for booked, moved, cancelled and missed, and `<booking id>:<kind>:<starts_at as epoch seconds>` for reminders. Pressing a button twice, or a retry, cannot queue the same email twice (spec 01.15).
- 08.3 Each row carries a snapshot of what the email needs (times, old time, reason, who acted), so a later change does not alter an email already queued.

**Reminders**

- 08.4 `reminder_day` is due from 24 hours before the start until 1 hour before it, for a live booking that was booked or last moved at least 24 hours before its start.
- 08.5 `reminder_hour` is due from 1 hour before the start until the start, for any live booking.
- 08.6 A booking made 10 hours before its start gets only `reminder_hour`.
- 08.7 A cancelled, done or missed booking gets no reminder, and a queued reminder for it that has not gone yet is `skipped` when the job reaches it.
- 08.8 A moved booking's reminders follow the new start, because the key holds the start. The old start's reminders are never queued after the move; any still pending are `skipped`.

| Booked or moved at (UTC) | Start (UTC) | Job runs at (UTC) | Due |
|---|---|---|---|
| 1 Dec 10:00 | 8 Dec 14:00 | 7 Dec 13:55 | none (24h 5m before) |
| 1 Dec 10:00 | 8 Dec 14:00 | 7 Dec 14:00 | `reminder_day` |
| 1 Dec 10:00 | 8 Dec 14:00 | 8 Dec 13:00 | `reminder_hour` |
| 1 Dec 10:00 | 8 Dec 14:00 | 8 Dec 14:00 | none (started) |
| 8 Dec 04:00 | 8 Dec 14:00 | 8 Dec 04:05 | none (10 hours ahead, no day reminder) |
| 8 Dec 04:00 | 8 Dec 14:00 | 8 Dec 13:05 | `reminder_hour` |

**Sending**

- 08.9 The mailer claims pending rows one batch at a time with `for update skip locked`, marks them `sending`, and only then sends. Two runs at once never send the same row.
- 08.10 A sent row becomes `sent` with `sent_at`. A failed send becomes `pending` again with `attempts` up by one and the error, when that run ends, so it is tried again on the next run and not straight away; after 5 attempts it is `failed`.
- 08.11 A row left in `sending` for more than 10 minutes is taken as pending again.
- 08.12 When `ONBOARDING_CALL_ONLY_TO` is set (a comma list of addresses), any other recipient is recorded as `skipped` with `Not on the test list`. It is set on staging and not on production, so tests never email a real company.
- 08.13 `dry_run: true` lists what is due and pending, and sends and changes nothing.

## Worked examples

The table under 08.8, worked by hand: 24 hours before 8 Dec 14:00 is 7 Dec 14:00; 1 hour before is
8 Dec 13:00. A booking at 04:00 for 14:00 is 10 hours ahead, under 24, so no day reminder.

## Database

In the migration of spec 01:

- `onboarding_call_queue_email(p_booking uuid, p_kind, p_payload jsonb)`: inserts the ledger row(s) with the key of 08.2, `on conflict do nothing`. Internal.
- `onboarding_call_due_reminders(p_now timestamptz default now()) returns table (booking_id, kind, starts_at)`: 08.4 to 08.6. Service role and super admin.
- `onboarding_call_queue_reminders(p_now timestamptz default now()) returns int`: queues what is due. Service role.
- `onboarding_call_claim_emails(p_limit int default 20) returns setof onboarding_call_emails`: 08.9, 08.11. Service role.
- A pg_cron job `onboarding-call-mailer` every 5 minutes on production. On staging it is created **inactive** and run by hand.

## Functions

`onboarding-call-mailer` edge function, `verify_jwt = false`, checks its own caller:

| Caller | Body | Does |
|---|---|---|
| pg_cron with `x-platform-secret` | `{}` | queue due reminders, then send pending |
| a super admin JWT | `{}` or `{ dry_run: true }` | the same, or the list |
| any signed-in JWT | `{ flush: true }` | send pending only (it only sends what an action already queued) |
| anyone else | any | `401` |

Returns `{ queued, sent, skipped, failed }`.

## Screens

None.

## Money and safety

No money. Staging cannot reach a real company (08.12). Sending once is guaranteed by the unique key
and the claim, not by the caller.

## Proof

| Statement | Proved by |
|---|---|
| 08.1 to 08.13 | `evals/08-mailer-and-reminders.mjs` (with `dry_run` and test addresses on the list only) |
| A real reminder arrives at the right time | QA report |

## Not in this spec

The email contents (spec 07).

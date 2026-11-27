# Spec 02 · The booking rules and the free times

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 2, 4, 13, 17, 18, 28, 32 · **Status:** Draft

## What this covers

The one place that decides whether a time can be booked, and the list of free times built from it.
Every screen and every function uses these two database functions; nothing else works out a free time.

## Behaviour

**Bryan's calendar today**

| Setting | Value |
|---|---|
| Call length | 30 minutes |
| Hours | Monday to Friday, 09:00 to 17:00, `America/New_York` |
| Notice | 12 hours |
| How far ahead | 30 days |
| Gap between calls | 0 minutes |
| Taking calls | on |

**What makes a time free.** For a time `t`, settings `s` and a moment `now`, the check returns the
first problem in this order, or none:

- 02.1 `not_accepting`: Bryan has switched taking calls off. Message: `Bryan is not taking new calls right now`.
- 02.2 `past`: `t` is at or before `now`. Message: `That time has passed. Please pick another.`
- 02.3 `too_soon`: `t` is earlier than `now` plus the notice. Message: `That time is too soon. Please pick a later one.` Skipped when Bryan himself moves or books a call.
- 02.4 `too_far`: `t` is later than `now` plus the days ahead. Message: `That time is too far ahead. Please pick an earlier one.`
- 02.5 `day_off`: the date of `t` in Bryan's zone is one of his days off. Message: `Bryan is not available then. Please pick another time.`
- 02.6 `outside_hours`: the call from `t` to `t` plus the length does not sit wholly inside one of that weekday's windows in Bryan's zone, or it ends on a different date in his zone (across midnight). Same message as 02.5.
- 02.7 `off_grid`: `t` is not a window's start plus a whole number of call lengths. 9:07 is refused. Same message as 02.5.
- 02.8 `blocked`: the call overlaps a blocked period (spec 06). Same message as 02.5.
- 02.9 `taken`: the call, widened by the gap on both sides, overlaps another live booking. Message: `Someone has just taken that time. Please pick another.`
- 02.10 With a gap of 15 minutes and a call booked 10:00 to 10:30, 09:30 and 10:30 are `taken`; 09:00 and 11:00 are free.
- 02.11 A booking being moved does not count as taken against itself.
- 02.12 The refusal reaches the caller as the message above, with the problem's code in the error's `details`, so a screen can show the words and an eval can check the reason.

**The free times**

- 02.13 The free times are every grid start (02.7) from Bryan's today to the last day ahead that has no problem, earliest first.
- 02.14 A time that the list offers is always accepted by the check at the same `now`, and a time the check accepts is always in the list. There is no second calculator.
- 02.15 With today's settings and nothing booked, a weekday offers 16 times: 09:00, 09:30, … 16:30 New York time.
- 02.16 Changing the call length to 45 minutes offers 09:00, 09:45, … 15:45 (10 times: 480 minutes ÷ 45 = 10, and 16:30 would end at 17:15), and leaves calls already booked at 30 minutes as they are.
- 02.17 A local time that does not exist (02:00 to 02:59 on 14 March 2027 in New York) is never offered and never accepted.
- 02.18 A local time that happens twice (01:00 to 01:59 on 7 November 2027 in New York) is offered once, at its second occurrence (after the clocks go back, 06:00 UTC for 01:00), and nothing fails. The first occurrence is refused as `off_grid`.
- 02.19 The calculator takes `now` as an input, so a check can stand on any date.
- 02.20 Two companies booking the same time at the same moment: exactly one is saved. The other gets `taken`. Bookings are taken one at a time.

## Worked examples

Bryan's hours 09:00 to 17:00 New York, 30 minutes, notice 12 hours, `now` = Monday 7 December 2026
12:00 UTC (07:00 New York).

| Time asked (UTC) | Working | Result |
|---|---|---|
| Mon 7 Dec 2026 18:00 | 6 hours after now; notice is 12 | `too_soon` |
| Tue 8 Dec 2026 14:00 | 09:00 NY Tue, 26 hours ahead, on the grid | free |
| Tue 8 Dec 2026 14:07 | 09:07 NY, 7 minutes after a grid start | `off_grid` |
| Tue 8 Dec 2026 21:30 | 16:30 NY, ends 17:00, inside the window | free |
| Tue 8 Dec 2026 22:00 | 17:00 NY, ends 17:30, past the window | `outside_hours` |
| Sat 12 Dec 2026 15:00 | Saturday, no window | `outside_hours` |
| Fri 8 Jan 2027 14:00 | 32 days ahead; limit 30 | `too_far` |

Clock change, odd hours Sunday 01:00 to 04:00 New York, `now` = 1 March 2027 00:00 UTC:

| Local time asked, 14 Mar 2027 | Working | Result |
|---|---|---|
| 01:30 EST | = 06:30 UTC, exists | free |
| 02:30 | does not exist that day | not offered |
| 03:00 EDT | = 07:00 UTC | free |

## Database

Two functions, in the migration of spec 01:

- `onboarding_call_slot_problem(s onboarding_call_settings, p_starts_at timestamptz, p_now timestamptz, p_skip_notice boolean, p_exclude uuid) returns text`: the code of 02.1 to 02.9, or null. `stable`, not callable by `authenticated` or `anon`.
- `onboarding_call_free_slots(s onboarding_call_settings, p_now timestamptz, p_skip_notice boolean, p_exclude uuid) returns setof timestamptz`: 02.13, built on the check. Not callable by `authenticated` or `anon`.
- `onboarding_call_refuse(p_code text)`: raises the message for a code with `errcode P0001` and the code as `detail`. The only place the messages are written.

## Functions

- `preview_onboarding_call_slots(p_settings jsonb default null, p_now timestamptz default now(), p_skip_notice boolean default false) returns jsonb`: super admin only (`42501` otherwise). Settings are the live row with `p_settings` laid over it. Returns `{ "slots": [...] }`. Used by spec 06's preview and by the evals.
- `check_onboarding_call_slot(p_starts_at timestamptz, p_settings jsonb default null, p_now timestamptz default now()) returns text`: super admin only. The code or null. Used by the evals.

## Screens

None.

## Money and safety

None.

## Proof

| Statement | Proved by |
|---|---|
| 02.1 to 02.13, 02.15 to 02.19 | `evals/02-booking-rules.mjs` (each row of both tables) |
| 02.14 | `evals/02-booking-rules.mjs` (every listed time passes the check, and grid neighbours that fail are absent) |
| 02.20 | `evals/02-booking-rules.mjs` (two bookings sent at once from two companies) |

## Not in this spec

Who may book (spec 04). How times are shown in a zone (spec 03). Bryan's blocked periods and
how they are saved (spec 06).

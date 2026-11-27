# Spec 06 · Bryan's settings, blocked hours and the clash check

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 18, 31, 32, 33, 34, 35 · **Status:** Draft

## What this covers

How Bryan changes his hours, days off, blocked periods and the rest of his settings, and what
happens when a change would hit calls already booked.

## Behaviour

- 06.1 Settings change only through `admin_save_onboarding_call_settings`. A direct update of the settings row by a signed-in user is refused.
- 06.2 Only a super admin can save: `Super admin access required` otherwise.
- 06.3 The save takes any of: host name, title, email, photo, call link, call length, gap, zone, weekly hours, days off, notice, days ahead, taking calls, and the full list of blocked periods.
- 06.4 A blocked period is sent as a date, a from time, a to time (in Bryan's zone) and a label, and stored as two instants. "Thursday 3 December 2026, 14:00 to 16:00" in New York is stored as 19:00 to 21:00 UTC.
- 06.5 A blocked period whose to time is not after its from time is refused with `A blocked time must end after it starts`.
- 06.6 A zone, a window or a number out of range is refused as in spec 01 (01.3 to 01.5), and nothing is saved.
- 06.7 Before saving, the function lists every live future booking that would no longer pass spec 02's check under the new settings, ignoring notice and ignoring itself: a new day off, shorter hours, a new blocked period, a longer call that now runs past the window.
- 06.8 If that list is not empty and the call did not say what to do with each one, nothing is saved and the list is returned (`saved: false`, `clashes`).
- 06.9 What to do is given per booking: `keep` or `cancel`. A clash with no choice, or a choice for a booking that is not a clash, is refused with `Choose what to do with each booked call`.
- 06.10 With a choice for every clash, the settings are saved, every `cancel` booking is cancelled by `admin` with the reason `Bryan is no longer available at this time.` and its emails are queued (as spec 05.10), and every `keep` booking stays as it is.
- 06.11 Switching taking calls off is never a clash: booked calls stay. New bookings are refused (spec 02.1).
- 06.12 Changing the zone moves no booked call (spec 03.11). A booking that no longer fits Bryan's hours in the new zone is listed as a clash like any other.
- 06.13 Changing the call length is not a clash for calls that still fit; calls booked keep their own end (spec 02.16).
- 06.14 After a save, the free times on the portal follow the new settings at once: a blocked 14:00 to 16:00 removes 14:00, 14:30, 15:00 and 15:30 New York that day.

## Worked examples

None. (06.4's conversion is spec 03's: New York is UTC-5 on 3 December 2026, so 14:00 + 5 = 19:00 UTC.)

## Database

In the migration of spec 01. Revoke `update` on `onboarding_call_settings` from `authenticated`.

## Functions

`admin_save_onboarding_call_settings(p_settings jsonb, p_blocks jsonb default null, p_decisions jsonb default '{}')`
returns `{ saved: boolean, clashes: [{ id, tenant_id, company_name, name, starts_at, customer_timezone, problem }] }`.

- `p_settings`: any subset of the settings' columns. Unknown keys are refused with `Unknown setting <key>`.
- `p_blocks`: null keeps the list as it is; an array replaces it: `[{ date, from, to, label }]`.
- `p_decisions`: `{ "<booking id>": "keep" | "cancel" }`.
- `preview_onboarding_call_slots` (spec 02) shows the free times under unsaved settings.

## Screens

The Availability tab of spec 10.

## Money and safety

None. A cancel here emails a real company on production, so the page shows the list and asks
before sending it (spec 10).

## Proof

| Statement | Proved by |
|---|---|
| 06.1 to 06.14 | `evals/06-bryan-settings.mjs` (staging settings are put back as they were after every check) |

## Not in this spec

The rules themselves (spec 02). The page (spec 10).
